#!/bin/bash
# Build the Agent HUD .app bundle (ad-hoc signed, no Xcode project needed).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
APP="$ROOT/build/Agent HUD.app"
SDK="$(xcrun --show-sdk-path)"
SWIFTC="$(xcrun --find swiftc)"
TARGET="arm64-apple-macos13.0"

if [[ "$(uname -m)" != "arm64" ]]; then
  TARGET="x86_64-apple-macos13.0"
fi

rm -rf "$ROOT/build"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

"$SWIFTC" -O -swift-version 5 \
  -target "$TARGET" \
  -sdk "$SDK" \
  -framework AppKit \
  -framework SwiftUI \
  -framework Combine \
  "$ROOT"/Sources/*.swift \
  -o "$APP/Contents/MacOS/AgentHUD"

cp "$ROOT/Info.plist" "$APP/Contents/Info.plist"
codesign --force --sign - "$APP" >/dev/null 2>&1 || true

echo "built: $APP"
