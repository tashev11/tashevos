import { spawnSync } from "node:child_process";

export const DEFAULT_PRUNE_KEEP = 10;
export const MAX_PRUNE_KEEP = 10_000;

export interface PrunePlan {
  branch: string;
  keep: number;
  rewriteAbove: number;
  tip: string;
  commitsTotal: number;
  commitsKept: number;
  commitsDropped: number;
  rewrite: boolean;
  bytesOnDisk: number;
  bytesRetained: number;
  bytesReclaimable: number;
  bytesToUpload: number;
  warnings: string[];
}

export interface PruneOutcome {
  newTip: string;
  pushed: boolean;
  bytesBefore: number;
  bytesAfter: number;
  bytesFreed: number;
  warnings: string[];
}

interface GitOptions {
  input?: string;
  env?: Record<string, string>;
}

function gitRun(vault: string, args: string[], options: GitOptions = {}) {
  return spawnSync("git", ["-C", vault, ...args], {
    input: options.input,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", ...options.env },
    stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"]
  });
}

function git(vault: string, args: string[], options?: GitOptions): string {
  const result = gitRun(vault, args, options);
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `git ${args[0]} failed`).trim());
  return result.stdout.trim();
}

function gitMaybe(vault: string, args: string[]): string {
  const result = gitRun(vault, args);
  return result.status === 0 ? result.stdout.trim() : "";
}

function lines(value: string): string[] {
  return value.split("\n").filter(Boolean);
}

function objectNames(listing: string): string[] {
  return lines(listing).map((line) => line.split(" ")[0]);
}

export function assertKeep(keep: number): void {
  if (!Number.isInteger(keep) || keep < 1 || keep > MAX_PRUNE_KEEP) throw new Error(`Prune keep must be an integer between 1 and ${MAX_PRUNE_KEEP}.`);
}

// The branch name comes from sync.json and ends up inside refspecs, so it must be a name git itself accepts
// (a colon, "..", "@{" or a space would change how --force-with-lease=<ref>:<expect> is split).
function assertBranch(branch: string): void {
  if (spawnSync("git", ["check-ref-format", `refs/heads/${branch}`], { stdio: "ignore" }).status !== 0) throw new Error(`Invalid vault branch name "${branch}".`);
}

// The merge commits among `commits`: replaying them as single-parent commits would flatten their second parent away.
function mergesIn(vault: string, commits: string[]): string[] {
  return lines(git(vault, ["rev-list", "--merges", "--no-walk=unsorted", "--stdin"], { input: commits.join("\n") + "\n" }));
}

// Plans a history prune without writing anything: only read-only plumbing commands run here. The history is rewritten
// down to `keep` commits only once it is longer than `rewriteAbove` (default: keep), so a caller can wait for it to grow.
export function planPrune(vault: string, branch: string, keep: number, rewriteAbove = keep): PrunePlan {
  assertKeep(keep);
  assertBranch(branch);
  if (!Number.isInteger(rewriteAbove) || rewriteAbove < keep) throw new Error("Prune rewriteAbove must be an integer of at least keep.");
  let tip: string;
  try { tip = git(vault, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`]); }
  catch { throw new Error(`Vault branch "${branch}" does not exist. Run: tash sync init --remote <git-url>`); }
  const chain = lines(git(vault, ["rev-list", "--first-parent", tip]));
  const rewrite = chain.length > rewriteAbove;
  const kept = rewrite ? chain.slice(0, keep) : chain;
  const merges = rewrite ? mergesIn(vault, kept) : [];

  const window = new Set(objectNames(git(vault, ["rev-list", "--objects", "--no-walk=unsorted", "--stdin"], { input: kept.join("\n") + "\n" })));
  const retained = new Set(window);
  // Any other ref (a tag, a stash, another branch) keeps its whole history alive: count it as retained and say so.
  const ownRefs = new Set([`refs/heads/${branch}`, `refs/remotes/origin/${branch}`, "refs/remotes/origin/HEAD"]);
  const others = lines(git(vault, ["for-each-ref", "--format=%(refname) %(objectname)"])).map((row) => row.split(" ")).filter(([name]) => !ownRefs.has(name));
  if (others.length) {
    for (const name of objectNames(git(vault, ["rev-list", "--objects", "--stdin"], { input: others.map(([, id]) => id).join("\n") + "\n" }))) retained.add(name);
  }
  let bytesOnDisk = 0;
  let bytesRetained = 0;
  let bytesInWindow = 0;
  for (const line of lines(git(vault, ["cat-file", "--batch-all-objects", "--batch-check=%(objectname) %(objectsize:disk)"]))) {
    const [name, size] = line.split(" ");
    bytesOnDisk += Number(size);
    if (retained.has(name)) bytesRetained += Number(size);
    if (window.has(name)) bytesInWindow += Number(size);
  }

  return {
    branch,
    keep,
    rewriteAbove,
    tip,
    commitsTotal: chain.length,
    commitsKept: kept.length,
    commitsDropped: chain.length - kept.length,
    rewrite,
    bytesOnDisk,
    bytesRetained,
    bytesReclaimable: bytesOnDisk - bytesRetained,
    // The new root commit shares no history with the remote's, so git re-sends every object of the kept window.
    bytesToUpload: rewrite ? bytesInWindow : 0,
    warnings: [
      ...(merges.length ? [`${merges.length} merge commit(s) among the newest ${keep}: a rewrite would flatten them, so applying is refused`] : []),
      ...(others.length ? [`${others.length} other ref(s) keep their history alive and are left alone: ${others.map(([name]) => name).join(", ")}`] : [])
    ]
  };
}

// Disk space of the object database as `git count-objects` sees it (loose blocks + packs + garbage).
function storageBytes(vault: string): number {
  const fields = new Map<string, number>();
  for (const line of lines(git(vault, ["count-objects", "-v"]))) {
    const [key, value] = line.split(": ");
    fields.set(key, Number(value));
  }
  return ((fields.get("size") ?? 0) + (fields.get("size-pack") ?? 0) + (fields.get("size-garbage") ?? 0)) * 1024;
}

// Replays the given commits (newest first) as a fresh chain: same trees, messages, authors and dates, but the
// oldest one has no parent. Only tiny commit objects are created, every tree and blob is reused as it is.
function rebuildHistory(vault: string, kept: string[]): string {
  let parent: string | undefined;
  for (const commit of [...kept].reverse()) {
    const [authorName, authorEmail, authorDate, committerName, committerEmail, committerDate] =
      git(vault, ["show", "-s", "--format=%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI", commit]).split("\0");
    parent = git(vault, ["-c", "commit.gpgsign=false", "commit-tree", `${commit}^{tree}`, ...(parent ? ["-p", parent] : []), "-F", "-"], {
      input: git(vault, ["show", "-s", "--format=%B", commit]) + "\n",
      env: {
        GIT_AUTHOR_NAME: authorName,
        GIT_AUTHOR_EMAIL: authorEmail,
        GIT_AUTHOR_DATE: authorDate,
        GIT_COMMITTER_NAME: committerName,
        GIT_COMMITTER_EMAIL: committerEmail,
        GIT_COMMITTER_DATE: committerDate
      }
    });
  }
  return parent as string;
}

// Rewrites the remote branch to the planned window (only when the history is longer than keep) and reclaims the
// local space. The push is a lease on the exact tip the plan was made for, so a concurrent push from another
// computer makes it fail instead of being overwritten. A plain --force is never used.
export function applyPrune(vault: string, plan: PrunePlan): PruneOutcome {
  const { branch } = plan;
  const warnings: string[] = [];
  const bytesBefore = storageBytes(vault);

  if (git(vault, ["rev-parse", "--verify", `refs/heads/${branch}`]) !== plan.tip) {
    throw new Error(`Vault branch "${branch}" moved after the prune was planned; nothing was changed.`);
  }

  let newTip = plan.tip;
  if (plan.rewrite) {
    if (gitMaybe(vault, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`]) !== plan.tip) {
      throw new Error(`Vault branch "${branch}" has commits that are not on the remote; run a sync first. Nothing was changed.`);
    }
    const kept = lines(git(vault, ["rev-list", "--first-parent", `--max-count=${plan.keep}`, plan.tip]));
    if (mergesIn(vault, kept).length) throw new Error(`Vault branch "${branch}" has merge commits among the newest ${plan.keep}; a rewrite would flatten them. Nothing was changed.`);
    newTip = rebuildHistory(vault, kept);
    if (git(vault, ["rev-parse", `${newTip}^{tree}`]) !== git(vault, ["rev-parse", `${plan.tip}^{tree}`])) {
      throw new Error("The rewritten history does not match the current vault data; nothing was pushed.");
    }

    // Checkpoints are encrypted, so a delta search only burns CPU: pack.window=0 turns it off.
    const push = gitRun(vault, ["-c", "pack.window=0", "push", "--quiet", `--force-with-lease=refs/heads/${branch}:${plan.tip}`, "origin", `${newTip}:refs/heads/${branch}`]);
    if (push.status !== 0) {
      const detail = (push.stderr || push.stdout || "git push failed").trim();
      if (/stale info/.test(detail)) throw new Error(`Remote branch "${branch}" changed since it was fetched; nothing was rewritten. Run the prune again.`);
      throw new Error(`The remote refused the rewritten history: ${detail}`);
    }
    git(vault, ["update-ref", "-m", "tashevos: prune vault history", `refs/heads/${branch}`, newTip, plan.tip]);
    // The push already succeeded, so a failed or surprising check is only a warning: the remote may be unreachable for
    // a moment, or another computer may have pushed on top of the new history already.
    const check = gitRun(vault, ["ls-remote", "origin", `refs/heads/${branch}`]);
    const remoteTip = check.stdout.trim().split(/\s+/)[0];
    if (check.status !== 0) warnings.push(`Could not confirm the remote tip after the push: ${(check.stderr || check.stdout || "ls-remote failed").trim()}`);
    else if (remoteTip !== newTip) warnings.push(`The remote reports ${remoteTip || "no branch"} instead of ${newTip.slice(0, 12)}; another computer may have pushed since.`);
  }

  // Free the space first: pruning loose objects needs no extra disk. Whatever is still unreachable after that sits
  // inside a pack (a vault that was cloned, not built up checkpoint by checkpoint), and only a repack can drop it.
  git(vault, ["reflog", "expire", "--expire=now", "--expire-unreachable=now", "--all"]);
  git(vault, ["prune", "--expire=now"]);
  if (planPrune(vault, branch, plan.keep, plan.rewriteAbove).bytesReclaimable > 0) {
    const gc = gitRun(vault, ["-c", "pack.window=0", "gc", "--quiet", "--prune=now"]);
    if (gc.status !== 0) warnings.push(`git gc failed after the prune: ${(gc.stderr || gc.stdout || "").trim()}`);
  }

  const bytesAfter = storageBytes(vault);
  return { newTip, pushed: plan.rewrite, bytesBefore, bytesAfter, bytesFreed: Math.max(0, bytesBefore - bytesAfter), warnings };
}
