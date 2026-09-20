import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectAgents } from "../dist/core/agents.js";
import { installInstructionAdapters } from "../dist/core/instructions.js";

const cleanMachine = (home) => ({ home, commandExists: () => false });

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

test("files holding only the managed block are not agent evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "tashevos-"));
  const home = mkdtempSync(join(tmpdir(), "tashevos-home-"));
  try {
    const everyone = detectAgents(root, cleanMachine(home)).map((agent) => ({ ...agent, detected: true }));
    assert.deepEqual(installInstructionAdapters(root, everyone), ["AGENTS.md", "CLAUDE.md", "GEMINI.md"]);
    const detected = detectAgents(root, cleanMachine(home)).filter((agent) => agent.detected);
    assert.deepEqual(detected.map((agent) => agent.id), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("an instruction file with its own content still counts as evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "tashevos-"));
  const home = mkdtempSync(join(tmpdir(), "tashevos-home-"));
  try {
    writeFileSync(join(root, "AGENTS.md"), "# House rules\n", "utf8");
    installInstructionAdapters(root, []);
    const codex = detectAgents(root, cleanMachine(home)).find((agent) => agent.id === "codex");
    assert.deepEqual(codex?.evidence, ["project:AGENTS.md"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
