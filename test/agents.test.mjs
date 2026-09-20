import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectAgents } from "../dist/core/agents.js";

test("detectAgents sees a project-local Cursor marker", () => {
  const root = mkdtempSync(join(tmpdir(), "tashevos-"));
  try {
    mkdirSync(join(root, ".cursor"));
    const cursor = detectAgents(root).find((agent) => agent.id === "cursor");
    assert.equal(cursor?.detected, true);
    assert.ok(cursor?.evidence.includes("project:.cursor"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
