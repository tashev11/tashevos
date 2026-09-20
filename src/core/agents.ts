import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { AgentDetection } from "../types.js";

type AgentDef = {
  id: string;
  name: string;
  commands?: string[];
  homeMarkers?: string[];
  projectMarkers?: string[];
  history?: string[];
};

const defs: AgentDef[] = [
  { id: "claude", name: "Claude Code", commands: ["claude"], homeMarkers: [".claude"], projectMarkers: ["CLAUDE.md"], history: [".claude/projects"] },
  { id: "codex", name: "OpenAI Codex", commands: ["codex"], homeMarkers: [".codex"], projectMarkers: ["AGENTS.md"], history: [".codex/sessions"] },
  { id: "cursor", name: "Cursor", commands: ["cursor"], homeMarkers: [".cursor"], projectMarkers: [".cursor"] },
  { id: "gemini", name: "Gemini CLI", commands: ["gemini"], homeMarkers: [".gemini"], projectMarkers: ["GEMINI.md"], history: [".gemini"] },
  { id: "copilot", name: "GitHub Copilot", projectMarkers: [".github/copilot-instructions.md"] },
  { id: "windsurf", name: "Windsurf", commands: ["windsurf"], homeMarkers: [".codeium/windsurf"], projectMarkers: [".windsurf"] },
  { id: "kiro", name: "Kiro", commands: ["kiro"], homeMarkers: [".kiro"], projectMarkers: [".kiro"] },
  { id: "cline", name: "Cline", homeMarkers: [".cline"], projectMarkers: [".cline"] },
  { id: "roo", name: "Roo Code", homeMarkers: [".roo"], projectMarkers: [".roo"] },
  { id: "opencode", name: "OpenCode", commands: ["opencode"], homeMarkers: [".config/opencode"], projectMarkers: ["opencode.json"], history: [".local/share/opencode"] },
  { id: "continue", name: "Continue", homeMarkers: [".continue"], projectMarkers: [".continue"] },
  { id: "qwen", name: "Qwen Code", commands: ["qwen"], homeMarkers: [".qwen"], projectMarkers: ["QWEN.md"] },
  { id: "zed", name: "Zed", commands: ["zed"], homeMarkers: [".config/zed"] },
  { id: "aider", name: "Aider", commands: ["aider"], homeMarkers: [".aider.conf.yml"], projectMarkers: [".aider.conf.yml"] }
];

function commandExists(command: string): boolean {
  const result = spawnSync("sh", ["-lc", "command -v " + command], { stdio: "ignore" });
  return result.status === 0;
}

function artifactCount(path: string): number {
  try { return readdirSync(path).length; }
  catch { return 0; }
}

export function detectAgents(root: string): AgentDetection[] {
  const home = homedir();
  return defs.map((def) => {
    const evidence: string[] = [];
    for (const command of def.commands ?? []) {
      if (commandExists(command)) evidence.push("command:" + command);
    }
    for (const marker of def.homeMarkers ?? []) {
      if (existsSync(join(home, marker))) evidence.push("home:" + marker);
    }
    for (const marker of def.projectMarkers ?? []) {
      if (existsSync(join(root, marker))) evidence.push("project:" + marker);
    }
    const historySources = (def.history ?? [])
      .map((path) => join(home, path))
      .filter(existsSync)
      .map((path) => path + " (" + artifactCount(path) + " entries)");
    return { id: def.id, name: def.name, detected: evidence.length > 0, evidence, historySources };
  });
}
