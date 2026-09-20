import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { readJson } from "../lib/fs.js";
import { getGitSnapshot } from "../lib/git.js";
import { detectAgents } from "./agents.js";
import { DATA_DIR, readRecentEvents } from "./store.js";

const DEFAULT_BUDGET = 6000;
const CLIPPED = "\n[clipped by contextBudget]";

function read(root: string, relative: string): string {
  const path = join(root, relative);
  return existsSync(path) ? readFileSync(path, "utf8").trim() : "";
}

// Rough estimate until real token accounting lands (roadmap v0.7):
// about 4 characters per token for ASCII and about 2 for everything else.
function charCost(char: string): number {
  return char.charCodeAt(0) < 128 ? 0.25 : 0.5;
}

export function estimateTokens(text: string): number {
  let cost = 0;
  for (const char of text) cost += charCost(char);
  return Math.ceil(cost);
}

function clip(text: string, budget: number): string {
  if (estimateTokens(text) <= budget) return text;
  const room = budget - estimateTokens(CLIPPED);
  if (room <= 0) return "";
  let cost = 0;
  let end = 0;
  for (const char of text) {
    cost += charCost(char);
    if (cost > room) break;
    end += char.length;
  }
  return text.slice(0, end).trimEnd() + CLIPPED;
}

// Shortest sections are served first, so what they do not use flows to the longer ones.
function fitSections(sections: string[], budget: number): string[] {
  const order = sections.map((_, index) => index).sort((a, b) => estimateTokens(sections[a]) - estimateTokens(sections[b]));
  const fitted = [...sections];
  let remaining = budget;
  order.forEach((index, position) => {
    fitted[index] = clip(sections[index], Math.floor(remaining / (order.length - position)));
    remaining -= estimateTokens(fitted[index]);
  });
  return fitted;
}

export function compileContext(root: string, task: string): string {
  const snapshot = getGitSnapshot(root);
  const agents = detectAgents(root).filter((agent) => agent.detected).map((agent) => agent.name);
  const events = readRecentEvents(root, 6);
  const gitLine = snapshot.branch + " @ " + snapshot.head.slice(0, 12) + (snapshot.dirty ? ", dirty (" + snapshot.changedFiles + " files)" : ", clean");
  const config = readJson<{ contextBudget?: unknown }>(join(root, DATA_DIR, "config.json"), {});
  const budget = typeof config.contextBudget === "number" && config.contextBudget > 0 ? config.contextBudget : DEFAULT_BUDGET;

  const render = (sections: string[], used: number): string => [
    "# TashevOS context packet",
    "",
    "Task: " + (task || "(not specified)"),
    "Git: " + gitLine,
    "Detected AI: " + (agents.join(", ") || "none"),
    "",
    "## Project",
    sections[0],
    "",
    "## Current state",
    sections[1],
    "",
    "## Guardrails",
    sections[2],
    "",
    "## Recent TashevOS events",
    events.length ? events.map((event) => "- " + event.ts + " " + event.type + (event.agent ? " [" + event.agent + "]" : "")).join("\n") : "- none",
    "",
    "Evidence priority: Git/files/tests/runtime > verified memory > agent summaries > inference.",
    "Context: ~" + used + " of " + budget + " tokens (estimated)."
  ].join("\n");

  const frame = estimateTokens(render(["", "", ""], budget));
  const sections = fitSections([
    read(root, ".tashevos/PROJECT.md") || "(not initialized)",
    read(root, ".tashevos/STATE.md") || "(not initialized)",
    read(root, ".tashevos/GUARDRAILS.md") || "(not initialized)"
  ], Math.max(0, budget - frame));
  return render(sections, estimateTokens(render(sections, budget)));
}
