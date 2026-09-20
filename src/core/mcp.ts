import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { findProjectRoot } from "../lib/fs.js";
import { getGitSnapshot } from "../lib/git.js";
import { detectAgents } from "./agents.js";
import { compileContext } from "./context.js";
import { recordHandoff } from "./handoff.js";
import { readRecentEvents } from "./store.js";
import { createCheckpoint, getSyncStatus } from "./sync.js";

const SERVER_VERSION = "0.1.0-alpha.3";

function rootFor(path?: string): string {
  return findProjectRoot(path?.trim() || process.env.TASHEVOS_PROJECT || process.cwd());
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function safeSyncStatus(root: string): unknown {
  try { return getSyncStatus(root); }
  catch (error) {
    return { available: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function createTashevMcpServer(): McpServer {
  const server = new McpServer({
    name: "tashevos",
    version: SERVER_VERSION
  });

  server.registerTool("tashevos_context", {
    title: "Load TashevOS project context",
    description: "Load the compact evidence-first context packet before continuing work in a project.",
    inputSchema: {
      task: z.string().optional().describe("What the user wants to continue or do now."),
      path: z.string().optional().describe("Project path. Defaults to the AI client's current working directory.")
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ task, path }) => {
    const root = rootFor(path);
    return textResult(compileContext(root, task || "continue the latest task"));
  });

  server.registerTool("tashevos_status", {
    title: "Inspect TashevOS continuity status",
    description: "Inspect Git, detected AI tools, recent continuity events and the latest encrypted remote checkpoint.",
    inputSchema: {
      path: z.string().optional().describe("Project path. Defaults to the AI client's current working directory.")
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ path }) => {
    const root = rootFor(path);
    const payload = {
      project: root,
      git: getGitSnapshot(root),
      detectedAI: detectAgents(root).filter((item) => item.detected).map((item) => item.name),
      recentEvents: readRecentEvents(root, 10),
      remoteCheckpoint: safeSyncStatus(root)
    };
    return textResult(JSON.stringify(payload, null, 2));
  });

  server.registerTool("tashevos_handoff", {
    title: "Record a TashevOS handoff",
    description: "Record the current task, summary, next step and blockers so another AI or new chat can continue.",
    inputSchema: {
      task: z.string().min(1),
      summary: z.string().optional(),
      nextStep: z.string().optional(),
      blockers: z.string().optional(),
      status: z.enum(["active", "paused", "completed"]).optional(),
      path: z.string().optional()
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async ({ task, summary, nextStep, blockers, status, path }) => {
    const root = rootFor(path);
    const handoff = recordHandoff(root, { task, summary, nextStep, blockers, status });
    return textResult(JSON.stringify({ project: root, handoff }, null, 2));
  });

  server.registerTool("tashevos_checkpoint", {
    title: "Create encrypted TashevOS checkpoint",
    description: "Create an encrypted cross-device checkpoint after meaningful work or before switching devices/agents.",
    inputSchema: {
      task: z.string().optional(),
      path: z.string().optional()
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async ({ task, path }) => {
    const root = rootFor(path);
    const result = createCheckpoint(root, task || "continue the latest task");
    return textResult(JSON.stringify({ project: root, checkpoint: result }, null, 2));
  });

  server.registerResource("tashevos-current-context", "tashevos://current/context", {
    title: "Current TashevOS context",
    description: "Continuity context for the project where the MCP server was started.",
    mimeType: "text/markdown"
  }, async (uri) => {
    const root = rootFor();
    return {
      contents: [{
        uri: uri.href,
        mimeType: "text/markdown",
        text: compileContext(root, "continue the latest task")
      }]
    };
  });

  return server;
}

export async function serveTashevMcp(): Promise<void> {
  const server = createTashevMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
