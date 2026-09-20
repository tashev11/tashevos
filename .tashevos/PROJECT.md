# Project memory

TashevOS is a local-first control plane for AI coding agents: one project memory, compact context packets and health checks that every agent can share. Alpha, version 0.1.0-alpha.1.

## Stack
- TypeScript (strict, ESM, NodeNext), Node.js >= 20.
- Runtime dependencies: commander and picocolors, nothing else.
- Tests: node:test, run against the compiled dist/ output.

## Layout
- src/cli.ts: the `tash` CLI with init, status, agents, scan, context, doctor and heal.
- src/core/: agents (detection), instructions (managed blocks), store (events and state), context (packets), doctor, scanner, sync/autosync and the optional Reddit ↔ GitHub bridge.
- src/lib/: fs and git helpers.
- packages/sdk/: adapter SDK types under Apache-2.0. The core is AGPL-3.0-only.
- docs/: principles, memory model, compatibility and auto-healing design.

## Commands
- `npm run check`: typecheck, build and tests. Run it before every push.
- `npm run dev -- <command>`: build and run the CLI.

## Design anchors
- Evidence hierarchy: runtime and tests > files and Git > verified memory > agent summaries > inference. See ARCHITECTURE.md.
- The roadmap is capability-driven. See ROADMAP.md.
