# Current state

- Status: active
- Active task: Vault history pruning: PR #26 (tash sync prune) awaiting owner review; the real vault has not been touched
- Summary: tash sync prune [--keep N] [--dry-run] [--yes] and the opt-in tash autosync prune are implemented with 43 new tests (suite 58/58), docs/VAULT_PRUNING.md, and an independent code + security review applied. A rehearsal on a hardlinked copy of the real vault matched the dry-run estimate within 0.4%. Real-vault dry-run (62 commits, 388 MiB on disk): --keep 10 would free about 324 MiB (63.8 MiB stay, 63.8 MiB upload). Still open from before: Publisher Hub macOS fallback and platform credentials (~/.config/tashevos/publisher.env), Reddit app tashev-os v0.0.2 pending PUBLIC App Review.
- Next step: Owner reviews PR #26. After an explicit OK: run `tash sync prune --keep 10` (report), then `--yes` on the real vault, then the same on the other computer(s); optionally `tash autosync prune --keep 10`. Never rewrite or force-push the real vault without that OK.
- Known blockers: Owner approval for pruning the real vault; GitHub-hosted Actions are blocked by a billing lock, so PR #26 has no CI checks and verification is the local `npm run check`.
- Updated: 2026-10-04T12:46:23.372Z
