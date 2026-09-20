import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { existsSync, chmodSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { gzipSync, gunzipSync } from "node:zlib";
import { DATA_DIR, appendEvent, initializeStore, readRecentEvents, updateState } from "./store.js";
import { getGitSnapshot } from "../lib/git.js";
import { ensureDir, readJson, writeJson } from "../lib/fs.js";

const SYNC_SCHEMA = 1;
const MAX_UNTRACKED_FILE = 5 * 1024 * 1024;
const MAX_UNTRACKED_TOTAL = 25 * 1024 * 1024;
const SYNC_FILES = [
  "PROJECT.md",
  "STATE.md",
  "GUARDRAILS.md",
  "config.json",
  "memory/decisions.ndjson",
  "memory/failed-approaches.ndjson"
] as const;

export interface SyncConfig {
  schemaVersion: number;
  remote: string;
  branch: string;
  keyFile: string;
}

interface EncryptedEnvelope {
  version: number;
  alg: "aes-256-gcm";
  kdf: "scrypt";
  salt: string;
  iv: string;
  tag: string;
  data: string;
}

interface UntrackedFile {
  path: string;
  mode: number;
  data: string;
}

interface ContinuityPayload {
  version: number;
  projectId: string;
  createdAt: string;
  fingerprint?: string;
  task: string;
  repository: string;
  branch: string;
  head: string;
  stagedPatch: string;
  unstagedPatch: string;
  untracked: UntrackedFile[];
  skippedUntracked: string[];
  bundle: string;
  memory: Record<string, string>;
  events: unknown[];
}

export interface CheckpointResult {
  projectId: string;
  fingerprint: string;
  task: string;
  branch: string;
  head: string;
  untracked: number;
  skippedUntracked: string[];
  vaultCommit: string;
}

export interface ResumeResult {
  projectId: string;
  task: string;
  branch: string;
  head: string;
  createdAt: string;
  untracked: number;
  skippedUntracked: string[];
  rescueStash?: string;
}

function globalHome(): string {
  return resolve(process.env.TASHEVOS_HOME || join(homedir(), ".tashevos"));
}

function syncConfigPath(): string { return join(globalHome(), "sync.json"); }
function defaultKeyPath(): string { return join(globalHome(), "sync.key"); }
function vaultPath(): string { return join(globalHome(), "vault"); }

function run(cwd: string, command: string, args: string[], input?: string): string {
  const result = spawnSync(command, args, {
    cwd,
    input,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"]
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || `${command} failed`).trim();
    throw new Error(detail);
  }
  return result.stdout.trim();
}

function git(root: string, args: string[]): string { return run(root, "git", args); }

function gitMaybe(root: string, args: string[]): string {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return result.status === 0 ? result.stdout.trim() : "";
}

function normalizeRepository(value: string): string {
  const raw = value.trim().replace(/\\/g, "/");
  const ssh = raw.match(/^git@([^:]+):(.+)$/);
  if (ssh) return `${ssh[1].toLowerCase()}/${ssh[2].replace(/\.git$/i, "").toLowerCase()}`;
  try {
    const url = new URL(raw);
    return `${url.host.toLowerCase()}${url.pathname.replace(/\.git$/i, "").replace(/\/$/, "").toLowerCase()}`;
  } catch {
    return isAbsolute(raw) ? resolve(raw) : raw;
  }
}

function repositoryIdentity(root: string): { remote: string; normalized: string; projectId: string } {
  const remote = git(root, ["remote", "get-url", "origin"]);
  if (!remote) throw new Error("TashevOS sync requires a Git origin remote.");
  const normalized = normalizeRepository(remote);
  const projectId = createHash("sha256").update(normalized).digest("hex");
  return { remote, normalized, projectId };
}

function readSyncConfig(): SyncConfig {
  const config = readJson<Partial<SyncConfig>>(syncConfigPath(), {});
  if (!config.remote || !config.keyFile) throw new Error("Sync is not configured. Run: tash sync init --remote <git-url>");
  return {
    schemaVersion: typeof config.schemaVersion === "number" ? config.schemaVersion : SYNC_SCHEMA,
    remote: String(config.remote),
    branch: String(config.branch || "main"),
    keyFile: String(config.keyFile)
  };
}

function readKey(config: SyncConfig): string {
  const key = process.env.TASHEVOS_SYNC_KEY?.trim() || (existsSync(config.keyFile) ? readFileSync(config.keyFile, "utf8").trim() : "");
  if (!key) throw new Error("TashevOS sync key is unavailable. Set TASHEVOS_SYNC_KEY or restore the key with `tash sync init --key ...`.");
  if (key.length < 32) throw new Error("TashevOS sync key is too short.");
  return key;
}

function ensureGitIdentity(dir: string): void {
  if (!gitMaybe(dir, ["config", "user.email"])) git(dir, ["config", "user.email", "tashevos@local"]);
  if (!gitMaybe(dir, ["config", "user.name"])) git(dir, ["config", "user.name", "TashevOS"]);
}

function refreshVault(config: SyncConfig): string {
  const vault = vaultPath();
  ensureDir(dirname(vault));
  if (!existsSync(join(vault, ".git"))) {
    rmSync(vault, { recursive: true, force: true });
    run(globalHome(), "git", ["clone", "--quiet", config.remote, vault]);
  }
  const currentRemote = git(vault, ["remote", "get-url", "origin"]);
  if (currentRemote !== config.remote) git(vault, ["remote", "set-url", "origin", config.remote]);
  ensureGitIdentity(vault);
  git(vault, ["fetch", "--quiet", "origin"]);
  const remoteRef = `refs/remotes/origin/${config.branch}`;
  const hasRemote = Boolean(gitMaybe(vault, ["show-ref", "--verify", "--hash", remoteRef]));
  if (hasRemote) {
    git(vault, ["checkout", "-q", "-B", config.branch, `origin/${config.branch}`]);
  } else {
    const hasHead = Boolean(gitMaybe(vault, ["rev-parse", "--verify", "HEAD"]));
    if (hasHead) git(vault, ["checkout", "-q", "-B", config.branch]);
    else git(vault, ["checkout", "-q", "--orphan", config.branch]);
  }
  return vault;
}

export function initializeSync(remote: string, suppliedKey?: string): { config: SyncConfig; generatedKey: boolean } {
  const target = remote.trim();
  if (!target) throw new Error("Sync remote is required.");
  const home = globalHome();
  ensureDir(home);
  const keyPath = defaultKeyPath();
  const existing = existsSync(keyPath) ? readFileSync(keyPath, "utf8").trim() : "";
  const key = suppliedKey?.trim() || existing || randomBytes(32).toString("base64url");
  if (key.length < 32) throw new Error("Sync key must contain at least 32 characters.");
  writeFileSync(keyPath, key + "\n", { encoding: "utf8", mode: 0o600 });
  try { chmodSync(keyPath, 0o600); } catch { /* best effort on platforms without POSIX modes */ }
  const config: SyncConfig = { schemaVersion: SYNC_SCHEMA, remote: target, branch: "main", keyFile: keyPath };
  writeJson(syncConfigPath(), config);
  refreshVault(config);
  return { config, generatedKey: !suppliedKey && !existing };
}

export function getSyncKey(): string {
  return readKey(readSyncConfig());
}

function encrypt(payload: ContinuityPayload, key: string): EncryptedEnvelope {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const derived = scryptSync(key, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", derived, iv);
  const compressed = gzipSync(Buffer.from(JSON.stringify(payload), "utf8"), { level: 9 });
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  return {
    version: SYNC_SCHEMA,
    alg: "aes-256-gcm",
    kdf: "scrypt",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64")
  };
}

function decrypt(envelope: EncryptedEnvelope, key: string): ContinuityPayload {
  if (envelope.version !== SYNC_SCHEMA || envelope.alg !== "aes-256-gcm" || envelope.kdf !== "scrypt") throw new Error("Unsupported TashevOS checkpoint format.");
  try {
    const salt = Buffer.from(envelope.salt, "base64");
    const iv = Buffer.from(envelope.iv, "base64");
    const derived = scryptSync(key, salt, 32);
    const decipher = createDecipheriv("aes-256-gcm", derived, iv);
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const plain = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]);
    return JSON.parse(gunzipSync(plain).toString("utf8")) as ContinuityPayload;
  } catch {
    throw new Error("Unable to decrypt TashevOS checkpoint. Check the sync key.");
  }
}

function isSecretLike(path: string): boolean {
  const lower = path.toLowerCase().replace(/\\/g, "/");
  const name = basename(lower);
  if (name === ".env" || name.startsWith(".env.")) return true;
  if ([".npmrc", ".pypirc", "id_rsa", "id_ed25519", "credentials", "credentials.json", "secrets.json"].includes(name)) return true;
  if (/\.(pem|key|p12|pfx|jks|kdbx)$/i.test(name)) return true;
  if (lower.includes("/.git/") || lower.startsWith(".git/")) return true;
  if (lower.startsWith(".tashevos/local/") || lower.startsWith(".tashevos/cache/") || lower.startsWith(".tashevos/sessions/")) return true;
  return false;
}

function listUntracked(root: string): { files: UntrackedFile[]; skipped: string[] } {
  const raw = spawnSync("git", ["-C", root, "ls-files", "--others", "--exclude-standard", "-z"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (raw.status !== 0) throw new Error((raw.stderr || "Unable to list untracked files").trim());
  const names = raw.stdout.split("\0").filter(Boolean);
  const files: UntrackedFile[] = [];
  const skipped: string[] = [];
  let total = 0;
  for (const name of names) {
    if (isSecretLike(name)) { skipped.push(`${name} (secret-like)`); continue; }
    const absolute = resolve(root, name);
    const rel = relative(root, absolute);
    if (!rel || rel.startsWith(".." + sep) || rel === ".." || isAbsolute(rel)) { skipped.push(`${name} (unsafe path)`); continue; }
    let stat;
    try { stat = statSync(absolute); } catch { skipped.push(`${name} (unreadable)`); continue; }
    if (!stat.isFile()) { skipped.push(`${name} (not a regular file)`); continue; }
    if (stat.size > MAX_UNTRACKED_FILE || total + stat.size > MAX_UNTRACKED_TOTAL) { skipped.push(`${name} (size limit)`); continue; }
    const data = readFileSync(absolute);
    total += data.byteLength;
    files.push({ path: name, mode: stat.mode & 0o777, data: data.toString("base64") });
  }
  return { files, skipped };
}

function stateFingerprint(branch: string, head: string, stagedPatch: string, unstagedPatch: string, files: UntrackedFile[]): string {
  const hash = createHash("sha256");
  hash.update(branch);
  hash.update("\0");
  hash.update(head);
  hash.update("\0staged\0");
  hash.update(stagedPatch);
  hash.update("\0unstaged\0");
  hash.update(unstagedPatch);
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update("\0file\0");
    hash.update(file.path);
    hash.update("\0");
    hash.update(String(file.mode));
    hash.update("\0");
    hash.update(file.data);
  }
  return hash.digest("hex");
}

export function getWorkingStateFingerprint(root: string): string {
  const snapshot = getGitSnapshot(root);
  if (snapshot.head === "UNBORN") throw new Error("Create the first Git commit before enabling autosync.");
  if (snapshot.branch === "DETACHED") throw new Error("Autosync requires a named Git branch.");
  const stagedPatch = git(root, ["diff", "--binary", "--cached", "HEAD"]);
  const unstagedPatch = git(root, ["diff", "--binary"]);
  const untracked = listUntracked(root);
  return stateFingerprint(snapshot.branch, snapshot.head, stagedPatch, unstagedPatch, untracked.files);
}

function captureMemory(root: string): Record<string, string> {
  const memory: Record<string, string> = {};
  for (const relativePath of SYNC_FILES) {
    const path = join(root, DATA_DIR, relativePath);
    if (existsSync(path)) memory[relativePath] = readFileSync(path, "utf8");
  }
  return memory;
}

function createBundle(root: string, branch: string): string {
  const path = join(tmpdir(), `tashevos-${process.pid}-${Date.now()}.bundle`);
  try {
    git(root, ["bundle", "create", path, `refs/heads/${branch}`]);
    return readFileSync(path).toString("base64");
  } finally {
    rmSync(path, { force: true });
  }
}

function checkpointPath(projectId: string): string { return join("projects", projectId, "latest.tash"); }

function pushCheckpoint(vault: string, config: SyncConfig, projectId: string, envelope: EncryptedEnvelope, createdAt: string): string {
  const relativePath = checkpointPath(projectId);
  const absolute = join(vault, relativePath);
  ensureDir(dirname(absolute));
  const serialized = JSON.stringify(envelope) + "\n";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    git(vault, ["fetch", "--quiet", "origin"]);
    const remoteRef = `refs/remotes/origin/${config.branch}`;
    if (gitMaybe(vault, ["show-ref", "--verify", "--hash", remoteRef])) git(vault, ["reset", "--hard", `origin/${config.branch}`]);
    writeFileSync(absolute, serialized, "utf8");
    git(vault, ["add", "--", relativePath]);
    const changed = git(vault, ["status", "--porcelain", "--", relativePath]);
    if (changed) git(vault, ["commit", "-q", "-m", `checkpoint ${projectId.slice(0, 12)} ${createdAt}`]);
    const push = spawnSync("git", ["-C", vault, "push", "--quiet", "origin", `HEAD:${config.branch}`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (push.status === 0) return git(vault, ["rev-parse", "HEAD"]);
    if (attempt === 1) throw new Error((push.stderr || "Unable to push TashevOS checkpoint").trim());
  }
  throw new Error("Unable to push TashevOS checkpoint.");
}

export function createCheckpoint(root: string, task = ""): CheckpointResult {
  initializeStore(root);
  updateState(root);
  const config = readSyncConfig();
  const key = readKey(config);
  const repository = repositoryIdentity(root);
  const snapshot = getGitSnapshot(root);
  if (snapshot.head === "UNBORN") throw new Error("Create the first Git commit before making a cross-device checkpoint.");
  if (snapshot.branch === "DETACHED") throw new Error("Cross-device checkpoint requires a named Git branch.");
  const untracked = listUntracked(root);
  const stagedPatch = git(root, ["diff", "--binary", "--cached", "HEAD"]);
  const unstagedPatch = git(root, ["diff", "--binary"]);
  const fingerprint = stateFingerprint(snapshot.branch, snapshot.head, stagedPatch, unstagedPatch, untracked.files);
  const payload: ContinuityPayload = {
    version: SYNC_SCHEMA,
    projectId: repository.projectId,
    createdAt: new Date().toISOString(),
    fingerprint,
    task: task.trim(),
    repository: repository.normalized,
    branch: snapshot.branch,
    head: snapshot.head,
    stagedPatch,
    unstagedPatch,
    untracked: untracked.files,
    skippedUntracked: untracked.skipped,
    bundle: createBundle(root, snapshot.branch),
    memory: captureMemory(root),
    events: readRecentEvents(root, 50)
  };
  const vault = refreshVault(config);
  const commit = pushCheckpoint(vault, config, repository.projectId, encrypt(payload, key), payload.createdAt);
  appendEvent(root, "sync.checkpoint", { task: payload.task, head: payload.head, branch: payload.branch, vaultCommit: commit, skippedUntracked: untracked.skipped.length });
  return { projectId: repository.projectId, fingerprint, task: payload.task, branch: payload.branch, head: payload.head, untracked: payload.untracked.length, skippedUntracked: payload.skippedUntracked, vaultCommit: commit };
}

function loadCheckpoint(root: string): ContinuityPayload {
  const config = readSyncConfig();
  const key = readKey(config);
  const repository = repositoryIdentity(root);
  const vault = refreshVault(config);
  const path = join(vault, checkpointPath(repository.projectId));
  if (!existsSync(path)) throw new Error("No TashevOS checkpoint exists for this project yet.");
  const envelope = readJson<EncryptedEnvelope | null>(path, null);
  if (!envelope) throw new Error("The TashevOS checkpoint is unreadable.");
  const payload = decrypt(envelope, key);
  if (payload.projectId !== repository.projectId) throw new Error("Checkpoint project identity mismatch.");
  return payload;
}

function writePatch(root: string, patch: string, staged: boolean): void {
  if (!patch.trim()) return;
  const path = join(tmpdir(), `tashevos-${process.pid}-${Date.now()}-${staged ? "staged" : "worktree"}.patch`);
  try {
    writeFileSync(path, patch + (patch.endsWith("\n") ? "" : "\n"), "utf8");
    git(root, ["apply", "--binary", ...(staged ? ["--index"] : []), path]);
  } finally { rmSync(path, { force: true }); }
}

function importBundle(root: string, payload: ContinuityPayload): void {
  const path = join(tmpdir(), `tashevos-${process.pid}-${Date.now()}.bundle`);
  try {
    writeFileSync(path, Buffer.from(payload.bundle, "base64"));
    const ref = `refs/tashevos/resume/${payload.projectId.slice(0, 12)}`;
    git(root, ["fetch", "-q", path, `refs/heads/${payload.branch}:${ref}`]);
    const fetched = git(root, ["rev-parse", ref]);
    if (fetched !== payload.head) throw new Error("Checkpoint bundle HEAD mismatch.");
  } finally { rmSync(path, { force: true }); }
}

function commitRelation(root: string, current: string, target: string): "same" | "target-ahead" | "current-ahead" | "diverged" {
  if (current === target) return "same";
  const targetAhead = spawnSync("git", ["-C", root, "merge-base", "--is-ancestor", current, target]).status === 0;
  if (targetAhead) return "target-ahead";
  const currentAhead = spawnSync("git", ["-C", root, "merge-base", "--is-ancestor", target, current]).status === 0;
  if (currentAhead) return "current-ahead";
  return "diverged";
}

function restoreUntracked(root: string, files: UntrackedFile[], force: boolean): void {
  for (const file of files) {
    const absolute = resolve(root, file.path);
    const rel = relative(root, absolute);
    if (!rel || rel.startsWith(".." + sep) || rel === ".." || isAbsolute(rel) || isSecretLike(file.path)) throw new Error(`Unsafe checkpoint path: ${file.path}`);
    if (existsSync(absolute) && !force) throw new Error(`Resume would overwrite untracked file: ${file.path}`);
    ensureDir(dirname(absolute));
    writeFileSync(absolute, Buffer.from(file.data, "base64"), { mode: file.mode });
  }
}

function restoreMemory(root: string, memory: Record<string, string>): void {
  for (const relativePath of SYNC_FILES) {
    const value = memory[relativePath];
    if (typeof value !== "string") continue;
    const path = join(root, DATA_DIR, relativePath);
    ensureDir(dirname(path));
    writeFileSync(path, value, "utf8");
  }
}

export function resumeCheckpoint(root: string, force = false): ResumeResult {
  const before = getGitSnapshot(root);
  const payload = loadCheckpoint(root);
  let rescueStash: string | undefined;
  if (before.dirty) {
    if (!force) throw new Error("Working tree is not clean. Commit/checkpoint it first or rerun `tash resume --force` to create a rescue stash.");
    git(root, ["stash", "push", "-u", "-m", `tashevos pre-resume ${new Date().toISOString()}`]);
    rescueStash = git(root, ["stash", "list", "-1", "--format=%gd"]);
  }

  importBundle(root, payload);
  const branchRef = `refs/heads/${payload.branch}`;
  const localBranchHead = gitMaybe(root, ["show-ref", "--verify", "--hash", branchRef]);
  if (localBranchHead) {
    const relation = commitRelation(root, localBranchHead, payload.head);
    if ((relation === "current-ahead" || relation === "diverged") && !force) {
      throw new Error(`Local branch ${payload.branch} contains work newer than or divergent from the checkpoint. Use --force only after reviewing it.`);
    }
  }

  const currentBranch = getGitSnapshot(root).branch;
  if (currentBranch !== payload.branch) {
    if (localBranchHead) git(root, ["checkout", "-q", payload.branch]);
    else git(root, ["checkout", "-q", "-b", payload.branch, payload.head]);
  }
  git(root, ["reset", "--hard", payload.head]);
  writePatch(root, payload.stagedPatch, true);
  writePatch(root, payload.unstagedPatch, false);
  restoreUntracked(root, payload.untracked, force);
  restoreMemory(root, payload.memory);
  updateState(root);
  appendEvent(root, "sync.resumed", { checkpointAt: payload.createdAt, task: payload.task, head: payload.head, branch: payload.branch, rescueStash: rescueStash || null });
  return { projectId: payload.projectId, task: payload.task, branch: payload.branch, head: payload.head, createdAt: payload.createdAt, untracked: payload.untracked.length, skippedUntracked: payload.skippedUntracked, ...(rescueStash ? { rescueStash } : {}) };
}

export function getSyncStatus(root: string): Omit<ResumeResult, "untracked"> & { untracked: number; ageMs: number; fingerprint?: string } {
  const payload = loadCheckpoint(root);
  return {
    projectId: payload.projectId,
    fingerprint: payload.fingerprint,
    task: payload.task,
    branch: payload.branch,
    head: payload.head,
    createdAt: payload.createdAt,
    untracked: payload.untracked.length,
    skippedUntracked: payload.skippedUntracked,
    ageMs: Math.max(0, Date.now() - Date.parse(payload.createdAt))
  };
}
