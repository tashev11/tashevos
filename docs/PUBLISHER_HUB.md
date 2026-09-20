# Publisher Hub

TashevOS Publisher Hub is the distribution layer for projects that are built in GitHub but need to be discovered elsewhere.

## Architecture

```text
Repositories
  ├─ tashevos
  ├─ tashev-relay
  ├─ tashev-proof
  └─ tashev-crew
        │
        └── GitHub Release
              │
              ▼
        Publisher Hub
          ├─ fetch release
          ├─ normalize content
          ├─ long / short / social variants
          ├─ platform routing
          ├─ dedupe state
          └─ result ledger
              │
              ├── direct API
              │   ├─ DEV.to
              │   ├─ Hashnode
              │   ├─ LinkedIn
              │   ├─ Telegram
              │   ├─ Discord
              │   ├─ Bluesky
              │   └─ Mastodon
              │
              ├── delegated
              │   └─ Reddit → existing Devvit bridge
              │
              └── automatic outbox
                  ├─ Hacker News / Show HN
                  ├─ Product Hunt
                  ├─ Peerlist
                  ├─ Indie Hackers
                  ├─ HackerNoon
                  ├─ DZone
                  ├─ daily.dev
                  ├─ Medium
                  └─ Lobsters
```

## Trigger

The default GitHub workflow checks every 15 minutes and can also be started manually. Only the latest non-draft release of each configured repository is considered. Releases older than 30 days are ignored by default so enabling the system cannot accidentally flood channels with old history.

## Idempotency

The ledger is `.tashevos/publisher-state.json`.

The key is `repository + GitHub release id`. Every platform records one of:

- `published` — API publication succeeded;
- `outbox` — ready-to-publish draft was created;
- `delegated` — another integration owns publication;
- `blocked` — credentials or account setup are missing;
- `error` — API call failed;
- `disabled` — channel is intentionally off.

Only `published`, `outbox` and `delegated` are terminal. This means adding a missing credential automatically unblocks the next scheduler pass without resetting state.

## Safety

- Secrets stay in GitHub Actions secrets or the runtime environment.
- Missing crdentials never break unrelated channels.
- No voting, engagement farming, DM automation or fake activity is performed.
- Community/editorial platforms are not driven with brittle browser bots.
- Release age guard prevents an initial backlog blast.
- Every generated manual draft links back to the canonical GitHub release.

## Adding projects

Add another source to `.tashevos/publisher.json`:

```json
{
  "repo": "owner/repository",
  "displayName": "Project",
  "includePrereleases": true,
  "tags": ["ai", "devtools"]
}
```

No publisher code change is required.

## Adding a platform

A direct platform adapter belongs in `integrations/publisher/src/platforms.mjs`. Its credentials must be environment variables and it must return a stable result containing `status`, `platform` and, when available, `id` / `url`.

If a platform does not have a safe supported write API, add it as `manual`; Publisher Hub will create a ready draft rather than simulating a user through a browser.
