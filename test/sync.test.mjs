import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createCheckpoint, getSyncStatus, initializeSync, resumeCheckpoint } from "../dist/core/sync.js";

function run(cwd, args) {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
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

test("encrypted checkpoint restores staged, unstaged and safe untracked work on another clone", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-sync-"));
  const previousHome = process.env.TASHEVOS_HOME;
  try {
    process.env.TASHEVOS_HOME = join(base, "home");
    const projectRemote = seedBare(base, "project-remote");
    const vaultRemote = seedBare(base, "vault-remote");
    const project1 = join(base, "device-a");
    const project2 = join(base, "device-b");
    run(base, ["clone", "-q", projectRemote, project1]);
    run(project1, ["config", "user.email", "test@example.com"]);
    run(project1, ["config", "user.name", "Test"]);
    writeFileSync(join(project1, "app.txt"), "base\n", "utf8");
    run(project1, ["add", "app.txt"]);
    run(project1, ["commit", "-qm", "app base"]);
    run(project1, ["push", "-q", "origin", "main"]);

    initializeSync(vaultRemote, "0123456789abcdef0123456789abcdef0123456789abcdef");

    writeFileSync(join(project1, "app.txt"), "base\nstaged\n", "utf8");
    run(project1, ["add", "app.txt"]);
    writeFileSync(join(project1, "app.txt"), "base\nstaged\nunstaged\n", "utf8");
    writeFileSync(join(project1, "notes.txt"), "continue from here\n", "utf8");
    writeFileSync(join(project1, ".env.local"), "SECRET=never-sync\n", "utf8");

    const checkpoint = createCheckpoint(project1, "finish cross-device continuity");
    assert.equal(checkpoint.untracked >= 1, true);
    assert.ok(checkpoint.skippedUntracked.some((x) => x.includes(".env.local")));

    run(base, ["clone", "-q", projectRemote, project2]);
    const status = getSyncStatus(project2);
    assert.equal(status.task, "finish cross-device continuity");
    assert.equal(status.branch, "main");

    const resumed = resumeCheckpoint(project2);
    assert.equal(resumed.task, "finish cross-device continuity");
    assert.equal(readFileSync(join(project2, "app.txt"), "utf8"), "base\nstaged\nunstaged\n");
    assert.equal(readFileSync(join(project2, "notes.txt"), "utf8"), "continue from here\n");
    assert.equal(spawnSync("test", ["-e", join(project2, ".env.local")]).status, 1);
    assert.match(run(project2, ["diff", "--cached", "--", "app.txt"]), /staged/);
    assert.match(run(project2, ["diff", "--", "app.txt"]), /unstaged/);
  } finally {
    if (previousHome === undefined) delete process.env.TASHEVOS_HOME;
    else process.env.TASHEVOS_HOME = previousHome;
    rmSync(base, { recursive: true, force: true });
  }
});

test("resume refuses to overwrite dirty local work without force", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-sync-guard-"));
  const previousHome = process.env.TASHEVOS_HOME;
  try {
    process.env.TASHEVOS_HOME = join(base, "home");
    const projectRemote = seedBare(base, "project-remote");
    const vaultRemote = seedBare(base, "vault-remote");
    const a = join(base, "a");
    const b = join(base, "b");
    run(base, ["clone", "-q", projectRemote, a]);
    initializeSync(vaultRemote, "abcdef0123456789abcdef0123456789abcdef0123456789");
    createCheckpoint(a, "guard test");
    run(base, ["clone", "-q", projectRemote, b]);
    writeFileSync(join(b, "local-only.txt"), "do not lose me\n", "utf8");
    assert.throws(() => resumeCheckpoint(b), /Working tree is not clean/);
    assert.equal(readFileSync(join(b, "local-only.txt"), "utf8"), "do not lose me\n");
  } finally {
    if (previousHome === undefined) delete process.env.TASHEVOS_HOME;
    else process.env.TASHEVOS_HOME = previousHome;
    rmSync(base, { recursive: true, force: true });
  }
});
