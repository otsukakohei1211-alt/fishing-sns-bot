#!/bin/zsh
# run_feature.sh — 魚種特集投稿（毎日 12:00 発火 / 隔日ガードで2日に1回投稿）
set -euo pipefail

[[ -f ~/.zprofile ]] && source ~/.zprofile
[[ -f ~/.zshrc    ]] && source ~/.zshrc 2>/dev/null || true

PROJECT_DIR="/Users/koheiotsuka/fishing-sns-bot"
LOG_DIR="$PROJECT_DIR/data/logs"
mkdir -p "$LOG_DIR"
STAMP="$(date +%Y-%m-%dT%H%M%S)"
LOG_FILE="$LOG_DIR/feature_${STAMP}.log"

export PATH="/Users/koheiotsuka/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"

cd "$PROJECT_DIR"

{
  echo "==== run_feature start: $(date) ===="
  /usr/local/bin/npm run run:feature
  echo "==== run_feature end:   $(date) ===="
} >> "$LOG_FILE" 2>&1
