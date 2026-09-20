# TashevOS

**One project. Every AI. Zero lost context.**

TashevOS is an open, local-first control plane for AI coding. It is designed to let Claude Code, OpenAI Codex, Cursor, Gemini CLI and other coding agents work on the same project without repeatedly re-reading the whole repository, forgetting previous decisions, or overwriting each other's work.

> Status: **v0.1 alpha foundation**. The repository is public early on purpose. The current release establishes project discovery, AI detection, local event memory, compact context packets, project health checks and safe repair primitives. Full session harvesting, MCP runtime, worktree autopilot and verified auto-healing are on the roadmap.

## Why TashevOS

AI coding tools are powerful, but project continuity is fragmented. Each agent has its own session, context window, rules and memory. Switching tools often means spending tokens rediscovering architecture and repeating failed approaches.

TashevOS puts the **project** in the center:

- one canonical project memory;
- automatic detection of installed AI coding tools;
- evidence-first context built from Git, files and verified state;
- compact context packets instead of repository dumps;
- cross-agent continuity and future session harvesting;
- project doctor and reversible safe healing;
- guardrails against secrets, stale memory and unrelated edits;
- future conflict detection, worktree isolation and token/cost telemetry.

## Quick start

```bash
git clone https://github.com/tashev11/tashevos.git
cd tashevos
npm install
npm run build
npm link

tash init /path/to/your/project
tash agents
tash doctor
tash context "fix admin notifications"
```

## Current CLI

```text
tash init [path]       Initialize TashevOS in a Git project
tash status [path]     Show Git and memory status
tash agents [path]     Detect AI tools and history sources
tash scan [path]       Detect the project stack
tash context [task]    Build a compact evidence-first context packet
tash doctor [path]     Check continuity/integration health
tash doctor --fix      Repair only safe TashevOS integration problems
tash heal [path]       Run the safe healing pass
```

## Architecture

```text
AI tools
Claude · Codex · Cursor · Gemini · Copilot · ...
        |
        v
Adapter / protocol layer
        |
        v
Context compiler <---- Memory / event store
        |                       ^
        v                       |
Reconciliation engine ---- Git / files / tests
        |
        v
Doctor / guardrails / verified healing
```

The long-term goal is not another passive memory database. TashevOS should answer:

> What is actually true about this project right now, what did every AI already try, what failed, what minimum context does the next agent need, and is it safe to continue?

## Local-first by default

Raw local AI sessions and runtime events are intended to remain local by default. Tracked project memory contains compact durable facts, decisions and guardrails. Cloud synchronization will be optional.

## Supported / planned agents

The adapter architecture targets Claude Code, Codex, Cursor, GitHub Copilot, Gemini CLI, Windsurf, Kiro, Cline, Roo Code, OpenCode, Continue, Qwen Code, Zed, Aider, Junie, Amp and more.

## Licensing

- TashevOS Core: **AGPL-3.0-only**
- Adapter SDK / protocol packages: **Apache-2.0**
- Future hosted Cloud/Team/Enterprise services may be commercial.

Commercial licensing for organizations that cannot use AGPL is planned.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md), [ARCHITECTURE.md](ARCHITECTURE.md) and [ROADMAP.md](ROADMAP.md).

## Security

Please do not open public issues for vulnerabilities or accidentally committed secrets. See [SECURITY.md](SECURITY.md).

---

Built in public. Designed for the multi-agent coding era.
