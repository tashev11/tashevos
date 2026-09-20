# TashevOS Reddit App Terms of Use

**Effective date:** September 20, 2026

These Terms apply to use of the **tashev-os** app on Reddit's Developer Platform.

## Purpose

TashevOS is an automation utility for communities and open-source maintainers. It connects configured GitHub repositories with a Reddit community so that release announcements and development feedback can move between the two services.

## Automated actions

When enabled by the community's moderators, the app may:

- publish a Reddit post for a new release in a configured GitHub repository;
- inspect replies to TashevOS-created posts for bug reports or feature requests;
- create a GitHub Issue containing relevant public Reddit feedback;
- reply to the originating Reddit comment when the linked Issue is closed.

The app acts through its Reddit app account. It does not vote on content or send direct messages.

## Community rules

Installation or configuration of TashevOS does not override subreddit rules or Reddit policies. The app includes conservative checks intended to avoid automated release posting when community rules clearly prohibit promotion, bots, require a special promotion thread, or require moderator approval.

Community moderators remain responsible for deciding whether the app is appropriate for their community and for configuring it consistently with their rules.

## GitHub configuration

Repository owners or administrators are responsible for:

- selecting repositories the app may access;
- granting the GitHub token only the permissions needed for the workflow;
- ensuring the token is authorized for every configured repository;
- reviewing and managing Issues created by the app.

## Public feedback

A Reddit comment classified as an actionable bug report or feature request may be copied into a GitHub Issue. That Issue can include the Reddit username, comment text, and links to Reddit.

Users should not submit passwords, access tokens, private keys, payment details, or other sensitive information in comments intended for this workflow.

## No guarantee

The app is provided on an "as is" and "as available" basis. Automated classification can be imperfect, external APIs can fail, and posts or Issues may be delayed or skipped. No guarantee is made that every release, comment, Issue, or status update will be processed.

## Acceptable use

Do not use TashevOS to spam communities, evade moderator restrictions, impersonate people, harvest personal information, or violate Reddit, GitHub, or applicable law.

## Third-party services

The app depends on Reddit and GitHub. Use of those services is also governed by their respective terms and policies. TashevOS does not control their availability or policy decisions.

## Suspension and termination

Community moderators may disable or uninstall the app. The app operator may suspend functionality when necessary for security, policy compliance, abuse prevention, or maintenance.

## Changes

These Terms may be updated as the app evolves. The current version will be published at this URL with an updated effective date when material changes are made.

## Contact

Questions about these Terms can be submitted through:

https://github.com/tashev11/tashevos/issues
