# TashevOS Reddit App Privacy Policy

**Effective date:** September 20, 2026

This Privacy Policy applies to the **tashev-os** app on Reddit's Developer Platform.

## What the app does

TashevOS connects Reddit communities with configured GitHub repositories. It can publish GitHub release announcements, detect actionable bug reports or feature requests in replies to app-created posts, create a GitHub Issue in the matching repository, and post a follow-up reply when that Issue is closed.

## Data the app processes

The app processes only the information needed to provide those functions:

- public Reddit post and comment content associated with TashevOS app posts;
- public Reddit usernames attached to those comments;
- Reddit post/comment identifiers and permalinks;
- configured GitHub repository names;
- public GitHub release metadata;
- GitHub Issue numbers, URLs, and status for Issues created or tracked by the app;
- operational state needed to avoid duplicate posts, Issues, and replies.

The app does **not** intentionally collect passwords, payment information, private messages, precise location, contacts, or sensitive profile information.

## How data is used

Data is used only to:

- publish release information requested by the installed community;
- route Reddit feedback to the correct GitHub repository;
- avoid duplicate automation;
- notify the originating Reddit thread when a linked Issue is closed;
- diagnose operational errors.

## External services

The app makes server-side requests only to **api.github.com** for the configured GitHub repositories.

When feedback is mirrored into GitHub, the resulting Issue may include the Reddit username, comment text, and links to the Reddit post/comment. If the configured GitHub repository is public, that Issue is public.

Reddit and GitHub process data under their own terms and privacy policies.

## Storage

Automation mappings and deduplication state are stored in Reddit Developer Platform Redis for the app installation. GitHub credentials are stored as Reddit Developer Platform secrets and are not committed to the source repository.

GitHub Issues created by the app are stored by GitHub according to the repository owner's settings and GitHub's policies.

## Retention

Operational mappings are retained while needed to run the integration and prevent duplicate actions. Community moderators can stop further processing by uninstalling or disabling the app. GitHub Issues remain subject to the controls available to the relevant repository owner.

## Sharing and sale

The app does not sell personal information and does not use Reddit data for advertising or user profiling. Data is shared with GitHub only as required to perform the configured Reddit-to-GitHub workflow.

## Security

The app uses Reddit Developer Platform secret storage for the GitHub token and requests only the permissions necessary for the configured workflow. No secret is intentionally written to Reddit posts, comments, GitHub Issues, or the public source repository.

## User and moderator choices

Do not include passwords, API keys, private credentials, or other sensitive information in feedback intended for automated GitHub mirroring.

Community moderators control whether the app is installed and enabled. Repository owners control the GitHub Issues created by the app.

## Changes

This policy may be updated when the app's functionality or data practices change. Material changes will be reflected by updating this document and its effective date.

## Contact

Questions, privacy requests, or security reports can be submitted through the TashevOS GitHub repository:

https://github.com/tashev11/tashevos/issues
