import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ensureDir, readJson, writeJson } from "../lib/fs.js";
import { getGitSnapshot } from "../lib/git.js";
import type { EventRecord } from "../types.js";

export const DATA_DIR = ".tashevos";

export function initializeStore(root: string): void {
  const base = join(root, DATA_DIR);
  for (const part of ["state", "memory", "local", "cache", "sessions"]) ensureDir(join(base, part));

  const configPath = join(base, "config.json");
  if (!existsSync(configPath)) {
    writeJson(configPath, { schemaVersion: 1, mode: "local-first", contextBudget: 6000, autoHeal: "safe", rawSessions: "local-only" });
  }

  const statePath = join(base, "state", "current.json");
  if (!existsSync(statePath)) {
    writeJson(statePath, { initializedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), git: getGitSnapshot(root) });
  }

  const decisions = join(base, "memory", "decisions.ndjson");
  if (!existsSync(decisions)) writeFileSync(decisions, "", "utf8");
  const failures = join(base, "memory", "failed-approaches.ndjson");
  if (!existsSync(failures)) writeFileSync(failures, "", "utf8");

  const projectMd = join(base, "PROJECT.md");
  if (!existsSync(projectMd)) {
    writeFileSync(projectMd, "# Project memory\n\nTashevOS manages canonical project context here. Keep durable facts concise and verifiable.\n", "utf8");
  }

  const stateMd = join(base, "STATE.md");
  if (!existsSync(stateMd)) {
    writeFileSync(stateMd, "# Current state\n\n- Status: initialized\n- Active task: none\n- Known blockers: none recorded\n", "utf8");
  }

  const guardrails = join(base, "GUARDRAILS.md");
  if (!existsSync(guardrails)) {
    writeFileSync(guardrails, "# Guardrails\n\n- Never expose secrets.\n- Prefer verified Git/files/test evidence over agent claims.\n- Do not rewrite unrelated areas of the project.\n", "utf8");
  }

  const ignore = join(base, ".gitignore");
  if (!existsSync(ignore)) {
    writeFileSync(ignore, "# Local/private TashevOS runtime data\nlocal/\ncache/\nsessions/\nstate/current.json\n", "utf8");
  }
}

export function appendEvent(root: string, type: string, data: Record<string, unknown> = {}, agent?: string): EventRecord {
  initializeStore(root);
  const event: EventRecord = { id: randomUUID(), ts: new Date().toISOString(), type, ...(agent ? { agent } : {}), data };
  appendFileSync(join(root, DATA_DIR, "local", "events.ndjson"), JSON.stringify(event) + "\n", "utf8");
  return event;
}

export function readRecentEvents(root: string, limit = 10): EventRecord[] {
  const path = join(root, DATA_DIR, "local", "events.ndjson");
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean).slice(-limit);
  return lines.flatMap((line: string) => {
    try { return [JSON.parse(line) as EventRecord]; }
    catch { return []; }
  });
}

export function updateState(root: string): void {
  initializeStore(root);
  const path = join(root, DATA_DIR, "state", "current.json");
  const state = readJson<Record<string, unknown>>(path, {});
  writeJson(path, { ...state, updatedAt: new Date().toISOString(), git: getGitSnapshot(root) });
}
