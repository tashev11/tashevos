# Reddit ↔ GitHub bridge

TashevOS can run a local background bridge that turns GitHub releases into Reddit posts and mirrors actionable Reddit feedback back into GitHub Issues.

## Safety model

The bridge is intentionally allowlist-only. It posts only to subreddits named in its config, checks the current subreddit rules before a new automated release post, deduplicates release/subreddit pairs, identifies itself as automated, and never votes or sends DMs.

Use a dedicated Reddit app/bot account. Do not configure a personal identity for unattended posting.

Reddit API access and the app/bot account must be approved and created once outside TashevOS. After the one-time credentials are imported, the bridge can run unattended.

## Configure

```bash
tash reddit init \
  --repo tashev11/tashevos \
  --bot YOUR_REDDIT_BOT \
  --subreddit opensource SideProject \
  --interval 1800
```

The minimum polling interval is 900 seconds. Use `--no-auto-publish` for feedback-only mode or `--no-issues` for release-only mode.

## Import OAuth credentials

Keep secrets out of Git and shell history files. Export them only for the import command:

```bash
export REDDIT_CLIENT_ID="..."
export REDDIT_CLIENT_SECRET="..."
export REDDIT_REFRESH_TOKEN="..."
tash reddit auth
unset REDDIT_CLIENT_ID REDDIT_CLIENT_SECRET REDDIT_REFRESH_TOKEN
```

TashevOS copies the three values into `~/.tashevos/reddit-credentials.json` and attempts to set mode `0600`. The values are never written into the project repository.

## Run and inspect

```bash
tash reddit tick
tash reddit status
```

One synchronization pass checks the latest non-draft GitHub release, publishes it to allowed communities that do not have an obvious conflicting rule, scans tracked post replies for bug/feature feedback, and creates a GitHub Issue for new actionable feedback. When such an Issue is later closed, the bridge replies once to the originating Reddit comment with the Issue link.

## Run continuously

```bash
tash reddit install
```

On macOS this installs a user `launchd` agent. On Linux it installs a user `systemd` timer. The service calls `tash reddit tick` at the configured interval and does not depend on GitHub Actions.

Remove it without deleting configuration/state:

```bash
tash reddit uninstall
```

## State

Configuration, credentials, post/Issue mappings and logs live under `~/.tashevos/`. Publication state prevents duplicate posts for the same GitHub release and subreddit. A subreddit skipped because its rules explicitly block promotion/bots is remembered for that release instead of being retried repeatedly.

This is an automation primitive, not a spam engine. Community rules and Reddit platform requirements remain authoritative; if the bridge cannot establish that an allowlisted community accepts the action, keep that community out of the allowlist.
