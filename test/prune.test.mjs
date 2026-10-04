import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { applyPrune, planPrune, vaultStats } from "../dist/core/prune.js";
import { createCheckpoint, getSyncStatus, getVaultStats, initializeSync, pruneVault } from "../dist/core/sync.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createTashevMcpServer } from "../dist/core/mcp.js";
import { runDoctor } from "../dist/core/doctor.js";
import { assessVault, getVaultHealth, readAutosyncConfig, runAutosyncTick, setAutosyncInterval, setAutosyncPrune } from "../dist/core/autosync.js";

const KEY = "0123456789abcdef0123456789abcdef0123456789abcdef";
const BLOB = 100 * 1024;
const PROJECTS = ["a".repeat(64), "b".repeat(64)];

function run(cwd, args, env = {}) {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return r.stdout.trim();
}

function seedBare(base, name) {
  const bare = join(base, name + ".git");
  const seed = join(base, name + "-seed");
  mkdirSync(seed, { recursive: true });
  run(base, ["init", "--bare", "-q", bare]);
  run(seed, ["init", "-q", "-b", "main"]);
  run(seed, ["config", "user.email", "test@example.com"]);
  run(seed, ["config", "user.name", "Test"]);
  writeFileSync(join(seed, "README.md"), `# ${name}\n`, "utf8");
  run(seed, ["add", "."]);
  run(seed, ["commit", "-qm", "init"]);
  run(seed, ["remote", "add", "origin", bare]);
  run(seed, ["push", "-q", "-u", "origin", "main"]);
  return bare;
}

// Adds `count` checkpoint commits to a vault clone. Checkpoint number `first + i` belongs to project
// PROJECTS[(first + i) % 2] and carries its own random (incompressible) BLOB-byte file, like a real latest.tash.
function addCheckpoints(vault, count, first = 0) {
  for (let i = 0; i < count; i += 1) {
    const id = PROJECTS[(first + i) % PROJECTS.length];
    const relative = `projects/${id}/latest.tash`;
    mkdirSync(join(vault, "projects", id), { recursive: true });
    writeFileSync(join(vault, relative), randomBytes(BLOB));
    run(vault, ["add", "--", relative]);
    const when = new Date(Date.UTC(2026, 8, 1, 0, first + i)).toISOString();
    run(vault, ["commit", "-q", "-m", `checkpoint ${id.slice(0, 12)} ${when}`], { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when });
  }
}

// Every file under `dir` mapped to "size:mtime", to prove that a read-only operation left the directory untouched.
function snapshot(dir) {
  const files = {};
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else {
        const stat = statSync(path);
        files[relative(dir, path)] = `${stat.size}:${stat.mtimeMs}`;
      }
    }
  };
  walk(dir);
  return files;
}

// Sum of the sizes of every file under `dir`, measured independently of git.
function dirBytes(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    total += entry.isDirectory() ? dirBytes(path) : statSync(path).size;
  }
  return total;
}

function objectExists(repo, id) {
  return spawnSync("git", ["-C", repo, "cat-file", "-e", id], { stdio: "ignore" }).status === 0;
}

// Another computer: its own clone of the vault remote.
function cloneDevice(base, remote, name) {
  const dir = join(base, name);
  run(base, ["clone", "-q", remote, dir]);
  run(dir, ["config", "user.email", "tashevos@local"]);
  run(dir, ["config", "user.name", "TashevOS"]);
  return dir;
}

// A vault remote plus a clone of it holding the seed commit and `checkpoints` pushed checkpoint commits.
function buildVault(base, checkpoints) {
  const remote = seedBare(base, "vault-remote");
  const vault = join(base, "vault");
  run(base, ["clone", "-q", remote, vault]);
  run(vault, ["config", "user.email", "tashevos@local"]);
  run(vault, ["config", "user.name", "TashevOS"]);
  addCheckpoints(vault, checkpoints);
  run(vault, ["push", "-q", "origin", "main"]);
  return { remote, vault };
}

test("planPrune keeps exactly the newest `keep` commits of the branch", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-plan-"));
  try {
    const { vault } = buildVault(base, 6);
    const tip = run(vault, ["rev-parse", "HEAD"]);

    const plan = planPrune(vault, "main", 2);

    assert.equal(plan.tip, tip);
    assert.equal(plan.commitsTotal, 7); // seed commit + 6 checkpoints
    assert.equal(plan.commitsKept, 2);
    assert.equal(plan.commitsDropped, 5);
    assert.equal(plan.rewrite, true);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("planPrune never writes to the vault", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-readonly-"));
  try {
    const { vault } = buildVault(base, 6);
    const before = snapshot(join(vault, ".git"));

    planPrune(vault, "main", 2);

    assert.deepEqual(snapshot(join(vault, ".git")), before);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("planPrune leaves a history alone when it already fits into keep", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-fits-"));
  try {
    const { vault } = buildVault(base, 3); // seed + 3 checkpoints = 4 commits

    for (const keep of [4, 10]) {
      const plan = planPrune(vault, "main", keep);
      assert.equal(plan.rewrite, false, `keep=${keep} must not rewrite a 4-commit history`);
      assert.equal(plan.commitsKept, 4);
      assert.equal(plan.commitsDropped, 0);
      assert.equal(plan.bytesReclaimable, 0);
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("planPrune rejects a keep that is not a positive integer", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-keep-"));
  try {
    const { vault } = buildVault(base, 2);
    // keep=0 would otherwise plan to drop every commit; a huge keep would spawn two git processes per kept commit.
    for (const keep of [0, -1, 1.5, Number.NaN, "3", 10_001, 1e21]) {
      assert.throws(() => planPrune(vault, "main", keep), /keep/, `keep=${String(keep)} must be refused`);
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("planPrune names the missing branch instead of surfacing a bare git error", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-branch-"));
  try {
    const { vault } = buildVault(base, 2);
    assert.throws(() => planPrune(vault, "no-such-branch", 2), /branch "no-such-branch"/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("planPrune counts as reclaimable only objects that no kept commit references", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-bytes-"));
  try {
    const { vault } = buildVault(base, 6);

    // Checkpoints are A1 B1 A2 B2 A3 B3. The last two commits hold trees {A3, B2} and {A3, B3},
    // so exactly three blobs (A1, B1, A2) become unreachable: 3 x 100 KiB plus a few KiB of trees/commits.
    const plan = planPrune(vault, "main", 2);

    assert.ok(plan.bytesReclaimable >= 3 * BLOB, `reclaimable ${plan.bytesReclaimable} is below the three dropped blobs`);
    assert.ok(plan.bytesReclaimable < 3 * BLOB + 16 * 1024, `reclaimable ${plan.bytesReclaimable} counts a kept blob`);
    assert.ok(plan.bytesRetained >= 3 * BLOB, "the three blobs of the kept trees must stay");
    assert.equal(plan.bytesRetained + plan.bytesReclaimable, plan.bytesOnDisk);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

for (const keep of [1, 2, 6]) {
  test(`applyPrune replaces the remote history with the newest ${keep} commit(s) and keeps the current data`, () => {
    const base = mkdtempSync(join(tmpdir(), "tashevos-prune-apply-"));
    try {
      const { remote, vault } = buildVault(base, 6); // seed + 6 checkpoints = 7 commits
      const oldTree = run(vault, ["rev-parse", "HEAD^{tree}"]);
      const keptLog = run(vault, ["log", `-${keep}`, "--format=%s|%an|%aI|%cI"]);

      const outcome = applyPrune(vault, planPrune(vault, "main", keep));

      assert.equal(run(remote, ["rev-list", "--count", "main"]), String(keep));
      assert.equal(run(remote, ["rev-list", "--max-parents=0", "main"]).split("\n").length, 1, "the rewritten history has a single root");
      assert.equal(run(remote, ["rev-parse", "main"]), outcome.newTip);
      assert.equal(run(vault, ["rev-parse", "HEAD"]), outcome.newTip);
      assert.equal(run(vault, ["rev-parse", "refs/remotes/origin/main"]), outcome.newTip);
      assert.equal(run(remote, ["rev-parse", "main^{tree}"]), oldTree, "the current data must be byte-identical");
      assert.equal(run(remote, ["log", "--format=%s|%an|%aI|%cI"]), keptLog, "kept commits keep message, author and dates");
      assert.equal(run(vault, ["status", "--porcelain"]), "", "the vault work tree stays clean");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
}

test("applyPrune deletes the dropped objects from the vault and reports the space it freed", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-free-"));
  try {
    const { vault } = buildVault(base, 6);
    const droppedCommit = run(vault, ["rev-parse", "HEAD~5"]); // checkpoint A1
    const droppedBlob = run(vault, ["rev-parse", `HEAD~5:projects/${PROJECTS[0]}/latest.tash`]);
    const keptBlob = run(vault, ["rev-parse", `HEAD:projects/${PROJECTS[0]}/latest.tash`]); // A3
    const plan = planPrune(vault, "main", 2);
    const before = dirBytes(join(vault, ".git", "objects"));

    const outcome = applyPrune(vault, plan);

    const after = dirBytes(join(vault, ".git", "objects"));
    assert.equal(objectExists(vault, droppedCommit), false, "the dropped commit must be gone, reflog included");
    assert.equal(objectExists(vault, droppedBlob), false, "the dropped blob must be gone");
    assert.equal(objectExists(vault, keptBlob), true, "a blob that a kept tree references must survive");
    assert.ok(before - after >= 3 * BLOB - 4096, `only ${before - after} bytes freed, three blobs were dropped`);
    assert.ok(Math.abs(before - after - plan.bytesReclaimable) < 16 * 1024, "the plan must predict what is really freed");
    assert.ok(outcome.bytesFreed >= 3 * BLOB - 4096, "the outcome reports the measured space");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("applyPrune refuses to overwrite a remote that moved after the plan was made", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-lease-"));
  try {
    const { remote, vault } = buildVault(base, 6);
    const plan = planPrune(vault, "main", 2);
    const device = cloneDevice(base, remote, "device-b");
    addCheckpoints(device, 1, 100);
    run(device, ["push", "-q", "origin", "main"]);
    const theirs = run(device, ["rev-parse", "HEAD"]);

    assert.throws(() => applyPrune(vault, plan), /changed since it was fetched/);

    assert.equal(run(remote, ["rev-parse", "main"]), theirs, "the other computer's checkpoint must survive");
    assert.equal(run(remote, ["rev-list", "--count", "main"]), "8");
    assert.equal(run(vault, ["rev-parse", "HEAD"]), plan.tip, "the local branch must not move");
    assert.equal(objectExists(vault, run(vault, ["rev-parse", "HEAD~5"])), true, "nothing may be deleted when the push is refused");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("applyPrune refuses to drop local commits that the remote has never seen", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-unpushed-"));
  try {
    const { remote, vault } = buildVault(base, 6);
    const remoteTip = run(remote, ["rev-parse", "main"]);
    addCheckpoints(vault, 1, 100); // committed locally, never pushed
    const plan = planPrune(vault, "main", 2);

    assert.throws(() => applyPrune(vault, plan), /not on the remote/);

    assert.equal(run(remote, ["rev-parse", "main"]), remoteTip);
    assert.equal(run(vault, ["rev-parse", "HEAD"]), plan.tip);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("applyPrune on a history that already fits only reclaims local garbage and never pushes", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-garbage-"));
  try {
    const { remote, vault } = buildVault(base, 3);
    const remoteTip = run(remote, ["rev-parse", "main"]);
    // A failed push attempt leaves a commit and its blob reachable only through the reflog.
    addCheckpoints(vault, 1, 100);
    const garbageBlob = run(vault, ["rev-parse", `HEAD:projects/${PROJECTS[0]}/latest.tash`]);
    run(vault, ["reset", "-q", "--hard", "origin/main"]);
    const plan = planPrune(vault, "main", 10);
    assert.equal(plan.rewrite, false);
    assert.ok(plan.bytesReclaimable >= BLOB, "the reflog-only blob must be counted as reclaimable");

    const outcome = applyPrune(vault, plan);

    assert.equal(outcome.newTip, plan.tip);
    assert.equal(run(remote, ["rev-parse", "main"]), remoteTip, "a history that fits must not be rewritten");
    assert.equal(objectExists(vault, garbageBlob), false, "the garbage must be gone");
    assert.ok(outcome.bytesFreed >= BLOB - 4096);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("applyPrune frees loose objects without needing gc, so a broken gc cannot get in the way", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-nogc-"));
  try {
    const { vault } = buildVault(base, 6);
    const droppedBlob = run(vault, ["rev-parse", `HEAD~5:projects/${PROJECTS[0]}/latest.tash`]);
    run(vault, ["config", "gc.auto", "notanumber"]); // `git gc` now exits with an error, `git prune` still works

    const outcome = applyPrune(vault, planPrune(vault, "main", 2));

    assert.equal(objectExists(vault, droppedBlob), false, "space must be freed by the prune alone");
    assert.ok(outcome.bytesFreed >= 3 * BLOB - 4096);
    assert.deepEqual(outcome.warnings, [], "nothing was left to repack, so gc must not even be attempted");
    assert.ok(Number(run(vault, ["count-objects", "-v"]).match(/^count: (\d+)$/m)[1]) > 0, "loose objects must not be rewritten into a pack for nothing");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("applyPrune reclaims objects that sit inside a pack, which only a repack can drop", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-packed-"));
  try {
    const { vault } = buildVault(base, 6);
    run(vault, ["gc", "-q"]); // like a fresh clone: every object is packed, none is loose
    const droppedBlob = run(vault, ["rev-parse", `HEAD~5:projects/${PROJECTS[0]}/latest.tash`]);
    const before = dirBytes(join(vault, ".git", "objects"));

    const outcome = applyPrune(vault, planPrune(vault, "main", 2));

    assert.equal(objectExists(vault, droppedBlob), false, "a packed dropped blob must be gone");
    assert.ok(before - dirBytes(join(vault, ".git", "objects")) >= 3 * BLOB - 8192, "the pack must shrink by the dropped blobs");
    assert.deepEqual(outcome.warnings, []);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("applyPrune reports a failing repack as a warning and keeps the rewritten history", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-gcwarn-"));
  try {
    const { remote, vault } = buildVault(base, 6);
    run(vault, ["gc", "-q"]);
    run(vault, ["config", "gc.auto", "notanumber"]);

    const outcome = applyPrune(vault, planPrune(vault, "main", 2));

    assert.equal(outcome.pushed, true);
    assert.equal(run(remote, ["rev-list", "--count", "main"]), "2");
    assert.equal(outcome.warnings.length, 1);
    assert.match(outcome.warnings[0], /gc/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// Runs `fn` as one computer: every TashevOS call inside sees that computer's ~/.tashevos.
function atHome(home, fn) {
  const previous = process.env.TASHEVOS_HOME;
  process.env.TASHEVOS_HOME = home;
  try { return fn(); }
  finally {
    if (previous === undefined) delete process.env.TASHEVOS_HOME;
    else process.env.TASHEVOS_HOME = previous;
  }
}

// A configured sync home whose vault clone holds `checkpoints` pushed checkpoint commits on top of the seed commit.
function buildSyncedVault(base, checkpoints) {
  const remote = seedBare(base, "vault-remote");
  const home = join(base, "home");
  atHome(home, () => initializeSync(remote, KEY));
  const vault = join(home, "vault");
  addCheckpoints(vault, checkpoints);
  run(vault, ["push", "-q", "origin", "main"]);
  return { remote, home, vault };
}

test("pruneVault without --apply plans offline and leaves the vault untouched", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-dry-"));
  try {
    const { home, vault } = buildSyncedVault(base, 6);
    run(vault, ["remote", "set-url", "origin", join(base, "unreachable.git")]); // any network access would now fail
    const before = snapshot(join(vault, ".git"));

    const report = atHome(home, () => pruneVault({ keep: 2 }));

    assert.equal(report.applied, false);
    assert.equal(report.outcome, undefined);
    assert.equal(report.plan.commitsDropped, 5);
    assert.ok(report.plan.bytesReclaimable >= 3 * BLOB);
    assert.deepEqual(snapshot(join(vault, ".git")), before);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("pruneVault keeps the newest 10 commits when no keep is given", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-default-"));
  try {
    const { home } = buildSyncedVault(base, 12); // seed + 12 checkpoints = 13 commits

    const report = atHome(home, () => pruneVault());

    assert.equal(report.plan.commitsKept, 10);
    assert.equal(report.plan.rewrite, true);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("pruneVault --apply rewrites the remote history and never needs the sync key", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-nokey-"));
  try {
    const { remote, home, vault } = buildSyncedVault(base, 6);
    rmSync(join(home, "sync.key")); // the key file of this throwaway test home; without it a key read would throw
    const oldTree = run(vault, ["rev-parse", "HEAD^{tree}"]);

    const report = atHome(home, () => pruneVault({ keep: 2, apply: true }));

    assert.equal(report.applied, true);
    assert.equal(report.outcome.pushed, true);
    assert.equal(run(remote, ["rev-list", "--count", "main"]), "2");
    assert.equal(run(remote, ["rev-parse", "main^{tree}"]), oldTree);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("pruneVault --apply first catches up with a remote this computer has not fetched yet", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-fetch-"));
  try {
    const { remote, home } = buildSyncedVault(base, 4);
    const other = cloneDevice(base, remote, "other-computer");
    addCheckpoints(other, 2, 100);
    run(other, ["push", "-q", "origin", "main"]);
    const theirs = run(other, ["rev-parse", "HEAD"]);

    const report = atHome(home, () => pruneVault({ keep: 2, apply: true }));

    assert.equal(report.plan.tip, theirs, "the plan must be made for the freshly fetched tip");
    assert.equal(run(remote, ["rev-parse", "main^{tree}"]), run(other, ["rev-parse", "HEAD^{tree}"]), "the other computer's checkpoints are part of the kept data");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// Computer A has made `checkpoints` real encrypted checkpoints, computer B has fetched them all, then A pruned the
// vault to keep=2. B is left holding the old history. Both use the same key but their own ~/.tashevos.
function twoComputersAfterPrune(base, checkpoints) {
  const vaultRemote = seedBare(base, "vault-remote");
  const projectA = seedBare(base, "project-a");
  const projectB = seedBare(base, "project-b");
  const homeA = join(base, "home-a");
  const homeB = join(base, "home-b");
  const workA = join(base, "work-a");
  const workB = join(base, "work-b");
  run(base, ["clone", "-q", projectA, workA]);
  run(base, ["clone", "-q", projectB, workB]);
  atHome(homeA, () => initializeSync(vaultRemote, KEY));
  atHome(homeB, () => initializeSync(vaultRemote, KEY));
  for (let i = 1; i <= checkpoints; i += 1) atHome(homeA, () => createCheckpoint(workA, `A step ${i}`));
  atHome(homeB, () => getSyncStatus(workA)); // B fetches the whole old history
  const vaultB = join(homeB, "vault");
  const staleTip = run(vaultB, ["rev-parse", "HEAD"]);
  atHome(homeA, () => pruneVault({ keep: 2, apply: true }));
  return { vaultRemote, homeA, homeB, workA, workB, vaultB, staleTip };
}

test("a computer that still holds the old history keeps checkpointing after another one pruned", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-lag-"));
  try {
    const c = twoComputersAfterPrune(base, 3);
    assert.equal(run(c.vaultB, ["rev-parse", "HEAD"]), c.staleTip, "B has not noticed the rewrite yet");
    run(c.vaultB, ["commit", "--allow-empty", "-q", "-m", "leftover of a failed push"]);

    const checkpoint = atHome(c.homeB, () => createCheckpoint(c.workB, "B after the prune"));

    assert.equal(run(c.vaultRemote, ["rev-list", "--count", "main"]), "3", "2 kept commits + B's checkpoint, no resurrected history");
    assert.equal(run(c.vaultRemote, ["rev-parse", "main"]), checkpoint.vaultCommit);
    assert.equal(run(c.vaultRemote, ["log", "--format=%s", "--grep=leftover"]), "", "B's leftover must not reach the remote");
    assert.equal(atHome(c.homeB, () => getSyncStatus(c.workA)).task, "A step 3", "A's checkpoint survived the rewrite and still decrypts");
    assert.equal(atHome(c.homeA, () => getSyncStatus(c.workB)).task, "B after the prune");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("pruning on the lagging computer reclaims its old objects and does not rewrite the remote again", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-lag-reclaim-"));
  try {
    const c = twoComputersAfterPrune(base, 3);
    const oldCheckpoint = run(c.vaultB, ["rev-parse", `${c.staleTip}~2`]); // A's first checkpoint, only in B's stale history
    atHome(c.homeB, () => createCheckpoint(c.workB, "B after the prune"));
    const remoteTip = run(c.vaultRemote, ["rev-parse", "main"]);
    assert.equal(objectExists(c.vaultB, oldCheckpoint), true, "B still carries the old history as garbage");

    const report = atHome(c.homeB, () => pruneVault({ keep: 5, apply: true }));

    assert.equal(report.plan.rewrite, false);
    assert.equal(report.outcome.pushed, false);
    assert.equal(run(c.vaultRemote, ["rev-parse", "main"]), remoteTip);
    assert.equal(objectExists(c.vaultB, oldCheckpoint), false, "the old history must be gone from B's disk");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

function tash(home, args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: { ...process.env, TASHEVOS_HOME: home } });
}

test("tash sync prune without --yes only reports and tells how to apply", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-cli-report-"));
  try {
    const { remote, home } = buildSyncedVault(base, 6);
    const remoteTip = run(remote, ["rev-parse", "main"]);

    const result = tash(home, ["sync", "prune", "--keep", "2"]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /--yes/);
    assert.equal(run(remote, ["rev-parse", "main"]), remoteTip);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("tash sync prune --yes rewrites the remote history", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-cli-yes-"));
  try {
    const { remote, home } = buildSyncedVault(base, 6);

    const result = tash(home, ["sync", "prune", "--keep", "2", "--yes"]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(run(remote, ["rev-list", "--count", "main"]), "2");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("tash sync prune --dry-run wins over --yes", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-cli-dry-"));
  try {
    const { remote, home } = buildSyncedVault(base, 6);
    const remoteTip = run(remote, ["rev-parse", "main"]);

    const result = tash(home, ["sync", "prune", "--keep", "2", "--dry-run", "--yes"]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(run(remote, ["rev-parse", "main"]), remoteTip);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("tash sync prune refuses a keep below 1 before touching anything", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-cli-keep-"));
  try {
    const { remote, home } = buildSyncedVault(base, 6);
    const remoteTip = run(remote, ["rev-parse", "main"]);

    const result = tash(home, ["sync", "prune", "--keep", "0", "--yes"]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /keep/);
    assert.equal(run(remote, ["rev-parse", "main"]), remoteTip);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("tash sync prune --yes waits out a running autosync pass, but the report stays available", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-cli-lock-"));
  try {
    const { remote, home } = buildSyncedVault(base, 6);
    const remoteTip = run(remote, ["rev-parse", "main"]);
    writeFileSync(join(home, "autosync.lock"), String(process.pid), "utf8"); // a live pid: an autosync pass is running

    const applied = tash(home, ["sync", "prune", "--keep", "2", "--yes"]);
    const report = tash(home, ["sync", "prune", "--keep", "2"]);

    assert.notEqual(applied.status, 0);
    assert.match(applied.stderr, /autosync/i);
    assert.equal(run(remote, ["rev-parse", "main"]), remoteTip, "nothing may be rewritten while the vault is in use");
    assert.equal(report.status, 0, report.stderr);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("the autosync prune policy is saved and survives other autosync config changes", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-policy-"));
  try {
    const home = join(base, "home");
    assert.equal(atHome(home, () => readAutosyncConfig().prune), undefined, "off by default");

    atHome(home, () => setAutosyncPrune(3));
    atHome(home, () => setAutosyncInterval(120)); // rewrites the whole config file

    assert.deepEqual(atHome(home, () => readAutosyncConfig().prune), { keep: 3 });
    atHome(home, () => setAutosyncPrune(null));
    assert.equal(atHome(home, () => readAutosyncConfig().prune), undefined);
    assert.throws(() => atHome(home, () => setAutosyncPrune(0)), /keep/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("an autosync pass never rewrites the vault history unless the owner turned the policy on", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-tick-off-"));
  try {
    const { remote, home } = buildSyncedVault(base, 6);
    const remoteTip = run(remote, ["rev-parse", "main"]);

    const tick = atHome(home, () => runAutosyncTick());

    assert.equal(tick.prune, undefined);
    assert.equal(run(remote, ["rev-parse", "main"]), remoteTip);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("an autosync pass prunes the vault at most once every 24 hours", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-tick-daily-"));
  try {
    const { remote, home } = buildSyncedVault(base, 6);
    atHome(home, () => setAutosyncPrune(2));

    const first = atHome(home, () => runAutosyncTick());
    assert.equal(first.prune.result, "pruned");
    assert.equal(first.prune.commitsDropped, 5);
    assert.equal(run(remote, ["rev-list", "--count", "main"]), "2");

    const other = cloneDevice(base, remote, "other-computer");
    addCheckpoints(other, 3, 100);
    run(other, ["push", "-q", "origin", "main"]);
    const second = atHome(home, () => runAutosyncTick());
    assert.equal(second.prune.result, "not-due", "a second pass within the day must leave the vault alone");
    assert.equal(run(remote, ["rev-list", "--count", "main"]), "5");

    const statePath = join(home, "autosync-prune.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    state.lastAttemptAt = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    state.lastRewriteAt = state.lastAttemptAt;
    writeFileSync(statePath, JSON.stringify(state));
    const third = atHome(home, () => runAutosyncTick());
    assert.equal(third.prune.result, "pruned");
    assert.equal(run(remote, ["rev-list", "--count", "main"]), "2");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("a failing scheduled prune is recorded, does not throw out of the pass and is not retried within the day", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-tick-error-"));
  try {
    const { home } = buildSyncedVault(base, 6);
    atHome(home, () => setAutosyncPrune(2));
    const syncJson = join(home, "sync.json");
    const config = JSON.parse(readFileSync(syncJson, "utf8"));
    writeFileSync(syncJson, JSON.stringify({ ...config, remote: join(base, "gone.git") })); // the fetch will fail

    const first = atHome(home, () => runAutosyncTick());
    const second = atHome(home, () => runAutosyncTick());

    assert.equal(first.prune.result, "error");
    assert.equal(typeof first.prune.error, "string");
    assert.equal(second.prune.result, "not-due");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("tash autosync prune turns the policy on and --off turns it off", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-cli-policy-"));
  try {
    const home = join(base, "home");

    const on = tash(home, ["autosync", "prune", "--keep", "7", "--yes"]);
    assert.equal(on.status, 0, on.stderr);
    assert.deepEqual(atHome(home, () => readAutosyncConfig().prune), { keep: 7 });

    const off = tash(home, ["autosync", "prune", "--off"]);
    assert.equal(off.status, 0, off.stderr);
    assert.equal(atHome(home, () => readAutosyncConfig().prune), undefined);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("planPrune does not promise to free objects that another ref keeps alive, and names that ref", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-otherref-"));
  try {
    const { vault } = buildVault(base, 6);
    const pinnedBlob = run(vault, ["rev-parse", `HEAD~5:projects/${PROJECTS[0]}/latest.tash`]); // A1
    run(vault, ["tag", "old-checkpoint", "HEAD~5"]);

    // Without the tag three blobs (A1, B1, A2) would go; the tag keeps A1 alive, so only B1 and A2 are freeable.
    const plan = planPrune(vault, "main", 2);
    const before = dirBytes(join(vault, ".git", "objects"));
    applyPrune(vault, plan);
    const freed = before - dirBytes(join(vault, ".git", "objects"));

    assert.ok(plan.bytesReclaimable >= 2 * BLOB, `reclaimable ${plan.bytesReclaimable} is below the two freeable blobs`);
    assert.ok(plan.bytesReclaimable < 2 * BLOB + 16 * 1024, `reclaimable ${plan.bytesReclaimable} counts the blob the tag keeps`);
    assert.equal(plan.warnings.length, 1);
    assert.match(plan.warnings[0], /refs\/tags\/old-checkpoint/);
    assert.equal(objectExists(vault, pinnedBlob), true, "the tagged checkpoint must survive");
    assert.ok(freed >= 2 * BLOB - 4096 && freed < 2 * BLOB + 16 * 1024, `freed ${freed} bytes, expected about the two unpinned blobs`);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("planPrune has nothing to warn about in a vault that only has its own refs", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-ownrefs-"));
  try {
    const { vault } = buildVault(base, 3);
    assert.deepEqual(planPrune(vault, "main", 2).warnings, []);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("planPrune reports the upload a rewrite costs: the whole kept window, which git cannot link to the old history", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-upload-"));
  try {
    const { remote, vault } = buildVault(base, 6);
    const plan = planPrune(vault, "main", 2);
    applyPrune(vault, plan);

    // What git push really sends: the pack for the rewritten branch minus what the remote advertised (the old tip).
    const pushed = spawnSync("git", ["-C", remote, "pack-objects", "--revs", "--thin", "--stdout", "-q"], {
      input: `${run(remote, ["rev-parse", "main"])}\n^${plan.tip}\n`,
      maxBuffer: 64 * 1024 * 1024
    }).stdout.length;

    assert.ok(pushed >= 3 * BLOB, "git re-sends the blobs of the kept trees (A3, B2, B3) although the remote has them");
    assert.ok(Math.abs(plan.bytesToUpload - pushed) < 16 * 1024, `planned ${plan.bytesToUpload} bytes, git sent ${pushed}`);
    assert.equal(planPrune(vault, "main", 10).bytesToUpload, 0, "a history that fits is not pushed at all");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("planPrune can wait for a longer history before it rewrites anything", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-above-"));
  try {
    const { vault } = buildVault(base, 6); // 7 commits

    const waiting = planPrune(vault, "main", 2, 7);
    assert.equal(waiting.rewrite, false, "7 commits are not more than 7");
    assert.equal(waiting.commitsKept, 7);
    assert.equal(waiting.commitsDropped, 0);
    assert.equal(waiting.bytesReclaimable, 0);
    assert.equal(waiting.bytesToUpload, 0);

    const due = planPrune(vault, "main", 2, 6);
    assert.equal(due.rewrite, true);
    assert.equal(due.commitsKept, 2, "once it rewrites, it keeps exactly keep commits");

    assert.throws(() => planPrune(vault, "main", 5, 4), /rewriteAbove/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("a scheduled prune waits until the history is twice as long as keep, then cuts it back to keep", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-tick-wait-"));
  try {
    const { remote, home } = buildSyncedVault(base, 4); // 5 commits
    atHome(home, () => setAutosyncPrune(3)); // rewrites only above 6 commits

    const early = atHome(home, () => runAutosyncTick());
    assert.equal(early.prune.result, "reclaimed");
    assert.equal(early.prune.commitsDropped, 0);
    assert.equal(run(remote, ["rev-list", "--count", "main"]), "5", "no forced push for a history this short");
    const vault = join(home, "vault");
    assert.ok(Number(run(vault, ["count-objects", "-v"]).match(/^count: (\d+)$/m)[1]) > 0, "a history that waits has nothing to repack");

    const other = cloneDevice(base, remote, "other-computer");
    addCheckpoints(other, 3, 100); // 8 commits
    run(other, ["push", "-q", "origin", "main"]);
    const statePath = join(home, "autosync-prune.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    writeFileSync(statePath, JSON.stringify({ ...state, lastAttemptAt: new Date(Date.now() - 25 * 3600 * 1000).toISOString() }));

    const due = atHome(home, () => runAutosyncTick());
    assert.equal(due.prune.result, "pruned");
    assert.equal(run(remote, ["rev-list", "--count", "main"]), "3");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("pruneVault reports a vault that was never cloned instead of cloning it just to prune it", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-noclone-"));
  try {
    const remote = seedBare(base, "vault-remote");
    const home = join(base, "home");
    atHome(home, () => initializeSync(remote, KEY));
    rmSync(join(home, "vault"), { recursive: true, force: true });

    for (const apply of [false, true]) {
      assert.throws(() => atHome(home, () => pruneVault({ apply })), /not cloned/);
    }
    assert.equal(existsSync(join(home, "vault")), false, "pruning must not clone the vault as a side effect");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// Merges a side branch (forked one commit back) into main with --no-ff and pushes: the vault never does this itself.
function addMerge(vault) {
  run(vault, ["checkout", "-q", "-b", "side", "HEAD~1"]);
  writeFileSync(join(vault, "side.txt"), "side work\n", "utf8");
  run(vault, ["add", "side.txt"]);
  run(vault, ["commit", "-q", "-m", "side work"]);
  run(vault, ["checkout", "-q", "main"]);
  run(vault, ["merge", "-q", "--no-ff", "-m", "merge side", "side"]);
  run(vault, ["branch", "-q", "-D", "side"]); // the side commit stays reachable only through the merge
  run(vault, ["push", "-q", "origin", "main"]);
}

test("a merge commit inside the kept window is reported and refused, never silently flattened", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-merge-"));
  try {
    const { remote, vault } = buildVault(base, 6);
    addMerge(vault);
    const remoteTip = run(remote, ["rev-parse", "main"]);
    const plan = planPrune(vault, "main", 2);

    assert.equal(plan.warnings.length, 1);
    assert.match(plan.warnings[0], /merge/);
    assert.throws(() => applyPrune(vault, plan), /merge/);
    assert.equal(run(remote, ["rev-parse", "main"]), remoteTip, "nothing may be rewritten");
    assert.equal(run(vault, ["rev-parse", "HEAD"]), plan.tip);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("a merge commit that is older than the kept window does not block the prune", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-oldmerge-"));
  try {
    const { remote, vault } = buildVault(base, 3);
    addMerge(vault);
    addCheckpoints(vault, 4, 100);
    run(vault, ["push", "-q", "origin", "main"]);
    const plan = planPrune(vault, "main", 2);
    assert.deepEqual(plan.warnings, []);

    applyPrune(vault, plan);

    assert.equal(run(remote, ["rev-list", "--count", "main"]), "2");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("applyPrune keeps a rewrite that succeeded when the remote cannot be queried afterwards, and warns", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-lsremote-"));
  try {
    const { remote, vault } = buildVault(base, 6);
    run(vault, ["config", "remote.origin.pushurl", remote]); // the push still reaches the real remote ...
    run(vault, ["remote", "set-url", "origin", join(base, "unreachable.git")]); // ... but ls-remote does not

    const outcome = applyPrune(vault, planPrune(vault, "main", 2));

    assert.equal(outcome.pushed, true);
    assert.equal(run(remote, ["rev-list", "--count", "main"]), "2");
    assert.equal(run(vault, ["rev-parse", "HEAD"]), outcome.newTip);
    assert.equal(outcome.warnings.length, 1);
    assert.match(outcome.warnings[0], /confirm/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("planPrune refuses a branch name that git would not accept, before it reaches any refspec", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-badbranch-"));
  try {
    const { vault } = buildVault(base, 2);
    // A colon would shift the split point of --force-with-lease=<ref>:<expect>.
    for (const branch of ["a:b", "a..b", "has space", "x@{1}", ""]) {
      assert.throws(() => planPrune(vault, branch, 2), /Invalid vault branch/, `branch ${JSON.stringify(branch)} must be refused`);
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("applyPrune warns, but does not fail, when the remote reports another tip after the push", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-othertip-"));
  try {
    const { remote, vault } = buildVault(base, 6);
    const elsewhere = seedBare(base, "elsewhere"); // stands in for a remote that moved on (another computer pushed right after us)
    run(vault, ["config", "remote.origin.pushurl", remote]);
    run(vault, ["remote", "set-url", "origin", elsewhere]);

    const outcome = applyPrune(vault, planPrune(vault, "main", 2));

    assert.equal(outcome.pushed, true);
    assert.equal(run(remote, ["rev-list", "--count", "main"]), "2");
    assert.equal(outcome.warnings.length, 1);
    assert.match(outcome.warnings[0], /instead of/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("vaultStats counts the commits of the branch and the disk the objects take", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-vault-stats-"));
  try {
    const { vault } = buildVault(base, 6); // seed + 6 checkpoints = 7 commits

    const stats = vaultStats(vault, "main");

    assert.equal(stats.commits, 7);
    // six 100 KiB blobs are on disk; the ~40 small loose objects add less than 512 KiB of block rounding
    assert.ok(stats.bytes >= 6 * BLOB, `${stats.bytes} bytes is less than the six checkpoint blobs`);
    assert.ok(stats.bytes < 6 * BLOB + 512 * 1024, `${stats.bytes} bytes counts far more than the objects`);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("vaultStats still counts the objects once git has packed them", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-vault-stats-packed-"));
  try {
    const { vault } = buildVault(base, 6);
    run(vault, ["gc", "-q"]); // loose objects are gone, everything sits in a pack

    assert.ok(vaultStats(vault, "main").bytes >= 6 * BLOB, "packed objects must be counted too");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("getVaultStats knows nothing until sync is configured and the vault is cloned, then reads it offline", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-vault-getstats-"));
  try {
    const home = join(base, "home");
    assert.equal(atHome(home, () => getVaultStats()), null, "sync is not configured yet");

    const remote = seedBare(base, "vault-remote");
    atHome(home, () => initializeSync(remote, KEY));
    const vault = join(home, "vault");
    addCheckpoints(vault, 3);
    run(vault, ["remote", "set-url", "origin", join(base, "unreachable.git")]); // any network access would now fail
    const before = snapshot(join(vault, ".git"));

    const stats = atHome(home, () => getVaultStats());

    assert.equal(stats.commits, 4); // seed + 3 checkpoints
    assert.ok(stats.bytes >= 3 * BLOB);
    assert.deepEqual(snapshot(join(vault, ".git")), before, "reading the stats must not write to the vault");

    rmSync(vault, { recursive: true, force: true });
    assert.equal(atHome(home, () => getVaultStats()), null, "the vault clone is gone");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

const MiB = 1024 * 1024;

test("assessVault warns only when automation is off and the vault is past 20 commits or 200 MiB", () => {
  const cases = [
    { stats: { commits: 11, bytes: 63 * MiB }, level: "ok", why: "a freshly pruned vault" },
    { stats: { commits: 20, bytes: 63 * MiB }, level: "ok", why: "20 commits is still within the limit" },
    { stats: { commits: 21, bytes: 63 * MiB }, level: "grown", why: "21 commits is past it" },
    { stats: { commits: 5, bytes: 200 * MiB }, level: "ok", why: "exactly 200 MiB is still within the limit" },
    { stats: { commits: 5, bytes: 200 * MiB + 1 }, level: "grown", why: "a few heavy checkpoints can outgrow it with few commits" }
  ];
  for (const { stats, level, why } of cases) {
    assert.equal(assessVault(stats, undefined, {}).level, level, why);
  }
});

test("assessVault names the commands that fix a vault that has grown again", () => {
  const health = assessVault({ commits: 40, bytes: 150 * MiB }, undefined, {});

  assert.equal(health.level, "grown");
  assert.match(health.detail, /40 commits, 150\.0 MiB/);
  assert.match(health.detail, /tash sync prune --keep 10/);
  assert.match(health.detail, /tash autosync prune --keep 10 --yes/);
});

test("assessVault leaves a big vault alone while automatic pruning is on and healthy", () => {
  const health = assessVault({ commits: 500, bytes: 5000 * MiB }, { keep: 10 }, { lastResult: "pruned" });

  assert.equal(health.level, "ok", "the scheduled prune is what keeps the vault bounded");
  assert.match(health.detail, /automatic prune on \(keep 10\)/);
});

test("assessVault reports a failed automatic prune, but only while the policy is on", () => {
  const failed = { lastResult: "error", lastError: "The remote refused the rewritten history" };

  const on = assessVault({ commits: 11, bytes: 63 * MiB }, { keep: 7 }, failed);
  assert.equal(on.level, "prune-failed");
  assert.match(on.detail, /The remote refused the rewritten history/);
  assert.match(on.detail, /tash sync prune --keep 7/);

  assert.equal(assessVault({ commits: 11, bytes: 63 * MiB }, undefined, failed).level, "ok", "a stale error must not nag once the policy is off");
});

test("getVaultHealth reads the real vault and the saved policy, and knows nothing without a vault", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-vault-health-"));
  try {
    assert.equal(atHome(join(base, "unconfigured"), () => getVaultHealth()), null);

    const { home } = buildSyncedVault(base, 3); // seed + 3 checkpoints = 4 commits
    const small = atHome(home, () => getVaultHealth());
    assert.equal(small.level, "ok");
    assert.equal(small.commits, 4);

    atHome(home, () => setAutosyncPrune(2));
    writeFileSync(join(home, "autosync-prune.json"), JSON.stringify({ lastAttemptAt: new Date().toISOString(), lastResult: "error", lastError: "network is down" }));
    const failed = atHome(home, () => getVaultHealth());
    assert.equal(failed.level, "prune-failed");
    assert.match(failed.detail, /network is down/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("tash autosync prune without --yes shows what the first pass would do and saves nothing", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-cli-preview-"));
  try {
    const { remote, home } = buildSyncedVault(base, 6); // 7 commits
    const remoteTip = run(remote, ["rev-parse", "main"]);

    const early = tash(home, ["autosync", "prune", "--keep", "2"]); // rewrites above 4 commits: 7 is past it
    assert.equal(early.status, 0, early.stderr);
    assert.match(early.stdout, /would rewrite the remote history/);
    assert.match(early.stdout, /--yes/);
    assert.match(early.stdout, /this computer's copy of the vault/, "the preview is made offline, from the local clone");

    const calm = tash(home, ["autosync", "prune", "--keep", "5"]); // rewrites above 10 commits: 7 is not
    assert.equal(calm.status, 0, calm.stderr);
    assert.match(calm.stdout, /would not rewrite the remote/);

    assert.equal(atHome(home, () => readAutosyncConfig().prune), undefined, "a preview must not turn the policy on");
    assert.equal(run(remote, ["rev-parse", "main"]), remoteTip, "a preview must not touch the remote");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("tash autosync prune --yes turns the policy on and still shows the preview", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-cli-yes-policy-"));
  try {
    const { home } = buildSyncedVault(base, 6);

    const result = tash(home, ["autosync", "prune", "--keep", "2", "--yes"]);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(atHome(home, () => readAutosyncConfig().prune), { keep: 2 });
    assert.match(result.stdout, /would rewrite the remote history/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("tash autosync prune rejects a bad keep, and without a vault it previews nothing but --yes still saves", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-cli-novault-"));
  try {
    const home = join(base, "home");

    const bad = tash(home, ["autosync", "prune", "--keep", "0", "--yes"]);
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /keep/);
    assert.equal(atHome(home, () => readAutosyncConfig().prune), undefined);

    const preview = tash(home, ["autosync", "prune", "--keep", "5"]);
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stdout, /No preview available/);
    assert.equal(atHome(home, () => readAutosyncConfig().prune), undefined);

    assert.equal(tash(home, ["autosync", "prune", "--keep", "5", "--yes"]).status, 0);
    assert.deepEqual(atHome(home, () => readAutosyncConfig().prune), { keep: 5 });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("tash autosync status shows the vault size and warns once it has grown again", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-cli-status-"));
  try {
    const small = buildSyncedVault(join(mkdtempSync(join(base, "a-")), ""), 3);
    const quiet = tash(small.home, ["autosync", "status"]);
    assert.equal(quiet.status, 0, quiet.stderr);
    assert.match(quiet.stdout, /Vault: 4 commits/);
    assert.doesNotMatch(quiet.stdout, /grown again/);

    const big = buildSyncedVault(mkdtempSync(join(base, "b-")), 21); // 22 commits: past the 20-commit limit
    const loud = tash(big.home, ["autosync", "status"]);
    assert.match(loud.stdout, /Vault: 22 commits/);
    assert.match(loud.stdout, /grown again/);
    assert.match(loud.stdout, /tash autosync prune --keep 10 --yes/);

    const none = tash(join(base, "no-sync-here"), ["autosync", "status"]);
    assert.equal(none.status, 0, none.stderr);
    assert.doesNotMatch(none.stdout, /Vault: \d/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// Like atHome, for async code that has to keep seeing that computer's ~/.tashevos until it settles.
async function atHomeAsync(home, fn) {
  const previous = process.env.TASHEVOS_HOME;
  process.env.TASHEVOS_HOME = home;
  try { return await fn(); }
  finally {
    if (previous === undefined) delete process.env.TASHEVOS_HOME;
    else process.env.TASHEVOS_HOME = previous;
  }
}

test("doctor reports the vault, and warns (never fails) once it has grown again", async () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-doctor-vault-"));
  try {
    const project = join(base, "project");
    mkdirSync(project);
    run(base, ["init", "-q", project]);
    const vaultCheck = async (home) => (await atHomeAsync(home, () => runDoctor(project, false))).find((check) => check.id === "vault");

    const small = buildSyncedVault(mkdtempSync(join(base, "a-")), 3);
    const ok = await vaultCheck(small.home);
    assert.equal(ok.health, "ok");
    assert.equal(ok.label, "Encrypted vault");
    assert.match(ok.detail, /^4 commits, /);

    const big = buildSyncedVault(mkdtempSync(join(base, "b-")), 21); // 22 commits: past the 20-commit limit
    const grown = await vaultCheck(big.home);
    assert.equal(grown.health, "warn", "a vault that merely grew must not fail the doctor");
    assert.match(grown.detail, /grown again/);

    assert.equal(await vaultCheck(join(base, "no-sync-here")), undefined, "no vault check without a configured vault");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("the MCP status tool tells an AI agent when the vault has grown again, so it can say so at session start", async () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-mcp-vault-"));
  const server = createTashevMcpServer();
  const client = new Client({ name: "tashevos-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    const project = join(base, "project");
    mkdirSync(project);
    run(base, ["init", "-q", project]);
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const status = async (home) => atHomeAsync(home, async () => {
      const result = await client.callTool({ name: "tashevos_status", arguments: { path: project } });
      return JSON.parse(result.content.find((item) => item.type === "text").text);
    });

    const big = buildSyncedVault(mkdtempSync(join(base, "big-")), 21); // 22 commits: past the 20-commit limit
    const grown = (await status(big.home)).vault;
    assert.equal(grown.level, "grown");
    assert.match(grown.detail, /tash autosync prune --keep 10 --yes/);

    const small = buildSyncedVault(mkdtempSync(join(base, "small-")), 3);
    assert.equal((await status(small.home)).vault.level, "ok");

    assert.equal((await status(join(base, "no-sync-here"))).vault, null, "no vault, nothing to warn about");
  } finally {
    await client.close().catch(() => {});
    await server.close().catch(() => {});
    rmSync(base, { recursive: true, force: true });
  }
});

test("a pass that finds nothing to rewrite does not use up the day: once the history passes 2 x keep the next pass rewrites it", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-tick-slot-"));
  try {
    const { remote, home, vault } = buildSyncedVault(base, 4); // 5 commits
    atHome(home, () => setAutosyncPrune(3)); // rewrites only above 6 commits

    const early = atHome(home, () => runAutosyncTick());
    assert.equal(early.prune.result, "reclaimed");
    assert.equal(run(remote, ["rev-list", "--count", "main"]), "5");

    addCheckpoints(vault, 3, 100); // autosync keeps checkpointing: the vault now holds 8 commits
    run(vault, ["push", "-q", "origin", "main"]);

    const next = atHome(home, () => runAutosyncTick()); // no waiting for tomorrow
    assert.equal(next.prune.result, "pruned");
    assert.equal(run(remote, ["rev-list", "--count", "main"]), "3");

    addCheckpoints(vault, 8, 200); // growing past the limit again straight away ...
    run(vault, ["push", "-q", "origin", "main"]);
    const again = atHome(home, () => runAutosyncTick());
    assert.equal(again.prune.result, "not-due", "... still waits out the 24 hours after a rewrite");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("between daily passes a short history is checked without any network access", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-tick-offline-"));
  try {
    const { home, vault } = buildSyncedVault(base, 3); // 4 commits
    atHome(home, () => setAutosyncPrune(5)); // rewrites only above 10 commits
    assert.equal(atHome(home, () => runAutosyncTick()).prune.result, "reclaimed");
    run(vault, ["remote", "set-url", "origin", join(base, "unreachable.git")]); // any network use would now fail

    const second = atHome(home, () => runAutosyncTick());

    assert.equal(second.prune.result, "not-due");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("turning the automatic prune back on forgets an old failure instead of showing it at once", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-reenable-"));
  try {
    const { home } = buildSyncedVault(base, 3);
    atHome(home, () => setAutosyncPrune(2));
    writeFileSync(join(home, "autosync-prune.json"), JSON.stringify({ lastAttemptAt: new Date().toISOString(), lastResult: "error", lastError: "network is down" }));
    assert.equal(atHome(home, () => getVaultHealth()).level, "prune-failed");

    atHome(home, () => setAutosyncPrune(null));
    atHome(home, () => setAutosyncPrune(2));

    assert.equal(atHome(home, () => getVaultHealth()).level, "ok", "a stale failure must not greet the owner who just turned it back on");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("the vault checks survive config and state files that hold a bare null", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-nullfiles-"));
  try {
    const { home } = buildSyncedVault(base, 3);
    writeFileSync(join(home, "autosync.json"), "null");
    writeFileSync(join(home, "autosync-prune.json"), "null");
    assert.equal(atHome(home, () => getVaultHealth()).level, "ok");
    assert.equal(atHome(home, () => readAutosyncConfig().projects.length), 0, "a null config reads as an empty one");

    writeFileSync(join(home, "autosync.json"), JSON.stringify({ prune: { keep: 2 } })); // policy on, state file still null
    assert.equal(atHome(home, () => getVaultHealth()).level, "ok");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("the autosync prune preview admits that another computer may have outgrown this computer's copy", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-prune-stale-preview-"));
  try {
    const { remote, home } = buildSyncedVault(base, 6); // 7 commits here
    const other = cloneDevice(base, remote, "other-computer");
    addCheckpoints(other, 12, 100);
    run(other, ["push", "-q", "origin", "main"]); // the remote has 19 commits, this computer has not fetched them

    const preview = tash(home, ["autosync", "prune", "--keep", "5"]); // rewrites above 10 commits

    assert.match(preview.stdout, /would not rewrite the remote/, "the local copy of 7 commits looks short");
    assert.match(preview.stdout, /another computer has checkpointed since/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
