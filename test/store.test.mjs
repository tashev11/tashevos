import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEvent, initializeStore, readRecentEvents } from "../dist/core/store.js";

test("store initializes and records events", () => {
  const root = mkdtempSync(join(tmpdir(), "tashevos-"));
  try {
    mkdirSync(join(root, ".git"));
    initializeStore(root);
    appendEvent(root, "test.event", { ok: true });
    assert.equal(readRecentEvents(root, 5).at(-1)?.type, "test.event");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("local runtime data stays out of Git in any project", () => {
  const root = mkdtempSync(join(tmpdir(), "tashevos-"));
  try {
    spawnSync("git", ["-C", root, "init", "-q"]);
    appendEvent(root, "test.event");
    const staged = spawnSync("git", ["-C", root, "add", "-A", "-n"], { encoding: "utf8" }).stdout;
    assert.match(staged, /\.tashevos\/PROJECT\.md/);
    assert.doesNotMatch(staged, /\.tashevos\/(local|cache|sessions)\//);
    assert.doesNotMatch(staged, /state\/current\.json/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
