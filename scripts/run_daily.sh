#!/bin/zsh
# launchd ラッパー。ログインシェルとして起動しユーザー環境（keychain 含む）を引き継ぐ。
# -l (login) により ~/.zprofile が読まれ、claude CLI の認証が通る。
# shellcheck disable=SC1091

set -euo pipefail

# ログインシェルのプロファイルを読み込み（claude CLI の認証に必要）
[[ -f ~/.zprofile ]] && source ~/.zprofile
[[ -f ~/.zshrc    ]] && source ~/.zshrc 2>/dev/null || true

PROJECT_DIR="/Users/koheiotsuka/fishing-sns-bot"
LOG_DIR="$PROJECT_DIR/data/logs"

mkdir -p "$LOG_DIR"
STAMP="$(date +%Y-%m-%dT%H%M%S)"
LOG_FILE="$LOG_DIR/run_${STAMP}.log"

# node / npm / claude CLI のパスを明示（プロファイルで設定されていない場合のフォールバック）
export PATH="/Users/koheiotsuka/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"

cd "$PROJECT_DIR"

{
  echo "==== run_daily start: $(date) ===="
  /usr/local/bin/npm run run:daily
  echo "==== run_daily end:   $(date) ===="
} >>"$LOG_FILE" 2>&1
