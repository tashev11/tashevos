import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileContext, estimateTokens } from "../dist/core/context.js";
import { initializeStore } from "../dist/core/store.js";

test("compileContext keeps the packet within contextBudget", () => {
  const root = mkdtempSync(join(tmpdir(), "tashevos-"));
  try {
    mkdirSync(join(root, ".git"));
    initializeStore(root);
    writeFileSync(join(root, ".tashevos", "config.json"), JSON.stringify({ contextBudget: 400 }), "utf8");
    writeFileSync(join(root, ".tashevos", "PROJECT.md"), "# Project memory\n\n" + "A durable fact about this project. ".repeat(400), "utf8");
    const packet = compileContext(root, "fix checkout");
    assert.ok(estimateTokens(packet) <= 400, "packet is " + estimateTokens(packet) + " tokens");
    assert.match(packet, /\[clipped by contextBudget\]/);
    assert.match(packet, /Do not rewrite unrelated areas of the project\./);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("compileContext leaves short memory untouched", () => {
  const root = mkdtempSync(join(tmpdir(), "tashevos-"));
  try {
    mkdirSync(join(root, ".git"));
    initializeStore(root);
    const packet = compileContext(root, "");
    assert.doesNotMatch(packet, /clipped by contextBudget/);
    assert.match(packet, /of 6000 tokens \(estimated\)\./);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
