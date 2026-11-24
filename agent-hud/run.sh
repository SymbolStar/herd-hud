#!/bin/bash
# Launch (or stop) the built Agent HUD app.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
APP="$ROOT/build/Agent HUD.app"

case "${1:-start}" in
  start)
    open "$APP"
    echo "opened: $APP"
    ;;
  stop)
    pkill -f "Agent HUD.app/Contents/MacOS/AgentHUD" 2>/dev/null && echo "stopped" || echo "not running"
    ;;
  restart)
    pkill -f "Agent HUD.app/Contents/MacOS/AgentHUD" 2>/dev/null || true
    sleep 1
    open "$APP"
    echo "restarted: $APP"
    ;;
  dump)
    "$APP/Contents/MacOS/AgentHUD" --dump
    ;;
  *)
    echo "usage: $0 [start|stop|restart|dump]" >&2
    exit 2
    ;;
esac
