import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createTashevMcpServer } from "../dist/core/mcp.js";
import { initializeStore } from "../dist/core/store.js";

function git(root, args) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}

test("MCP exposes context and durable handoff tools", async () => {
  const root = mkdtempSync(join(tmpdir(), "tashevos-mcp-"));
  const server = createTashevMcpServer();
  const client = new Client({ name: "tashevos-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    git(root, ["init", "-q", "-b", "main"]);
    git(root, ["config", "user.email", "test@example.com"]);
    git(root, ["config", "user.name", "Test"]);
    writeFileSync(join(root, "app.txt"), "hello\n", "utf8");
    git(root, ["add", "."]);
    git(root, ["commit", "-qm", "init"]);
    initializeStore(root);

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const tools = await client.listTools();
    assert.ok(tools.tools.some((item) => item.name === "tashevos_context"));
    assert.ok(tools.tools.some((item) => item.name === "tashevos_handoff"));

    await client.callTool({
      name: "tashevos_handoff",
      arguments: {
        path: root,
        task: "finish MCP continuity",
        summary: "server connected",
        nextStep: "run tests"
      }
    });
    const context = await client.callTool({
      name: "tashevos_context",
      arguments: { path: root, task: "continue" }
    });
    const text = context.content.find((item) => item.type === "text")?.text || "";
    assert.match(text, /finish MCP continuity/);
    assert.match(text, /server connected/);
  } finally {
    await client.close().catch(() => {});
    await server.close().catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
});
