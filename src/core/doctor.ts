import { existsSync } from "node:fs";
import { access, constants } from "node:fs/promises";
import { join } from "node:path";
import { getGitSnapshot } from "../lib/git.js";
import type { DoctorCheck } from "../types.js";
import { DATA_DIR, initializeStore } from "./store.js";
import { detectAgents } from "./agents.js";
import { installInstructionAdapters } from "./instructions.js";

export async function runDoctor(root: string, fix = false): Promise<DoctorCheck[]> {
  if (fix) {
    initializeStore(root);
    installInstructionAdapters(root, detectAgents(root));
  }

  const checks: DoctorCheck[] = [];
  const isGit = existsSync(join(root, ".git"));
  checks.push({ id: "git", label: "Git repository", health: isGit ? "ok" : "fail", detail: isGit ? "detected" : "not detected" });

  const initialized = existsSync(join(root, DATA_DIR, "config.json"));
  checks.push({ id: "store", label: "TashevOS store", health: initialized ? "ok" : "fail", detail: initialized ? "initialized" : "run tash init" });

  if (initialized) {
    try {
      await access(join(root, DATA_DIR, "local"), constants.W_OK);
      checks.push({ id: "store-write", label: "Local event store", health: "ok", detail: "writable" });
    } catch {
      checks.push({ id: "store-write", label: "Local event store", health: "fail", detail: "not writable" });
    }
  }

  const agentsMd = existsSync(join(root, "AGENTS.md"));
  checks.push({ id: "instructions", label: "Agent bootstrap", health: agentsMd ? "ok" : "warn", detail: agentsMd ? "AGENTS.md present" : "missing; doctor --fix can repair" });

  const snapshot = getGitSnapshot(root);
  checks.push({
    id: "working-tree",
    label: "Working tree",
    health: snapshot.dirty ? "warn" : "ok",
    detail: snapshot.dirty ? String(snapshot.changedFiles) + " changed file(s)" : "clean"
  });
  return checks;
}
