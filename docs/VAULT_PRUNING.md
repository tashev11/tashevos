# Vault pruning

The encrypted vault is a private Git repository. Every checkpoint rewrites `projects/<id>/latest.tash` and becomes a new commit. Encrypted data neither compresses nor deltas, so every version stays in the history at full size: the vault grows without a bound, on the remote and in every local clone.

One real vault, two weeks of use: 52 commits, 353 MiB on disk, of which the current checkpoints are only 33 MiB. A single large project made up 78 % of it (ten versions of one checkpoint). `git gc` cannot help, because every version is still reachable.

`tash sync prune` bounds the history: it keeps the newest N checkpoint commits, replaces the older history on the remote and deletes the objects nobody references any more.

## Usage

```bash
tash sync prune --keep 10          # report only: what would be kept, freed and uploaded
tash sync prune --keep 10 --yes    # rewrite the remote history and reclaim the local space
```

- Without `--yes` nothing is changed. `--dry-run` is the explicit spelling of the same thing and wins over `--yes`.
- `--keep` is the number of newest vault commits that survive (default 10, from 1 to 10 000). Checkpoints arrive a few times a day, so 10 is roughly a few days of rollback. `keep` counts commits, not bytes: how much stays depends on which projects changed in them.
- The report is computed from the local clone and works offline. A computer that lags behind may still see the old history until it syncs; `--yes` always fetches first.

On the real vault above, `--keep 10` frees about 300 MiB locally and leaves about 50 MiB; `--keep 1` frees about 320 MiB.

## What `--yes` does

1. Takes the same lock as `tash autosync tick`, so it never overlaps with a background pass.
2. Fetches the remote and plans the rewrite against the fetched tip.
3. Replays the newest N commits as a new chain: same trees, messages, authors and dates, but the oldest one has no parent. The new tip must have exactly the tree of the old tip, otherwise nothing is pushed.
4. Pushes with `--force-with-lease` on the exact tip it fetched. If another computer pushed in the meantime the push is refused and nothing is lost; a plain `--force` is never used. Afterwards the remote is asked for its tip; since the rewrite has already happened, an unexpected or missing answer (another computer may have pushed on top already) is reported as a warning, not an error.
5. Moves the local branch, expires the reflog and deletes the unreachable objects. A repack (`git gc`) runs only when something unreachable is left inside a pack, as in a freshly cloned vault.

The pruning never reads the recovery key; the vault is handled as opaque Git objects.

It refuses to rewrite, and changes nothing, when the vault branch holds commits the remote has not seen, when the remote moved after the plan, or when the newest N commits contain a merge commit (the vault never creates one, and replaying it would drop its second parent). Merge commits older than the kept window go away with the rest of the old history.

A history that is already within `--keep` is not rewritten and nothing is pushed, but the local garbage is still reclaimed. That makes the command safe to run on every computer.

## What it costs

- **Upload.** The new root commit has no common history with the old one, so Git cannot tell the remote already has the kept objects and re-sends the whole kept window (about 50 MiB for `--keep 10` on the vault above, 33 MiB for `--keep 1`). The report prints this as `Upload`.
- **Download.** For the same reason every other computer downloads the kept window once, the first time it syncs after a rewrite.
- **Time.** Building that pack and repacking take seconds to a minute on a vault of this size.
- **Remote disk.** The Git host drops the unreachable old objects on its own garbage-collection schedule; the remote's reported size may not shrink immediately.
- **Rollback depth.** After a prune only the kept commits can be restored from the vault history.

## Other computers

Another computer that is behind the vault needs no special handling. Its next sync fetches the rewritten history and resets to it (`fetch` followed by `checkout -B`; a checkpoint resets the vault clone to the remote before writing). A checkpoint that computer makes afterwards lands on top of the new history, and nothing from the old history is resurrected.

That computer still carries the old objects on its own disk. Run `tash sync prune --yes` there as well: it finds the history already short, pushes nothing and only frees the local space.

## Automatic pruning (opt-in)

```bash
tash autosync prune --keep 10   # let `tash autosync tick` prune the vault
tash autosync prune --off       # stop
tash autosync status            # shows the policy and the last result
```

It is off by default, because it force-pushes the vault branch. Once enabled, the pass runs inside `tash autosync tick`, at most once every 24 hours. Because every rewrite re-uploads the kept window, it rewrites the remote only when the history is longer than twice `--keep` and then cuts it back to `--keep`; in between it only reclaims local garbage. Failures are recorded in `~/.tashevos/autosync-prune.json` and are not retried within the day.

## Notes

- If the disk is completely full, free a few MiB first: even the first step needs to write a few small files. The prune then frees the rest.
- Other refs in the vault clone (tags, a stash, other branches) keep their history alive. They are left alone and reported as warnings, and the estimate accounts for them.
- If the Git host protects the branch against force pushes, the push is refused and the vault is left as it was.
