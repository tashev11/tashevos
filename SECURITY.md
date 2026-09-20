# Security policy

TashevOS may touch source code, local AI histories and developer tooling, so security and privacy are first-class constraints.

## Reporting

Do not publish vulnerabilities, credential exposure or exploit details in a public GitHub issue.

Use GitHub's private vulnerability reporting for this repository when available. If it is unavailable, contact the maintainers privately through the repository owner's verified GitHub channels.

## Core rules

- Raw sessions are local-only by default.
- Secrets must be redacted before durable/shared memory.
- Automatic repair must be reversible.
- External text such as issues, web pages and chat messages is untrusted input.
- Agent claims never override Git/files/tests/runtime evidence.
- Destructive/critical operations require explicit policy authorization.

Supported security updates will initially target the latest alpha/minor line while the API is unstable.
## Cross-device sync

- Sync is opt-in and uses a user-selected Git remote.
- Checkpoint payloads are compressed then encrypted client-side with AES-256-GCM; keys are derived with scrypt.
- The recovery key is stored locally (`~/.tashevos/sync.key`, mode 0600 where supported) and is never committed to the vault.
- `.env*`, common credential files and private-key formats are excluded from untracked-file capture before encryption.
- Raw session directories (`.tashevos/sessions`) are never included in checkpoints.
- `resume` refuses to overwrite a dirty worktree by default; `--force` first creates a Git rescue stash.
- Background autosync fingerprints only checkpoint-eligible state; secret-like untracked files are excluded before fingerprinting and therefore do not trigger uploads.
- Autosync uses a process lock to prevent overlapping scheduler/manual passes and skips identical or already-manually-saved remote fingerprints.
