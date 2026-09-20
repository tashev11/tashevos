import { stableKey, markdownToSimpleHtml } from "./content.mjs";

function missing(names, env) {
  return names.filter((name) => !env[name]);
}

function blocked(platform, names, env) {
  const absent = missing(names, env);
  return absent.length
    ? { status: "blocked", platform, reason: `Missing configuration: ${absent.join(", ")}` }
    : null;
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    const detail = typeof data === "string" ? data : JSON.stringify(data);
    throw new Error(`${response.status} ${response.statusText}: ${detail.slice(0, 800)}`);
  }
  return { data, headers: response.headers, status: response.status };
}

export const requiredSecrets = {
  devto: ["DEVTO_API_KEY"],
  hashnode: ["HASHNODE_PAT", "HASHNODE_PUBLICATION_ID"],
  linkedin: ["LINKEDIN_ACCESS_TOKEN", "LINKEDIN_AUTHOR_URN", "LINKEDIN_VERSION"],
  telegram: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"],
  discord: ["DISCORD_WEBHOOK_URL"],
  bluesky: ["BLUESKY_HANDLE", "BLUESKY_APP_PASSWORD"],
  mastodon: ["MASTODON_BASE_URL", "MASTODON_ACCESS_TOKEN"],
  x: ["X_USER_ACCESS_TOKEN"],
  wordpress: ["WORDPRESS_BASE_URL", "WORDPRESS_USERNAME", "WORDPRESS_APP_PASSWORD"],
  webhook: ["PUBLISHER_WEBHOOK_URL"],
};

async function devto(material, env) {
  const stop = blocked("devto", requiredSecrets.devto, env);
  if (stop) return stop;
  const { data } = await request("https://dev.to/api/articles", {
    method: "POST",
    headers: {
      "api-key": env.DEVTO_API_KEY,
      "content-type": "application/json",
      "user-agent": "TashevOS-Publisher/0.1",
    },
    body: JSON.stringify({
      article: {
        title: material.title,
        body_markdown: material.long,
        published: true,
        tags: material.tags,
        canonical_url: material.sourceUrl,
        description: material.social.replaceAll("\n", " ").slice(0, 180),
      },
    }),
  });
  return { status: "published", platform: "devto", id: String(data.id), url: data.url };
}

async function hashnode(material, env) {
  const stop = blocked("hashnode", requiredSecrets.hashnode, env);
  if (stop) return stop;
  const query = `mutation PublishPost($input: PublishPostInput!) {
    publishPost(input: $input) { post { id slug url } }
  }`;
  const { data } = await request(env.HASHNODE_ENDPOINT || "https://gql-beta.hashnode.com", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.HASHNODE_PAT}`,
      "content-type": "application/json",
      "user-agent": "TashevOS-Publisher/0.1",
    },
    body: JSON.stringify({
      query,
      variables: {
        input: {
          publicationId: env.HASHNODE_PUBLICATION_ID,
          title: material.title,
          contentMarkdown: material.long,
          originalArticleURL: material.sourceUrl,
          tags: material.tags.map((slug) => ({ slug, name: slug })),
          enableToc: true,
        },
      },
    }),
  });
  if (data.errors?.length) throw new Error(JSON.stringify(data.errors).slice(0, 1200));
  const post = data.data?.publishPost?.post;
  if (!post) throw new Error("Hashnode returned no post");
  return { status: "published", platform: "hashnode", id: String(post.id), url: post.url };
}

async function linkedin(material, env) {
  const stop = blocked("linkedin", requiredSecrets.linkedin, env);
  if (stop) return stop;
  const { headers } = await request("https://api.linkedin.com/rest/posts", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.LINKEDIN_ACCESS_TOKEN}`,
      "content-type": "application/json",
      "x-restli-protocol-version": "2.0.0",
      "linkedin-version": env.LINKEDIN_VERSION,
    },
    body: JSON.stringify({
      author: env.LINKEDIN_AUTHOR_URN,
      commentary: material.short.slice(0, 2900),
      visibility: "PUBLIC",
      distribution: {
        feedDistribution: "MAIN_FEED",
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    }),
  });
  const id = headers.get("x-restli-id") || stableKey(material.sourceUrl);
  return { status: "published", platform: "linkedin", id };
}

async function telegram(material, env) {
  const stop = blocked("telegram", requiredSecrets.telegram, env);
  if (stop) return stop;
  const { data } = await request(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      text: material.short.slice(0, 4096),
      disable_web_page_preview: false,
    }),
  });
  return {
    status: "published",
    platform: "telegram",
    id: String(data.result?.message_id ?? ""),
    url: env.TELEGRAM_PUBLIC_BASE_URL || undefined,
  };
}

async function discord(material, env) {
  const stop = blocked("discord", requiredSecrets.discord, env);
  if (stop) return stop;
  const url = env.DISCORD_WEBHOOK_URL + (env.DISCORD_WEBHOOK_URL.includes("?") ? "&wait=true" : "?wait=true");
  const { data } = await request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      content: material.short.slice(0, 2000),
      allowed_mentions: { parse: [] },
    }),
  });
  return { status: "published", platform: "discord", id: String(data?.id || "") };
}

async function bluesky(material, env) {
  const stop = blocked("bluesky", requiredSecrets.bluesky, env);
  if (stop) return stop;
  const service = (env.BLUESKY_SERVICE || "https://bsky.social").replace(/\/$/, "");
  const { data: session } = await request(`${service}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: env.BLUESKY_HANDLE, password: env.BLUESKY_APP_PASSWORD }),
  });
  const { data } = await request(`${service}/xrpc/com.atproto.repo.createRecord`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${session.accessJwt}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      repo: session.did,
      collection: "app.bsky.feed.post",
      record: {
        $type: "app.bsky.feed.post",
        text: material.social.slice(0, 300),
        createdAt: new Date().toISOString(),
        langs: ["en"],
      },
    }),
  });
  return { status: "published", platform: "bluesky", id: data.cid, url: data.uri };
}

async function mastodon(material, env) {
  const stop = blocked("mastodon", requiredSecrets.mastodon, env);
  if (stop) return stop;
  const base = env.MASTODON_BASE_URL.replace(/\/$/, "");
  const { data } = await request(`${base}/api/v1/statuses`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.MASTODON_ACCESS_TOKEN}`,
      "content-type": "application/json",
      "idempotency-key": stableKey(`mastodon:${material.fingerprint}`),
    },
    body: JSON.stringify({
      status: material.social,
      visibility: env.MASTODON_VISIBILITY || "public",
    }),
  });
  return { status: "published", platform: "mastodon", id: String(data.id), url: data.url };
}

async function x(material, env) {
  const stop = blocked("x", requiredSecrets.x, env);
  if (stop) return stop;
  const { data } = await request(env.X_API_URL || "https://api.x.com/2/tweets", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.X_USER_ACCESS_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ text: material.social.slice(0, 280) }),
  });
  return { status: "published", platform: "x", id: String(data.data?.id || "") };
}

async function wordpress(material, env) {
  const stop = blocked("wordpress", requiredSecrets.wordpress, env);
  if (stop) return stop;
  const base = env.WORDPRESS_BASE_URL.replace(/\/$/, "");
  const auth = Buffer.from(`${env.WORDPRESS_USERNAME}:${env.WORDPRESS_APP_PASSWORD}`).toString("base64");
  const { data } = await request(`${base}/wp-json/wp/v2/posts`, {
    method: "POST",
    headers: {
      authorization: `Basic ${auth}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      title: material.title,
      content: markdownToSimpleHtml(material.long),
      status: env.WORDPRESS_STATUS || "publish",
      excerpt: material.social.replaceAll("\n", " ").slice(0, 220),
    }),
  });
  return { status: "published", platform: "wordpress", id: String(data.id), url: data.link };
}

async function webhook(material, env) {
  const stop = blocked("webhook", requiredSecrets.webhook, env);
  if (stop) return stop;
  const { data } = await request(env.PUBLISHER_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(env.PUBLISHER_WEBHOOK_TOKEN
        ? { authorization: `Bearer ${env.PUBLISHER_WEBHOOK_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({ event: "release.published", material }),
  });
  return {
    status: "published",
    platform: "webhook",
    id: String(data?.id || material.fingerprint),
    url: data?.url,
  };
}

export const directAdapters = {
  devto,
  hashnode,
  linkedin,
  telegram,
  discord,
  bluesky,
  mastodon,
  x,
  wordpress,
  webhook,
};
