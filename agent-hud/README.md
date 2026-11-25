# Agent HUD

A tiny native macOS app that docks a translucent panel to the right edge of the
desktop and shows the live status of every Herdr-managed agent — local and
remote — as a status-bar companion.

- **Two layouts** (switch with the small “顶部 / 侧边” button in the panel or
  from the menu bar menu; the choice is remembered):
  - **右侧竖列** — 160 pt floating column at the right edge with one row per agent,
    showing the same set as the top bar: the 10 most recently active agents
    (`最近7 / 全部` toggle in the footer). Below 220 pt the rows switch to a compact
    two-line form (name + status/age, badges hidden) and the header/footer shrink.
  - **顶部横向** — a 42 pt strip spanning the top of the screen with scrollable
    agent chips. It shows the 10 most recently active agents (`最近7 / 全部` toggle).
    Recent-activity data comes from observed changes and the Claude session
    registry's `updatedAt`, persisted across restarts.
- **Desktop panel**: floating, always-on-top, all spaces, no Dock icon. Working
  and blocked agents pulse. Rows are ordered by most recent activity (Herdr's
  last state-change sequence seeds the order until the HUD observes a terminal
  revision/status change, then real timestamps take over); the right edge shows
  “just now / 3m / 2h”. Each layout remembers its own dragged position.
- **Click to jump**: clicking a row focuses that agent in Herdr and brings the
  cmux workspace hosting the Herdr TUI to the front. The HUD reads the Herdr
  client process's cmux workspace id and asks cmux (via its AppleScript
  dictionary) to `select tab` / `activate window`; nothing writes to cmux.
  The first click may ask macOS to allow "Agent HUD" to control cmux —
  without that permission it falls back to merely activating cmux.
- **Menu bar**: `◉N` running count (plus `⚠︎M` when agents are waiting for
  confirmation). Menu: show/hide panel, move to the screen under the pointer,
  refresh, quit.
- **Data**: local Herdr unix socket (`session.snapshot`) every 2 s; remote
  machines through the local Herdr CLI `--machine <label> api snapshot` (15 s
  cache, retries after 8 s on failure). No SSH credentials are read or stored.
- **Agents**: Claude, OpenCode, Codex, pi. Filters: the panel shows active agents
  (working/blocked) by default; the footer toggle reveals idle ones.

## Build

```sh
./build.sh
```

Produces `build/Agent HUD.app` (ad-hoc signed, arm64, macOS 13+). Swift is the
only dependency (Xcode Command Line Tools); there is no Xcode project and no
external package.

## Test

```sh
./test.sh
```

Compiles the real sources (minus `main.swift`) together with `Tests/main.swift`
into a throwaway binary and runs the assertions. No XCTest and no SwiftPM, so
`swiftc` stays the only requirement; CI runs it on every pull request.

Covered: pi session-name trimming and fallback, name disambiguation, counts,
row ordering (activity, then Herdr sequence, then status rank, then local
before remote), workspace label resolution, workspace grouping (including the
"其他" bucket staying last), and remote-machine row ids.

## Run

```sh
./run.sh          # open build/Agent HUD.app
./run.sh stop     # stop it
```

Or open `build/Agent HUD.app` in Finder. To keep it around, drag it to
`/Applications`. Auto-start at login: **System Settings → General → Login
Items → +** and pick `Agent HUD.app`.

## Configuration

Optional `~/.config/agent-hud/config.json` (created with defaults on first
run):

```json
{
  "machines": ["symbol-150-jms"],
  "refreshSeconds": 2,
  "remoteRefreshSeconds": 15,
  "panelWidth": 160,
  "panelHeightFraction": 0.76,
  "layout": "vertical"
}
```

`layout` accepts `"vertical"` (right column) or `"horizontal"` (top strip); the
in-app switch overrides it and is remembered in UserDefaults.

`panelWidth` and `panelHeightFraction` set the side column's default size. Drag
any edge or corner of the unfolded column to resize it (width 140–520 pt,
height from 200 pt up to the screen); the dragged size is remembered and
overrides the config. Menu-bar item “侧边栏恢复默认大小” goes back to the
config values. The folded tab and the top strip keep a fixed size.

`machines` must match Herdr saved machine labels (`herdr machine list`).
`HERDR_BIN` and `HERDR_SOCKET_PATH` environment variables override the binary
and socket paths. Panel position is remembered when you drag it; use the menu
item “移到鼠标所在屏幕” to snap it to another display.

## Diagnostics

- `AgentHUD --dump` — one-shot JSON board (local + remote), useful to check the
  data plane without the window.
- `~/Library/Logs/AgentHUD.log` — launch, board counts, remote failures, focus jumps.
- `AgentHUD --cmux-workspace` — print the detected cmux workspace UUID that hosts
  the Herdr TUI (empty output means the Herdr client process was not found).
- `AgentHUD --cmux-focus` — perform the jump once, headlessly.

## Notes

- Remote snapshots need SSH to the machine; the first call on a cold link can
  take several seconds, and Herdr's own SSH helper may time out on the first
  try — the HUD retries automatically.
- Adding `ControlMaster` to `~/.ssh/config` for the remote machine and its jump
  host makes remote refreshes nearly instant.
- The panel is a non-activating `NSPanel`: clicking it does not steal focus from
  your editor.
