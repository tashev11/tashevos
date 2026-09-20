# Verified auto-healing

TashevOS must never equate "agent says fixed" with "fixed".

## Pipeline

```text
discover
  -> reconcile
  -> diagnose
  -> classify risk
  -> checkpoint
  -> repair
  -> verify
  -> accept OR rollback
  -> memorize result
```

## Risk classes

### SAFE
Generated TashevOS metadata, stale indexes, managed instruction blocks and other reversible project-control artifacts.

### LOW
Formatting, imports, simple generated configuration and similar changes. Requires checkpoint and verification.

### HIGH
Application logic, dependency changes, infrastructure and broad refactors. Prefer isolated worktree and stronger test plan.

### CRITICAL
Auth, billing, destructive database operations, production infrastructure, secrets and irreversible actions. Default behavior requires explicit authorization.

## Verification contract

A repair may only be marked successful when the configured evidence passes. Depending on project type this may include typecheck, lint, unit/integration tests, build, migrations, smoke tests or custom commands.

A failed verified repair is itself valuable memory and should be written to the failed-approach store before rollback.
