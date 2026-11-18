#!/bin/zsh
# Install / reload the Video Brain launchd job (tick every 5 min). Usage: zsh workers/video-brain/install.sh [--uninstall]
set -euo pipefail
DIR="${0:A:h}"
PLIST="$HOME/Library/LaunchAgents/co.celldigital.video-brain.plist"
NODE="$(command -v node)"
launchctl bootout "gui/$(id -u)/co.celldigital.video-brain" 2>/dev/null || true
if [[ "${1:-}" == "--uninstall" ]]; then mv -f "$PLIST" "$HOME/.claude/backups/" 2>/dev/null || true; echo "uninstalled"; exit 0; fi
[[ -f "$HOME/.config/adstudio-worker/prod.env" ]] || { echo "missing ~/.config/adstudio-worker/prod.env (APP_URL, WORKER_TOKEN)"; exit 1; }
sed -e "s#__DIR__#$DIR#g" -e "s#__HOME__#$HOME#g" -e "s#__NODE__#$NODE#g" "$DIR/co.celldigital.video-brain.plist.template" > "$PLIST"
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installed: $PLIST (runs $DIR/brain.mjs --once every 300 s; log ~/Library/Logs/video-brain.log)"
