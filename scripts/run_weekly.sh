#!/bin/bash
# Wrapper for launchd. launchd runs with a near-empty PATH, so we set up the
# environment explicitly here before calling npm.

set -euo pipefail

PROJECT_DIR="/Users/koheiotsuka/fishing-sns-bot"
LOG_DIR="$PROJECT_DIR/data/logs"

mkdir -p "$LOG_DIR"
STAMP="$(date +%Y-%m-%dT%H%M%S)"
LOG_FILE="$LOG_DIR/run_${STAMP}.log"

# Make node / npm reachable. /usr/local/bin (intel brew / official installer)
# is where `which node` resolved at setup time.
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"

cd "$PROJECT_DIR"

{
  echo "==== run_weekly start: $(date) ===="
  /usr/local/bin/npm run run:weekly
  echo "==== run_weekly end:   $(date) ===="
} >>"$LOG_FILE" 2>&1
