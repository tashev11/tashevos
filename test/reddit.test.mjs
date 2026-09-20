import test from "node:test";
import assert from "node:assert/strict";
import { classifyRedditComment, renderReleasePost, ruleBlocksAutomation } from "../dist/core/reddit.js";

test("reddit feedback classifier separates actionable feedback", () => {
  assert.equal(classifyRedditComment("The CLI crashes with an exception on macOS"), "bug");
  assert.equal(classifyRedditComment("Could you add support for another provider?"), "feature");
  assert.equal(classifyRedditComment("Nice project, thanks for sharing"), "other");
});

test("subreddit rules block obvious promotion and bot restrictions", () => {
  assert.match(ruleBlocksAutomation([{ short_name: "No self promotion", description: "Share useful discussion instead." }]) || "", /promotion/);
  assert.match(ruleBlocksAutomation([{ short_name: "No bots", description: "Automated posts are forbidden." }]) || "", /bots|automated/);
  assert.match(ruleBlocksAutomation([{ short_name: "Promotion", description: "Self-promotion only in the weekly megathread." }]) || "", /conditional/);
  assert.equal(ruleBlocksAutomation([{ short_name: "Be civil", description: "No harassment." }]), null);
});

test("release renderer is transparent and links back to GitHub", () => {
  const post = renderReleasePost({
    id: 1,
    tag_name: "v0.2.0",
    name: "Memory Bridge",
    body: "## Added\n\n- Reddit bridge",
    html_url: "https://github.com/tashev11/tashevos/releases/tag/v0.2.0"
  }, "tashev11/tashevos");
  assert.match(post.title, /v0\.2\.0/);
  assert.match(post.body, /Reddit bridge/);
  assert.match(post.body, /Posted automatically/);
  assert.match(post.body, /github\.com\/tashev11\/tashevos/);
});
