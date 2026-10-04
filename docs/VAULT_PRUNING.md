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

## Rolling it out the first time

1. **Report.** `tash sync prune --keep 10` changes nothing. Check the history length, the MiB freed and the `Upload`.
2. **Optional safety net.** `git -C ~/.tashevos/vault bundle create <somewhere>/vault-before-prune.bundle --all` is the only undo: after `--yes` the old versions are deleted locally and kept by the Git host only until its own cleanup. It costs about the vault's size on disk, so put it where there is room (an external drive if the machine is tight) and delete it once everything works.
3. **Apply.** `tash sync prune --keep 10 --yes`, preferably while no other computer is checkpointing. A collision only makes the push refuse; run it again.
4. **Verify.** `git -C ~/.tashevos/vault rev-list --count HEAD` shows the kept number; `git -C ~/.tashevos/vault ls-remote origin refs/heads/main` and `rev-parse HEAD` agree; `tash sync status <project>` still decrypts the newest checkpoint; the next `tash autosync tick` ends without an error.
5. **Other computers**, if there are any: see below.
6. **Automation, last.** `tash autosync prune --keep 10` previews what the first pass would do; `--yes` turns it on.

## One computer, and a second one later

With one computer the vault is an off-site backup of your checkpoints, and the kept commits are the rollback depth. There is nothing to do for other computers.

A computer that joins later needs no prune: it clones the history, which is already short. Install TashevOS there, then run `tash sync init --remote <the same URL> --key <the recovery key>` and `tash sync status`; `tash resume` continues a project. Take the key from `tash sync key` on the first computer and move it through a password manager, never through chat or Git.

A computer that was enrolled before the first prune still carries the old objects on its disk. Run `tash sync prune --yes` there once: it finds the history already short, pushes nothing and only frees the local space. Until then it works normally: its next sync fetches the rewritten history and resets to it (`fetch` followed by `checkout -B`; a checkpoint resets the vault clone to the remote before writing), and a checkpoint it makes afterwards lands on top of the new history. Nothing from the old history is resurrected.

### Rehearsing a second computer on one computer

This proves that enrolling and resuming work against your real, pruned vault before the second computer exists. It uses a temporary home, so nothing of the real one is touched, and the recovery key lives only in the environment of that one process: not on disk, not in a command line.

```bash
(
  set -eo pipefail
  REAL="$HOME/.tashevos"
  PROJECT=/path/to/a/project/that/autosync/tracks
  B="$(mktemp -d)"
  trap 'rm -rf "$B"' EXIT
  REMOTE="$(node -p "require('$REAL/sync.json').remote")"
  PROJECT_REMOTE="$(git -C "$PROJECT" remote get-url origin)"
  export TASHEVOS_HOME="$B/home"
  tash sync init --remote "$REMOTE" >/dev/null
  echo "1/4 the second computer cloned the vault: $(git -C "$B/home/vault" rev-list --count HEAD) commits, $(du -sh "$B/home/vault/.git" | cut -f1)"
  export TASHEVOS_SYNC_KEY="$(TASHEVOS_HOME="$REAL" tash sync key)"
  tash sync status "$PROJECT" | sed -n '2,4p'
  echo "2/4 the newest checkpoint decrypted with the key of the first computer"
  git clone -q "$PROJECT_REMOTE" "$B/project"
  tash resume "$B/project" | sed -n '1,4p'
  echo "3/4 resumed into a fresh clone at $(git -C "$B/project" rev-parse --short HEAD), $(git -C "$B/project" status --short | wc -l | tr -d ' ') changed file(s)"
  echo "4/4 REHEARSAL PASSED; the temporary folder is removed on exit"
)
```

## Automatic pruning (opt-in)

```bash
tash autosync prune --keep 10         # preview: what the first pass would do; changes nothing
tash autosync prune --keep 10 --yes   # turn it on
tash autosync prune --off             # turn it off
tash autosync status                  # shows the vault size, the policy and the last result
```

It is off by default, and without `--yes` it only prints a preview, because turning it on lets `tash autosync tick` force-push the vault branch. The preview says whether the first pass, minutes after turning it on, would rewrite the remote right away (it does when the history is already longer than twice `--keep`) or only wait. It is computed offline from this computer's copy of the vault, so if another computer has checkpointed since, the real first pass may see more commits. Once enabled, `tash autosync tick` looks after the vault. Because every rewrite re-uploads the kept window, it rewrites the remote only when the history is longer than twice `--keep`, cuts it back to `--keep`, and then waits at least 24 hours before the next rewrite. While the history is still short it only does a daily local check (it reclaims garbage and rewrites nothing), and that check does not use up the day: the moment the history passes the limit, the next tick rewrites it. Failures are recorded in `~/.tashevos/autosync-prune.json` and are not retried within the day.

While you are working, autosync can add several checkpoints an hour, each about the size of the project's bundle. On a very busy day the vault can therefore grow by a few hundred MiB between two rewrites; it never grows without a bound.

## Growth warning

While the automatic prune is off, the vault can quietly grow again. `tash autosync status` prints `Vault: <commits>, <size>` and warns, `tash doctor` adds an "Encrypted vault" check (a warning, never a failure), and the MCP `tashevos_status` tool carries a `vault` field whose `level` is `ok`, `grown` or `prune-failed`, so an AI agent can mention it at the start of a session. The vault counts as grown past 20 commits or 200 MiB, which is where the automatic prune would start rewriting it. With the automatic prune on, the warning stays quiet unless its last run failed. The check is offline and read-only.

## Notes

- If the disk is completely full, free a few MiB first: even the first step needs to write a few small files. The prune then frees the rest.
- Other refs in the vault clone (tags, a stash, other branches) keep their history alive. They are left alone and reported as warnings, and the estimate accounts for them.
- If the Git host protects the branch against force pushes, the push is refused and the vault is left as it was.
