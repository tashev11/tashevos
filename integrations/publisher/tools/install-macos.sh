#!/bin/zsh
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

LABEL="ru.tashev.tashevos-publisher"
REPO_URL="${TASHEVOS_PUBLISHER_REPO_URL:-https://github.com/tashev11/tashevos.git}"
BASE_DIR="${TASHEVOS_PUBLISHER_HOME:-$HOME/.local/share/tashevos-publisher}"
REPO_DIR="${TASHEVOS_PUBLISHER_REPO_DIR:-$BASE_DIR/repo}"
ENV_DIR="$HOME/.config/tashevos"
ENV_FILE="${TASHEVOS_PUBLISHER_ENV_FILE:-$ENV_DIR/publisher.env}"
LOG_DIR="$HOME/.local/state/tashevos-publisher"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

mkdir -p "$BASE_DIR" "$ENV_DIR" "$LOG_DIR" "$HOME/Library/LaunchAgents"

if [[ ! -d "$REPO_DIR/.git" ]]; then
  git clone "$REPO_URL" "$REPO_DIR"
else
  git -C "$REPO_DIR" fetch origin main
  git -C "$REPO_DIR" switch main
  git -C "$REPO_DIR" pull --rebase origin main
fi

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$REPO_DIR/integrations/publisher/.env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
fi

RUNNER="$REPO_DIR/integrations/publisher/tools/local-runner.sh"
chmod +x "$RUNNER"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>$RUNNER</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>900</integer>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/stdout.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/stderr.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$UID" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$PLIST"
launchctl enable "gui/$UID/$LABEL"
launchctl kickstart -k "gui/$UID/$LABEL"

echo "Publisher scheduler installed."
echo "Credentials file: $ENV_FILE"
echo "Dedicated clone: $REPO_DIR"
echo "Logs: $LOG_DIR"
echo "Schedule: every 15 minutes + RunAtLoad"
