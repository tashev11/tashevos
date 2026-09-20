# TashevOS Reddit Devvit bridge

Server-only Reddit Developer Platform integration for TashevOS.

One Devvit app can watch multiple GitHub repositories, publish new releases to an installed subreddit, mirror actionable Reddit feedback into the matching repository, and reply when the GitHub Issue is closed.

## Current repositories

- `tashev11/tashevos`
- `tashev11/tashev-relay`
- `tashev11/tashev-proof`
- `tashev11/tashev-crew`

The list is configurable through the global `githubRepos` Devvit setting.

## Flow

```text
GitHub releases (N repositories)
        ↓
Devvit scheduler every 15 minutes
        ↓
subreddit rule guard
        ↓
Reddit app-account post
        ↓
comment trigger
        ↓
bug / feature classifier
        ↓
GitHub Issue in the originating repository
        ↓
Issue closed
        ↓
one app-account reply to the originating comment
```

## Safety

The app acts as the Reddit app account, not as a personal user. It does not vote or send DMs. Before publishing a release it checks subreddit rules and skips automation when it sees an explicit ban on promotion/bots, conditional promotion windows, megathread-only promotion, or moderator-approval requirements.

Release/repository state, tracked Reddit posts, processed comments and Issue mappings are kept in Devvit Redis so retries do not create duplicates.

## Requirements

- Node.js 24+
- Reddit Developer Platform access
- Devvit CLI login for the app owner
- GitHub fine-grained token stored as the Devvit secret `githubToken`
The token needs **Issues: Read and write** for every repository that should receive Reddit feedback. Public release reads do not require write access.

## Local verification

```bash
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
npm install
npm run test:types
npm run lint
npm run build
```

## Devvit settings

The default repository list is declared in `devvit.json`. To override it, set `githubRepos` to one repository per line.

Store the GitHub token through Devvit; never commit it:

```bash
npx devvit settings set githubToken
```

## Playtest

```bash
npm run dev
```

The project currently uses `r/tashev_os_dev` as its playtest subreddit. The live playtest validated a four-repository scheduler pass with two already-seen releases and two repositories without a release.
## Publishing

`npm run deploy` uploads a version after typecheck and lint. `npm run launch` submits the app for Reddit review.

The app requests external HTTP access only to `api.github.com`. Reddit may require review of that domain and public Privacy Policy / Terms before wider installation.

## Dependency note

The current Devvit 0.14.4 dependency graph reports upstream npm audit findings. Do not apply `npm audit fix --force` blindly because it can move Devvit tooling across incompatible versions. Re-check the audit whenever Reddit releases a newer compatible Devvit SDK.
