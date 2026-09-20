import { createHash } from "node:crypto";

export function cleanMarkdown(value = "") {
  return String(value).replace(/\r\n/g, "\n").trim();
}

export function plainText(markdown = "") {
  return cleanMarkdown(markdown)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/[>*_~#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function excerpt(markdown, max = 220) {
  const text = plainText(markdown);
  if (text.length <= max) return text;
  const sliced = text.slice(0, Math.max(0, max - 1));
  const cut = sliced.lastIndexOf(" ");
  return (cut > max * 0.6 ? sliced.slice(0, cut) : sliced).trimEnd() + "…";
}

export function stableKey(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 24);
}

export function buildVariants(source, release) {
  const project = source.displayName || source.repo.split("/").at(-1);
  const releaseName = cleanMarkdown(release.name || "");
  const tag = cleanMarkdown(release.tag_name || "");
  const suffix = releaseName && releaseName !== tag ? releaseName : tag;
  const title = suffix ? `${project}: ${suffix}` : `${project}: new release`;
  const body = cleanMarkdown(release.body || `Release ${tag || release.id} is available.`);
  const sourceUrl = release.html_url;
  const tags = [...new Set([...(source.tags || []), "opensource", "devtools"])].slice(0, 4);

  const long = [
    `# ${title}`,
    "",
    body,
    "",
    "---",
    "",
    `Source and code: ${sourceUrl}`,
  ].join("\n");

  const short = [title, "", excerpt(body, 220), "", sourceUrl].join("\n");
  const social = [title, "", excerpt(body, 155), "", sourceUrl].join("\n");

  return {
    repo: source.repo,
    project,
    title,
    tag,
    body,
    long,
    short,
    social,
    sourceUrl,
    tags,
    releaseId: String(release.id),
    publishedAt: release.published_at || release.created_at || new Date().toISOString(),
    fingerprint: stableKey(`${source.repo}:${release.id}:${release.tag_name || ""}`),
  };
}

export function markdownToSimpleHtml(markdown = "") {
  const escape = (value) =>
    value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

  return cleanMarkdown(markdown)
    .split(/\n{2,}/)
    .map((block) => {
      const text = block.trim();
      if (!text) return "";
      const heading = text.match(/^(#{1,3})\s+(.+)$/s);
      if (heading) {
        const level = heading[1].length;
        return `<h${level}>${escape(heading[2])}</h${level}>`;
      }
      const lines = text.split("\n");
      if (lines.every((line) => /^[-*+]\s+/.test(line))) {
        return `<ul>${lines
          .map((line) => `<li>${escape(line.replace(/^[-*+]\s+/, ""))}</li>`)
          .join("")}</ul>`;
      }
      return `<p>${escape(text).replaceAll("\n", "<br>")}</p>`;
    })
    .join("\n");
}
