import { chmodSync, existsSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { ensureDir, readJson, writeJson } from "../lib/fs.js";

const REDDIT_SCHEMA = 1;
const DEFAULT_INTERVAL_SECONDS = 1800;
const MIN_INTERVAL_SECONDS = 900;
const SERVICE_LABEL = "com.tashevos.reddit-bridge";

export interface RedditBridgeConfig {
  schemaVersion: number;
  repository: string;
  botUsername: string;
  intervalSeconds: number;
  subreddits: string[];
  autoPublish: boolean;
  syncIssues: boolean;
}

interface RedditCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

interface GitHubRelease {
  id: number;
  tag_name: string;
  name?: string | null;
  body?: string | null;
  html_url: string;
  draft?: boolean;
  prerelease?: boolean;
}

interface RedditPostState {
  releaseId: number;
  subreddit: string;
  postId: string;
  fullname: string;
  permalink: string;
  createdAt: string;
}

interface RedditCommentState {
  postId: string;
  commentId: string;
  fullname: string;
  permalink: string;
  issueNumber: number;
  issueUrl: string;
  notifiedClosed?: boolean;
}

interface RedditBridgeState {
  lastRunAt?: string;
  lastError?: string;
  posts: Record<string, RedditPostState>;
  comments: Record<string, RedditCommentState>;
  skipped: Record<string, { reason: string; at: string }>;
}

export interface RedditTickResult {
  published: string[];
  skipped: string[];
  issues: string[];
  closedReplies: string[];
}

export type RedditFeedbackKind = "bug" | "feature" | "other";

function globalHome(): string {
  return resolve(process.env.TASHEVOS_HOME || join(homedir(), ".tashevos"));
}

function configPath(): string { return join(globalHome(), "reddit-bridge.json"); }
function credentialsPath(): string { return join(globalHome(), "reddit-credentials.json"); }
function statePath(): string { return join(globalHome(), "reddit-state.json"); }
function logPath(): string { return join(globalHome(), "reddit.log"); }
function errorLogPath(): string { return join(globalHome(), "reddit-error.log"); }

function normalizeSubreddit(value: string): string {
  return value.trim().replace(/^r\//i, "").replace(/^\/+/, "");
}

function normalizeRepository(value: string): string {
  const repo = value.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "").replace(/^\/+|\/+$/g, "");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error("Repository must use owner/name format.");
  return repo;
}

function defaultState(): RedditBridgeState {
  return { posts: {}, comments: {}, skipped: {} };
}

export function configureRedditBridge(input: {
  repository: string;
  botUsername: string;
  subreddits: string[];
  intervalSeconds?: number;
  autoPublish?: boolean;
  syncIssues?: boolean;
}): RedditBridgeConfig {
  const subreddits = [...new Set(input.subreddits.map(normalizeSubreddit).filter(Boolean))];
  if (!subreddits.length) throw new Error("At least one subreddit is required.");
  const botUsername = input.botUsername.trim().replace(/^u\//i, "");
  if (!botUsername) throw new Error("A dedicated Reddit app/bot username is required.");
  const intervalSeconds = Math.max(MIN_INTERVAL_SECONDS, Math.round(input.intervalSeconds || DEFAULT_INTERVAL_SECONDS));
  const config: RedditBridgeConfig = {
    schemaVersion: REDDIT_SCHEMA,
    repository: normalizeRepository(input.repository),
    botUsername,
    intervalSeconds,
    subreddits,
    autoPublish: input.autoPublish !== false,
    syncIssues: input.syncIssues !== false
  };
  ensureDir(globalHome());
  writeJson(configPath(), config);
  return config;
}

export function readRedditBridgeConfig(): RedditBridgeConfig {
  const raw = readJson<Partial<RedditBridgeConfig>>(configPath(), {});
  if (!raw.repository || !raw.botUsername || !Array.isArray(raw.subreddits) || !raw.subreddits.length) {
    throw new Error("Reddit bridge is not configured. Run: tash reddit init --repo owner/name --bot username --subreddit name");
  }
  return {
    schemaVersion: typeof raw.schemaVersion === "number" ? raw.schemaVersion : REDDIT_SCHEMA,
    repository: normalizeRepository(String(raw.repository)),
    botUsername: String(raw.botUsername).replace(/^u\//i, ""),
    intervalSeconds: typeof raw.intervalSeconds === "number" && raw.intervalSeconds >= MIN_INTERVAL_SECONDS ? raw.intervalSeconds : DEFAULT_INTERVAL_SECONDS,
    subreddits: [...new Set(raw.subreddits.map((value) => normalizeSubreddit(String(value))).filter(Boolean))],
    autoPublish: raw.autoPublish !== false,
    syncIssues: raw.syncIssues !== false
  };
}

export function importRedditCredentialsFromEnv(): string {
  const credentials: RedditCredentials = {
    clientId: process.env.REDDIT_CLIENT_ID?.trim() || "",
    clientSecret: process.env.REDDIT_CLIENT_SECRET?.trim() || "",
    refreshToken: process.env.REDDIT_REFRESH_TOKEN?.trim() || ""
  };
  if (!credentials.clientId || !credentials.clientSecret || !credentials.refreshToken) {
    throw new Error("Set REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET and REDDIT_REFRESH_TOKEN, then rerun `tash reddit auth`.");
  }
  ensureDir(globalHome());
  writeJson(credentialsPath(), credentials);
  try { chmodSync(credentialsPath(), 0o600); } catch { /* best effort */ }
  return credentialsPath();
}

function readCredentials(): RedditCredentials {
  const credentials = readJson<Partial<RedditCredentials>>(credentialsPath(), {});
  if (!credentials.clientId || !credentials.clientSecret || !credentials.refreshToken) {
    throw new Error("Reddit credentials are missing. Import them once with `tash reddit auth`.");
  }
  return {
    clientId: String(credentials.clientId),
    clientSecret: String(credentials.clientSecret),
    refreshToken: String(credentials.refreshToken)
  };
}

function readState(): RedditBridgeState {
  const state = readJson<Partial<RedditBridgeState>>(statePath(), {});
  const base = defaultState();
  return {
    lastRunAt: state.lastRunAt,
    lastError: state.lastError,
    posts: state.posts && typeof state.posts === "object" ? state.posts : base.posts,
    comments: state.comments && typeof state.comments === "object" ? state.comments : base.comments,
    skipped: state.skipped && typeof state.skipped === "object" ? state.skipped : base.skipped
  };
}

function writeState(state: RedditBridgeState): void {
  ensureDir(globalHome());
  writeJson(statePath(), state);
}

function safeText(value: unknown, max = 500): string {
  return String(value || "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, max);
}

function ghToken(): string {
  if (process.env.GITHUB_TOKEN?.trim()) return process.env.GITHUB_TOKEN.trim();
  const result = spawnSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return result.status === 0 ? result.stdout.trim() : "";
}

async function fetchJson(url: string, init: RequestInit = {}): Promise<any> {
  const response = await fetch(url, init);
  const body = await response.text();
  let parsed: any;
  try { parsed = body ? JSON.parse(body) : {}; }
  catch { parsed = body; }
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${safeText(body, 300)}`);
  return parsed;
}

async function latestRelease(repository: string): Promise<GitHubRelease | null> {
  const token = ghToken();
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "TashevOS-Reddit-Bridge"
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    return await fetchJson(`https://api.github.com/repos/${repository}/releases/latest`, { headers }) as GitHubRelease;
  } catch (error) {
    if (String(error).includes("404")) return null;
    throw error;
  }
}

async function redditToken(credentials: RedditCredentials, config: RedditBridgeConfig): Promise<string> {
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: credentials.refreshToken });
  const payload = await fetchJson("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": `script:tashevos-reddit-bridge:0.1 (by /u/${config.botUsername})`
    },
    body
  });
  if (!payload.access_token) throw new Error("Reddit OAuth did not return an access token.");
  return String(payload.access_token);
}

async function redditJson(config: RedditBridgeConfig, token: string, path: string, init: RequestInit = {}): Promise<any> {
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("User-Agent", `script:tashevos-reddit-bridge:0.1 (by /u/${config.botUsername})`);
  return fetchJson(`https://oauth.reddit.com${path}`, { ...init, headers });
}

export function ruleBlocksAutomation(rules: Array<{ short_name?: string; description?: string }>): string | null {
  const text = rules.map((rule) => `${rule.short_name || ""}\n${rule.description || ""}`).join("\n").toLowerCase();
  const blockers: Array<[RegExp, string]> = [
    [/\bno\s+(?:self[- ]?promotion|promotion|advertis(?:ing|ements?))\b/i, "promotion is prohibited by subreddit rules"],
    [/\b(?:self[- ]?promotion|promotion|advertis(?:ing|ements?))\b.{0,80}\b(?:not allowed|prohibited|forbidden|banned)\b/i, "promotion is prohibited by subreddit rules"],
    [/\b(?:self[- ]?promotion|promotion)\b.{0,120}\b(?:only|megathread|weekly|monthly|saturdays?|sundays?|mod approval|moderator approval)\b/i, "promotion has conditional subreddit rules; automatic posting is disabled"],
    [/\b(?:ask|message|contact)\s+(?:the\s+)?mods?\b/i, "subreddit rules require moderator review"],
    [/\bno\s+(?:bots?|automated posts?|automation)\b/i, "bots or automated posts are prohibited by subreddit rules"]
  ];
  for (const [pattern, reason] of blockers) if (pattern.test(text)) return reason;
  return null;
}

async function subredditRules(config: RedditBridgeConfig, token: string, subreddit: string): Promise<Array<{ short_name?: string; description?: string }>> {
  const payload = await redditJson(config, token, `/r/${encodeURIComponent(subreddit)}/about/rules`);
  return Array.isArray(payload.rules) ? payload.rules : [];
}

function cleanReleaseBody(value: string): string {
  return value
    .replace(/<!--([\s\S]*?)-->/g, "")
    .replace(/^#+\s*/gm, "")
    .trim()
    .slice(0, 7000);
}

export function renderReleasePost(release: GitHubRelease, repository: string): { title: string; body: string } {
  const tag = safeText(release.tag_name, 60);
  const name = safeText(release.name || "", 120);
  const title = safeText(name && name.toLowerCase() !== tag.toLowerCase() ? `${repository}: ${name} (${tag})` : `${repository}: ${tag} released`, 290);
  const notes = cleanReleaseBody(release.body || "") || "A new release is available.";
  const body = [
    notes,
    "",
    `Release: ${release.html_url}`,
    `Source: https://github.com/${repository}`,
    "",
    "_Posted automatically by the TashevOS project bot. Bug reports and feature requests from replies may be mirrored into GitHub Issues._"
  ].join("\n");
  return { title, body };
}

async function submitPost(config: RedditBridgeConfig, token: string, subreddit: string, release: GitHubRelease): Promise<RedditPostState> {
  const rendered = renderReleasePost(release, config.repository);
  const body = new URLSearchParams({
    api_type: "json",
    kind: "self",
    sr: subreddit,
    title: rendered.title,
    text: rendered.body,
    sendreplies: "true",
    resubmit: "true"
  });
  const payload = await redditJson(config, token, "/api/submit", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const errors = payload?.json?.errors;
  if (Array.isArray(errors) && errors.length) throw new Error(`Reddit submit failed: ${safeText(JSON.stringify(errors), 400)}`);
  const data = payload?.json?.data || {};
  const postId = String(data.id || "").replace(/^t3_/, "");
  const fullname = String(data.name || (postId ? `t3_${postId}` : ""));
  if (!postId || !fullname) throw new Error("Reddit submit succeeded without a post id.");
  const permalink = String(data.url || `https://www.reddit.com/r/${subreddit}/comments/${postId}`);
  return { releaseId: release.id, subreddit, postId, fullname, permalink, createdAt: new Date().toISOString() };
}

interface RedditComment {
  id: string;
  name: string;
  author: string;
  body: string;
  permalink: string;
}

function collectComments(value: any, out: RedditComment[]): void {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) collectComments(item, out);
    return;
  }
  if (value.kind === "t1" && value.data) {
    const data = value.data;
    out.push({
      id: String(data.id || ""),
      name: String(data.name || (data.id ? `t1_${data.id}` : "")),
      author: String(data.author || ""),
      body: String(data.body || ""),
      permalink: String(data.permalink || "")
    });
    collectComments(data.replies?.data?.children, out);
    return;
  }
  collectComments(value.data?.children, out);
}

async function fetchComments(config: RedditBridgeConfig, token: string, postId: string): Promise<RedditComment[]> {
  const payload = await redditJson(config, token, `/comments/${encodeURIComponent(postId)}?limit=100&depth=5&sort=new&raw_json=1`);
  const out: RedditComment[] = [];
  collectComments(payload, out);
  return out.filter((comment) => comment.id && comment.name && comment.body);
}

export function classifyRedditComment(body: string): RedditFeedbackKind {
  const text = body.toLowerCase();
  if (/\b(bug|broken|crash(?:es|ed)?|error|exception|fail(?:s|ed|ing)?|regression|not working|doesn['’]?t work)\b/i.test(text)) return "bug";
  if (/\b(feature|feature request|enhancement|please add|could you add|would be nice|support for|wish it|request)\b/i.test(text)) return "feature";
  return "other";
}

function issueTitle(kind: Exclude<RedditFeedbackKind, "other">, body: string): string {
  const prefix = kind === "bug" ? "Bug" : "Feature";
  const summary = safeText(body, 120) || "Reddit feedback";
  return `[Reddit] ${prefix}: ${summary}`.slice(0, 250);
}

function createGitHubIssue(config: RedditBridgeConfig, post: RedditPostState, comment: RedditComment, kind: Exclude<RedditFeedbackKind, "other">): { number: number; url: string } {
  const body = [
    "Imported automatically from Reddit by TashevOS.",
    "",
    `**Type:** ${kind}`,
    `**Subreddit:** r/${post.subreddit}`,
    `**Reddit post:** ${post.permalink}`,
    `**Comment:** https://www.reddit.com${comment.permalink}`,
    `**Author:** u/${safeText(comment.author, 80)}`,
    "",
    "### Feedback",
    "",
    comment.body.trim(),
    "",
    `<!-- tashevos-reddit:${comment.name} -->`
  ].join("\n");
  const result = spawnSync("gh", ["issue", "create", "--repo", config.repository, "--title", issueTitle(kind, comment.body), "--body", body], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || "gh issue create failed").trim());
  const url = result.stdout.trim().split(/\r?\n/).find((line) => /^https:\/\/github\.com\//.test(line)) || "";
  const match = url.match(/\/issues\/(\d+)/);
  if (!match) throw new Error(`Unable to parse GitHub issue URL: ${safeText(result.stdout, 200)}`);
  return { number: Number(match[1]), url };
}

function githubIssueState(config: RedditBridgeConfig, issueNumber: number): "OPEN" | "CLOSED" | null {
  const result = spawnSync("gh", ["issue", "view", String(issueNumber), "--repo", config.repository, "--json", "state"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  if (result.status !== 0) return null;
  try {
    const parsed = JSON.parse(result.stdout);
    return parsed.state === "CLOSED" ? "CLOSED" : parsed.state === "OPEN" ? "OPEN" : null;
  } catch {
    return null;
  }
}

async function submitComment(config: RedditBridgeConfig, token: string, fullname: string, text: string): Promise<void> {
  const body = new URLSearchParams({ api_type: "json", thing_id: fullname, text });
  const payload = await redditJson(config, token, "/api/comment", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const errors = payload?.json?.errors;
  if (Array.isArray(errors) && errors.length) throw new Error(`Reddit comment failed: ${safeText(JSON.stringify(errors), 400)}`);
}

function postKey(releaseId: number, subreddit: string): string {
  return `${releaseId}:${subreddit.toLowerCase()}`;
}

export async function runRedditBridgeTick(): Promise<RedditTickResult> {
  const config = readRedditBridgeConfig();
  const credentials = readCredentials();
  const state = readState();
  const result: RedditTickResult = { published: [], skipped: [], issues: [], closedReplies: [] };
  try {
    const token = await redditToken(credentials, config);
    const release = await latestRelease(config.repository);

    if (release && !release.draft && config.autoPublish) {
      for (const subreddit of config.subreddits) {
        const key = postKey(release.id, subreddit);
        if (state.posts[key] || state.skipped[key]) continue;
        const rules = await subredditRules(config, token, subreddit);
        const blocked = ruleBlocksAutomation(rules);
        if (blocked) {
          state.skipped[key] = { reason: blocked, at: new Date().toISOString() };
          result.skipped.push(`r/${subreddit}: ${blocked}`);
          continue;
        }
        const post = await submitPost(config, token, subreddit, release);
        state.posts[key] = post;
        result.published.push(`r/${subreddit}: ${post.permalink}`);
      }
    }

    if (config.syncIssues) {
      for (const post of Object.values(state.posts)) {
        const comments = await fetchComments(config, token, post.postId);
        for (const comment of comments) {
          if (!comment.author || comment.author.toLowerCase() === config.botUsername.toLowerCase()) continue;
          if (state.comments[comment.name]) continue;
          const kind = classifyRedditComment(comment.body);
          if (kind === "other") continue;
          const issue = createGitHubIssue(config, post, comment, kind);
          state.comments[comment.name] = {
            postId: post.postId,
            commentId: comment.id,
            fullname: comment.name,
            permalink: comment.permalink,
            issueNumber: issue.number,
            issueUrl: issue.url
          };
          result.issues.push(issue.url);
        }
      }

      for (const item of Object.values(state.comments)) {
        if (item.notifiedClosed) continue;
        if (githubIssueState(config, item.issueNumber) !== "CLOSED") continue;
        await submitComment(config, token, item.fullname, `GitHub issue #${item.issueNumber} has been closed: ${item.issueUrl}`);
        item.notifiedClosed = true;
        result.closedReplies.push(item.issueUrl);
      }
    }

    state.lastRunAt = new Date().toISOString();
    state.lastError = undefined;
    writeState(state);
    return result;
  } catch (error) {
    state.lastRunAt = new Date().toISOString();
    state.lastError = safeText(error instanceof Error ? error.message : error, 500);
    writeState(state);
    throw error;
  }
}

export function getRedditBridgeStatus(): { config: RedditBridgeConfig; state: RedditBridgeState; credentialsConfigured: boolean } {
  return { config: readRedditBridgeConfig(), state: readState(), credentialsConfigured: existsSync(credentialsPath()) };
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
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n  <key>Label</key><string>${SERVICE_LABEL}</string>\n  <key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(cliEntrypoint())}</string><string>reddit</string><string>tick</string></array>\n  <key>RunAtLoad</key><true/>\n  <key>StartInterval</key><integer>${intervalSeconds}</integer>\n  <key>ProcessType</key><string>Background</string>\n  <key>EnvironmentVariables</key><dict><key>HOME</key><string>${xml(homedir())}</string><key>PATH</key><string>${xml([dirname(process.execPath), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(":"))}</string></dict>\n  <key>StandardOutPath</key><string>${xml(logPath())}</string>\n  <key>StandardErrorPath</key><string>${xml(errorLogPath())}</string>\n</dict>\n</plist>\n`;
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
  const service = join(userDir, "tashevos-reddit.service");
  const timer = join(userDir, "tashevos-reddit.timer");
  writeFileSync(service, `[Unit]\nDescription=TashevOS Reddit/GitHub bridge\n\n[Service]\nType=oneshot\nExecStart=${process.execPath} ${cliEntrypoint()} reddit tick\n`, "utf8");
  writeFileSync(timer, `[Unit]\nDescription=Run TashevOS Reddit/GitHub bridge\n\n[Timer]\nOnBootSec=60s\nOnUnitActiveSec=${intervalSeconds}s\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n`, "utf8");
  for (const args of [["--user", "daemon-reload"], ["--user", "enable", "--now", "tashevos-reddit.timer"]]) {
    const result = spawnSync("systemctl", args, { encoding: "utf8" });
    if (result.status !== 0) throw new Error((result.stderr || result.stdout || "systemctl failed").trim());
  }
  return timer;
}

export function installRedditBridgeService(): { platform: string; servicePath: string; intervalSeconds: number } {
  const config = readRedditBridgeConfig();
  if (!existsSync(credentialsPath())) throw new Error("Import Reddit credentials first: tash reddit auth");
  if (process.platform === "darwin") return { platform: "macOS launchd", servicePath: installMacService(config.intervalSeconds), intervalSeconds: config.intervalSeconds };
  if (process.platform === "linux") return { platform: "systemd user timer", servicePath: installLinuxService(config.intervalSeconds), intervalSeconds: config.intervalSeconds };
  throw new Error("Automatic Reddit bridge service installation currently supports macOS and Linux.");
}

export function uninstallRedditBridgeService(): boolean {
  if (process.platform === "darwin") {
    const uid = process.getuid?.();
    const plist = join(homedir(), "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`);
    if (uid !== undefined && existsSync(plist)) spawnSync("launchctl", ["bootout", `gui/${uid}`, plist], { stdio: "ignore" });
    const existed = existsSync(plist);
    rmSync(plist, { force: true });
    return existed;
  }
  if (process.platform === "linux") {
    spawnSync("systemctl", ["--user", "disable", "--now", "tashevos-reddit.timer"], { stdio: "ignore" });
    const userDir = join(homedir(), ".config", "systemd", "user");
    const service = join(userDir, "tashevos-reddit.service");
    const timer = join(userDir, "tashevos-reddit.timer");
    const existed = existsSync(service) || existsSync(timer);
    rmSync(service, { force: true });
    rmSync(timer, { force: true });
    spawnSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
    return existed;
  }
  return false;
}
