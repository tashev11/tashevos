import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function findProjectRoot(input = process.cwd()): string {
  let current = resolve(input);
  while (true) {
    if (existsSync(current + "/.git")) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(input);
    current = parent;
  }
}

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

export function readJson<T>(path: string, fallback: T): T {
  try { return JSON.parse(readFileSync(path, "utf8")) as T; }
  catch { return fallback; }
}

export function writeJson(path: string, value: unknown): void {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

export function pathExists(path: string): boolean {
  return existsSync(path);
}
