import { closeSync, existsSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { ensureDir, readJson, writeJson } from "../lib/fs.js";
import { findProjectRoot } from "../lib/fs.js";
import { createCheckpoint, getSyncStatus, getWorkingStateFingerprint } from "./sync.js";

const AUTOSYNC_SCHEMA = 1;
const DEFAULT_INTERVAL_SECONDS = 300;
const MIN_INTERVAL_SECONDS = 60;
const SERVICE_LABEL = "com.tashevos.autosync";

export interface AutosyncProject {
  path: string;
  enabled: boolean;
  task?: string;
}

export interface AutosyncConfig {
  schemaVersion: number;
  intervalSeconds: number;
  projects: AutosyncProject[];
}

export interface AutosyncProjectState {
  fingerprint?: string;
  lastAttemptAt?: string;
  lastCheckpointAt?: string;
  lastVaultCommit?: string;
  lastResult?: "checkpoint" | "unchanged" | "remote-current" | "error";
  lastError?: string;
}

export interface AutosyncTickResult {
  path: string;
  result: "checkpoint" | "unchanged" | "remote-current" | "error";
  fingerprint?: string;
  vaultCommit?: string;
  error?: string;
}

function globalHome(): string {
  return resolve(process.env.TASHEVOS_HOME || join(homedir(), ".tashevos"));
}

function configPath(): string { return join(globalHome(), "autosync.json"); }
function statePath(): string { return join(globalHome(), "autosync-state.json"); }
function lockPath(): string { return join(globalHome(), "autosync.lock"); }
function logPath(): string { return join(globalHome(), "autosync.log"); }
function errorLogPath(): string { return join(globalHome(), "autosync-error.log"); }

function defaultConfig(): AutosyncConfig {
  return { schemaVersion: AUTOSYNC_SCHEMA, intervalSeconds: DEFAULT_INTERVAL_SECONDS, projects: [] };
}

export function readAutosyncConfig(): AutosyncConfig {
  const raw = readJson<Partial<AutosyncConfig>>(configPath(), {});
  return {
    schemaVersion: typeof raw.schemaVersion === "number" ? raw.schemaVersion : AUTOSYNC_SCHEMA,
    intervalSeconds: typeof raw.intervalSeconds === "number" && raw.intervalSeconds >= MIN_INTERVAL_SECONDS ? raw.intervalSeconds : DEFAULT_INTERVAL_SECONDS,
    projects: Array.isArray(raw.projects) ? raw.projects
      .filter((item): item is AutosyncProject => Boolean(item && typeof item.path === "string"))
      .map((item) => ({ path: resolve(item.path), enabled: item.enabled !== false, ...(item.task ? { task: String(item.task) } : {}) })) : []
  };
}

function writeConfig(config: AutosyncConfig): void {
  ensureDir(globalHome());
  writeJson(configPath(), config);
}

function readStates(): Record<string, AutosyncProjectState> {
  return readJson<Record<string, AutosyncProjectState>>(statePath(), {});
}

function writeStates(states: Record<string, AutosyncProjectState>): void {
  ensureDir(globalHome());
  writeJson(statePath(), states);
}

export function autosyncProjectKey(path: string): string {
  return createHash("sha256").update(resolve(path)).digest("hex");
}

function canonicalProjectPath(path: string): string {
  const root = findProjectRoot(path);
  try { return realpathSync(root); }
  catch { return resolve(root); }
}

function parseStateTask(root: string): string {
  const path = join(root, ".tashevos", "STATE.md");
  if (!existsSync(path)) return "";
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const patterns = [
    /^\s*[-*]\s*(?:Active task|Current task|Активная задача|Текущая задача)\s*:\s*(.+)$/i,
    /^\s*[-*]\s*(?:Next step|Следующий шаг)\s*:\s*(.+)$/i
  ];
  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match?.[1]?.trim()) return match[1].trim();
    }
  }
  return "";
}

function taskFor(project: AutosyncProject): string {
  return project.task?.trim() || parseStateTask(project.path) || `Autosync: continue ${basename(project.path)}`;
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}

function acquireLock(): number | null {
  ensureDir(globalHome());
  const path = lockPath();
  const attempt = (): number | null => {
    try {
      const fd = openSync(path, "wx", 0o600);
      writeFileSync(fd, String(process.pid), "utf8");
      return fd;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let stalePid = 0;
      try { stalePid = Number(readFileSync(path, "utf8").trim()); } catch { stalePid = 0; }
      if (!pidAlive(stalePid)) {
        rmSync(path, { force: true });
        return attempt();
      }
      return null;
    }
  };
  return attempt();
}

function releaseLock(fd: number): void {
  try { closeSync(fd); } catch { /* best effort */ }
  rmSync(lockPath(), { force: true });
}

export function registerAutosyncProject(path: string, task = "", initialCheckpoint = true): { project: AutosyncProject; checkpoint?: string } {
  const root = canonicalProjectPath(path);
  const config = readAutosyncConfig();
  const existing = config.projects.find((item) => item.path === root);
  const project: AutosyncProject = { path: root, enabled: true, ...(task.trim() ? { task: task.trim() } : existing?.task ? { task: existing.task } : {}) };
  config.projects = [...config.projects.filter((item) => item.path !== root), project];
  writeConfig(config);

  const states = readStates();
  const key = autosyncProjectKey(root);
  const fingerprint = getWorkingStateFingerprint(root);
  let checkpoint: string | undefined;
  if (initialCheckpoint) {
    const result = createCheckpoint(root, taskFor(project));
    checkpoint = result.vaultCommit;
    states[key] = {
      fingerprint: result.fingerprint,
      lastAttemptAt: new Date().toISOString(),
      lastCheckpointAt: new Date().toISOString(),
      lastVaultCommit: result.vaultCommit,
      lastResult: "checkpoint"
    };
  } else {
    states[key] = { ...(states[key] || {}), fingerprint, lastAttemptAt: new Date().toISOString(), lastResult: "unchanged" };
  }
  writeStates(states);
  return { project, ...(checkpoint ? { checkpoint } : {}) };
}

export function unregisterAutosyncProject(path: string): boolean {
  const root = canonicalProjectPath(path);
  const config = readAutosyncConfig();
  const before = config.projects.length;
  config.projects = config.projects.filter((item) => item.path !== root);
  writeConfig(config);
  const states = readStates();
  delete states[autosyncProjectKey(root)];
  writeStates(states);
  return config.projects.length !== before;
}

export function setAutosyncInterval(seconds: number): AutosyncConfig {
  const intervalSeconds = Math.max(MIN_INTERVAL_SECONDS, Math.round(seconds));
  const config = readAutosyncConfig();
  config.intervalSeconds = intervalSeconds;
  writeConfig(config);
  return config;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "unknown error");
  return message.replace(/[\r\n]+/g, " ").slice(0, 500);
}

export function runAutosyncTick(): { locked: boolean; results: AutosyncTickResult[] } {
  const fd = acquireLock();
  if (fd === null) return { locked: true, results: [] };
  try {
    const config = readAutosyncConfig();
    const states = readStates();
    const results: AutosyncTickResult[] = [];
    for (const project of config.projects.filter((item) => item.enabled)) {
      const key = autosyncProjectKey(project.path);
      const now = new Date().toISOString();
      try {
        if (!existsSync(project.path)) throw new Error("Project path does not exist");
        const fingerprint = getWorkingStateFingerprint(project.path);
        const previous = states[key];
        if (previous?.fingerprint === fingerprint) {
          states[key] = { ...previous, lastAttemptAt: now, lastResult: "unchanged", lastError: undefined };
          results.push({ path: project.path, result: "unchanged", fingerprint });
          continue;
        }

        let remoteFingerprint: string | undefined;
        try { remoteFingerprint = getSyncStatus(project.path).fingerprint; } catch { remoteFingerprint = undefined; }
        if (remoteFingerprint && remoteFingerprint === fingerprint) {
          states[key] = { ...previous, fingerprint, lastAttemptAt: now, lastResult: "remote-current", lastError: undefined };
          results.push({ path: project.path, result: "remote-current", fingerprint });
          continue;
        }

        const checkpoint = createCheckpoint(project.path, taskFor(project));
        states[key] = {
          fingerprint: checkpoint.fingerprint,
          lastAttemptAt: now,
          lastCheckpointAt: now,
          lastVaultCommit: checkpoint.vaultCommit,
          lastResult: "checkpoint",
          lastError: undefined
        };
        results.push({ path: project.path, result: "checkpoint", fingerprint: checkpoint.fingerprint, vaultCommit: checkpoint.vaultCommit });
      } catch (error) {
        const message = safeError(error);
        states[key] = { ...(states[key] || {}), lastAttemptAt: now, lastResult: "error", lastError: message };
        results.push({ path: project.path, result: "error", error: message });
      }
    }
    writeStates(states);
    return { locked: false, results };
  } finally {
    releaseLock(fd);
  }
}

export function getAutosyncStatus(): { config: AutosyncConfig; states: Record<string, AutosyncProjectState> } {
  return { config: readAutosyncConfig(), states: readStates() };
}

function xml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function cliEntrypoint(): string {
  try { return realpathSync(process.argv[1]); }
  catch { return resolve(process.argv[1]); }
}

function installMacService(intervalSeconds: number): string {
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error("Unable to determine macOS user id.");
  const launchDir = join(homedir(), "Library", "LaunchAgents");
  ensureDir(launchDir);
  ensureDir(globalHome());
  const plist = join(launchDir, `${SERVICE_LABEL}.plist`);
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n  <key>Label</key><string>${SERVICE_LABEL}</string>\n  <key>ProgramArguments</key>\n  <array>\n    <string>${xml(process.execPath)}</string>\n    <string>${xml(cliEntrypoint())}</string>\n    <string>autosync</string>\n    <string>tick</string>\n  </array>\n  <key>RunAtLoad</key><true/>\n  <key>StartInterval</key><integer>${intervalSeconds}</integer>\n  <key>ProcessType</key><string>Background</string>\n  <key>EnvironmentVariables</key>\n  <dict>\n    <key>HOME</key><string>${xml(homedir())}</string>\n    <key>PATH</key><string>${xml([dirname(process.execPath), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(":"))}</string>\n  </dict>\n  <key>StandardOutPath</key><string>${xml(logPath())}</string>\n  <key>StandardErrorPath</key><string>${xml(errorLogPath())}</string>\n</dict>\n</plist>\n`;
  writeFileSync(plist, body, "utf8");
  spawnSync("launchctl", ["bootout", `gui/${uid}`, plist], { stdio: "ignore" });
  const bootstrap = spawnSync("launchctl", ["bootstrap", `gui/${uid}`, plist], { encoding: "utf8" });
  if (bootstrap.status !== 0) throw new Error((bootstrap.stderr || bootstrap.stdout || "launchctl bootstrap failed").trim());
  const kick = spawnSync("launchctl", ["kickstart", "-k", `gui/${uid}/${SERVICE_LABEL}`], { encoding: "utf8" });
  if (kick.status !== 0) throw new Error((kick.stderr || kick.stdout || "launchctl kickstart failed").trim());
  return plist;
}

function installLinuxService(intervalSeconds: number): string {
  const userDir = join(homedir(), ".config", "systemd", "user");
  ensureDir(userDir);
  ensureDir(globalHome());
  const service = join(userDir, "tashevos-autosync.service");
  const timer = join(userDir, "tashevos-autosync.timer");
  writeFileSync(service, `[Unit]\nDescription=TashevOS encrypted autosync\n\n[Service]\nType=oneshot\nExecStart=${process.execPath} ${cliEntrypoint()} autosync tick\n`, "utf8");
  writeFileSync(timer, `[Unit]\nDescription=Run TashevOS autosync periodically\n\n[Timer]\nOnBootSec=30s\nOnUnitActiveSec=${intervalSeconds}s\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n`, "utf8");
  for (const args of [["--user", "daemon-reload"], ["--user", "enable", "--now", "tashevos-autosync.timer"]]) {
    const result = spawnSync("systemctl", args, { encoding: "utf8" });
    if (result.status !== 0) throw new Error((result.stderr || result.stdout || "systemctl failed").trim());
  }
  return timer;
}

export function installAutosyncService(seconds = DEFAULT_INTERVAL_SECONDS): { platform: string; servicePath: string; intervalSeconds: number } {
  const config = setAutosyncInterval(seconds);
  if (!config.projects.length) throw new Error("Register at least one project first: tash autosync add <path>");
  if (process.platform === "darwin") return { platform: "macOS launchd", servicePath: installMacService(config.intervalSeconds), intervalSeconds: config.intervalSeconds };
  if (process.platform === "linux") return { platform: "systemd user timer", servicePath: installLinuxService(config.intervalSeconds), intervalSeconds: config.intervalSeconds };
  throw new Error("Automatic service installation currently supports macOS and Linux. `tash autosync tick` remains portable for other schedulers.");
}

export function uninstallAutosyncService(): boolean {
  if (process.platform === "darwin") {
    const uid = process.getuid?.();
    const plist = join(homedir(), "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`);
    if (uid !== undefined && existsSync(plist)) spawnSync("launchctl", ["bootout", `gui/${uid}`, plist], { stdio: "ignore" });
    const existed = existsSync(plist);
    rmSync(plist, { force: true });
    return existed;
  }
  if (process.platform === "linux") {
    spawnSync("systemctl", ["--user", "disable", "--now", "tashevos-autosync.timer"], { stdio: "ignore" });
    const userDir = join(homedir(), ".config", "systemd", "user");
    const service = join(userDir, "tashevos-autosync.service");
    const timer = join(userDir, "tashevos-autosync.timer");
    const existed = existsSync(service) || existsSync(timer);
    rmSync(service, { force: true }); rmSync(timer, { force: true });
    spawnSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
    return existed;
  }
  return false;
}
