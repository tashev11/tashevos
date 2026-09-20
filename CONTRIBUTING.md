# Contributing to TashevOS

Thanks for helping build a vendor-neutral continuity layer for AI coding.

## Before starting

1. Open or find an issue for substantial behavior changes.
2. Keep the local-first/privacy model intact.
3. Never add telemetry that sends code, prompts, secrets or session contents without explicit user opt-in.
4. Prefer adapters over provider-specific logic in the core.
5. Add tests for behavior changes.

## Development

```bash
npm install
npm run check
npm run build
npm run dev -- --help
```

## Pull requests

A good PR explains:
- the problem;
- the design choice;
- which AI clients/stacks are affected;
- tests/verification performed;
- privacy/security implications.

By contributing, you agree to the project CLA in [CLA.md](CLA.md).

## Adapter contributions

Keep detection non-destructive. Do not overwrite a user's existing AI rules. Managed files/blocks must be clearly delimited and idempotent.
