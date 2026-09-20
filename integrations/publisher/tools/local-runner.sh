#!/bin/zsh
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

REPO_URL="${TASHEVOS_PUBLISHER_REPO_URL:-https://github.com/tashev11/tashevos.git}"
BASE_DIR="${TASHEVOS_PUBLISHER_HOME:-$HOME/.local/share/tashevos-publisher}"
REPO_DIR="${TASHEVOS_PUBLISHER_REPO_DIR:-$BASE_DIR/repo}"
ENV_FILE="${TASHEVOS_PUBLISHER_ENV_FILE:-$HOME/.config/tashevos/publisher.env}"
LOG_DIR="${TASHEVOS_PUBLISHER_LOG_DIR:-$HOME/.local/state/tashevos-publisher}"

mkdir -p "$BASE_DIR" "$LOG_DIR" "$(dirname "$ENV_FILE")"

if [[ ! -d "$REPO_DIR/.git" ]]; then
  git clone "$REPO_URL" "$REPO_DIR"
fi

cd "$REPO_DIR"

unexpected="$(git status --porcelain | grep -Ev '^[ MARC?]{2} \.tashevos/(publisher-state\.json|publisher-outbox/)' || true)"
if [[ -n "$unexpected" ]]; then
  print -u2 "Publisher clone has unexpected local changes:"
  print -u2 "$unexpected"
  exit 1
fi

git config user.name "tashevos-publisher[bot]"
git config user.email "tashevos-publisher[bot]@users.noreply.github.com"

if [[ -n "$(git status --porcelain -- .tashevos/publisher-state.json .tashevos/publisher-outbox)" ]]; then
  git add .tashevos/publisher-state.json .tashevos/publisher-outbox
  git commit -m "chore(publisher): preserve pending publication state"
fi

git fetch origin main
git switch main
git rebase origin/main

if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

node integrations/publisher/src/publisher.mjs

if [[ -n "$(git status --porcelain -- .tashevos/publisher-state.json .tashevos/publisher-outbox)" ]]; then
  git add .tashevos/publisher-state.json .tashevos/publisher-outbox
  git commit -m "chore(publisher): update publication state"
fi

git fetch origin main
git rebase origin/main

if [[ "$(git rev-list --count origin/main..HEAD)" -gt 0 ]]; then
  git push origin main
fi
