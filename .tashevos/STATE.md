# Current state

- Status: alpha foundation (v0.1). The CLI, agent detection, event store, context packets and doctor work.
- Active task: Reddit ↔ GitHub automation bridge implemented and locally verified on feat/reddit-github-bridge (`npm run check`: 13/13 tests passing); next external step is Reddit app/API approval + bot OAuth credentials before live activation.
- Known blockers:
  - Reddit app/API approval and dedicated bot OAuth credentials are required before live unattended publishing can be activated.
  - GitHub Actions jobs do not start because the account is locked due to a billing issue. CI stays on workflow_dispatch until that is resolved, then its triggers move to push and pull_request.
  - The npm alpha package is not published yet.
