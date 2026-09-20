import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { initializeSync, createCheckpoint } from "../dist/core/sync.js";
import { getAutosyncStatus, registerAutosyncProject, runAutosyncTick } from "../dist/core/autosync.js";

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
  writeFileSync(join(seed, "app.txt"), "base\n", "utf8");
  run(seed, ["add", "."]);
  run(seed, ["commit", "-qm", "init"]);
  run(seed, ["remote", "add", "origin", bare]);
  run(seed, ["push", "-q", "-u", "origin", "main"]);
  return bare;
}

test("autosync checkpoints only changed safe state and deduplicates manual checkpoints", () => {
  const base = mkdtempSync(join(tmpdir(), "tashevos-autosync-"));
  const previousHome = process.env.TASHEVOS_HOME;
  try {
    process.env.TASHEVOS_HOME = join(base, "home");
    const projectRemote = seedBare(base, "project-remote");
    const vaultRemote = seedBare(base, "vault-remote");
    const project = join(base, "project");
    run(base, ["clone", "-q", projectRemote, project]);
    initializeSync(vaultRemote, "0123456789abcdef0123456789abcdef0123456789abcdef");

    const registered = registerAutosyncProject(project, "continue autosync test", true);
    assert.ok(registered.checkpoint);
    assert.equal(runAutosyncTick().results[0]?.result, "unchanged");

    writeFileSync(join(project, "app.txt"), "base\nchanged\n", "utf8");
    const changed = runAutosyncTick().results[0];
    assert.equal(changed?.result, "checkpoint");
    assert.ok(changed?.vaultCommit);
    assert.equal(runAutosyncTick().results[0]?.result, "unchanged");

    writeFileSync(join(project, ".env.local"), "SECRET=must-not-trigger-sync\n", "utf8");
    assert.equal(runAutosyncTick().results[0]?.result, "unchanged");

    writeFileSync(join(project, "app.txt"), "base\nchanged again\n", "utf8");
    const manual = createCheckpoint(project, "manual checkpoint");
    assert.ok(manual.fingerprint);
    const dedupe = runAutosyncTick().results[0];
    assert.equal(dedupe?.result, "remote-current");
    assert.equal(dedupe?.fingerprint, manual.fingerprint);

    const status = getAutosyncStatus();
    assert.equal(status.config.projects.length, 1);
    assert.equal(status.config.projects[0].path, realpathSync(project));
  } finally {
    if (previousHome === undefined) delete process.env.TASHEVOS_HOME;
    else process.env.TASHEVOS_HOME = previousHome;
    rmSync(base, { recursive: true, force: true });
  }
});
