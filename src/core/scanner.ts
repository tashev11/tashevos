import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ProjectScan } from "../types.js";

export function scanProject(root: string): ProjectScan {
  const technologies: string[] = [];
  const has = (path: string) => existsSync(join(root, path));

  if (has("package.json")) technologies.push("Node.js/JavaScript");
  if (has("tsconfig.json")) technologies.push("TypeScript");
  if (has("pyproject.toml") || has("requirements.txt")) technologies.push("Python");
  if (has("composer.json")) technologies.push("PHP");
  if (has("go.mod")) technologies.push("Go");
  if (has("Cargo.toml")) technologies.push("Rust");
  if (has("Dockerfile") || has("docker-compose.yml") || has("compose.yml")) technologies.push("Docker");

  let packageManager: string | undefined;
  if (has("pnpm-lock.yaml")) packageManager = "pnpm";
  else if (has("yarn.lock")) packageManager = "yarn";
  else if (has("bun.lockb") || has("bun.lock")) packageManager = "bun";
  else if (has("package-lock.json")) packageManager = "npm";

  return { root, technologies, packageManager };
}
