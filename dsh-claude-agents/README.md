# @local/dsh-claude-agents

A DSH sidebar board for every agent running on this machine and on the remote
Herdr machines you attach — Claude Code, OpenCode, and Codex — with live status,
terminal output, and manual message sending.

## What it shows

| Field | Source |
|---|---|
| Local Herdr-managed agents (`claude` / `opencode` / `codex`), pane and workspace labels, `idle\|working\|blocked\|done\|unknown` status | local Herdr unix-socket API |
| Remote agents from attached machines | local Herdr CLI `--machine <label> api snapshot` (15 s cache) |
| Claude session name, model, permission mode, latest prompt, task list, background job / tokens | `~/.claude/sessions/*.json`, `~/.claude/jobs/*/state.json`, `~/.claude/tasks/<sid>/*.json`, transcript tail |
| Claude processes Herdr does not manage | shown read-only |

The page refreshes every 3 seconds, groups agents as **waiting for
confirmation → working → idle → other**, and can filter by agent type and by
machine.

## Remote machines

Remote Herdr machines use the local Herdr server's saved SSH profiles through
`herdr --machine <label> ...`; this plugin never reads or stores SSH
credentials.

- Default machine set: `symbol-150-jms`.
- Override with the plugin row's `machines: [...]` config, or the
  `DSH_CLAUDE_AGENTS_MACHINES` env var (comma separated).
- Remote snapshots are cached for 15 s because one forwarded call costs a few
  seconds on a cold SSH link. Sending a message to a remote agent therefore
  takes a few seconds; the board shows the request in flight.
- Adding `ControlMaster` to `~/.ssh/config` for the machine (and its jump host)
  cuts that from ~6 s to tens of milliseconds; the plugin picks it up
  automatically because Herdr uses the system `ssh`.
- An unreachable machine keeps its chip (marked offline) and never blocks the
  local board.

## Sending messages

Every card backed by a Herdr agent — local or remote — gets a composer:

- **Message** — `agent.prompt` (text + Enter). Works while the agent is
  working; the message queues after its current turn. Agents waiting on a
  confirmation reject prompts.
- **Send Enter / Send Esc** — for blocked agents only, after reading the
  output. This answers whatever the agent is asking, so it requires a second
  explicit confirmation click.
- **Output** — `agent.read` of the last lines of the agent's terminal.

Non-Herdr Claude processes are read-only.

## Routes (all gated by the DSH connection service)

| Route | Purpose |
|---|---|
| `GET  /dsh-plugin-claude-agents/agents.json` | Board snapshot |
| `POST /dsh-plugin-claude-agents/prompt` | `{key, text, sessionId?}` → `agent.prompt` |
| `POST /dsh-plugin-claude-agents/keys` | `{key, keys:["enter"\|"esc"]}` → `agent.send_keys` |
| `GET  /dsh-plugin-claude-agents/output?key=…&lines=…` | `agent.read` |

Local keys are pane ids (`w2:pH`); remote keys are `machine::pane`
(`symbol-150-jms::w1:p5`). Policy: targets are resolved from a live Herdr
snapshot (the browser never invents a pane id), text is capped at 8000
characters / 16 KB bodies, only `enter` and `esc` are accepted as keys, and
sends are rate-limited (1.5–2 s per target, 20 per minute).

## Install into a profile

```sh
dsh plugin --profile desktop add link:/Users/fujindong/Documents/deepseek-harness/default-workspace/dsh-claude-agents
```

Host code changes of a `link:` package need the DSH app to reload the profile
(restart the app, or toggle the bundle in **Settings → Plugins**). Client-only
changes just need a page refresh.

## Test

```sh
node test/board.test.mjs
node test/machines.test.mjs
```

The tests spin up a mock Herdr unix socket, a fake remote-machine runner, and a
throwaway `~/.claude` tree; they never contact or prompt a real agent.
