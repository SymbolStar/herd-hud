# Herd HUD

A live HUD for your local agent herd: every Claude / OpenCode / Codex agent
managed by [Herdr](https://herdr.dev), visible at a glance and one click away.

Herd HUD comes in two halves that share one idea:

- **`agent-hud/` — a native macOS app.** A floating HUD (right-edge column or
  top strip) plus a menu-bar item that shows the live status of every agent,
  ordered by recent activity, and jumps to an agent in cmux/Herdr when clicked.
- **`dsh-claude-agents/` — a DeepSeek Harness plugin.** A full “Agents” board
  inside the DSH Web GUI: local + remote Herdr machines, status filters, terminal
  output, and message sending (including confirmation-aware Enter/Esc for
  blocked agents).

Both read the same control plane — the local Herdr server — and neither stores
SSH credentials or touches agent processes behind your back.

## What it looks like

| Where | What |
|---|---|
| macOS HUD | 160 pt right-edge column or 42 pt top strip; live status dots, the 10 most recently active agents (`最近10 / 全部`), click → Herdr pane |
| Menu bar | `◉N` running agents (`⚠︎M` waiting for confirmation); show/hide, layout, refresh, quit |
| DSH board | Type/machine filters, blocked → working → idle grouping, output viewer, send message, remote machines via `herdr --machine` |

## Architecture

```
                 ~/.claude sessions/jobs/tasks/transcripts
                              │ (Claude enrichment)
Herdr server ── unix socket ──┤
   │  session.snapshot        │
   │  agent.prompt/keys/read  ▼
   │                    ┌──────────────┐        ┌────────────────┐
   └── herdr --machine ─┤  AgentStore  ├───────►│ macOS HUD app  │
        (remote Herdr)  │  (merge/poll)│        │ SwiftUI panel  │
                        └──────┬───────┘        └────────────────┘
                               │
                        ┌──────▼───────┐
                        │ DSH plugin   │  /dsh-plugin-claude-agents/*
                        │ web routes   │  (cookie-authenticated)
                        └──────────────┘
```

Click-to-jump path: `herdr agent focus <pane>` (server-side focus) + a cmux
AppleScript call that selects the cmux workspace hosting the Herdr TUI and
activates cmux.

## Quick start

### macOS app

```sh
cd agent-hud
./build.sh          # needs Xcode Command Line Tools only
./run.sh            # opens "build/Agent HUD.app"
```

Menu-bar menu → layout（侧边/顶部）、move to the screen under the pointer,
refresh, quit. Optional config at `~/.config/agent-hud/config.json`; logs at
`~/Library/Logs/AgentHUD.log`.

### DSH plugin

```sh
dsh plugin --profile desktop add link:$PWD/dsh-claude-agents
```

Then refresh the DSH page: an **Agents** item appears in the sidebar. Remote
machines are configured with the plugin's `machines` list / the
`DSH_CLAUDE_AGENTS_MACHINES` env var (default: `symbol-150-jms`).

## Versioning

The project-wide version lives in the `VERSION` file at the repository root.
`agent-hud/build.sh` stamps it into the app's `Info.plist`, build output, log,
menu bar, and `--dump` JSON. The DSH plugin's `package.json` version is kept in
sync by `scripts/release.sh`.

To cut a release:

```sh
scripts/release.sh 0.3.0   # bump, validate CHANGELOG, build, commit, tag
git push origin main --tags
gh release create v0.3.0 --generate-notes
```

See [CHANGELOG.md](CHANGELOG.md) for the release history.

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main`:

| Job | Runner | What it checks |
|---|---|---|
| `dsh-plugin` | ubuntu-latest | `node --check` on every `*.js` module, then `test/board.test.mjs` and `test/machines.test.mjs` |
| `agent-hud` | macos-latest | `agent-hud/build.sh`; `Info.plist` `CFBundleShortVersionString` equals `VERSION`, `CFBundleVersion` equals the commit count; the built binary's `--dump` reports the `VERSION` value as `hudVersion` |

The macOS job needs no Herdr: `--dump --no-remote` prints a board with no agents when the socket is missing.

## Design notes

- [dsh-claude-agents/DESIGN-send-message.md](dsh-claude-agents/DESIGN-send-message.md) —
  why the control plane is Herdr, the message/keys/output route design, auth and
  safety limits, and the remote-machine extension.
- [agent-hud/README.md](agent-hud/README.md) — app internals, layouts, activity
  tracking, jump path, diagnostics.
- [dsh-claude-agents/README.md](dsh-claude-agents/README.md) — plugin routes,
  security model, tests.

## Safety

- Read-only unless you explicitly click send/Enter; approval prompts are never
  answered automatically.
- The DSH routes require the browser session cookie and an Origin/Host fence;
  targets are resolved from a live Herdr snapshot, never supplied by the client.
- Remote machines use Herdr's saved SSH profiles; the app and plugin never read
  or store SSH credentials.
