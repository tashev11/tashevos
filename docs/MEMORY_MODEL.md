# Memory model

TashevOS memory is evidence-backed project state, not a transcript dump.

## Layers

1. **Raw events** — local append-only observations from agents, Git, tools and verification.
2. **Episodes** — compact task/session summaries rebuilt from events.
3. **Decisions** — durable choices with reason, affected files and provenance.
4. **Failed approaches** — attempts that should not be repeated without new evidence.
5. **Current state** — concise status for continuation.
6. **Derived context** — disposable task-specific packets.

## Trust states

Every durable memory item should eventually have:
- source;
- source commit / file hashes where applicable;
- creating agent and model when known;
- timestamp;
- confidence;
- trust: observed / inferred / verified / human-approved / contradicted;
- freshness: current / stale / invalid;
- supersedes / superseded-by links.

## Reconciliation

Before a durable fact is used, TashevOS should check whether its evidence is still current. Changed files, moved symbols, newer decisions or failing tests can downgrade memory.

## Dead-end firewall

Failed approaches are first-class memory. Before an agent executes a materially similar plan, TashevOS should surface prior failures and their evidence.

## Privacy

Raw session stores are local-only by default. Durable tracked memory must be compact and secret-redacted. Cloud sync is opt-in and encrypted.
