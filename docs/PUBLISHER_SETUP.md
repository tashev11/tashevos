# Publisher Hub setup checklist

Add credentials in **GitHub → tashev11/tashevos → Settings → Secrets and variables → Actions**. Never paste tokens into tracked files.

## 1. DEV.to

Create an API key in DEV Community account settings and add:

- Secret `DEVTO_API_KEY`

Publisher Hub will publish Markdown articles and use the GitHub release as the canonical source.

## 2. Hashnode

The publication must have API access. Add:

- Secret `HASHNODE_PAT`
- Secret `HASHNODE_PUBLICATION_ID`

Hashnode GraphQL API access requires an active Pro plan for the publication.

## 3. LinkedIn

Create/authorize a LinkedIn developer application with permission to create posts for the intended member or organization. Add:

- Secret `LINKEDIN_ACCESS_TOKEN`
- Secret `LINKEDIN_AUTHOR_URN` — `urn:li:person:...` or `urn:li:organization:...`
- Repository variable `LINKEDIN_VERSION` — choose a currently supported LinkedIn Marketing API version

LinkedIn publishing permissions are restricted; the app/account must actually be approved for the required API.

## 4. Telegram

Create a bot through BotFather, add it to the target channel/group and grant permission to post. Add:

- Secret `TELEGRAM_BOT_TOKEN`
- Secret `TELEGRAM_CHAT_ID` — numeric id or public `@channel`
- Optional variable `TELEGRAM_PUBLIC_BASE_URL`

## 5. Discord

Create a channel webhook and add:

- Secret `DISCORD_WEBHOOK_URL`

## 6. Bluesky

Create an app password for the publishing account. Add:

- Variable `BLUESKY_HANDLE`
- Secret `BLUESKY_APP_PASSWORD`
- Optional variable `BLUESKY_SERVICE`

## 7. Mastodon

Create an application/access token on the chosen instance with permission to write statuses. Add:

- Variable `MASTODON_BASE_URL`
- Secret `MASTODON_ACCESS_TOKEN`
- Optional variable `MASTODON_VISIBILITY`

## 8. Reddit

Reddit is already handled by `integrations/reddit-devvit`.

For feedback → GitHub Issues, the Devvit secret `githubToken` needs **Issues: read/write** for every watched repository. No Publisher Hub secret is needed for Reddit.

## 9. X

The adapter exists but is disabled in `.tashevos/publisher.json` until write-capable API access is confirmed for the account.

When confirmed:

- Secret `X_USER_ACCESS_TOKEN`
- Optional variable `X_API_URL`
- Set `platforms.x.enabled` to `true`

## 10. WordPress / personal developer hub

Disabled until a canonical site is chosen. To enable:

- Variable `WORDPRESS_BASE_URL`
- Secret `WORDPRESS_USERNAME`
- Secret `WORDPRESS_APP_PASSWORD`
- Optional variable `WORDPRESS_STATUS`
- Set `platforms.wordpress.enabled` to `true`

## 11. Generic webhook

Use this for future automation services or a custom website:

- Variable `PUBLISHER_WEBHOOK_URL`
- Optional secret `PUBLISHER_WEBHOOK_TOKEN`
- Set `platforms.webhook.enabled` to `true`

## No credential required

Publisher Hub automatically creates reviewed Markdown drafts for:

- Hacker News / Show HN
- Product Hunt
- Peerlist
- Indie Hackers
- HackerNoon
- DZone
- daily.dev
- Medium
- Lobsters

These are intentionally kept in the reviewed outbox instead of blind auto-posting because their publishing flow is editorial, launch-oriented, community-sensitive, or lacks a suitable supported write API.

## First activation

1. Merge the Publisher Hub changes to `main`.
2. Add credentials for any direct platforms you want active.
3. Run **Actions → Publisher Hub → Run workflow** once.
4. Inspect `.tashevos/publisher-state.json`.
5. Future checks run every 15 minutes automatically.

Missing credentials are safe: that channel is marked `blocked`, while every other configured channel continues. Once the secret is added, the next run retries it automatically.
