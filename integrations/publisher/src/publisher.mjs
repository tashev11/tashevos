#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { buildVariants } from "./content.mjs";
import { directAdapters } from "./platforms.mjs";

const TERMINAL = new Set(["published", "outbox", "delegated"]);

function parseArgs(argv) {
  return {
    dryRun: argv.includes("--dry-run"),
    configPath: argv.find((arg) => arg.startsWith("--config="))?.slice("--config=".length),
  };
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

async function githubJson(path, token) {
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "TashevOS-Publisher/0.1",
    "x-github-api-version": "2022-11-28",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`https://api.github.com${path}`, { headers });
  if (!response.ok) {
    throw new Error(`GitHub ${response.status}: ${(await response.text()).slice(0, 800)}`);
  }
  return response.json();
}

async function latestRelease(source, env) {
  const releases = await githubJson(
    `/repos/${source.repo}/releases?per_page=${Math.max(1, Math.min(source.scanLimit || 5, 20))}`,
    env.GITHUB_TOKEN,
  );
  return releases.find(
    (release) =>
      !release.draft &&
      (source.includePrereleases !== false || !release.prerelease) &&
      !release.tag_name?.includes(source.ignoreTagContains || "__never__"),
  );
}

function isStale(release, maxAgeDays) {
  if (!maxAgeDays) return false;
  const stamp = Date.parse(release.published_at || release.created_at || 0);
  if (!stamp) return false;
  return Date.now() - stamp > maxAgeDays * 86_400_000;
}

function manualDraft(platform, material) {
  const intros = {
    hackernews:
      "Suggested format: submit manually as Show HN only when the project is runnable and the release is substantial.",
    producthunt:
      "Suggested format: use this as launch/update copy; Product Hunt launches should remain deliberate rather than blind auto-posts.",
    peerlist:
      "Suggested format: project update / proof-of-work entry with screenshots and the GitHub release link.",
    indiehackers:
      "Suggested format: build-in-public update focused on the problem, implementation, result and lesson learned.",
    hackernoon:
      "Suggested format: editorial technical case study. Expand architecture, trade-offs and measurable outcomes before submission.",
    dzone:
      "Suggested format: editorial technical article. Keep it educational and avoid release-note-only copy.",
    dailydev:
      "Suggested format: share the canonical article/release into the appropriate Squad or RSS-backed source.",
    medium:
      "Medium does not issue new API integration tokens. Import the canonical article or use an existing legacy token if you already have one.",
    lobsters:
      "Suggested format: submit manually only when it is genuinely technical and relevant to the community.",
  };
  return [
    `# ${material.title}`,
    "",
    `Platform: ${platform}`,
    `Source: ${material.sourceUrl}`,
    "",
    intros[platform] || "Review platform rules before publishing.",
    "",
    "## Short version",
    "",
    material.short,
    "",
    "## Long version",
    "",
    material.long,
    "",
  ].join("\n");
}

function releaseKey(source, release) {
  return `${source.repo}#${release.id}`;
}

async function createOutbox(root, platform, material, dryRun) {
  const safeRepo = material.repo.replace("/", "__");
  const relativePath = join(
    ".tashevos",
    "publisher-outbox",
    safeRepo,
    `${material.tag || material.releaseId}--${platform}.md`,
  );
  const fullPath = join(root, relativePath);
  if (!dryRun) {
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, manualDraft(platform, material), "utf8");
  }
  return relativePath;
}

function shouldAttempt(previous) {
  return !previous || !TERMINAL.has(previous.status);
}

async function publishOne({ name, spec, previous, material, env, root, dryRun }) {
  if (spec.enabled === false) return { status: "disabled", platform: name };
  if (!shouldAttempt(previous)) return previous;

  if (spec.mode === "delegated") {
    return {
      status: "delegated",
      platform: name,
      note: spec.note || "Handled by an external TashevOS integration.",
    };
  }

  if (spec.mode === "manual") {
    const path = await createOutbox(root, name, material, dryRun);
    return { status: "outbox", platform: name, path };
  }

  if (spec.mode !== "direct") {
    return { status: "skipped", platform: name, reason: `Unknown mode: ${spec.mode}` };
  }

  const adapter = directAdapters[name];
  if (!adapter) {
    return { status: "blocked", platform: name, reason: "No direct adapter is implemented." };
  }
  if (dryRun) return { status: "dry-run", platform: name };

  try {
    return await adapter(material, env);
  } catch (error) {
    return { status: "error", platform: name, reason: String(error?.message || error).slice(0, 1200) };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = resolve(process.env.PUBLISHER_ROOT || process.cwd());
  const configPath = resolve(root, args.configPath || ".tashevos/publisher.json");
  const statePath = resolve(root, ".tashevos/publisher-state.json");
  const config = await readJson(configPath, null);
  if (!config) throw new Error(`Publisher config not found: ${configPath}`);

  const state = await readJson(statePath, { version: 1, releases: {} });
  state.version = 1;
  state.releases ||= {};

  let changed = false;
  const results = [];

  for (const source of config.sources || []) {
    if (source.enabled === false) continue;

    let release;
    try {
      release = await latestRelease(source, process.env);
    } catch (error) {
      results.push({ repo: source.repo, status: "source-error", reason: String(error.message || error) });
      continue;
    }
    if (!release) {
      results.push({ repo: source.repo, status: "no-release" });
      continue;
    }

    const key = releaseKey(source, release);
    if (isStale(release, source.maxReleaseAgeDays ?? config.maxReleaseAgeDays ?? 30)) {
      results.push({ repo: source.repo, release: release.tag_name, status: "stale" });
      continue;
    }

    const material = buildVariants(source, release);
    const entry = state.releases[key] || {
      repo: source.repo,
      releaseId: String(release.id),
      tag: release.tag_name,
      sourceUrl: release.html_url,
      publishedAt: release.published_at || release.created_at,
      platforms: {},
    };

    for (const [name, spec] of Object.entries(config.platforms || {})) {
      const before = JSON.stringify(entry.platforms[name] || null);
      const after = await publishOne({
        name,
        spec,
        previous: entry.platforms[name],
        material,
        env: process.env,
        root,
        dryRun: args.dryRun,
      });
      entry.platforms[name] = after;
      if (JSON.stringify(after) !== before) changed = true;
    }

    if (!args.dryRun) {
      state.releases[key] = entry;
      await writeJson(statePath, state);
    }

    results.push({
      repo: source.repo,
      release: release.tag_name,
      platforms: entry.platforms,
    });
  }

  const summary = { dryRun: args.dryRun, changed, results };
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
