# TashevOS architecture

## Design goal

TashevOS is a project-centric control plane. AI providers are replaceable clients; the project state is the durable source of continuity.

## Core layers

1. **Discovery** — identify repository, stack, AI clients, rules, session/history sources and capabilities.
2. **Event store** — append raw local events so summaries can be rebuilt instead of trusted blindly.
3. **Memory engine** — durable decisions, failures, lessons, state and provenance.
4. **Reconciliation** — compare remembered state with current Git/files/tests/runtime evidence.
5. **Context compiler** — retrieve only task-relevant state under a token budget.
6. **Guardrails** — protect secrets, critical paths and concurrent work.
7. **Doctor / healer** — diagnose, classify risk, checkpoint, fix, verify and roll back.
8. **Adapters** — native hooks/MCP/instruction files for each AI environment.

## Evidence hierarchy

TashevOS must never treat an agent summary as stronger than repository evidence.

1. runtime/test/CI evidence;
2. current files and Git;
3. verified memory;
4. agent summaries;
5. inference.

## Memory classes

- **Raw events**: local/private, append-only where practical.
- **Project state**: compact current state.
- **Decisions**: durable architectural/product decisions with provenance.
- **Failed approaches**: attempted solutions and why they failed.
- **Handoffs**: compact continuation packets.
- **Cache**: disposable derived context.

## Safety model

Automatic repair is risk-classified.

- SAFE: TashevOS metadata, generated indexes, stale links, managed adapter blocks.
- LOW: checkpoint, repair, verify, rollback on regression.
- HIGH: isolated worktree and explicit verification policy.
- CRITICAL: authorization required by default.

## Data directories

```text
.tashevos/
  config.json
  PROJECT.md
  STATE.md
  GUARDRAILS.md
  state/
  memory/
  local/      # ignored by Git
  cache/      # ignored by Git
  sessions/   # ignored by Git
```

## Non-goals

TashevOS is not an LLM, IDE replacement or model vendor. It should work across them.
