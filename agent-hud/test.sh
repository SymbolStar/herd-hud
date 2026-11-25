#!/bin/bash
# Run the HUD's unit tests.
#
# The app has no Xcode project, so this compiles the real sources (minus
# main.swift, whose top-level code would launch the app) together with
# Tests/main.swift into one throwaway binary and runs it.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SDK="$(xcrun --show-sdk-path)"
SWIFTC="$(xcrun --find swiftc)"
TARGET="arm64-apple-macos13.0"

if [[ "$(uname -m)" != "arm64" ]]; then
  TARGET="x86_64-apple-macos13.0"
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# build.sh generates BuildVersion.swift, which defines BuildInfo. Reuse it when
# present; otherwise compile a stub from the temp dir so the source tree stays
# clean.
GENERATED_SOURCES=()
if [[ -f "$ROOT/Sources/BuildVersion.swift" ]]; then
  :
else
  cat > "$WORK/BuildVersion.swift" <<'SWIFT'
// Stub for the test build; build.sh generates the real one.
enum BuildInfo {
    static let version = "test"
    static let build = "0"
    static let commit = "test"
    static var summary: String { "\(version) (\(build), \(commit))" }
}
SWIFT
  GENERATED_SOURCES+=("$WORK/BuildVersion.swift")
fi

SOURCES=()
for source in "$ROOT"/Sources/*.swift; do
  case "$(basename "$source")" in
    main.swift) continue ;;  # top-level code; would run the app
  esac
  SOURCES+=("$source")
done

"$SWIFTC" -O -swift-version 5 \
  -target "$TARGET" \
  -sdk "$SDK" \
  -framework AppKit \
  -framework SwiftUI \
  -framework Combine \
  -D GENERATED_BUILD_INFO \
  "${SOURCES[@]}" \
  ${GENERATED_SOURCES[@]+"${GENERATED_SOURCES[@]}"} \
  "$ROOT"/Tests/*.swift \
  -o "$WORK/hud-tests"

"$WORK/hud-tests"
