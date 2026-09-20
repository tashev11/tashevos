#!/usr/bin/env node
import { Command } from "commander";
import pc from "picocolors";
import { findProjectRoot } from "./lib/fs.js";
import { getGitSnapshot } from "./lib/git.js";
import { detectAgents } from "./core/agents.js";
import { scanProject } from "./core/scanner.js";
import { appendEvent, initializeStore, readRecentEvents, updateState } from "./core/store.js";
import { installInstructionAdapters } from "./core/instructions.js";
import { runDoctor } from "./core/doctor.js";
import { compileContext } from "./core/context.js";

const VERSION = "0.1.0-alpha.1";
const program = new Command();

program.name("tash")
  .description("TashevOS — the open control plane for AI coding")
  .version(VERSION);

program.command("init")
  .argument("[path]", "project path", process.cwd())
  .description("Initialize TashevOS and detect local AI coding tools")
  .action((path: string) => {
    const root = findProjectRoot(path);
    initializeStore(root);
    const agents = detectAgents(root);
    const adapters = installInstructionAdapters(root, agents);
    const scan = scanProject(root);
    const snapshot = getGitSnapshot(root);
    appendEvent(root, "project.initialized", {
      technologies: scan.technologies,
      packageManager: scan.packageManager ?? null,
      detectedAgents: agents.filter((agent) => agent.detected).map((agent) => agent.id),
      adapters,
      head: snapshot.head
    });
    updateState(root);

    console.log(pc.bold("\nTashevOS initialized"));
    console.log("Project: " + root);
    console.log("Stack: " + (scan.technologies.join(", ") || "unknown"));
    console.log("AI: " + (agents.filter((agent) => agent.detected).map((agent) => agent.name).join(", ") || "none detected"));
    console.log("Adapters: " + adapters.join(", "));
    console.log(pc.dim("\nNext: tash doctor"));
  });

program.command("status")
  .argument("[path]", "project path", process.cwd())
  .description("Show project, Git and memory status")
  .action((path: string) => {
    const root = findProjectRoot(path);
    const snapshot = getGitSnapshot(root);
    const events = readRecentEvents(root, 50);
    const agents = detectAgents(root).filter((agent) => agent.detected);
    console.log(pc.bold("TashevOS status"));
    console.log("Project: " + root);
    console.log("Git: " + snapshot.branch + " @ " + snapshot.head.slice(0, 12) + " " + (snapshot.dirty ? pc.yellow("DIRTY") : pc.green("CLEAN")));
    console.log("Detected AI: " + agents.length);
    console.log("Recorded local events: " + events.length + (events.length === 50 ? "+" : ""));
  });

program.command("agents")
  .argument("[path]", "project path", process.cwd())
  .description("Detect supported AI coding tools and historical sources")
  .action((path: string) => {
    const root = findProjectRoot(path);
    for (const agent of detectAgents(root)) {
      const mark = agent.detected ? pc.green("✓") : pc.dim("○");
      console.log(mark + " " + agent.name);
      if (agent.detected && agent.evidence.length) console.log(pc.dim("  " + agent.evidence.join(", ")));
      for (const source of agent.historySources) console.log(pc.dim("  history: " + source));
    }
  });

program.command("scan")
  .argument("[path]", "project path", process.cwd())
  .description("Scan the current project stack")
  .action((path: string) => {
    const root = findProjectRoot(path);
    console.log(JSON.stringify(scanProject(root), null, 2));
  });

program.command("context")
  .argument("[task...]", "current task")
  .option("-p, --path <path>", "project path", process.cwd())
  .description("Compile a compact evidence-first context packet")
  .action((task: string[], options: { path: string }) => {
    const root = findProjectRoot(options.path);
    console.log(compileContext(root, task.join(" ")));
    appendEvent(root, "context.compiled", { task: task.join(" ") });
  });

program.command("doctor")
  .argument("[path]", "project path", process.cwd())
  .option("--fix", "apply only safe TashevOS repairs", false)
  .description("Check TashevOS integration and project continuity health")
  .action(async (path: string, options: { fix: boolean }) => {
    const root = findProjectRoot(path);
    const checks = await runDoctor(root, options.fix);
    console.log(pc.bold("TashevOS doctor" + (options.fix ? " (safe repair)" : "")));
    for (const check of checks) {
      const icon = check.health === "ok" ? pc.green("✓") : check.health === "warn" ? pc.yellow("!") : pc.red("✗");
      console.log(icon + " " + check.label + ": " + check.detail);
    }
    appendEvent(root, "doctor.completed", {
      fix: options.fix,
      ok: checks.filter((check) => check.health === "ok").length,
      warn: checks.filter((check) => check.health === "warn").length,
      fail: checks.filter((check) => check.health === "fail").length
    });
    if (checks.some((check) => check.health === "fail")) process.exitCode = 1;
  });

program.command("heal")
  .argument("[path]", "project path", process.cwd())
  .description("Run the safe auto-healing pass")
  .action(async (path: string) => {
    const root = findProjectRoot(path);
    const checks = await runDoctor(root, true);
    appendEvent(root, "heal.completed", {
      remaining: checks.filter((check) => check.health !== "ok").map((check) => check.id)
    });
    console.log(pc.bold("Safe healing completed"));
    for (const check of checks) {
      const icon = check.health === "ok" ? pc.green("✓") : check.health === "warn" ? pc.yellow("!") : pc.red("✗");
      console.log(icon + " " + check.label + ": " + check.detail);
    }
  });

program.parseAsync(process.argv);
