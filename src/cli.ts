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
import { createCheckpoint, getSyncKey, getSyncStatus, initializeSync, resumeCheckpoint } from "./core/sync.js";
import { autosyncProjectKey, getAutosyncStatus, installAutosyncService, registerAutosyncProject, runAutosyncTick, setAutosyncInterval, uninstallAutosyncService, unregisterAutosyncProject } from "./core/autosync.js";
import { configureRedditBridge, getRedditBridgeStatus, importRedditCredentialsFromEnv, installRedditBridgeService, runRedditBridgeTick, uninstallRedditBridgeService } from "./core/reddit.js";

const VERSION = "0.1.0-alpha.2";
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


program.command("checkpoint")
  .argument("[task...]", "what you are doing / where to continue")
  .option("-p, --path <path>", "project path", process.cwd())
  .description("Create an encrypted cross-device checkpoint of Git + safe project continuity")
  .action((task: string[], options: { path: string }) => {
    const root = findProjectRoot(options.path);
    const result = createCheckpoint(root, task.join(" "));
    console.log(pc.bold("TashevOS checkpoint saved"));
    console.log("Project: " + root);
    console.log("Git: " + result.branch + " @ " + result.head.slice(0, 12));
    console.log("Task: " + (result.task || "(not specified)"));
    console.log("Untracked captured: " + result.untracked);
    if (result.skippedUntracked.length) {
      console.log(pc.yellow("Skipped for safety: " + result.skippedUntracked.length));
      for (const item of result.skippedUntracked.slice(0, 10)) console.log(pc.dim("  - " + item));
    }
    console.log(pc.dim("Vault commit: " + result.vaultCommit.slice(0, 12)));
  });

program.command("resume")
  .argument("[path]", "project path", process.cwd())
  .option("--force", "allow replacing local branch/worktree after creating a rescue stash", false)
  .description("Restore the latest encrypted checkpoint on this device")
  .action((path: string, options: { force: boolean }) => {
    const root = findProjectRoot(path);
    const result = resumeCheckpoint(root, options.force);
    console.log(pc.bold("TashevOS resumed"));
    console.log("Project: " + root);
    console.log("Checkpoint: " + result.createdAt);
    console.log("Git: " + result.branch + " @ " + result.head.slice(0, 12));
    console.log("Task: " + (result.task || "(not specified)"));
    if (result.rescueStash) console.log(pc.yellow("Previous local work saved in " + result.rescueStash));
    if (result.skippedUntracked.length) console.log(pc.yellow("Checkpoint excluded " + result.skippedUntracked.length + " secret/large untracked file(s)."));
    console.log(pc.dim("Next: tash context \"" + (result.task || "continue") + "\""));
  });

const sync = program.command("sync").description("Configure and inspect encrypted cross-device continuity");

sync.command("init")
  .requiredOption("--remote <git-url>", "private Git repository used as the encrypted continuity vault")
  .option("--key <key>", "existing recovery key for another device")
  .description("Configure encrypted sync on this device")
  .action((options: { remote: string; key?: string }) => {
    const result = initializeSync(options.remote, options.key);
    console.log(pc.bold("TashevOS sync configured"));
    console.log("Remote: " + result.config.remote);
    console.log("Encryption: AES-256-GCM + scrypt");
    console.log("Recovery key: " + (result.generatedKey ? "generated locally" : "reused"));
    console.log(pc.dim("Use `tash sync key` only when you need to enroll another trusted device."));
  });

sync.command("status")
  .argument("[path]", "project path", process.cwd())
  .description("Show the latest remote checkpoint for this project")
  .action((path: string) => {
    const root = findProjectRoot(path);
    const status = getSyncStatus(root);
    console.log(pc.bold("TashevOS sync status"));
    console.log("Checkpoint: " + status.createdAt);
    console.log("Git: " + status.branch + " @ " + status.head.slice(0, 12));
    console.log("Task: " + (status.task || "(not specified)"));
    console.log("Age: " + Math.round(status.ageMs / 1000) + "s");
    console.log("Untracked captured: " + status.untracked);
    if (status.skippedUntracked.length) console.log(pc.yellow("Excluded for safety: " + status.skippedUntracked.length));
  });

sync.command("key")
  .description("Print the recovery key so you can enroll another trusted device")
  .action(() => {
    console.log(getSyncKey());
  });

sync.command("push")
  .argument("[task...]", "what you are doing / where to continue")
  .option("-p, --path <path>", "project path", process.cwd())
  .description("Alias for checkpoint")
  .action((task: string[], options: { path: string }) => {
    const root = findProjectRoot(options.path);
    const result = createCheckpoint(root, task.join(" "));
    console.log("Checkpoint: " + result.branch + " @ " + result.head.slice(0, 12));
  });

sync.command("pull")
  .argument("[path]", "project path", process.cwd())
  .option("--force", "create rescue stash and restore even if local work differs", false)
  .description("Alias for resume")
  .action((path: string, options: { force: boolean }) => {
    const root = findProjectRoot(path);
    const result = resumeCheckpoint(root, options.force);
    console.log("Resumed: " + result.branch + " @ " + result.head.slice(0, 12));
  });


const autosync = program.command("autosync").description("Automatically checkpoint changed projects in the encrypted vault");

autosync.command("add")
  .argument("[path]", "project path", process.cwd())
  .option("--task <task>", "fallback handoff task for automatic checkpoints")
  .option("--no-initial", "register without creating an immediate checkpoint")
  .description("Register a project for encrypted background autosync")
  .action((path: string, options: { task?: string; initial: boolean }) => {
    const root = findProjectRoot(path);
    const result = registerAutosyncProject(root, options.task || "", options.initial);
    console.log(pc.bold("TashevOS autosync project registered"));
    console.log("Project: " + result.project.path);
    console.log("Initial checkpoint: " + (result.checkpoint ? result.checkpoint.slice(0, 12) : "skipped"));
  });

autosync.command("remove")
  .argument("[path]", "project path", process.cwd())
  .description("Stop autosyncing a project")
  .action((path: string) => {
    const root = findProjectRoot(path);
    console.log(unregisterAutosyncProject(root) ? "Autosync project removed" : "Project was not registered");
  });

autosync.command("tick")
  .description("Run one autosync pass; intended for launchd/systemd and other schedulers")
  .action(() => {
    const tick = runAutosyncTick();
    if (tick.locked) {
      console.log("Autosync skipped: another pass is already running");
      return;
    }
    if (!tick.results.length) {
      console.log("Autosync: no registered projects");
      return;
    }
    for (const item of tick.results) {
      if (item.result === "checkpoint") console.log(`checkpoint ${item.path} ${item.vaultCommit?.slice(0, 12) || ""}`.trim());
      else if (item.result === "error") console.error(`error ${item.path}: ${item.error}`);
      else console.log(`${item.result} ${item.path}`);
    }
    if (tick.results.some((item) => item.result === "error")) process.exitCode = 1;
  });

autosync.command("status")
  .description("Show registered projects and last autosync result")
  .action(() => {
    const status = getAutosyncStatus();
    console.log(pc.bold("TashevOS autosync"));
    console.log("Interval: " + status.config.intervalSeconds + "s");
    if (!status.config.projects.length) {
      console.log("Projects: none");
      return;
    }
    for (const project of status.config.projects) {
      const key = autosyncProjectKey(project.path);
      const state = status.states[key];
      console.log((project.enabled ? "✓ " : "○ ") + project.path);
      console.log(pc.dim("  last: " + (state?.lastResult || "never") + (state?.lastCheckpointAt ? " @ " + state.lastCheckpointAt : "")));
      if (state?.lastError) console.log(pc.yellow("  error: " + state.lastError));
    }
  });

autosync.command("install")
  .option("--interval <seconds>", "seconds between checks", "300")
  .description("Install the background autosync service (macOS launchd / Linux systemd)")
  .action((options: { interval: string }) => {
    const seconds = Number(options.interval);
    if (!Number.isFinite(seconds) || seconds < 60) throw new Error("Autosync interval must be at least 60 seconds.");
    const result = installAutosyncService(seconds);
    console.log(pc.bold("TashevOS autosync service installed"));
    console.log("Service: " + result.platform);
    console.log("Interval: " + result.intervalSeconds + "s");
    console.log("Config: " + result.servicePath);
  });

autosync.command("interval")
  .argument("<seconds>", "seconds between checks")
  .description("Change the stored autosync interval; reinstall service to apply scheduler timing")
  .action((seconds: string) => {
    const value = Number(seconds);
    if (!Number.isFinite(value) || value < 60) throw new Error("Autosync interval must be at least 60 seconds.");
    const config = setAutosyncInterval(value);
    console.log("Autosync interval: " + config.intervalSeconds + "s");
  });

autosync.command("uninstall")
  .description("Remove the background autosync service without deleting checkpoints or project registrations")
  .action(() => {
    console.log(uninstallAutosyncService() ? "Autosync service removed" : "Autosync service was not installed");
  });


const reddit = program.command("reddit").description("Automate GitHub ↔ Reddit releases and feedback");

reddit.command("init")
  .requiredOption("--repo <owner/name>", "GitHub repository to mirror")
  .requiredOption("--bot <username>", "dedicated Reddit app/bot username")
  .requiredOption("--subreddit <names...>", "allowlisted subreddit(s)")
  .option("--interval <seconds>", "seconds between background checks", "1800")
  .option("--no-auto-publish", "do not publish releases automatically")
  .option("--no-issues", "do not mirror Reddit bug/feature feedback into GitHub Issues")
  .description("Configure the Reddit/GitHub bridge")
  .action((options: { repo: string; bot: string; subreddit: string[]; interval: string; autoPublish: boolean; issues: boolean }) => {
    const seconds = Number(options.interval);
    if (!Number.isFinite(seconds)) throw new Error("Reddit bridge interval must be a number.");
    const config = configureRedditBridge({
      repository: options.repo,
      botUsername: options.bot,
      subreddits: options.subreddit,
      intervalSeconds: seconds,
      autoPublish: options.autoPublish,
      syncIssues: options.issues
    });
    console.log(pc.bold("TashevOS Reddit bridge configured"));
    console.log("Repository: " + config.repository);
    console.log("Bot: u/" + config.botUsername);
    console.log("Subreddits: " + config.subreddits.map((name) => "r/" + name).join(", "));
    console.log("Interval: " + config.intervalSeconds + "s");
    console.log(pc.dim("Next: export Reddit OAuth credentials, then run `tash reddit auth`."));
  });

reddit.command("auth")
  .description("Import Reddit OAuth credentials from environment variables into a local 0600 file")
  .action(() => {
    const path = importRedditCredentialsFromEnv();
    console.log(pc.bold("Reddit credentials imported"));
    console.log(pc.dim(path));
  });

reddit.command("tick")
  .description("Run one Reddit/GitHub synchronization pass")
  .action(async () => {
    const result = await runRedditBridgeTick();
    for (const item of result.published) console.log(pc.green("published ") + item);
    for (const item of result.skipped) console.log(pc.yellow("skipped ") + item);
    for (const item of result.issues) console.log(pc.green("issue ") + item);
    for (const item of result.closedReplies) console.log(pc.green("closed-reply ") + item);
    if (!result.published.length && !result.skipped.length && !result.issues.length && !result.closedReplies.length) {
      console.log("Reddit bridge: no new work");
    }
  });

reddit.command("status")
  .description("Show Reddit/GitHub bridge configuration and local state")
  .action(() => {
    const status = getRedditBridgeStatus();
    console.log(pc.bold("TashevOS Reddit bridge"));
    console.log("Repository: " + status.config.repository);
    console.log("Bot: u/" + status.config.botUsername);
    console.log("Subreddits: " + status.config.subreddits.map((name) => "r/" + name).join(", "));
    console.log("Credentials: " + (status.credentialsConfigured ? pc.green("configured") : pc.yellow("missing")));
    console.log("Auto publish: " + (status.config.autoPublish ? "yes" : "no"));
    console.log("Issue sync: " + (status.config.syncIssues ? "yes" : "no"));
    console.log("Posts tracked: " + Object.keys(status.state.posts).length);
    console.log("Feedback mirrored: " + Object.keys(status.state.comments).length);
    console.log("Last run: " + (status.state.lastRunAt || "never"));
    if (status.state.lastError) console.log(pc.yellow("Last error: " + status.state.lastError));
  });

reddit.command("install")
  .description("Install the background Reddit/GitHub bridge service")
  .action(() => {
    const result = installRedditBridgeService();
    console.log(pc.bold("TashevOS Reddit bridge service installed"));
    console.log("Service: " + result.platform);
    console.log("Interval: " + result.intervalSeconds + "s");
    console.log("Config: " + result.servicePath);
  });

reddit.command("uninstall")
  .description("Remove the background Reddit/GitHub bridge service")
  .action(() => {
    console.log(uninstallRedditBridgeService() ? "Reddit bridge service removed" : "Reddit bridge service was not installed");
  });

program.parseAsync(process.argv);
