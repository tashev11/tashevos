# TashevOS Publisher Hub

Publisher Hub turns GitHub releases into a single, deduplicated distribution pipeline for developer-facing channels.

## Flow

```text
GitHub Releases (N repositories)
        ↓
normalize release + create long/short/social variants
        ↓
┌───────────────────────────────────────────┐
│ direct API                                  │
│ DEV.to · Hashnode · LinkedIn · Telegram     │
│ Discord · Bluesky · Mastodon                │
└────────────────────────────────────────────┘
        ↓
state + publication IDs/URLs
        ↓
GitHub

Reddit is delegated to the existing Devvit bridge.

Platforms that should not be blindly auto-posted receive a ready-to-publish Markdown file in `.tashevos/publisher-outbox/`: Hacker News, Product Hunt, Peerlist, Indie Hackers, HackerNoon, DZone, daily.dev, Medium and Lobsters.
```

## Why two modes?

A platform having a website does not mean it has a safe, supported publishing API. Publisher Hub uses direct API posting only where a supported integration is appropriate. Editorial, launch-focused or community-moderated destinations get an automatic outbox draft instead of brittle browser automation.

## Configuration

The repository-wide configuration is `.tashevos/publisher.json`.

Each platform has one of three modes:

- `direct` — post through an API and save the returned ID/URL.
- `delegated` — another TashevOS integration owns the channel (currently Reddit/Devvit).
- `manual` — generate a platform-specific outbox draft.

Missing credentials do not stop other platforms. The channel is recorded as `blocked` and is retried on the next run.

## Secrets and variables

Direct channels use environment variables so credentials never enter Git.

| Platform | Required |
|---|---|
| DEV.to | `DEVTO_API_KEY` |
| Hashnode | `HASHNODE_PAT`, `HASHNODE_PUBLICATION_ID` |
| LinkedIn | `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_AUTHOR_URN` |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |
| Discord | `DISCORD_WEBHOOK_URL` |
| Bluesky | `BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD` |
| Mastodon | `MASTODON_BASE_URL`, `MASTODON_ACCESS_TOKEN` |
| X | `X_USER_ACCESS_TOKEN` (adapter disabled by default until account/API access is verified) |
| WordPress | `WORDPRESS_BASE_URL`, `WORDPRESS_USERNAME`, `WORDPRESS_APP_PASSWORD` |
| Generic webhook | `PUBLISHER_WEBHOOK_URL` |

Optional settings are exposed through workflow variables rather than secrets.

## Run locally

From the repository root:

```bash
node integrations/publisher/src/publisher.mjs --dry-run
```

Run tests:

```bash
cd integrations/publisher
npm test
```

A live run creates/updates `.tashevos/publisher-state.json`. A successful or outbox result is terminal for that release/platform, so subsequent scheduler runs do not duplicate it. `blocked` and `error` results are retried.

## GitHub Actions

`.github/workflows/publisher.yml` is ready for a 15-minute schedule plus manual runs. If GitHub cannot allocate hosted runners, `tools/install-macos.sh` installs an equivalent 15-minute `launchd` scheduler using a dedicated clone.

Do not commit platform tokens. Use repository Actions secrets when GitHub Actions is available, or the private local file `~/.config/tashevos/publisher.env` for the macOS fallback. See [../../docs/PUBLISHER_SETUP.md](../../docs/PUBLISHER_SETUP.md) for the exact setup checklist.
