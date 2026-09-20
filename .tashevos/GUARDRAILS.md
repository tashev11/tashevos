# Guardrails

- Never expose secrets.
- Prefer verified Git/files/test evidence over agent claims.
- Do not rewrite unrelated areas of the project.
- Files that TashevOS writes are never evidence about the environment. Detection ignores a marker that holds only the managed block.
- Managed content lives only between the tashevos:start and tashevos:end markers. Never touch user text outside them.
- TashevOS writes only to .tashevos/ and to the AGENTS.md, CLAUDE.md and GEMINI.md adapter files.
- Keep the licence boundary: packages/sdk (Apache-2.0) must not import from src/ (AGPL-3.0-only).
- Run `npm run check` before pushing. Never rely on GitHub Actions as the only scheduler or verifier: runner allocation can be blocked by account/billing state.
