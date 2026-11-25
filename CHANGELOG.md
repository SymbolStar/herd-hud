# Changelog

All notable changes to Herd HUD are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and versions use [Semantic Versioning](https://semver.org/).

## [0.2.0] — 2026-11-25

First versioned release, covering everything since the initial commit.

### Added

- **pi agent support** — the HUD and DSH board recognise Herdr's `pi` agent
  kind with a `π` badge (blue), type filter chip, and locale strings. The sort
  order is claude → opencode → codex → pi. (#1)
- **Short pi session names** — pi titles like `π - litellm额度 - gongchenhao`
  are trimmed to just the session name (`litellm额度`). Unnamed sessions fall
  back to the directory name. (#1)
- **Foldable side column** — a `›` button in the header folds the right-edge
  column into a slim 34 × 150 pt tab showing coloured status discs (blocked /
  working / done / idle). Click anywhere on the tab to unfold. The state is
  remembered across restarts. (#2)
- **Drag-to-resize** — the unfolded side column can be resized by dragging any
  edge or corner (width 140–520 pt, height 200 pt to screen height). The size
  is remembered; a menu-bar item resets to the config default. (#2)
- **Version stamping** — `VERSION` file at the project root drives the app's
  `Info.plist`, build output, log line, menu-bar label, and `--dump` JSON. A
  `scripts/release.sh` helper validates and tags releases.

### Fixed

- **Board test isolation** — `board.test.mjs` no longer leaks the default
  remote machine into route tests, which caused failures on hosts with herdr
  installed. (#1)

### Changed

- The DSH plugin `cleanTitle` now strips the leading `π` glyph (same treatment
  as `claude`, `opencode`, `codex`, `oc`).
- `Counts` gains a separate `done` field (still included in `other`).
- `package.json` version aligned to the project-wide `VERSION` file (was
  `0.3.0`, now `0.2.0` to match the first tagged release).

## [0.1.0] — 2026-11-24

Initial commit: macOS floating HUD + DSH sidebar board, Herdr socket and
remote-machine integration, click-to-jump via cmux.

[0.2.0]: https://github.com/SymbolStar/herd-hud/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/SymbolStar/herd-hud/releases/tag/v0.1.0
