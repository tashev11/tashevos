import test from "node:test";
import assert from "node:assert/strict";
import { buildVariants, excerpt, markdownToSimpleHtml, plainText, stableKey } from "../src/content.mjs";

test("plainText strips common markdown noise", () => {
  assert.equal(plainText("# Hello\n\n- **World** [link](https://example.com)"), "Hello World link");
});

test("excerpt is bounded", () => {
  const value = excerpt("word ".repeat(100), 80);
  assert.ok(value.length <= 80);
  assert.ok(value.endsWith("…"));
});

test("release variants are stable and include source", () => {
  const source = { repo: "tashev11/tashevos", tags: ["ai"] };
  const release = {
    id: 42,
    name: "Alpha 4",
    tag_name: "v0.1.0-alpha.4",
    body: "Shared memory improvements.",
    html_url: "https://github.com/tashev11/tashevos/releases/tag/v0.1.0-alpha.4",
    published_at: "2026-09-20T00:00:00Z",
  };
  const result = buildVariants(source, release);
  assert.match(result.title, /tashevos: Alpha 4/);
  assert.match(result.long, /Shared memory improvements/);
  assert.match(result.short, /github\.com/);
  assert.equal(result.fingerprint, stableKey("tashev11/tashevos:42:v0.1.0-alpha.4"));
});

test("simple HTML converter handles heading and list blocks", () => {
  const html = markdownToSimpleHtml("## Title\n\n- one\n- two");
  assert.match(html, /<h2>Title<\/h2>/);
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
});
