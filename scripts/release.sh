#!/bin/bash
# Tag a release from the current branch.
#
# Usage:
#   scripts/release.sh          # release the version in VERSION
#   scripts/release.sh 0.3.0    # bump VERSION to 0.3.0 and release
#
# What it does:
#   1. Reads or updates the VERSION file.
#   2. Syncs the version into dsh-claude-agents/package.json.
#   3. Checks that CHANGELOG.md mentions the version.
#   4. Builds agent-hud to verify it compiles with the new version.
#   5. Commits the version bump (if anything changed).
#   6. Creates an annotated git tag vX.Y.Z.
#
# It does NOT push. Run `git push origin main --tags` after reviewing.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION_FILE="$ROOT/VERSION"

# ── resolve version ─────────────────────────────────────────────────────────

if [[ "${1:-}" != "" ]]; then
  if ! [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "error: version must be semver (e.g. 0.3.0), got: $1" >&2
    exit 1
  fi
  echo "$1" > "$VERSION_FILE"
fi

VERSION="$(head -1 "$VERSION_FILE" | tr -d '[:space:]')"
TAG="v$VERSION"

if [[ -z "$VERSION" ]]; then
  echo "error: VERSION file is empty" >&2
  exit 1
fi

echo "version: $VERSION  tag: $TAG"

# ── sync package.json ───────────────────────────────────────────────────────

PKG="$ROOT/dsh-claude-agents/package.json"
if [[ -f "$PKG" ]]; then
  # Replace only the top-level "version" line.
  sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" "$PKG"
fi

# ── check changelog ─────────────────────────────────────────────────────────

CHANGELOG="$ROOT/CHANGELOG.md"
if ! grep -q "\[$VERSION\]" "$CHANGELOG" 2>/dev/null; then
  echo "error: CHANGELOG.md does not mention [$VERSION]" >&2
  echo "       add a section before tagging." >&2
  exit 1
fi

# ── build ───────────────────────────────────────────────────────────────────

echo "building agent-hud..."
"$ROOT/agent-hud/build.sh"

# ── commit if dirty ─────────────────────────────────────────────────────────

cd "$ROOT"
if ! git diff --quiet HEAD -- VERSION dsh-claude-agents/package.json CHANGELOG.md; then
  git add VERSION dsh-claude-agents/package.json CHANGELOG.md
  git commit -m "release: v$VERSION"
fi

# ── tag ─────────────────────────────────────────────────────────────────────

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "error: tag $TAG already exists" >&2
  exit 1
fi

git tag -a "$TAG" -m "Release $VERSION"
echo ""
echo "tagged: $TAG"
echo ""
echo "next steps:"
echo "  git push origin main --tags"
echo "  gh release create $TAG --generate-notes"
