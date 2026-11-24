# 给「Claude 智能体」看板加发消息能力 — 可行性调查与设计方案

状态：已实现（v0.2.0），待宿主重载后生效
调查日期：2026-11-20

已确认的范围（用户 2026-11-20）：

1. 统一展示 Herdr 全部 agent：Claude / OpenCode / Codex；
2. 支持 blocked agent 的"查看输出 + 发送 Enter / Esc"（二次确认）；
3. working 状态的 agent 允许发送，消息排队；
4. 不做发送历史面板。

## 1. 结论

**可行，控制面是 herdr。** 本机正在运行的 Herdr（`/opt/homebrew/bin/herdr`，server 0.9.1，socket 协议 22）
提供了结构化的 agent 控制 API，其中 `agent.prompt` 可以把一段文本 + Enter 投递到指定 agent 的 pane。

但有两条边界：

- 只能控制 **Herdr 托管 pane 里的 agent**。当前 20 个存活 Claude 进程里，10 个在 Herdr pane 内（可控），
  10 个不在（后台 daemon 或 Herdr 外终端，只读）。
- Claude Code 自己的跨会话 `SendMessage`（`/tmp/cc-socks/<pid>.sock`）是**内部协议**（含 pid/procStart 身份校验、
  `notify_when_idle` 等帧），没有公开 CLI。外部进程硬接等于依赖未公开实现并冒充 peer，**不采用**。

## 2. 调查结果

### 2.1 候选通道对比

| 通道 | 可行性 | 结论 |
|---|---|---|
| **A. Herdr unix socket API** | 已实测通过 | **采用** |
| B. Claude Code 内部 SendMessage(UDS) | 内部协议、需 peer 身份 | 不采用 |
| C. `claude attach` / `--bg --resume` / `logs` | 不是对现有进程实时投递 | 仅作将来"接管会话"备选 |

### 2.2 Herdr socket API（已实测）

- socket：`~/.config/herdr/herdr.sock`（可用 `HERDR_SOCKET_PATH` 覆盖）
- 帧格式：客户端发一行 JSON `{"id":"...","method":"...","params":{...}}\n`；服务端回一行
  `{"id":"...","result":{...}}` 或 `{"id":"...","error":{"code":"...","message":"..."}}`
- `ping` → `{type:"pong", version:"0.9.1", protocol:22, capabilities:{...}}`
- `session.snapshot`（params `{}`）→ 全量快照：workspaces / tabs / panes / **agents**
  - agent 字段：`pane_id`、`agent`（claude/opencode/codex）、`agent_status`
    （`idle|working|blocked|done|unknown`）、`agent_session.value`（= Claude sessionId）、
    `cwd`、`tab_id`、`workspace_id`、`terminal_title` 等
- **`agent.prompt`**：`{target, text, wait?: {until?: AgentStatus[], timeout_ms?: number}}`
  → 成功返回 `{type:"agent_prompted", agent:{...}}`
  - target 可以是 **pane_id**（如 `w5:p8`）或唯一的 live agent name
  - 语义：text + Enter 作为一次有序提交；**agent 处于 blocked（等待审批/提问）时直接拒绝**
    （`agent_blocked`，不发送任何输入）
  - 不跟踪 turn：agent 已在 working 时，提交会排队（Claude Code 自身会排队输入）
- 其他可用方法：
  - `agent.read` `{target, source: visible|recent|recent_unwrapped|detection, lines, format: text|ansi, strip_ansi}`
  - `agent.send_keys` `{target, keys: string[]}`（如 `enter`、`esc`、`ctrl+c`）
  - `agent.wait` `{target, until: AgentStatus[], timeout_ms}`
  - `session.snapshot` 也可用于页面状态的实时补充

### 2.3 覆盖情况（2026-11-20 实测）

- `~/.claude/sessions/*.json` 存活进程：**20**
- Herdr 托管的 Claude agent：**10**（`agent_session.value` 与 `~/.claude` 的 sessionId 一一对应）
- Herdr 之外：**10**（3 个 bg daemon 会话 + 7 个 Herdr 外终端的旧交互会话）→ 只能只读展示
- Herdr 另外还管着 26 个 opencode + 2 个 codex agent（将来可纳入统一 fleet 视图）

注意状态语义不同：`~/.claude` 的 status 是 busy/idle；Herdr 是 idle/working/blocked/done/unknown，
后者更准，页面应以 Herdr 为准、文件扫描作为补充。

## 3. 方案设计

### 3.1 宿主侧（插件 `@local/dsh-claude-agents`）

新增 `herdr.js`：

- socket 路径解析：`HERDR_SOCKET_PATH` → `$XDG_CONFIG_HOME/herdr/herdr.sock` → `~/.config/herdr/herdr.sock`
- 一行 JSON 请求/响应、2s 超时、`ping` 校验 protocol 22；不可用时返回 `herdr_unavailable`
- `snapshot()` 缓存 1.5s；`prompt(target, text)`；错误结构透传

`index.js` 合并数据：

- 现有 `~/.claude` 扫描结果上增加 `control` 字段：
  `{ controllable, target: pane_id, herdrStatus, herdrName }`
- 页面顶部显示 Herdr 状态（连接正常/不可用），不可控的卡标注"只读"

### 3.2 发送接口

```
POST /dsh-plugin-claude-agents/prompt
Content-Type: application/json
{ "sessionId": "...", "text": "..." }
```

处理流程：

1. **鉴权**：`ctx.connection.requestRejection(req)`（Host/Origin fence + 浏览器 cookie）
   - 注意：本插件现有路由**默认没有鉴权**（实测无 cookie 也返回 200），新增接口和现有 GET 都要补上
2. 校验：`Content-Type`、body ≤ 16KB、`text` 1–8000 字符、无 NUL、Origin 若存在须同源
3. 目标解析：只用服务端快照把 `sessionId` 解析成 `pane_id`（客户端不能直传 pane_id）
4. 发送前再取一次快照，确认该 pane 当前 `agent_session.value` 仍等于 sessionId（防 pane 换 agent）
5. 速率限制：每 target ≥ 2s、全局 20 次/分钟
6. 调 `agent.prompt`；返回
   - `{ok:true, target, acceptedAt}`
   - `{ok:false, code, message}`，code：`agent_blocked` / `herdr_unavailable` / `target_stale` /
     `timeout` / `rate_limited` / `invalid_request`
7. 审计：内存环形 50 条（时间、目标名、sessionId、结果码；**不存正文**）

P1 可选接口：

- `GET  /dsh-plugin-claude-agents/output?sessionId=...&lines=80` → `agent.read` recent_unwrapped（弹窗查看）
- `POST /dsh-plugin-claude-agents/keys` `{sessionId, keys}` → `agent.send_keys`（应答 blocked 的确认框，需二次确认）

### 3.3 前端交互

- 每张卡新增「发消息」按钮 → 展开 composer：textarea + 发送（⌘/Ctrl+Enter）+ 取消（Esc）；
  显示目标 agent 名、pane、当前 Herdr 状态
- 状态处理：
  - Herdr 不可用：composer 禁用，顶部 banner，页面仍可只读刷新
  - `blocked`：禁用提交，提示"等待确认中"；P1 提供"查看输出 / 发送 Enter"（二次确认）
  - `working`：允许发送，提示"将排队，当前回合结束后处理"
  - `idle/done`：正常发送
- 发送结果：按钮转圈 → "已投递，等待执行" / 错误码中文提示；
  3 秒轮询会自然看到状态变成 working
- 卡片状态优先显示 Herdr 状态（中文映射：工作中/等待确认/空闲/已完成/未知）

### 3.4 安全与边界

- 所有写接口用 `connection.requestRejection`，GET 也补鉴权
- 服务端白名单解析 target；客户端不能指定任意 pane
- 文本长度/body 上限、速率限制、审计只记元数据
- **不自动应答 blocked 审批**；`send-keys`（Enter）必须显式二次确认并先展示输出上下文
- v1 不做批量/广播/定时发送
- Herdr socket 仅本机当前用户可访问；DSH 进程同用户，天然可用

### 3.5 协议示例（实测帧）

```
→ {"id":"t1","method":"agent.prompt","params":{"target":"w5:p8","text":"..."}}
← {"id":"t1","result":{"type":"agent_prompted","agent":{...}}}
← {"id":"t1","error":{"code":"agent_blocked","message":"agent is waiting for input"}}
```

## 4. 分阶段

| 阶段 | 内容 | 预估 |
|---|---|---|
| **P0** | herdr 客户端 + snapshot 合并 + 鉴权 + POST prompt + 卡片 composer + 错误映射 + 单测（mock socket） | ~半天 |
| **P1** | blocked 处理（read + send_keys 二次确认）、发送历史、Herdr 状态并列显示 | ~半天 |
| **P2** | 统一 fleet 页（opencode/codex 也可发）、消息模板、把 DSH 当唯一控制台 | 待定 |

P0 全部在现有插件内完成（不新增 profile 安装），刷新页面即生效。

## 5. 测试计划

- 单测：JSON 帧、错误映射、参数校验、速率限制；用临时 unix socket 服务器 mock herdr
- 联调：对 1 个用户指定的空闲 agent 发一条无害消息（不自动测试用户的 agent）
- GUI：刷新页面验证 composer 与错误路径（可临时停 herdr server 模拟 503）

## 6. 待确认

1. 范围：只做 Claude agent，还是把 Herdr 里的 opencode/codex 也纳入统一视图？
2. blocked 的 agent 是否要支持"看输出 + 发 Enter"（有审批风险，需二次确认）？
3. 对 `working` 的 agent 允许"发送即排队"，还是只允许 idle/done 时发送？
4. 是否需要"发送历史"面板？

## 7. 实现状态（v0.2.0）

- `herdr.js`：Herdr unix-socket 客户端（`ping` / `session.snapshot` / `agent.prompt` /
  `agent.read` / `agent.send_keys`），一行 JSON 帧、超时与错误码映射。
- `index.js`：`~/.claude` 扫描 + Herdr 快照合并成统一 board；
  - `GET  /dsh-plugin-claude-agents/agents.json`
  - `POST /dsh-plugin-claude-agents/prompt`
  - `POST /dsh-plugin-claude-agents/keys`（仅 `enter` / `esc`）
  - `GET  /dsh-plugin-claude-agents/output`
  - 所有路由经 `ctx.connection.requestRejection()`（Host/Origin fence + cookie）；
    目标由服务端快照解析；文本 ≤ 8000 字符、body ≤ 16KB；每 target 1.5–2s、全局 20/min 限速。
- `client.js`：类型筛选、按状态分组（等待确认 → 工作中 → 空闲 → 其他）、
  卡片内 composer、blocked 的 Enter/Esc 二次确认、输出弹窗、Herdr 不可用降级为只读。
- `test/board.test.mjs`：mock Herdr socket + 临时 `~/.claude`，覆盖客户端、合并与全部路由
  （含鉴权、越权/只读、速率与输入校验、Herdr 掉线降级）；不接触真实 agent。

联调注意：`link:` 插件的**宿主代码**变更需要 DSH 应用重载 profile（重启 App，或在
设置→插件里关/开该 bundle）；仅 client 变更刷新页面即可。

## 8. 远端 Herdr 机器（v0.3）

- 传输：本机 Herdr 已保存的 SSH machine profile，通过 `herdr --machine <label> ...`
  转发；插件不读取、不保存 SSH 凭据。
- 范围：默认只接 `symbol-150-jms`（`machines` 配置或 `DSH_CLAUDE_AGENTS_MACHINES` 可改）。
- 拉取：`herdr --machine <label> api snapshot`，15 秒缓存 + 后台刷新，不阻塞本地看板；
  agent key 使用 `machine::pane` 前缀避免与本地 pane id 冲突。
- 控制：prompt / send-keys / read 都走同一 `--machine` 前缀，规则与本地一致
  （鉴权、白名单、输入上限、限速、blocked 二次确认）。
- 降级：机器不可达时保留机器条目并标"离线"，本地看板照常工作。
- 性能：冷 SSH 链路一次调用约 6s；加 `ControlMaster`（机器 + 跳板机）可降到几十毫秒，
  插件无需改动（Herdr 使用系统 ssh）。
- 验证：远端 `api snapshot` / `agent read` 实测通过；prompt/send-keys 只用不存在的目标
  验证错误路径，未向远端真实 agent 发送过消息。
