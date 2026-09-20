import { spawnSync } from "node:child_process";
import type { GitSnapshot } from "../types.js";

export function git(root: string, args: string[]): string {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.status !== 0) return "";
  return result.stdout.trim();
}

export function getGitSnapshot(root: string): GitSnapshot {
  const branch = git(root, ["branch", "--show-current"]) || "DETACHED";
  const head = git(root, ["rev-parse", "HEAD"]) || "UNBORN";
  const status = git(root, ["status", "--porcelain"]);
  const changedFiles = status ? status.split("\n").filter(Boolean).length : 0;
  return { branch, head, dirty: changedFiles > 0, changedFiles };
}
