import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentDetection } from "../types.js";

const START = "<!-- tashevos:start -->";
const END = "<!-- tashevos:end -->";
const block = [
  START,
  "## TashevOS project continuity",
  "",
  "Before substantial work:",
  "1. Read .tashevos/PROJECT.md, .tashevos/STATE.md, and .tashevos/GUARDRAILS.md.",
  "2. If the TashevOS MCP server is available, call `tashevos_context` with the current task; otherwise run `tash context`.",
  "3. Check Git state before editing and do not overwrite unrelated or concurrent work.",
  "4. Treat Git, files, tests and runtime evidence as stronger than remembered agent claims.",
  "5. After changes, run relevant verification and record a handoff with `tashevos_handoff` when MCP is available; otherwise run `tash handoff`.",
  "6. Keep TashevOS autosync enabled when available; before switching agents/devices, verify `tash autosync status` or create `tashevos_checkpoint` / `tash checkpoint`.",
  "",
  "Never place secrets or private credentials into TashevOS tracked memory.",
  END
].join("\n");

export function stripManagedBlock(text: string): string {
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  if (start < 0 || end < start) return text;
  return text.slice(0, start) + text.slice(end + END.length);
}

function upsertManagedBlock(path: string): void {
  let current = existsSync(path) ? readFileSync(path, "utf8") : "";
  const start = current.indexOf(START);
  const end = current.indexOf(END);
  if (start >= 0 && end >= start) {
    current = current.slice(0, start) + block + current.slice(end + END.length);
  } else {
    current = (current.trimEnd() ? current.trimEnd() + "\n\n" : "") + block + "\n";
  }
  writeFileSync(path, current, "utf8");
}

export function installInstructionAdapters(root: string, agents: AgentDetection[]): string[] {
  const changed: string[] = [];
  upsertManagedBlock(join(root, "AGENTS.md"));
  changed.push("AGENTS.md");

  const detected = new Set(agents.filter((agent) => agent.detected).map((agent) => agent.id));
  if (detected.has("claude")) {
    upsertManagedBlock(join(root, "CLAUDE.md"));
    changed.push("CLAUDE.md");
  }
  if (detected.has("gemini")) {
    upsertManagedBlock(join(root, "GEMINI.md"));
    changed.push("GEMINI.md");
  }
  return changed;
}
