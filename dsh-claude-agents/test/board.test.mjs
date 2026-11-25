/**
 * Board test: Herdr socket client, the pure merge step, and the HTTP routes.
 *
 * A throwaway `~/.claude` tree and a mock Herdr unix-socket server keep every
 * assertion local; no real agent is contacted or prompted.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { HerdrClient, HerdrError } from '../herdr.js';
import { MachineError } from '../machines.js';
import {
  apply,
  configureMachines,
  mergeBoard,
  piSessionName,
  refreshMachines,
  resetCaches,
  ROUTE_AGENTS,
  ROUTE_KEYS,
  ROUTE_OUTPUT,
  ROUTE_PROMPT,
} from '../index.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-agents-board-test-'));
const livePid = process.pid;
const idlePid = process.ppid;
const alphaSession = 'aaaaaaaa-1111-4111-8111-111111111111';
const betaSession = 'bbbbbbbb-2222-4222-8222-222222222222';

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value));
}

class MockHerdr {
  constructor() {
    this.requests = [];
    this.snapshot = null;
    this.server = null;
    this.path = null;
  }

  async start(dir) {
    this.path = path.join(dir, 'herdr.sock');
    this.server = net.createServer((socket) => {
      let buffer = '';
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        for (;;) {
          const at = buffer.indexOf('\n');
          if (at === -1) break;
          const line = buffer.slice(0, at);
          buffer = buffer.slice(at + 1);
          let request;
          try {
            request = JSON.parse(line);
          } catch {
            continue;
          }
          this.requests.push(request);
          const response = this.respond(request);
          if (response) socket.write(`${JSON.stringify(response)}\n`);
        }
      });
      socket.on('error', () => {});
    });
    await new Promise((resolve) => this.server.listen(this.path, resolve));
  }

  respond(request) {
    const { id, method, params } = request;
    if (method === 'ping') return { id, result: { type: 'pong', version: '0.9.1', protocol: 22 } };
    if (method === 'session.snapshot') return { id, result: { type: 'session_snapshot', snapshot: this.snapshot } };
    if (method === 'agent.prompt') {
      if (params.target === 'err:blocked') return { id, error: { code: 'agent_blocked', message: 'blocked' } };
      return { id, result: { type: 'agent_prompted', agent: { pane_id: params.target } } };
    }
    if (method === 'agent.read') {
      return { id, result: { type: 'pane_read', read: { text: 'line1\nline2', source: 'recent_unwrapped' } } };
    }
    if (method === 'agent.send_keys') return { id, result: { type: 'agent_keys_sent' } };
    if (method === 'slow') return null;
    return { id, error: { code: 'unknown_method', message: `no mock for ${method}` } };
  }

  async stop() {
    if (!this.server) return;
    await new Promise((resolve) => this.server.close(resolve));
    this.server = null;
    try {
      await fs.unlink(this.path);
    } catch {
      // ignore
    }
  }
}

function baseSnapshot() {
  return {
    protocol: 22,
    version: '0.9.1',
    workspaces: [{ workspace_id: 'w1', label: 'ws' }],
    tabs: [
      { tab_id: 'w1:t1', label: 'tab one' },
      { tab_id: 'w1:t2', label: '99' },
    ],
    panes: [],
    agents: [
      {
        pane_id: 'w1:p1',
        agent: 'claude',
        agent_session: { agent: 'claude', kind: 'id', source: 'herdr:claude', value: alphaSession },
        agent_status: 'working',
        cwd: '/work/demo',
        workspace_id: 'w1',
        tab_id: 'w1:t1',
        terminal_title: '✳ alpha',
        terminal_title_stripped: 'alpha',
      },
      {
        pane_id: 'w1:p2',
        agent: 'opencode',
        agent_session: { agent: 'opencode', kind: 'id', source: 'herdr:opencode', value: 'ses_x' },
        agent_status: 'idle',
        cwd: '/work/oc',
        workspace_id: 'w1',
        tab_id: 'w1:t2',
        terminal_title: 'OpenCode',
        terminal_title_stripped: 'OpenCode',
      },
      {
        pane_id: 'w1:p3',
        agent: 'codex',
        agent_session: { agent: 'codex', kind: 'id', source: 'herdr:codex', value: '01a-codex' },
        agent_status: 'blocked',
        cwd: '/work/cx',
        workspace_id: 'w1',
        tab_id: 'w1:t1',
        terminal_title: 'codex-review',
        terminal_title_stripped: 'codex-review',
      },
    ],
  };
}

function makeCtx() {
  const routes = new Map();
  const state = { rejection: undefined };
  const ctx = {
    effect: (fn) => {
      fn();
    },
    webServer: {
      register(spec) {
        routes.set(spec.path, spec.handler);
        return () => {};
      },
    },
    get(name) {
      if (name !== 'connection') return undefined;
      return { requestRejection: () => state.rejection };
    },
  };
  return { ctx, routes, state };
}

async function call(handler, { method = 'GET', url, headers = {}, body } = {}) {
  const req = new PassThrough();
  req.method = method;
  req.url = url;
  req.headers = headers;
  const res = {
    status: 0,
    headers: null,
    body: '',
    writeHead(code, head) {
      this.status = code;
      this.headers = head || {};
    },
    end(chunk) {
      this.body = chunk || '';
    },
  };
  const running = handler(req, res);
  req.end(body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body));
  await running;
  let json = null;
  try {
    json = JSON.parse(res.body);
  } catch {
    json = null;
  }
  return { status: res.status, headers: res.headers, json };
}

const claudeHome = path.join(root, '.claude');
const mock = new MockHerdr();

try {
  // ── fixture: one busy claude session (matched by herdr), one idle (read-only)
  await writeJson(path.join(claudeHome, 'sessions', `${livePid}.json`), {
    pid: livePid,
    sessionId: alphaSession,
    cwd: '/work/demo',
    name: 'alpha',
    status: 'busy',
    kind: 'interactive',
    version: '2.1.322',
    startedAt: Date.now() - 3_600_000,
    updatedAt: Date.now() - 60_000,
  });
  await writeJson(path.join(claudeHome, 'sessions', `${idlePid}.json`), {
    pid: idlePid,
    sessionId: betaSession,
    cwd: '/work/other',
    name: 'beta',
    status: 'idle',
    kind: 'interactive',
    version: '2.1.322',
    startedAt: Date.now() - 7_200_000,
    updatedAt: Date.now() - 3_600_000,
  });
  const transcript = path.join(claudeHome, 'projects', '-work-demo', `${alphaSession}.jsonl`);
  await fs.mkdir(path.dirname(transcript), { recursive: true });
  await fs.writeFile(
    transcript,
    [
      { type: 'api-request', timestamp: new Date(Date.now() - 120_000).toISOString(), params: { model: 'claude-opus-5-5' } },
      { type: 'permission-mode', permissionMode: 'auto' },
      { type: 'last-prompt', lastPrompt: 'hello from the transcript' },
      { type: 'assistant', timestamp: new Date(Date.now() - 30_000).toISOString() },
    ]
      .map((line) => JSON.stringify(line))
      .join('\n'),
  );

  await mock.start(root);
  process.env.DSH_CLAUDE_AGENTS_HOME = claudeHome;
  process.env.HERDR_SOCKET_PATH = mock.path;

  // ── 1. herdr client over the mock socket
  const client = new HerdrClient({ socketPath: mock.path });
  const pong = await client.ping();
  assert.equal(pong.type, 'pong');
  mock.snapshot = baseSnapshot();
  const snapshot = await client.snapshot();
  assert.equal(snapshot.agents.length, 3);
  const prompted = await client.prompt('w1:p1', 'hello world');
  assert.equal(prompted.type, 'agent_prompted');
  await assert.rejects(
    () => client.prompt('err:blocked', 'x'),
    (error) => error instanceof HerdrError && error.code === 'agent_blocked',
  );
  const read = await client.read('w1:p1', { lines: 5 });
  assert.equal(read.read.text, 'line1\nline2');
  await client.sendKeys('w1:p1', ['enter']);
  await assert.rejects(
    () => client.request('slow', {}, { timeoutMs: 120 }),
    (error) => error instanceof HerdrError && error.code === 'timeout',
  );
  const missing = new HerdrClient({ socketPath: path.join(root, 'missing.sock') });
  await assert.rejects(
    () => missing.ping(),
    (error) => error instanceof HerdrError && error.code === 'herdr_unavailable',
  );

  // ── 2. pure merge
  const now = Date.now();
  const merged = mergeBoard({
    claude: {
      sessions: [
        {
          sessionId: alphaSession,
          name: 'alpha',
          status: 'busy',
          kind: 'interactive',
          cwd: '/work/demo',
          pid: livePid,
          version: '2.1.322',
          model: 'claude-opus-5-5',
          permissionMode: 'auto',
          lastPrompt: 'hello from the transcript',
          startedAt: now - 60_000,
          updatedAt: now - 30_000,
          lastActivityAt: now - 20_000,
          tokens: null,
          job: null,
          tasks: null,
        },
        {
          sessionId: betaSession,
          name: 'beta',
          status: 'idle',
          kind: 'interactive',
          cwd: '/work/other',
          pid: idlePid,
          version: '2.1.322',
          model: null,
          permissionMode: null,
          lastPrompt: null,
          startedAt: null,
          updatedAt: null,
          lastActivityAt: null,
          tokens: null,
          job: null,
          tasks: null,
        },
      ],
      notes: [],
    },
    herdr: { available: true, protocol: 22, version: '0.9.1', snapshot: baseSnapshot(), error: null },
    now,
  });

  assert.equal(merged.agents.length, 4);
  assert.deepEqual(merged.counts, {
    total: 4,
    working: 1,
    blocked: 1,
    idle: 2,
    other: 0,
    readOnly: 1,
    claude: 2,
    opencode: 1,
    codex: 1,
    pi: 0,
    remote: 0,
  });
  const [first, second] = merged.agents;
  assert.equal(first.key, 'w1:p3', 'blocked agents sort first');
  assert.equal(first.status, 'blocked');
  assert.equal(first.control.keys, true);
  assert.equal(second.key, 'w1:p1', 'working agents sort next');
  assert.equal(second.model, 'claude-opus-5-5');
  assert.equal(second.permissionMode, 'auto');
  assert.equal(second.lastPrompt, 'hello from the transcript');
  assert.equal(second.control.promptable, true);
  const opencode = merged.agents.find((agent) => agent.key === 'w1:p2');
  assert.equal(opencode.name, 'ws / oc', 'generic titles fall back to workspace/cwd');
  const readOnlyAgent = merged.agents.find((agent) => agent.key === `claude:${betaSession}`);
  assert.equal(readOnlyAgent.control, null);
  assert.equal(readOnlyAgent.status, 'idle');

  // ── 2b. pi titles "π - <session> - <dir>" show only the session name
  assert.equal(piSessionName('litellm额度 - gongchenhao', 'gongchenhao'), 'litellm额度');
  assert.equal(piSessionName('runtime flow - regression - carher-runtime', 'carher-runtime'), 'runtime flow - regression');
  assert.equal(piSessionName('carher-runtime', 'carher-runtime'), '', 'unnamed session falls back');
  assert.equal(piSessionName('custom title', 'carher-runtime'), 'custom title');
  const piBoard = mergeBoard({
    claude: { sessions: [], notes: [] },
    herdr: {
      available: true,
      protocol: 22,
      version: '0.9.5',
      snapshot: {
        workspaces: [{ workspace_id: 'w5', label: 'home' }],
        tabs: [{ tab_id: 'w5:t1', label: '1' }],
        agents: [
          {
            pane_id: 'w5:p1',
            agent: 'pi',
            agent_status: 'idle',
            cwd: '/Users/me/gongchenhao',
            workspace_id: 'w5',
            tab_id: 'w5:t1',
            terminal_title: 'π - litellm额度 - gongchenhao',
            terminal_title_stripped: 'π - litellm额度 - gongchenhao',
          },
          {
            pane_id: 'w5:p2',
            agent: 'pi',
            agent_status: 'idle',
            cwd: '/Users/me/gongchenhao',
            workspace_id: 'w5',
            tab_id: 'w5:t1',
            terminal_title: 'π - gongchenhao',
            terminal_title_stripped: 'π - gongchenhao',
          },
        ],
      },
      error: null,
    },
    now,
  });
  assert.equal(piBoard.agents.find((agent) => agent.key === 'w5:p1').name, 'litellm额度');
  assert.equal(piBoard.agents.find((agent) => agent.key === 'w5:p2').name, 'home / gongchenhao', 'unnamed pi falls back to workspace/cwd');
  assert.equal(piBoard.counts.pi, 2);

  // ── 3. routes
  resetCaches();
  const { ctx, routes, state } = makeCtx();
  // apply() resets the plugin config, so pass the empty machine set through it;
  // otherwise the default machine leaks in and a real `herdr` CLI gets called.
  apply(ctx, { machines: [] });
  configureMachines({ labels: [] });
  assert.ok(routes.has(ROUTE_AGENTS));
  assert.ok(routes.has(ROUTE_PROMPT));
  assert.ok(routes.has(ROUTE_KEYS));
  assert.ok(routes.has(ROUTE_OUTPUT));

  const boardResponse = await call(routes.get(ROUTE_AGENTS), { url: ROUTE_AGENTS });
  assert.equal(boardResponse.status, 200);
  assert.equal(boardResponse.json.ok, true);
  assert.equal(boardResponse.json.herdr.available, true);
  assert.equal(boardResponse.json.counts.total, 4);

  state.rejection = 401;
  const denied = await call(routes.get(ROUTE_AGENTS), { url: ROUTE_AGENTS });
  assert.equal(denied.status, 401);
  assert.equal(denied.json.code, 'unauthorized');
  state.rejection = undefined;

  const sendResult = await call(routes.get(ROUTE_PROMPT), {
    method: 'POST',
    url: ROUTE_PROMPT,
    headers: { 'content-type': 'application/json' },
    body: { key: 'w1:p1', text: 'hello world', sessionId: alphaSession },
  });
  assert.equal(sendResult.status, 200);
  assert.equal(sendResult.json.ok, true);
  const sent = mock.requests[mock.requests.length - 1];
  assert.equal(sent.method, 'agent.prompt');
  assert.deepEqual(sent.params, { target: 'w1:p1', text: 'hello world' });

  const tooLong = await call(routes.get(ROUTE_PROMPT), {
    method: 'POST',
    url: ROUTE_PROMPT,
    headers: { 'content-type': 'application/json' },
    body: { key: 'w1:p1', text: 'x'.repeat(8001) },
  });
  assert.equal(tooLong.status, 400);
  assert.equal(tooLong.json.code, 'invalid_request');

  const unknownTarget = await call(routes.get(ROUTE_PROMPT), {
    method: 'POST',
    url: ROUTE_PROMPT,
    headers: { 'content-type': 'application/json' },
    body: { key: 'w1:pZ', text: 'hello' },
  });
  assert.equal(unknownTarget.status, 404);
  assert.equal(unknownTarget.json.code, 'target_not_found');

  const promptsBefore = mock.requests.filter((request) => request.method === 'agent.prompt').length;
  const blocked = await call(routes.get(ROUTE_PROMPT), {
    method: 'POST',
    url: ROUTE_PROMPT,
    headers: { 'content-type': 'application/json' },
    body: { key: 'w1:p3', text: 'hello' },
  });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.json.code, 'agent_blocked');
  assert.equal(
    mock.requests.filter((request) => request.method === 'agent.prompt').length,
    promptsBefore,
    'a blocked agent is never prompted',
  );

  const changed = await call(routes.get(ROUTE_PROMPT), {
    method: 'POST',
    url: ROUTE_PROMPT,
    headers: { 'content-type': 'application/json' },
    body: { key: 'w1:p1', text: 'hello', sessionId: 'stale-session' },
  });
  assert.equal(changed.status, 409);
  assert.equal(changed.json.code, 'target_changed');

  const readOnlyPrompt = await call(routes.get(ROUTE_PROMPT), {
    method: 'POST',
    url: ROUTE_PROMPT,
    headers: { 'content-type': 'application/json' },
    body: { key: `claude:${betaSession}`, text: 'hello' },
  });
  assert.equal(readOnlyPrompt.status, 409);
  assert.equal(readOnlyPrompt.json.code, 'read_only');

  const keyResult = await call(routes.get(ROUTE_KEYS), {
    method: 'POST',
    url: ROUTE_KEYS,
    headers: { 'content-type': 'application/json' },
    body: { key: 'w1:p3', keys: ['enter'] },
  });
  assert.equal(keyResult.status, 200, 'blocked agents accept explicit keys');
  const keysSent = mock.requests[mock.requests.length - 1];
  assert.equal(keysSent.method, 'agent.send_keys');
  assert.deepEqual(keysSent.params, { target: 'w1:p3', keys: ['enter'] });

  const badKey = await call(routes.get(ROUTE_KEYS), {
    method: 'POST',
    url: ROUTE_KEYS,
    headers: { 'content-type': 'application/json' },
    body: { key: 'w1:p3', keys: ['ctrl+c'] },
  });
  assert.equal(badKey.status, 400);
  assert.equal(badKey.json.code, 'invalid_request');

  const plainText = await call(routes.get(ROUTE_PROMPT), {
    method: 'POST',
    url: ROUTE_PROMPT,
    headers: { 'content-type': 'text/plain' },
    body: 'hi',
  });
  assert.equal(plainText.status, 400);

  const output = await call(routes.get(ROUTE_OUTPUT), { url: `${ROUTE_OUTPUT}?key=w1:p1&lines=40` });
  assert.equal(output.status, 200);
  assert.equal(output.json.text, 'line1\nline2');

  const readOnlyOutput = await call(routes.get(ROUTE_OUTPUT), { url: `${ROUTE_OUTPUT}?key=claude:${betaSession}` });
  assert.equal(readOnlyOutput.status, 409);
  assert.equal(readOnlyOutput.json.code, 'read_only');

  // ── 3b. same display name on two live agents: both rows stay, names disambiguate
  const dupSession = {
    sessionId: 'dddddddd-4444-4444-8444-444444444444',
    name: 'nexus dev',
    nameSource: 'derived',
    status: 'busy',
    kind: 'bg',
    cwd: '/work/dup',
    pid: 7001,
    version: '2.1.322',
    model: null,
    permissionMode: null,
    lastPrompt: null,
    startedAt: now - 600_000,
    updatedAt: now - 600_000,
    lastActivityAt: now - 10 * 24 * 3600 * 1000,
    tokens: null,
    job: null,
    tasks: null,
  };
  const dupBoard = mergeBoard({
    claude: { sessions: [dupSession], notes: [] },
    herdr: {
      available: true,
      protocol: 22,
      version: '0.9.1',
      snapshot: {
        protocol: 22,
        version: '0.9.1',
        workspaces: [],
        tabs: [],
        agents: [
          {
            pane_id: 'w1:p9',
            agent: 'claude',
            agent_session: { agent: 'claude', kind: 'id', value: 'eeeeeeee-5555-4555-8555-555555555555' },
            agent_status: 'working',
            cwd: '/work/dup',
            workspace_id: 'w1',
            tab_id: 'w1:t9',
            terminal_title: '◑ nexus dev',
            terminal_title_stripped: 'nexus dev',
          },
        ],
      },
      error: null,
    },
    now,
  });
  assert.equal(dupBoard.agents.length, 2);
  const paneRow = dupBoard.agents.find((agent) => agent.paneId === 'w1:p9');
  const bgRow = dupBoard.agents.find((agent) => agent.paneId === null);
  assert.equal(paneRow.name, 'nexus dev · w1:p9', 'duplicate names are disambiguated by pane');
  assert.equal(bgRow.name, 'nexus dev · pid 7001', 'duplicate names are disambiguated by pid');
  assert.equal(paneRow.lastActivityAt, null, 'a stale registry timestamp does not claim recent activity');
  assert.equal(bgRow.kind, 'bg');
  assert.equal(bgRow.sessionShort, 'dddddddd');

  // ── 3c. remote Herdr machine: agents merge in and actions forward over the CLI
  const remoteSnapshot = {
    protocol: 22,
    version: '0.9.1',
    workspaces: [{ workspace_id: 'wr', label: 'jms' }],
    tabs: [{ tab_id: 'wr:t1', label: 'remote tab' }],
    agents: [
      {
        pane_id: 'wr:p1',
        agent: 'opencode',
        agent_session: { agent: 'opencode', kind: 'id', value: 'ses_r1' },
        agent_status: 'idle',
        cwd: '/home/cltx',
        workspace_id: 'wr',
        tab_id: 'wr:t1',
        terminal_title: 'OC | jms work',
        terminal_title_stripped: 'OC | jms work',
      },
      {
        pane_id: 'wr:p2',
        agent: 'claude',
        agent_session: { agent: 'claude', kind: 'id', value: 'rrrrrrrr-6666-4666-8666-666666666666' },
        agent_status: 'working',
        cwd: '/home/cltx',
        workspace_id: 'wr',
        tab_id: 'wr:t1',
        terminal_title: 'remote claude',
        terminal_title_stripped: 'remote claude',
      },
    ],
  };
  const remoteCalls = [];
  resetCaches();
  configureMachines({
    labels: ['symbol-150-jms'],
    clientFactory: (label) => ({
      label,
      async snapshot() {
        return remoteSnapshot;
      },
      async prompt(paneId, text) {
        remoteCalls.push({ method: 'prompt', paneId, text });
      },
      async sendKeys(paneId, keys) {
        remoteCalls.push({ method: 'keys', paneId, keys });
      },
      async read(paneId, lines) {
        return `remote output ${paneId} ${lines}`;
      },
    }),
  });
  await refreshMachines();
  const remoteBoard = await call(routes.get(ROUTE_AGENTS), { url: ROUTE_AGENTS });
  assert.equal(remoteBoard.status, 200);
  assert.equal(remoteBoard.json.counts.total, 6);
  assert.equal(remoteBoard.json.counts.remote, 2);
  assert.equal(remoteBoard.json.machines.length, 1);
  assert.equal(remoteBoard.json.machines[0].label, 'symbol-150-jms');
  assert.equal(remoteBoard.json.machines[0].available, true);
  const remoteAgent = remoteBoard.json.agents.find((agent) => agent.key === 'symbol-150-jms::wr:p1');
  assert.ok(remoteAgent, 'remote agents carry a machine-scoped key');
  assert.equal(remoteAgent.machine.label, 'symbol-150-jms');
  assert.equal(remoteAgent.control.promptable, true);

  const remotePrompt = await call(routes.get(ROUTE_PROMPT), {
    method: 'POST',
    url: ROUTE_PROMPT,
    headers: { 'content-type': 'application/json' },
    body: { key: 'symbol-150-jms::wr:p1', text: 'hello jms' },
  });
  assert.equal(remotePrompt.status, 200);
  assert.deepEqual(remoteCalls[0], { method: 'prompt', paneId: 'wr:p1', text: 'hello jms' });

  const remoteKeys = await call(routes.get(ROUTE_KEYS), {
    method: 'POST',
    url: ROUTE_KEYS,
    headers: { 'content-type': 'application/json' },
    body: { key: 'symbol-150-jms::wr:p2', keys: ['enter'] },
  });
  assert.equal(remoteKeys.status, 200);
  assert.deepEqual(remoteCalls[1], { method: 'keys', paneId: 'wr:p2', keys: ['enter'] });

  const remoteOutput = await call(routes.get(ROUTE_OUTPUT), {
    url: `${ROUTE_OUTPUT}?key=${encodeURIComponent('symbol-150-jms::wr:p1')}&lines=40`,
  });
  assert.equal(remoteOutput.status, 200);
  assert.equal(remoteOutput.json.text, 'remote output wr:p1 40');

  // A machine that cannot be reached keeps its label but no agents; actions fail closed.
  resetCaches();
  configureMachines({
    labels: ['symbol-150-jms'],
    clientFactory: (label) => ({
      label,
      async snapshot() {
        throw new MachineError('machine_unreachable', 'ssh: connect timed out');
      },
    }),
  });
  await refreshMachines();
  const offlineBoard = await call(routes.get(ROUTE_AGENTS), { url: ROUTE_AGENTS });
  assert.equal(offlineBoard.status, 200);
  assert.equal(offlineBoard.json.machines[0].available, false);
  assert.equal(offlineBoard.json.machines[0].error.code, 'machine_unreachable');
  const offlineRemote = await call(routes.get(ROUTE_PROMPT), {
    method: 'POST',
    url: ROUTE_PROMPT,
    headers: { 'content-type': 'application/json' },
    body: { key: 'symbol-150-jms::wr:p1', text: 'hello' },
  });
  assert.equal(offlineRemote.status, 503);
  assert.equal(offlineRemote.json.code, 'herdr_unavailable');

  // ── 4. herdr goes away: the board degrades to read-only and sends fail closed
  await mock.stop();
  resetCaches();
  const degraded = await call(routes.get(ROUTE_AGENTS), { url: ROUTE_AGENTS });
  assert.equal(degraded.status, 200);
  assert.equal(degraded.json.herdr.available, false);
  assert.equal(degraded.json.counts.total, 2, 'claude sessions survive as read-only cards');
  assert.equal(degraded.json.counts.readOnly, 2);

  const offlineSend = await call(routes.get(ROUTE_PROMPT), {
    method: 'POST',
    url: ROUTE_PROMPT,
    headers: { 'content-type': 'application/json' },
    body: { key: 'w1:p1', text: 'hello' },
  });
  assert.equal(offlineSend.status, 503);
  assert.equal(offlineSend.json.code, 'herdr_unavailable');

  console.log('board.test.mjs: all assertions passed');
} finally {
  await mock.stop();
  await fs.rm(root, { recursive: true, force: true });
}
