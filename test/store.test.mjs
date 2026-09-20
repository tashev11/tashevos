import test from "node:test";
import assert from "node:assert/strict";
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
