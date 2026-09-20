import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("tash handoff persists explicit next step", () => {
  const root = mkdtempSync(join(tmpdir(), "tashevos-handoff-"));
  try {
    mkdirSync(join(root, ".git"));
    const cli = join(process.cwd(), "dist", "cli.js");
    const result = spawnSync(process.execPath, [
      cli,
      "handoff",
      "finish continuity",
      "--path", root,
      "--summary", "MCP is ready",
      "--next", "connect next client",
      "--blockers", "none"
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Next: connect next client/);
    const state = readFileSync(join(root, ".tashevos", "STATE.md"), "utf8");
    assert.match(state, /Active task: finish continuity/);
    assert.match(state, /Summary: MCP is ready/);
    assert.match(state, /Next step: connect next client/);
    assert.match(state, /Known blockers: none/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
