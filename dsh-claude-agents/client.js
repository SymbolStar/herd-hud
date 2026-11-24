window.__ModuleLoader__.load({
  id: '@local/dsh-claude-agents',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'dsh-claude-agents';
    const ENDPOINT = '/dsh-plugin-claude-agents/agents.json';
    const PROMPT_ENDPOINT = '/dsh-plugin-claude-agents/prompt';
    const KEYS_ENDPOINT = '/dsh-plugin-claude-agents/keys';
    const OUTPUT_ENDPOINT = '/dsh-plugin-claude-agents/output';
    const REFRESH_MS = 3000;

    let t = (key) => key;

    const ZH = {
      'nav.label': 'Agents',
      'page.title': '智能体看板',
      'page.subtitle': '本机 Herdr + Claude Code 的全部 agent · 每 3 秒刷新',
      'action.refresh': '刷新',
      'action.retry': '重试',
      'action.updated': '更新于',
      'state.loading': '正在读取本机 agent 状态…',
      'state.refreshing': '读取中…',
      'state.error': '读取失败',
      'state.empty': '没有检测到正在运行的 agent。',
      'herdr.unavailable': 'Herdr 未连接：页面只读，无法发送消息。',
      'filter.label': '类型',
      'filter.machine': '机器',
      'filter.all': '全部',
      'filter.claude': 'Claude',
      'filter.opencode': 'OpenCode',
      'filter.codex': 'Codex',
      'filter.local': '本机',
      'machine.offline': '离线',
      'machine.loading': '加载中',
      'summary.total': '共',
      'summary.working': '工作中',
      'summary.blocked': '等待确认',
      'summary.idle': '空闲',
      'summary.other': '其他',
      'summary.readOnly': '只读',
      'section.blocked': '等待确认',
      'section.working': '工作中',
      'section.idle': '空闲',
      'section.other': '其他',
      'status.working': '工作中',
      'status.blocked': '等待确认',
      'status.idle': '空闲',
      'status.done': '已完成',
      'status.unknown': '未知',
      'type.claude': 'Claude',
      'type.opencode': 'OpenCode',
      'type.codex': 'Codex',
      'kind.bg': '后台',
      'kind.interactive': '交互',
      'label.readOnly': '只读',
      'label.lastActive': '最近活动',
      'label.permission': '权限',
      'label.tasks': '任务',
      'action.message': '发消息',
      'action.send': '发送',
      'action.cancel': '取消',
      'action.output': '查看输出',
      'action.close': '关闭',
      'action.sendEnter': '发送 Enter',
      'action.sendEsc': '发送 Esc',
      'action.confirmSend': '确认发送',
      'confirm.keys': '确认向该 agent 发送按键？这会应答它当前的提问。',
      'compose.placeholder': '给该 agent 发送消息…（⌘/Ctrl+Enter 发送，Esc 取消）',
      'compose.hintWorking': 'Agent 正在执行，消息会在当前回合结束后排队处理。',
      'compose.hintRemote': '远端机器，发送需要几秒钟。',
      'compose.hintBlocked': 'Agent 正在等待确认：先查看输出，再决定发送 Enter 还是 Esc。',
      'send.sent': '已投递',
      'send.failed': '发送失败',
      'output.title': '终端输出',
      'output.loading': '读取中…',
      'output.error': '读取失败',
      'output.empty': '没有可显示的输出。',
      'output.note': '只读取该 agent 终端最近输出，不含完整对话历史。',
      'time.justNow': '刚刚',
      'time.minutes': ' 分钟前',
      'time.hours': ' 小时前',
      'time.days': ' 天前',
      'foot.note': '状态来自本机 Herdr 快照与 ~/.claude；发送操作只在卡片上手动触发，不会自动代答审批。',
      'err.agentBlocked': '该 agent 正在等待确认，请先查看输出并发送按键。',
      'err.rateLimited': '发送太频繁，请稍后重试。',
      'err.targetNotFound': '目标 agent 已不存在，请刷新页面。',
      'err.targetChanged': '该面板上的 agent 已经换了，请刷新页面。',
      'err.herdrUnavailable': 'Herdr 不可用，无法发送。',
      'err.timeout': 'Herdr 响应超时。',
      'err.readOnly': '该 agent 只读，无法发送。',
      'err.unauthorized': '会话未认证，请刷新 DSH 页面。',
      'err.invalid': '请求无效。',
    };

    const EN = {
      'nav.label': 'Agents',
      'page.title': 'Agent board',
      'page.subtitle': 'Every agent on this machine via Herdr + Claude Code · refreshes every 3s',
      'action.refresh': 'Refresh',
      'action.retry': 'Retry',
      'action.updated': 'Updated',
      'state.loading': 'Reading local agent state…',
      'state.refreshing': 'Refreshing…',
      'state.error': 'Read failed',
      'state.empty': 'No running agent was found.',
      'herdr.unavailable': 'Herdr is not connected: the board is read-only and cannot send messages.',
      'filter.label': 'Type',
      'filter.machine': 'Machine',
      'filter.all': 'All',
      'filter.claude': 'Claude',
      'filter.opencode': 'OpenCode',
      'filter.codex': 'Codex',
      'filter.local': 'Local',
      'machine.offline': 'offline',
      'machine.loading': 'loading',
      'summary.total': 'Total',
      'summary.working': 'Working',
      'summary.blocked': 'Waiting',
      'summary.idle': 'Idle',
      'summary.other': 'Other',
      'summary.readOnly': 'Read-only',
      'section.blocked': 'Waiting for confirmation',
      'section.working': 'Working',
      'section.idle': 'Idle',
      'section.other': 'Other',
      'status.working': 'working',
      'status.blocked': 'waiting',
      'status.idle': 'idle',
      'status.done': 'done',
      'status.unknown': 'unknown',
      'type.claude': 'Claude',
      'type.opencode': 'OpenCode',
      'type.codex': 'Codex',
      'kind.bg': 'bg',
      'kind.interactive': 'interactive',
      'label.readOnly': 'read-only',
      'label.lastActive': 'active',
      'label.permission': 'perm',
      'label.tasks': 'tasks',
      'action.message': 'Message',
      'action.send': 'Send',
      'action.cancel': 'Cancel',
      'action.output': 'Output',
      'action.close': 'Close',
      'action.sendEnter': 'Send Enter',
      'action.sendEsc': 'Send Esc',
      'action.confirmSend': 'Confirm',
      'confirm.keys': 'Send this key to the agent? It answers whatever the agent is asking.',
      'compose.placeholder': 'Message this agent… (⌘/Ctrl+Enter to send, Esc to cancel)',
      'compose.hintWorking': 'The agent is working; this message will queue after the current turn.',
      'compose.hintRemote': 'Remote machine: sending takes a few seconds.',
      'compose.hintBlocked': 'The agent is waiting for confirmation: read the output, then choose Enter or Esc.',
      'send.sent': 'Sent',
      'send.failed': 'Send failed',
      'output.title': 'Terminal output',
      'output.loading': 'Reading…',
      'output.error': 'Read failed',
      'output.empty': 'No output available.',
      'output.note': 'Recent terminal output only; this is not the full conversation.',
      'time.justNow': 'just now',
      'time.minutes': 'm ago',
      'time.hours': 'h ago',
      'time.days': 'd ago',
      'foot.note': 'State comes from the local Herdr snapshot and ~/.claude. Sending is manual per card and never auto-answers an approval.',
      'err.agentBlocked': 'The agent is waiting for confirmation; read its output and answer with a key first.',
      'err.rateLimited': 'Sending too fast; wait a moment.',
      'err.targetNotFound': 'That agent is gone; refresh the board.',
      'err.targetChanged': 'The pane now hosts another agent; refresh the board.',
      'err.herdrUnavailable': 'Herdr is unavailable; nothing was sent.',
      'err.timeout': 'Herdr timed out.',
      'err.readOnly': 'That agent is read-only.',
      'err.unauthorized': 'Session is not authenticated; reload the DSH page.',
      'err.invalid': 'Invalid request.',
    };

    const CSS = `
.dca-page { min-height: 100%; height: 100%; overflow: auto; box-sizing: border-box;
  padding: calc(var(--dsh-frame-top-clearance, 0px) + 24px) 32px 48px;
  padding-left: calc(var(--dsh-frame-leading-clearance, 0px) + 32px);
  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); }
.dca-wrap { max-width: 980px; margin: 0 auto; }
.dca-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.dca-title { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -0.01em; }
.dca-sub { margin-top: 6px; font-size: 13px; color: var(--dsw-alias-label-secondary); }
.dca-actions { display: flex; align-items: center; gap: 10px; flex: none; }
.dca-updated, .dca-pending { font-size: 12px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.dca-btn { appearance: none; border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  border-radius: 8px; font: inherit; font-size: 12px; padding: 6px 12px; cursor: pointer; }
.dca-btn:hover { background: var(--dsw-alias-bg-layer-2); }
.dca-btn:disabled { opacity: 0.55; cursor: default; }
.dca-btn[data-primary='true'] { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-primary); font-weight: 600; }
.dca-btn[data-danger='true'] { color: var(--dsw-alias-state-warn-primary); border-color: var(--dsw-alias-state-warn-primary); }
.dca-loading, .dca-empty { margin-top: 20px; font-size: 13px; color: var(--dsw-alias-label-secondary); }
.dca-banner { margin-top: 16px; font-size: 13px; border-radius: 8px; padding: 8px 12px;
  color: var(--dsw-alias-state-warn-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent); }
.dca-error { margin-top: 16px; display: flex; align-items: center; gap: 12px; font-size: 13px;
  color: var(--dsw-alias-state-error-primary); }
.dca-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 16px; }
.dca-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12px;
  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1);
  border-radius: 999px; padding: 4px 10px; color: var(--dsw-alias-label-secondary); }
.dca-chip b { color: var(--dsw-alias-label-primary); font-weight: 600; font-variant-numeric: tabular-nums; }
.dca-chip[data-active='true'] { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.dca-chip[data-clickable='true'] { cursor: pointer; }
.dca-chip[data-clickable='true']:hover { background: var(--dsw-alias-bg-layer-2); }
.dca-divider { width: 1px; height: 16px; background: var(--dsw-alias-border-l1); margin: 0 2px; }
.dca-section { margin-top: 22px; }
.dca-section-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 10px; }
.dca-section-title { font-size: 13px; font-weight: 600; }
.dca-section-count { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dca-list { display: flex; flex-direction: column; gap: 10px; }
.dca-card { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 12px; padding: 13px 15px; }
.dca-card[data-status='working'] { border-color: var(--dsw-alias-state-success-primary); }
.dca-card[data-status='blocked'] { border-color: var(--dsw-alias-state-warn-primary); }
.dca-row { display: flex; align-items: center; gap: 9px; min-width: 0; }
.dca-dot { width: 8px; height: 8px; border-radius: 999px; flex: none; background: var(--dsw-alias-state-idle-primary); }
.dca-dot[data-status='working'] { background: var(--dsw-alias-state-success-primary); animation: dca-pulse 1.6s ease-in-out infinite; }
.dca-dot[data-status='blocked'] { background: var(--dsw-alias-state-warn-primary); animation: dca-pulse 1.2s ease-in-out infinite; }
@keyframes dca-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
.dca-name { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dca-badge { flex: none; font-size: 11px; line-height: 1; padding: 3px 7px; border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); }
.dca-badge[data-type='claude'] { color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }
.dca-badge[data-type='opencode'] { color: var(--dsw-alias-state-success-primary); border-color: var(--dsw-alias-state-success-primary); }
.dca-badge[data-type='codex'] { color: var(--dsw-alias-state-warn-primary); border-color: var(--dsw-alias-state-warn-primary); }
.dca-badge[data-muted='true'] { opacity: 0.7; }
.dca-status { flex: none; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dca-status[data-status='working'] { color: var(--dsw-alias-state-success-primary); }
.dca-status[data-status='blocked'] { color: var(--dsw-alias-state-warn-primary); }
.dca-spacer { flex: 1 1 auto; }
.dca-activity { flex: none; font-size: 12px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.dca-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px;
  margin-top: 9px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dca-cwd { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.dca-dim { opacity: 0.65; }
.dca-model { font-size: 11px; padding: 2px 7px; border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums; }
.dca-task { margin-top: 9px; font-size: 13px; }
.dca-task-prefix { color: var(--dsw-alias-label-secondary); }
.dca-prompt { margin-top: 8px; font-size: 12px; line-height: 1.55; color: var(--dsw-alias-label-secondary);
  overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.dca-actions-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 10px; }
.dca-result { font-size: 12px; }
.dca-result[data-ok='true'] { color: var(--dsw-alias-state-success-primary); }
.dca-result[data-ok='false'] { color: var(--dsw-alias-state-error-primary); }
.dca-hint { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dca-compose { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
.dca-compose textarea { width: 100%; box-sizing: border-box; resize: vertical; min-height: 70px;
  border-radius: 10px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 1.5; padding: 9px 11px; }
.dca-compose textarea:focus { outline: none; border-color: var(--dsw-alias-brand-primary); }
.dca-compose-actions { display: flex; align-items: center; gap: 8px; }
.dca-confirm { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 10px;
  border-radius: 8px; padding: 8px 10px; font-size: 12px;
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent);
  color: var(--dsw-alias-state-warn-primary); }
.dca-foot-note { margin-top: 26px; font-size: 12px; color: var(--dsw-alias-label-secondary); line-height: 1.6; }
.dca-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.45); z-index: 60;
  display: flex; align-items: center; justify-content: center; padding: 24px; }
.dca-modal { width: min(820px, 100%); max-height: 80vh; display: flex; flex-direction: column;
  background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 14px; box-shadow: 0 18px 48px rgba(0, 0, 0, 0.35); overflow: hidden; }
.dca-modal-head { display: flex; align-items: center; gap: 10px; padding: 12px 16px;
  border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dca-modal-title { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dca-modal-body { padding: 12px 16px; overflow: auto; }
.dca-pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-primary); }
.dca-modal-note { margin-top: 10px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
`;

    // ── helpers ───────────────────────────────────────────────────────────

    function formatClock(ts) {
      const date = new Date(ts || Date.now());
      try {
        return date.toLocaleTimeString([], { hour12: false });
      } catch {
        return date.toISOString().slice(11, 19);
      }
    }

    function formatRelative(ts, now) {
      if (!ts) return null;
      const diff = Math.max(0, now - ts);
      if (diff < 45_000) return t('time.justNow');
      const minutes = Math.floor(diff / 60_000);
      if (minutes < 60) return `${minutes}${t('time.minutes')}`;
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return `${hours}${t('time.hours')}`;
      return `${Math.floor(hours / 24)}${t('time.days')}`;
    }

    function formatCompact(value) {
      const number = Number(value) || 0;
      if (number >= 1e9) return `${(number / 1e9).toFixed(1)}B`;
      if (number >= 1e6) return `${(number / 1e6).toFixed(1)}M`;
      if (number >= 1e3) return `${(number / 1e3).toFixed(1)}k`;
      return String(Math.round(number));
    }

    /**
     * Two live agents can legitimately carry the same display name (a renamed
     * background session vs. a pane whose live title says the same thing).
     * Append the pane id or pid only when a name actually repeats.
     */
    function buildDisplayNames(agents) {
      const counts = new Map();
      for (const agent of agents) counts.set(agent.name || '—', (counts.get(agent.name || '—') || 0) + 1);
      const names = new Map();
      for (const agent of agents) {
        const name = agent.name || '—';
        let display = name;
        if (counts.get(name) > 1) {
          const suffix = agent.paneId
            || (agent.pid ? `pid ${agent.pid}` : (agent.sessionShort || (agent.sessionId || '').slice(0, 8)));
          if (suffix) display = `${name} · ${suffix}`;
        }
        names.set(agent.key, display);
      }
      return names;
    }

    function errorLabel(error) {
      const known = {
        agent_blocked: 'err.agentBlocked',
        rate_limited: 'err.rateLimited',
        target_not_found: 'err.targetNotFound',
        target_changed: 'err.targetChanged',
        herdr_unavailable: 'err.herdrUnavailable',
        timeout: 'err.timeout',
        read_only: 'err.readOnly',
        unauthorized: 'err.unauthorized',
        invalid_request: 'err.invalid',
      };
      const key = error && error.code ? known[error.code] : null;
      if (key) return t(key);
      return (error && error.message) || String(error);
    }

    async function postJson(url, body) {
      const response = await fetch(url, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload || payload.ok !== true) {
        const failure = new Error((payload && payload.message) || `HTTP ${response.status}`);
        failure.code = payload && payload.code ? payload.code : 'invalid_request';
        throw failure;
      }
      return payload;
    }

    // ── components ────────────────────────────────────────────────────────

    function AgentsIcon(props) {
      const size = typeof props.size === 'number' && props.size > 0 ? props.size : 20;
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          'aria-hidden': true,
          style: { display: 'block', pointerEvents: 'none' },
        },
        h('path', { d: 'M12 3.3v3.2M9.4 2.8h5.2', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
        h('rect', { x: 3.7, y: 6.7, width: 16.6, height: 12, rx: 3.8, stroke: 'currentColor', strokeWidth: 1.7 }),
        h('circle', { cx: 9.1, cy: 12.7, r: 1.3, fill: 'currentColor' }),
        h('circle', { cx: 14.9, cy: 12.7, r: 1.3, fill: 'currentColor' }),
        h('path', { d: 'M9.4 16.2h5.2', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeOpacity: 0.6 }),
      );
    }

    function Chip(props) {
      return h(
        'span',
        {
          className: 'dca-chip',
          'data-active': props.active ? 'true' : 'false',
          'data-clickable': props.onClick ? 'true' : 'false',
          onClick: props.onClick || undefined,
          role: props.onClick ? 'button' : undefined,
          tabIndex: props.onClick ? 0 : undefined,
        },
        props.label,
        ' ',
        h('b', null, String(props.value)),
      );
    }

    function TypeBadge(props) {
      const labelKey = { claude: 'type.claude', opencode: 'type.opencode', codex: 'type.codex' }[props.type];
      return h('span', { className: 'dca-badge', 'data-type': props.type }, t(labelKey || 'type.claude'));
    }

    function StatusText(props) {
      const labelKey = {
        working: 'status.working',
        blocked: 'status.blocked',
        idle: 'status.idle',
        done: 'status.done',
        unknown: 'status.unknown',
      }[props.status];
      return h('span', { className: 'dca-status', 'data-status': props.status }, t(labelKey || 'status.unknown'));
    }

    function Card(props) {
      const { agent, now, expanded, sending, result, onToggleCompose, onSend, composerText, setComposerText,
        onOpenOutput, keysConfirm, onAskKeys, onCancelKeys, onSendKey } = props;
      const control = agent.control;
      const blocked = agent.status === 'blocked';
      const working = agent.status === 'working';
      const staleWorking = agent.status === 'working' && agent.lastActivityAt && now - agent.lastActivityAt > 24 * 60 * 60 * 1000;
      const relative = staleWorking ? null : formatRelative(agent.lastActivityAt, now);
      const tasks = agent.tasks;

      return h(
        'div',
        { className: 'dca-card', 'data-status': agent.status },
        h(
          'div',
          { className: 'dca-row' },
          h('span', { className: 'dca-dot', 'data-status': agent.status }),
          h('span', { className: 'dca-name', title: agent.name || '' }, agent.name || '—'),
          h(TypeBadge, { type: agent.type }),
          agent.machine ? h('span', { className: 'dca-badge', 'data-muted': 'true' }, agent.machine.label) : null,
          agent.kind && (agent.kind === 'bg' || agent.source === 'claude')
            ? h('span', { className: 'dca-badge', 'data-muted': 'true' },
                agent.kind === 'bg' ? t('kind.bg') : t('kind.interactive'))
            : null,
          h(StatusText, { status: agent.status }),
          control ? null : h('span', { className: 'dca-badge', 'data-muted': 'true' }, t('label.readOnly')),
          h('span', { className: 'dca-spacer' }),
          relative ? h('span', { className: 'dca-activity' }, `${t('label.lastActive')} ${relative}`) : null,
        ),
        h(
          'div',
          { className: 'dca-meta' },
          agent.cwd ? h('span', { className: 'dca-cwd', title: agent.cwd }, agent.cwd) : null,
          agent.workspaceLabel ? h('span', null, `${agent.workspaceLabel}${agent.tabLabel ? ` / ${agent.tabLabel}` : ''}`) : null,
          agent.paneId ? h('span', null, agent.paneId) : null,
          agent.model ? h('span', { className: 'dca-model' }, agent.model) : null,
          agent.permissionMode ? h('span', null, `${t('label.permission')} ${agent.permissionMode}`) : null,
          agent.tokens ? h('span', null, `tokens ${formatCompact(agent.tokens)}`) : null,
          agent.sessionShort || agent.sessionId
            ? h('span', { className: 'dca-dim' }, `session ${agent.sessionShort || String(agent.sessionId).slice(0, 8)}`)
            : null,
          agent.pid ? h('span', null, `pid ${agent.pid}`) : null,
        ),
        tasks && Array.isArray(tasks.current) && tasks.current.length > 0
          ? h('div', { className: 'dca-task' }, h('span', { className: 'dca-task-prefix' }, '▸ '), tasks.current.join(' · '))
          : null,
        agent.lastPrompt
          ? h('div', { className: 'dca-prompt', title: agent.lastPrompt }, `“${agent.lastPrompt}”`)
          : null,
        control
          ? h(
              'div',
              { className: 'dca-actions-row' },
              blocked
                ? h(
                    'span',
                    { className: 'dca-hint' },
                    h('button', { type: 'button', className: 'dca-btn', onClick: () => onOpenOutput(agent) }, t('action.output')),
                    ' ',
                    h('button', { type: 'button', className: 'dca-btn', 'data-primary': 'true', onClick: () => onAskKeys(agent, 'enter') }, t('action.sendEnter')),
                    ' ',
                    h('button', { type: 'button', className: 'dca-btn', onClick: () => onAskKeys(agent, 'esc') }, t('action.sendEsc')),
                  )
                : h(
                    React.Fragment,
                    null,
                    h(
                      'button',
                      { type: 'button', className: 'dca-btn', 'data-primary': expanded ? 'false' : 'true', onClick: () => onToggleCompose(agent) },
                      t('action.message'),
                    ),
                    h('button', { type: 'button', className: 'dca-btn', onClick: () => onOpenOutput(agent) }, t('action.output')),
                  ),
              result
                ? h(
                    'span',
                    { className: 'dca-result', 'data-ok': result.ok ? 'true' : 'false' },
                    result.ok ? `${t('send.sent')} ${formatClock(result.at)}` : `${t('send.failed')}: ${result.message}`,
                  )
                : null,
            )
          : h('div', { className: 'dca-actions-row' }, h('span', { className: 'dca-hint' }, t('label.readOnly'))),
        keysConfirm && keysConfirm.key === agent.key
          ? h(
              'div',
              { className: 'dca-confirm' },
              h('span', null, `${t('confirm.keys')} [${keysConfirm.press === 'enter' ? 'Enter' : 'Esc'}]`),
              h('button', { type: 'button', className: 'dca-btn', 'data-danger': 'true', onClick: () => onSendKey(agent, keysConfirm.press) }, t('action.confirmSend')),
              h('button', { type: 'button', className: 'dca-btn', onClick: onCancelKeys }, t('action.cancel')),
            )
          : null,
        expanded
          ? h(
              'div',
              { className: 'dca-compose' },
              h('textarea', {
                value: composerText,
                placeholder: t('compose.placeholder'),
                onChange: (event) => setComposerText(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    onToggleCompose(null);
                    return;
                  }
                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                    event.preventDefault();
                    onSend(agent);
                  }
                },
              }),
              h(
                'div',
                { className: 'dca-compose-actions' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dca-btn',
                    'data-primary': 'true',
                    disabled: sending || !composerText.trim(),
                    onClick: () => onSend(agent),
                  },
                  sending ? t('state.refreshing') : t('action.send'),
                ),
                h('button', { type: 'button', className: 'dca-btn', onClick: () => onToggleCompose(null) }, t('action.cancel')),
                working ? h('span', { className: 'dca-hint' }, t('compose.hintWorking')) : null,
                agent.machine ? h('span', { className: 'dca-hint' }, t('compose.hintRemote')) : null,
              ),
            )
          : null,
      );
    }

    function OutputModal(props) {
      const state = props.state;
      return h(
        'div',
        { className: 'dca-overlay', onClick: props.onClose },
        h(
          'div',
          { className: 'dca-modal', onClick: (event) => event.stopPropagation() },
          h(
            'div',
            { className: 'dca-modal-head' },
            h('span', { className: 'dca-modal-title' }, `${t('output.title')} · ${state.name || state.key}`),
            h('span', { className: 'dca-spacer' }),
            h('button', { type: 'button', className: 'dca-btn', onClick: props.onRefresh }, t('action.refresh')),
            h('button', { type: 'button', className: 'dca-btn', onClick: props.onClose }, t('action.close')),
          ),
          h(
            'div',
            { className: 'dca-modal-body' },
            state.phase === 'loading'
              ? h('div', { className: 'dca-hint' }, t('output.loading'))
              : state.phase === 'error'
                ? h('div', { className: 'dca-error' }, `${t('output.error')}: ${state.error}`)
                : h(
                    React.Fragment,
                    null,
                    h('pre', { className: 'dca-pre' }, state.text || t('output.empty')),
                    h('div', { className: 'dca-modal-note' }, t('output.note')),
                  ),
          ),
        ),
      );
    }

    // ── panel ─────────────────────────────────────────────────────────────

    function AgentsPanel() {
      const [data, setData] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [pending, setPending] = React.useState(false);
      const [now, setNow] = React.useState(() => Date.now());
      const [typeFilter, setTypeFilter] = React.useState('all');
      const [machineFilter, setMachineFilter] = React.useState('all');
      const [composerKey, setComposerKey] = React.useState(null);
      const [composerText, setComposerText] = React.useState('');
      const [sendingKey, setSendingKey] = React.useState(null);
      const [sendResults, setSendResults] = React.useState({});
      const [keysConfirm, setKeysConfirm] = React.useState(null);
      const [outputState, setOutputState] = React.useState(null);
      const mounted = React.useRef(true);
      const inFlight = React.useRef(false);

      const load = React.useCallback(async () => {
        if (inFlight.current) return;
        inFlight.current = true;
        setPending(true);
        try {
          const response = await fetch(ENDPOINT, { cache: 'no-store', headers: { accept: 'application/json' } });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const payload = await response.json();
          if (!mounted.current) return;
          setData(payload);
          setError(null);
        } catch (failure) {
          if (!mounted.current) return;
          setError(failure && failure.message ? String(failure.message) : String(failure));
        } finally {
          inFlight.current = false;
          if (mounted.current) {
            setPending(false);
            setNow(Date.now());
          }
        }
      }, []);

      React.useEffect(() => {
        mounted.current = true;
        const tick = () => {
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
          load();
        };
        tick();
        const timer = window.setInterval(tick, REFRESH_MS);
        const onVisible = () => {
          if (document.visibilityState === 'visible') load();
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
          mounted.current = false;
          window.clearInterval(timer);
          document.removeEventListener('visibilitychange', onVisible);
        };
      }, [load]);

      const openOutput = React.useCallback(async (agent) => {
        setOutputState({ key: agent.key, name: agent.name, phase: 'loading', text: '', error: null });
        try {
          const response = await fetch(
            `${OUTPUT_ENDPOINT}?key=${encodeURIComponent(agent.key)}&lines=160`,
            { cache: 'no-store', headers: { accept: 'application/json' } },
          );
          const payload = await response.json().catch(() => null);
          if (!response.ok || !payload || payload.ok !== true) {
            const failure = new Error((payload && payload.message) || `HTTP ${response.status}`);
            failure.code = payload && payload.code;
            throw failure;
          }
          if (!mounted.current) return;
          setOutputState({ key: agent.key, name: agent.name, phase: 'ready', text: payload.text, error: null });
        } catch (failure) {
          if (!mounted.current) return;
          setOutputState({ key: agent.key, name: agent.name, phase: 'error', text: '', error: errorLabel(failure) });
        }
      }, []);

      const sendPrompt = React.useCallback(
        async (agent) => {
          const text = composerText.trim();
          if (!text || sendingKey) return;
          setSendingKey(agent.key);
          setSendResults((previous) => ({ ...previous, [agent.key]: null }));
          try {
            const payload = await postJson(PROMPT_ENDPOINT, {
              key: agent.key,
              text,
              sessionId: agent.sessionId || null,
              type: agent.type,
            });
            if (!mounted.current) return;
            setSendResults((previous) => ({
              ...previous,
              [agent.key]: { ok: true, at: payload.acceptedAt || Date.now() },
            }));
            setComposerKey(null);
            setComposerText('');
            load();
          } catch (failure) {
            if (!mounted.current) return;
            setSendResults((previous) => ({
              ...previous,
              [agent.key]: { ok: false, message: errorLabel(failure), at: Date.now() },
            }));
          } finally {
            if (mounted.current) setSendingKey(null);
          }
        },
        [composerText, sendingKey, load],
      );

      const sendKey = React.useCallback(
        async (agent, press) => {
          setKeysConfirm(null);
          setSendResults((previous) => ({ ...previous, [agent.key]: null }));
          try {
            await postJson(KEYS_ENDPOINT, { key: agent.key, keys: [press] });
            if (!mounted.current) return;
            setSendResults((previous) => ({ ...previous, [agent.key]: { ok: true, at: Date.now() } }));
            load();
          } catch (failure) {
            if (!mounted.current) return;
            setSendResults((previous) => ({
              ...previous,
              [agent.key]: { ok: false, message: errorLabel(failure), at: Date.now() },
            }));
          }
        },
        [load],
      );

      const agents = data && Array.isArray(data.agents) ? data.agents : [];
      const displayNames = buildDisplayNames(agents);
      const named = agents.map((agent) => ({ ...agent, name: displayNames.get(agent.key) || agent.name }));
      const machineKey = (agent) => (agent.machine && agent.machine.label ? agent.machine.label : 'local');
      const machineCounts = new Map();
      for (const agent of named) machineCounts.set(machineKey(agent), (machineCounts.get(machineKey(agent)) || 0) + 1);
      const machineOptions = (data && Array.isArray(data.machines) ? data.machines : []).map((machine) => ({
        label: machine.label,
        available: machine.available !== false,
        offline: Boolean(machine.error),
        loading: !machine.available && !machine.error,
        count: machineCounts.get(machine.label) || 0,
      }));
      const visible = named
        .filter((agent) => typeFilter === 'all' || agent.type === typeFilter)
        .filter((agent) => {
          if (machineFilter === 'all') return true;
          if (machineFilter === 'local') return !agent.machine;
          return agent.machine && agent.machine.label === machineFilter;
        });
      const groups = {
        blocked: visible.filter((agent) => agent.status === 'blocked'),
        working: visible.filter((agent) => agent.status === 'working'),
        idle: visible.filter((agent) => agent.status === 'idle'),
        other: visible.filter((agent) => !['blocked', 'working', 'idle'].includes(agent.status)),
      };
      const counts = (data && data.counts) || {};
      const herdr = (data && data.herdr) || null;
      const renderSection = (statusKey, titleKey) => {
        const list = groups[statusKey];
        if (!list || list.length === 0) return null;
        return h(
          'section',
          { className: 'dca-section' },
          h(
            'div',
            { className: 'dca-section-head' },
            h('span', { className: 'dca-section-title' }, t(titleKey)),
            h('span', { className: 'dca-section-count' }, String(list.length)),
          ),
          h(
            'div',
            { className: 'dca-list' },
            list.map((agent) =>
              h(Card, {
                key: agent.key,
                agent,
                now,
                expanded: composerKey === agent.key,
                sending: sendingKey === agent.key,
                result: sendResults[agent.key] || null,
                composerText: composerKey === agent.key ? composerText : '',
                setComposerText,
                onToggleCompose: (target) => {
                  if (!target) {
                    setComposerKey(null);
                    setComposerText('');
                    return;
                  }
                  setComposerKey((previous) => (previous === target.key ? null : target.key));
                  setComposerText('');
                  setKeysConfirm(null);
                },
                onSend: sendPrompt,
                onOpenOutput: openOutput,
                keysConfirm,
                onAskKeys: (target, press) => setKeysConfirm({ key: target.key, press }),
                onCancelKeys: () => setKeysConfirm(null),
                onSendKey: sendKey,
              }),
            ),
          ),
        );
      };

      return h(
        'div',
        { className: 'dca-page' },
        h('style', null, CSS),
        h(
          'div',
          { className: 'dca-wrap' },
          h(
            'div',
            { className: 'dca-head' },
            h(
              'div',
              null,
              h('h1', { className: 'dca-title' }, t('page.title')),
              h('div', { className: 'dca-sub' }, t('page.subtitle')),
            ),
            h(
              'div',
              { className: 'dca-actions' },
              pending ? h('span', { className: 'dca-pending' }, t('state.refreshing')) : null,
              data ? h('span', { className: 'dca-updated' }, `${t('action.updated')} ${formatClock(data.generatedAt || now)}`) : null,
              h('button', { type: 'button', className: 'dca-btn', onClick: load, disabled: pending }, t('action.refresh')),
            ),
          ),
          !data && !error ? h('div', { className: 'dca-loading' }, t('state.loading')) : null,
          error
            ? h(
                'div',
                { className: 'dca-error' },
                h('span', null, `${t('state.error')}: ${error}`),
                h('button', { type: 'button', className: 'dca-btn', onClick: load }, t('action.retry')),
              )
            : null,
          herdr && herdr.available === false
            ? h('div', { className: 'dca-banner' }, `${t('herdr.unavailable')}${herdr.error ? ` (${herdr.error.message})` : ''}`)
            : null,
          data
            ? h(
                React.Fragment,
                null,
                h(
                  'div',
                  { className: 'dca-chips' },
                  h(Chip, { label: t('summary.total'), value: counts.total || 0 }),
                  h(Chip, { label: t('summary.working'), value: counts.working || 0 }),
                  h(Chip, { label: t('summary.blocked'), value: counts.blocked || 0 }),
                  h(Chip, { label: t('summary.idle'), value: counts.idle || 0 }),
                  h(Chip, { label: t('summary.other'), value: counts.other || 0 }),
                  h(Chip, { label: t('summary.readOnly'), value: counts.readOnly || 0 }),
                ),
                h(
                  'div',
                  { className: 'dca-chips' },
                  h('span', { className: 'dca-hint' }, t('filter.label')),
                  h(Chip, { label: t('filter.all'), value: counts.total || 0, active: typeFilter === 'all', onClick: () => setTypeFilter('all') }),
                  h(Chip, { label: t('filter.claude'), value: counts.claude || 0, active: typeFilter === 'claude', onClick: () => setTypeFilter('claude') }),
                  h(Chip, { label: t('filter.opencode'), value: counts.opencode || 0, active: typeFilter === 'opencode', onClick: () => setTypeFilter('opencode') }),
                  h(Chip, { label: t('filter.codex'), value: counts.codex || 0, active: typeFilter === 'codex', onClick: () => setTypeFilter('codex') }),
                ),
                machineOptions.length > 0
                  ? h(
                      'div',
                      { className: 'dca-chips' },
                      h('span', { className: 'dca-hint' }, t('filter.machine')),
                      h(Chip, { label: t('filter.all'), value: counts.total || 0, active: machineFilter === 'all', onClick: () => setMachineFilter('all') }),
                      h(Chip, { label: t('filter.local'), value: machineCounts.get('local') || 0, active: machineFilter === 'local', onClick: () => setMachineFilter('local') }),
                      ...machineOptions.map((machine) =>
                        h(Chip, {
                          key: machine.label,
                          label: machine.offline
                            ? `${machine.label} (${t('machine.offline')})`
                            : machine.loading
                              ? `${machine.label} (${t('machine.loading')})`
                              : machine.label,
                          value: machine.count,
                          active: machineFilter === machine.label,
                          onClick: () => setMachineFilter(machine.label),
                        }),
                      ),
                    )
                  : null,
                visible.length === 0 ? h('div', { className: 'dca-empty' }, t('state.empty')) : null,
              )
            : null,
          data ? renderSection('blocked', 'section.blocked') : null,
          data ? renderSection('working', 'section.working') : null,
          data ? renderSection('idle', 'section.idle') : null,
          data ? renderSection('other', 'section.other') : null,
          data ? h('div', { className: 'dca-foot-note' }, t('foot.note')) : null,
        ),
        outputState
          ? h(OutputModal, {
              state: outputState,
              onClose: () => setOutputState(null),
              onRefresh: () => {
                const agent = agents.find((candidate) => candidate.key === outputState.key);
                if (agent) openOutput(agent);
              },
            })
          : null,
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        t = ctx.locale.bind(NS);
        ctx.effect(() => ctx.locale.register(NS, 'zh', ZH), 'claude-agents: zh dictionary');
        ctx.effect(() => ctx.locale.register(NS, 'en', EN), 'claude-agents: en dictionary');
        ctx.effect(
          () =>
            ctx.slots.inject('sidebar.panellist', () =>
              ctx.slots.register(
                { name: 'sidebar.panellist', id: 'claude-agents', order: 21, label: () => t('nav.label') },
                AgentsIcon,
              ),
            ),
          'claude-agents: sidebar entry',
        );
        ctx.effect(
          () =>
            ctx.slots.inject('main', () =>
              ctx.slots.register({ name: 'main', key: 'claude-agents' }, AgentsPanel),
            ),
          'claude-agents: main panel',
        );
      },
    };
  },
});
