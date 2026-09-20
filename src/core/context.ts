import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getGitSnapshot } from "../lib/git.js";
import { detectAgents } from "./agents.js";
import { readRecentEvents } from "./store.js";

function read(root: string, relative: string): string {
  const path = join(root, relative);
  return existsSync(path) ? readFileSync(path, "utf8").trim() : "";
}

export function compileContext(root: string, task: string): string {
  const snapshot = getGitSnapshot(root);
  const agents = detectAgents(root).filter((agent) => agent.detected).map((agent) => agent.name);
  const events = readRecentEvents(root, 6);
  const gitLine = snapshot.branch + " @ " + snapshot.head.slice(0, 12) + (snapshot.dirty ? ", dirty (" + snapshot.changedFiles + " files)" : ", clean");

  return [
    "# TashevOS context packet",
    "",
    "Task: " + (task || "(not specified)"),
    "Git: " + gitLine,
    "Detected AI: " + (agents.join(", ") || "none"),
    "",
    "## Project",
    read(root, ".tashevos/PROJECT.md") || "(not initialized)",
    "",
    "## Current state",
    read(root, ".tashevos/STATE.md") || "(not initialized)",
    "",
    "## Guardrails",
    read(root, ".tashevos/GUARDRAILS.md") || "(not initialized)",
    "",
    "## Recent TashevOS events",
    events.length ? events.map((event) => "- " + event.ts + " " + event.type + (event.agent ? " [" + event.agent + "]" : "")).join("\n") : "- none",
    "",
    "Evidence priority: Git/files/tests/runtime > verified memory > agent summaries > inference."
  ].join("\n");
}
