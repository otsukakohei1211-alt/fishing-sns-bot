#!/bin/zsh
# run_batch.sh — 週3回の観察記録抽出 + 統計集計バッチ
# launchd から呼ばれる。ログインシェルとして起動しユーザー環境を引き継ぐ。

set -euo pipefail

[[ -f ~/.zprofile ]] && source ~/.zprofile
[[ -f ~/.zshrc    ]] && source ~/.zshrc 2>/dev/null || true

PROJECT_DIR="/Users/koheiotsuka/fishing-sns-bot"
LOG_DIR="$PROJECT_DIR/data/logs"

mkdir -p "$LOG_DIR"
STAMP="$(date +%Y-%m-%dT%H%M%S)"
LOG_FILE="$LOG_DIR/batch_${STAMP}.log"

export PATH="/Users/koheiotsuka/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"

cd "$PROJECT_DIR"

{
  echo "==== run_batch start: $(date) ===="
  /usr/local/bin/npm run batch:extract
  /usr/local/bin/npm run batch:aggregate
  echo "==== run_batch end:   $(date) ===="
} >> "$LOG_FILE" 2>&1
