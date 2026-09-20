# AI compatibility

TashevOS separates **target support** from **verified implementation**. We do not claim a full integration until it is tested.

## Integration levels

- **FULL** — lifecycle integration through hooks/MCP/CLI plus automatic context and event capture.
- **NATIVE** — instruction/rules integration and project context, but limited lifecycle capture.
- **BRIDGE** — Git/GitHub/handoff integration where the platform does not expose a suitable local runtime API.
- **TARGET** — planned adapter; capability research still required.

## Target matrix

| Environment | Target mode | v0.1 |
|---|---|---|
| Claude Code | FULL | detection + instruction bootstrap |
| OpenAI Codex | FULL | detection + AGENTS bootstrap |
| Cursor | FULL | marker detection |
| Gemini CLI | FULL | detection + instruction bootstrap |
| GitHub Copilot | FULL/NATIVE | marker detection |
| Windsurf | FULL | marker detection |
| Kiro | FULL | marker detection |
| Cline | FULL | marker detection |
| Roo Code | FULL | marker detection |
| OpenCode | FULL | marker detection |
| Continue | FULL/NATIVE | marker detection |
| Qwen Code | FULL | detection |
| Zed | FULL | marker/CLI detection |
| Aider | NATIVE | marker/CLI detection |
| JetBrains Junie | FULL/NATIVE | TARGET |
| Amp | NATIVE/FULL | TARGET |
| Goose | FULL | TARGET |
| Amazon Q Developer | FULL/NATIVE | TARGET |
| Sourcegraph Cody | NATIVE | TARGET |
| Augment Code | NATIVE | TARGET |
| Trae | NATIVE/FULL | TARGET |
| Tabnine | NATIVE | TARGET |
| Devin | BRIDGE | TARGET |
| OpenHands | BRIDGE/FULL | TARGET |
| Replit Agent | BRIDGE | TARGET |
| Google Jules | BRIDGE | TARGET |
| Lovable | BRIDGE | TARGET |
| Bolt | BRIDGE | TARGET |
| v0 | BRIDGE | TARGET |
| CodeRabbit | BRIDGE/review | TARGET |
| Qodo | BRIDGE/review | TARGET |

Community adapters should implement the Apache-licensed adapter SDK rather than adding provider conditionals to core.
