/**
 * Host half of the DSH "Agents" plugin.
 *
 * Two read planes and one control plane, merged into one board:
 *   ~/.claude/...        every live Claude Code process (status, model, tasks, prompt)
 *   herdr socket API     every agent Herdr manages (claude / opencode / codex) plus
 *                        pane ids, richer live state, and the prompt/keys/read controls
 *
 * Read-only for Claude processes: nothing here writes to or signals them. The only
 * mutating operations are explicit HTTP calls from the board UI, and each one is
 * authenticated through the DSH connection service and resolved against a live Herdr
 * snapshot (a client never sends a raw pane id it invented).
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { HerdrClient, HerdrError, HERDR_PROTOCOL, herdrSocketPath, herdrSocketExists } from './herdr.js';
import { MachineClient, MachineError, listMachines, DEFAULT_MACHINE_LABELS } from './machines.js';

export const ROUTE_AGENTS = '/dsh-plugin-claude-agents/agents.json';
export const ROUTE_PROMPT = '/dsh-plugin-claude-agents/prompt';
export const ROUTE_KEYS = '/dsh-plugin-claude-agents/keys';
export const ROUTE_OUTPUT = '/dsh-plugin-claude-agents/output';

export const inject = ['webServer'];

const HERDR_CACHE_MS = 1200;
const SNAPSHOT_TAIL_MS = 1000;
const TRANSCRIPT_TAIL_BYTES = 1024 * 1024;
const TRANSCRIPT_CACHE_LIMIT = 300;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_TEXT_CHARS = 8000;
const MAX_KEY_LEN = 200;
const MAX_AGENTS = 200;
const ALLOWED_KEYS = new Set(['enter', 'esc']);
const MACHINE_REFRESH_MS = 15_000;
const MACHINE_INIT_RETRY_MS = 60_000;

let pluginConfig = {};
let machineFactory = null;
let machineInitAt = 0;
let machineInitError = null;
const machineClients = new Map();
const machineCache = new Map();

const transcriptCache = new Map();
let boardCache = null;
let boardAt = 0;
let boardInFlight = null;
let herdrCache = null;
let herdrAt = 0;
let herdrInFlight = null;

export function defaultClaudeHome() {
  return process.env.DSH_CLAUDE_AGENTS_HOME || path.join(os.homedir(), '.claude');
}

export function resetCaches() {
  boardCache = null;
  boardAt = 0;
  boardInFlight = null;
  herdrCache = null;
  herdrAt = 0;
  herdrInFlight = null;
  transcriptCache.clear();
  machineClients.clear();
  machineCache.clear();
  machineInitAt = 0;
  machineInitError = null;
}

// ── plugin wiring ──────────────────────────────────────────────────────────

export function apply(ctx, config) {
  pluginConfig = config && typeof config === 'object' ? config : {};
  register(ctx, ROUTE_AGENTS, serveAgents);
  register(ctx, ROUTE_PROMPT, servePrompt);
  register(ctx, ROUTE_KEYS, serveKeys);
  register(ctx, ROUTE_OUTPUT, serveOutput);
}

function register(ctx, routePath, handler) {
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: routePath,
        handler: (req, res) => handler(ctx, req, res),
      }),
    `claude-agents: ${routePath} route`,
  );
}

// ── HTTP helpers ───────────────────────────────────────────────────────────

/**
 * Gate a request through the DSH connection service (Host/Origin fence plus the
 * browser-session cookie). Plugin routes are not gated by the platform itself, so
 * every route here calls this first.
 */
function rejectUnauthorized(ctx, req, res) {
  const connection = safeGet(ctx, 'connection');
  if (!connection || typeof connection.requestRejection !== 'function') {
    writeJson(res, 503, { ok: false, code: 'auth-unavailable', message: 'DSH connection service is unavailable' });
    return true;
  }
  let rejection;
  try {
    rejection = connection.requestRejection(req);
  } catch {
    rejection = 401;
  }
  if (rejection === undefined) return false;
  writeJson(res, rejection, { ok: false, code: 'unauthorized', message: 'DSH web authentication required' });
  return true;
}

function writeJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function methodNotAllowed(res, methods) {
  res.writeHead(405, { allow: methods.join(', '), 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: false, code: 'method-not-allowed' }));
}

async function readJsonBody(req) {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    throw new RequestError('invalid_request', 'content-type must be application/json');
  }
  const declared = Number(req.headers['content-length'] || 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new RequestError('invalid_request', 'request body is too large', 413);
  }
  const chunks = [];
  let size = 0;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new RequestError('invalid_request', 'request body timed out')), 5000);
    const done = (fn, value) => {
      clearTimeout(timer);
      fn(value);
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        done(reject, new RequestError('invalid_request', 'request body is too large', 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => done(resolve));
    req.on('error', (error) => done(reject, new RequestError('invalid_request', String(error && error.message))));
  });
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) throw new RequestError('invalid_request', 'request body is empty');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new RequestError('invalid_request', 'request body is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new RequestError('invalid_request', 'request body must be a JSON object');
  }
  return parsed;
}

class RequestError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'RequestError';
    this.code = code;
    this.status = status;
  }
}

class RateLimiter {
  constructor({ perTargetMs, globalPerMinute }) {
    this.perTargetMs = perTargetMs;
    this.globalPerMinute = globalPerMinute;
    this.targets = new Map();
    this.global = [];
  }

  check(target) {
    const now = Date.now();
    this.global = this.global.filter((at) => now - at < 60_000);
    const last = this.targets.get(target);
    if (last !== undefined && now - last < this.perTargetMs) {
      return { ok: false, retryAfterMs: this.perTargetMs - (now - last) };
    }
    if (this.global.length >= this.globalPerMinute) {
      return { ok: false, retryAfterMs: 60_000 - (now - this.global[0]) };
    }
    return { ok: true };
  }

  record(target) {
    const now = Date.now();
    this.targets.set(target, now);
    this.global.push(now);
    if (this.targets.size > 400) {
      for (const [key, at] of this.targets) if (now - at > 600_000) this.targets.delete(key);
    }
  }
}

const promptLimiter = new RateLimiter({ perTargetMs: 1500, globalPerMinute: 20 });
const keysLimiter = new RateLimiter({ perTargetMs: 2000, globalPerMinute: 20 });

// ── routes ─────────────────────────────────────────────────────────────────

async function serveAgents(ctx, req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return methodNotAllowed(res, ['GET', 'HEAD']);
  if (rejectUnauthorized(ctx, req, res)) return;
  try {
    writeJson(res, 200, await currentBoard());
  } catch (error) {
    console.error('claude-agents: board failed', error);
    writeJson(res, 500, { ok: false, code: 'internal', message: String((error && error.message) || error) });
  }
}

async function servePrompt(ctx, req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  if (rejectUnauthorized(ctx, req, res)) return;
  try {
    const body = await readJsonBody(req);
    const key = validateKey(body.key);
    const text = validateText(body.text);
    const expectedSessionId = typeof body.sessionId === 'string' && body.sessionId ? body.sessionId : null;
    if (key.startsWith('claude:')) return writeReadOnly(res);
    const target = splitKey(key);
    if (target.machine) {
      return await serveRemotePrompt(res, { key, machineLabel: target.machine, paneId: target.paneId, text, expectedSessionId });
    }

    const herdr = await readHerdr({ force: true });
    if (!herdr.available) return writeHerdrUnavailable(res, herdr);

    const agent = findHerdrAgent(herdr.snapshot, target.paneId);
    if (!agent) return writeJson(res, 404, { ok: false, code: 'target_not_found', message: `agent ${key} is not live` });
    const currentSession = agent.agent === 'claude' ? agent.agent_session?.value : null;
    if (expectedSessionId && currentSession && currentSession !== expectedSessionId) {
      return writeJson(res, 409, {
        ok: false,
        code: 'target_changed',
        message: 'the pane now hosts a different agent session; refresh the board',
      });
    }
    if (agent.agent_status === 'blocked') {
      return writeJson(res, 409, {
        ok: false,
        code: 'agent_blocked',
        message: 'the agent is waiting for confirmation; read its output and answer with a key first',
      });
    }

    const gate = promptLimiter.check(key);
    if (!gate.ok) {
      return writeJson(res, 429, {
        ok: false,
        code: 'rate_limited',
        message: 'sending too fast; wait a moment',
        retryAfterMs: Math.max(0, Math.round(gate.retryAfterMs)),
      });
    }

    const client = new HerdrClient();
    await client.prompt(key, text);
    promptLimiter.record(key);
    writeJson(res, 200, {
      ok: true,
      key,
      name: agentName(agent, herdr.snapshot),
      acceptedAt: Date.now(),
    });
  } catch (error) {
    writeRouteError(res, error);
  }
}

async function serveKeys(ctx, req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  if (rejectUnauthorized(ctx, req, res)) return;
  try {
    const body = await readJsonBody(req);
    const key = validateKey(body.key);
    const keys = validateKeys(body.keys);
    if (key.startsWith('claude:')) return writeReadOnly(res);
    const target = splitKey(key);
    if (target.machine) {
      return await serveRemoteKeys(res, { key, machineLabel: target.machine, paneId: target.paneId, keys });
    }

    const herdr = await readHerdr({ force: true });
    if (!herdr.available) return writeHerdrUnavailable(res, herdr);
    const agent = findHerdrAgent(herdr.snapshot, target.paneId);
    if (!agent) return writeJson(res, 404, { ok: false, code: 'target_not_found', message: `agent ${key} is not live` });

    const gate = keysLimiter.check(key);
    if (!gate.ok) {
      return writeJson(res, 429, {
        ok: false,
        code: 'rate_limited',
        message: 'sending too fast; wait a moment',
        retryAfterMs: Math.max(0, Math.round(gate.retryAfterMs)),
      });
    }

    const client = new HerdrClient();
    await client.sendKeys(target.paneId, keys);
    keysLimiter.record(key);
    writeJson(res, 200, { ok: true, key, keys, name: agentName(agent, herdr.snapshot), acceptedAt: Date.now() });
  } catch (error) {
    writeRouteError(res, error);
  }
}

async function serveOutput(ctx, req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return methodNotAllowed(res, ['GET', 'HEAD']);
  if (rejectUnauthorized(ctx, req, res)) return;
  try {
    const url = new URL(req.url || '/', 'http://local');
    const key = validateKey(url.searchParams.get('key'));
    const lines = clamp(Number(url.searchParams.get('lines') || 120), 10, 400);
    if (key.startsWith('claude:')) return writeReadOnly(res);
    const target = splitKey(key);
    if (target.machine) {
      return await serveRemoteOutput(res, { key, machineLabel: target.machine, paneId: target.paneId, lines });
    }

    const herdr = await readHerdr();
    if (!herdr.available) return writeHerdrUnavailable(res, herdr);
    const agent = findHerdrAgent(herdr.snapshot, target.paneId);
    if (!agent) return writeJson(res, 404, { ok: false, code: 'target_not_found', message: `agent ${key} is not live` });

    const client = new HerdrClient();
    const result = await client.read(target.paneId, { lines });
    const read = result && result.read ? result.read : {};
    writeJson(res, 200, {
      ok: true,
      key,
      name: agentName(agent, herdr.snapshot),
      source: read.source || 'recent_unwrapped',
      lines,
      text: typeof read.text === 'string' ? read.text : '',
    });
  } catch (error) {
    writeRouteError(res, error);
  }
}

function splitKey(key) {
  const at = key.indexOf('::');
  if (at === -1) return { machine: null, paneId: key };
  return { machine: key.slice(0, at), paneId: key.slice(at + 2) };
}

function remoteAgentFor(machineLabel, paneId) {
  const view = machineViewCached(machineLabel);
  if (!view.snapshot) return { view, error: 'unavailable' };
  const agent = findHerdrAgent(view.snapshot, paneId);
  if (!agent) return { view, error: 'target_not_found' };
  return { view, agent };
}

function writeRemoteUnavailable(res, machineLabel) {
  writeJson(res, 503, {
    ok: false,
    code: 'herdr_unavailable',
    message: `machine ${machineLabel} snapshot is not available yet`,
  });
}

async function serveRemotePrompt(res, { key, machineLabel, paneId, text, expectedSessionId }) {
  const { view, agent, error } = remoteAgentFor(machineLabel, paneId);
  if (error === 'unavailable') return writeRemoteUnavailable(res, machineLabel);
  if (error) return writeJson(res, 404, { ok: false, code: 'target_not_found', message: `agent ${paneId} is not live on ${machineLabel}` });
  const currentSession = agent.agent === 'claude' ? agent.agent_session?.value : null;
  if (expectedSessionId && currentSession && currentSession !== expectedSessionId) {
    return writeJson(res, 409, { ok: false, code: 'target_changed', message: 'the pane now hosts a different agent session; refresh the board' });
  }
  if (agent.agent_status === 'blocked') {
    return writeJson(res, 409, {
      ok: false,
      code: 'agent_blocked',
      message: 'the agent is waiting for confirmation; read its output and answer with a key first',
    });
  }
  const gate = promptLimiter.check(key);
  if (!gate.ok) {
    return writeJson(res, 429, {
      ok: false,
      code: 'rate_limited',
      message: 'sending too fast; wait a moment',
      retryAfterMs: Math.max(0, Math.round(gate.retryAfterMs)),
    });
  }
  await machineClientFor(machineLabel).prompt(paneId, text);
  promptLimiter.record(key);
  void refreshMachine(machineClientFor(machineLabel));
  writeJson(res, 200, { ok: true, key, name: agentName(agent, view.snapshot), acceptedAt: Date.now() });
}

async function serveRemoteKeys(res, { key, machineLabel, paneId, keys }) {
  const { view, agent, error } = remoteAgentFor(machineLabel, paneId);
  if (error === 'unavailable') return writeRemoteUnavailable(res, machineLabel);
  if (error) return writeJson(res, 404, { ok: false, code: 'target_not_found', message: `agent ${paneId} is not live on ${machineLabel}` });
  const gate = keysLimiter.check(key);
  if (!gate.ok) {
    return writeJson(res, 429, {
      ok: false,
      code: 'rate_limited',
      message: 'sending too fast; wait a moment',
      retryAfterMs: Math.max(0, Math.round(gate.retryAfterMs)),
    });
  }
  await machineClientFor(machineLabel).sendKeys(paneId, keys);
  keysLimiter.record(key);
  void refreshMachine(machineClientFor(machineLabel));
  writeJson(res, 200, { ok: true, key, keys, name: agentName(agent, view.snapshot), acceptedAt: Date.now() });
}

async function serveRemoteOutput(res, { key, machineLabel, paneId, lines }) {
  const { view, agent, error } = remoteAgentFor(machineLabel, paneId);
  if (error === 'unavailable') return writeRemoteUnavailable(res, machineLabel);
  if (error) return writeJson(res, 404, { ok: false, code: 'target_not_found', message: `agent ${paneId} is not live on ${machineLabel}` });
  const text = await machineClientFor(machineLabel).read(paneId, lines);
  writeJson(res, 200, {
    ok: true,
    key,
    name: agentName(agent, view.snapshot),
    source: 'recent_unwrapped',
    lines,
    text: String(text || ''),
  });
}

function writeReadOnly(res) {
  writeJson(res, 409, { ok: false, code: 'read_only', message: 'this agent is read-only; it is not managed by Herdr' });
}

function writeHerdrUnavailable(res, herdr) {
  writeJson(res, 503, {
    ok: false,
    code: 'herdr_unavailable',
    message: (herdr && herdr.error && herdr.error.message) || 'Herdr is not reachable',
  });
}

function writeRouteError(res, error) {
  if (error instanceof RequestError) {
    writeJson(res, error.status, { ok: false, code: error.code, message: error.message });
    return;
  }
  if (error instanceof HerdrError || error instanceof MachineError) {
    const mapping = {
      agent_not_found: 404,
      agent_blocked: 409,
      timeout: 504,
      herdr_unavailable: 503,
      machine_unreachable: 503,
      machine_not_found: 404,
      'bad-response': 502,
      herdr_cli_error: 502,
    };
    writeJson(res, mapping[error.code] || 502, { ok: false, code: error.code, message: error.message });
    return;
  }
  console.error('claude-agents: route failed', error);
  writeJson(res, 500, { ok: false, code: 'internal', message: String((error && error.message) || error) });
}

function validateKey(value) {
  if (typeof value !== 'string') throw new RequestError('invalid_request', 'key is required');
  const key = value.trim();
  if (!key || key.length > MAX_KEY_LEN) throw new RequestError('invalid_request', 'key is invalid');
  return key;
}

function validateText(value) {
  if (typeof value !== 'string') throw new RequestError('invalid_request', 'text is required');
  const text = value.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  if (text.includes('\u0000')) throw new RequestError('invalid_request', 'text contains a NUL byte');
  const trimmed = text.trim();
  if (!trimmed) throw new RequestError('invalid_request', 'text is empty');
  if (trimmed.length > MAX_TEXT_CHARS) {
    throw new RequestError('invalid_request', `text is longer than ${MAX_TEXT_CHARS} characters`);
  }
  return text;
}

function validateKeys(value) {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? [value] : null;
  if (!list || list.length === 0 || list.length > 4) {
    throw new RequestError('invalid_request', 'keys must be a non-empty array of at most 4 logical keys');
  }
  const keys = [];
  for (const raw of list) {
    if (typeof raw !== 'string' || !ALLOWED_KEYS.has(raw)) {
      throw new RequestError('invalid_request', `unsupported key; allowed: ${[...ALLOWED_KEYS].join(', ')}`);
    }
    keys.push(raw);
  }
  return keys;
}

// ── board assembly ─────────────────────────────────────────────────────────

async function currentBoard() {
  const now = Date.now();
  if (boardCache && now - boardAt < SNAPSHOT_TAIL_MS) return boardCache;
  if (boardInFlight) return boardInFlight;
  void ensureMachines();
  boardInFlight = scanBoard({ machines: machinesView() })
    .then((board) => {
      boardCache = board;
      boardAt = Date.now();
      return board;
    })
    .finally(() => {
      boardInFlight = null;
    });
  return boardInFlight;
}

/** Full board: Claude file state + live Herdr snapshot merged into one agent list. */
export async function scanBoard({ claudeHome, now, alive, herdr, machines } = {}) {
  const at = typeof now === 'number' ? now : Date.now();
  const home = claudeHome || defaultClaudeHome();
  const claude = await scanClaudeState(home, { now: at, alive });
  const herdrData = herdr || (await readHerdr());
  return mergeBoard({ claude, herdr: herdrData, machines, now: at });
}

/**
 * Pure merge step, exported for tests.
 *
 * @param {object} options
 * @param {{sessions: object[], notes: string[]}} options.claude
 * @param {{available: boolean, protocol?: number, version?: string, snapshot?: object, error?: object|null}} options.herdr
 * @param {Array<{label: string, available: boolean, snapshot?: object|null}>} [options.machines]
 * @param {number} options.now
 */
export function mergeBoard({ claude, herdr, machines, now }) {
  const sessions = Array.isArray(claude && claude.sessions) ? claude.sessions : [];
  const claudeBySession = new Map(sessions.map((session) => [session.sessionId, session]));

  const snapshot = herdr && herdr.available && herdr.snapshot ? herdr.snapshot : null;
  const workspaceLabels = new Map();
  const tabLabels = new Map();
  if (snapshot) {
    for (const workspace of snapshot.workspaces || []) workspaceLabels.set(workspace.workspace_id, workspace.label);
    for (const tab of snapshot.tabs || []) tabLabels.set(tab.tab_id, tab.label);
  }

  const agents = [];
  const covered = new Set();

  if (snapshot) {
    for (const agent of snapshot.agents || []) {
      const type = typeof agent.agent === 'string' ? agent.agent : 'unknown';
      const sessionId = type === 'claude' ? agent.agent_session?.value || null : null;
      const session = sessionId ? claudeBySession.get(sessionId) || null : null;
      if (sessionId) covered.add(sessionId);
      const workspaceLabel = workspaceLabels.get(agent.workspace_id) || null;
      const tabLabel = tabLabels.get(agent.tab_id) || null;
      const fields = claudeFields(session);
      // The live Herdr status outranks a stale Claude registry timestamp: a pid
      // file that has not moved for over a day would read as "last active days
      // ago" while the pane is visibly working.
      if (fields.lastActivityAt && now - fields.lastActivityAt > 24 * 60 * 60 * 1000) fields.lastActivityAt = null;
      agents.push({
        key: agent.pane_id,
        type,
        name: preferClaudeName(session, herdrAgentName(agent, workspaceLabel, tabLabel)),
        status: normalizeStatus(agent.agent_status),
        statusRaw: typeof agent.agent_status === 'string' ? agent.agent_status : 'unknown',
        source: 'herdr',
        cwd: typeof agent.cwd === 'string' ? agent.cwd : null,
        paneId: agent.pane_id,
        workspaceId: agent.workspace_id || null,
        workspaceLabel,
        tabId: agent.tab_id || null,
        tabLabel,
        terminalTitle: agent.terminal_title_stripped || agent.terminal_title || null,
        sessionId,
        ...fields,
        machine: null,
        control: { promptable: true, keys: true, readable: true },
      });
    }
  }

  for (const session of sessions) {
    if (covered.has(session.sessionId)) continue;
    agents.push({
      key: `claude:${session.sessionId}`,
      type: 'claude',
      name: claudeName(session) || `claude-${session.pid || session.sessionId.slice(0, 8)}`,
      status: session.status === 'busy' ? 'working' : 'idle',
      statusRaw: session.status === 'busy' ? 'busy' : 'idle',
      source: 'claude',
      cwd: session.cwd || null,
      paneId: null,
      workspaceId: null,
      workspaceLabel: null,
      tabId: null,
      tabLabel: null,
      terminalTitle: null,
      sessionId: session.sessionId,
      ...claudeFields(session),
      machine: null,
      control: null,
    });
  }

  for (const machine of Array.isArray(machines) ? machines : []) {
    const remoteSnapshot = machine && machine.snapshot;
    if (!remoteSnapshot) continue;
    const remoteWorkspaceLabels = new Map(
      (remoteSnapshot.workspaces || []).map((workspace) => [workspace.workspace_id, workspace.label]),
    );
    const remoteTabLabels = new Map((remoteSnapshot.tabs || []).map((tab) => [tab.tab_id, tab.label]));
    for (const agent of remoteSnapshot.agents || []) {
      const type = typeof agent.agent === 'string' ? agent.agent : 'unknown';
      const sessionId = type === 'claude' ? agent.agent_session?.value || null : null;
      const workspaceLabel = remoteWorkspaceLabels.get(agent.workspace_id) || null;
      const tabLabel = remoteTabLabels.get(agent.tab_id) || null;
      agents.push({
        key: `${machine.label}::${agent.pane_id}`,
        type,
        name: herdrAgentName(agent, workspaceLabel, tabLabel),
        status: normalizeStatus(agent.agent_status),
        statusRaw: typeof agent.agent_status === 'string' ? agent.agent_status : 'unknown',
        source: 'herdr',
        cwd: typeof agent.cwd === 'string' ? agent.cwd : null,
        paneId: agent.pane_id,
        workspaceId: agent.workspace_id || null,
        workspaceLabel,
        tabId: agent.tab_id || null,
        tabLabel,
        terminalTitle: agent.terminal_title_stripped || agent.terminal_title || null,
        sessionId,
        ...claudeFields(null),
        sessionShort: sessionId ? String(sessionId).slice(0, 8) : null,
        machine: { label: machine.label, remote: true },
        control: { promptable: true, keys: true, readable: true },
      });
    }
  }

  agents.sort(compareAgents);
  disambiguateNames(agents);

  const counts = {
    total: agents.length,
    working: agents.filter((agent) => agent.status === 'working').length,
    blocked: agents.filter((agent) => agent.status === 'blocked').length,
    idle: agents.filter((agent) => agent.status === 'idle').length,
    other: agents.filter((agent) => agent.status !== 'working' && agent.status !== 'blocked' && agent.status !== 'idle').length,
    readOnly: agents.filter((agent) => !agent.control).length,
  };
  counts.claude = agents.filter((agent) => agent.type === 'claude').length;
  counts.opencode = agents.filter((agent) => agent.type === 'opencode').length;
  counts.codex = agents.filter((agent) => agent.type === 'codex').length;
  counts.remote = agents.filter((agent) => Boolean(agent.machine)).length;

  return {
    ok: true,
    generatedAt: now,
    source: 'herdr+claude',
    herdr: {
      available: Boolean(herdr && herdr.available),
      version: (herdr && herdr.version) || null,
      protocol: (herdr && herdr.protocol) || null,
      supportedProtocol: HERDR_PROTOCOL,
      error: (herdr && herdr.error) || null,
    },
    machines: (Array.isArray(machines) ? machines : []).map((machine) => ({
      label: machine.label,
      available: Boolean(machine.available),
      loading: Boolean(machine.loading),
      updatedAt: machine.updatedAt || null,
      error: machine.error || null,
      agentCount: machine.agentCount || 0,
    })),
    counts,
    agents: agents.slice(0, MAX_AGENTS),
    notes: Array.isArray(claude && claude.notes) ? claude.notes : [],
  };
}

/**
 * Two live agents can legitimately carry the same name (a renamed background
 * session and a pane whose live terminal title says the same thing). Keep both
 * rows but make the names unique with the pane id or pid they belong to.
 */
function disambiguateNames(agents) {
  const seen = new Map();
  for (const agent of agents) seen.set(agent.name, (seen.get(agent.name) || 0) + 1);
  for (const agent of agents) {
    if (seen.get(agent.name) < 2) continue;
    const suffix = agent.paneId || (agent.pid ? `pid ${agent.pid}` : agent.sessionShort);
    if (suffix) agent.name = `${agent.name} · ${suffix}`;
  }
}

function compareAgents(left, right) {
  const rank = { blocked: 0, working: 1, idle: 2, done: 3, unknown: 4 };
  const delta = (rank[left.status] ?? 9) - (rank[right.status] ?? 9);
  if (delta !== 0) return delta;
  const machineDelta = (left.machine ? 1 : 0) - (right.machine ? 1 : 0);
  if (machineDelta !== 0) return machineDelta;
  const typeOrder = { claude: 0, opencode: 1, codex: 2 };
  const typeDelta = (typeOrder[left.type] ?? 9) - (typeOrder[right.type] ?? 9);
  if (typeDelta !== 0) return typeDelta;
  return String(left.name).localeCompare(String(right.name));
}

function claudeName(session) {
  if (session && typeof session.name === 'string' && session.name) return session.name;
  return null;
}

/** A derived session name is autogenerated; the Herdr title is more meaningful then. */
function preferClaudeName(session, fallback) {
  const name = claudeName(session);
  if (!name) return fallback;
  if (session.nameSource === 'derived' && fallback) return fallback;
  return name;
}

function claudeFields(session) {
  if (!session) {
    return {
      kind: null,
      sessionShort: null,
      model: null,
      permissionMode: null,
      lastPrompt: null,
      lastActivityAt: null,
      startedAt: null,
      updatedAt: null,
      tasks: null,
      job: null,
      tokens: null,
      pid: null,
      version: null,
    };
  }
  return {
    kind: session.kind || null,
    sessionShort: session.sessionId ? String(session.sessionId).slice(0, 8) : null,
    model: session.model || null,
    permissionMode: session.permissionMode || null,
    lastPrompt: session.lastPrompt || null,
    lastActivityAt: session.lastActivityAt || null,
    startedAt: session.startedAt || null,
    updatedAt: session.updatedAt || null,
    tasks: session.tasks || null,
    job: session.job || null,
    tokens: session.tokens || null,
    pid: session.pid || null,
    version: session.version || null,
  };
}

function normalizeStatus(status) {
  switch (status) {
    case 'working':
    case 'blocked':
    case 'idle':
    case 'done':
      return status;
    default:
      return 'unknown';
  }
}

function herdrAgentName(agent, workspaceLabel, tabLabel) {
  const title = cleanTitle(agent.terminal_title_stripped || agent.terminal_title);
  const generic = new Set(['opencode', 'codex', 'claude', 'claude code', 'terminal']);
  const cwdBase = typeof agent.cwd === 'string' ? path.basename(agent.cwd) : '';
  if (title && !generic.has(title.toLowerCase()) && title !== cwdBase) return title;
  if (tabLabel && !/^\d+$/.test(tabLabel)) return workspaceLabel ? `${workspaceLabel} / ${tabLabel}` : tabLabel;
  if (workspaceLabel) return `${workspaceLabel} / ${cwdBase || agent.pane_id}`;
  return cwdBase || agent.pane_id;
}

function agentName(agent, snapshot) {
  const workspaceLabels = new Map((snapshot.workspaces || []).map((workspace) => [workspace.workspace_id, workspace.label]));
  const tabLabels = new Map((snapshot.tabs || []).map((tab) => [tab.tab_id, tab.label]));
  return herdrAgentName(agent, workspaceLabels.get(agent.workspace_id) || null, tabLabels.get(agent.tab_id) || null);
}

function cleanTitle(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/^[\u2000-\u3000\uFE0F\uFFFD\s\u2022\u00b7\u25cf\u25cb\u25d0\u25d1\u2733\u2734\u2726\u2736\u273b\u273d\u2023\u203b\u25aa\u25ab]+/u, '')
    .replace(/^(?:oc|opencode|codex|claude)\s*[|:>-]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findHerdrAgent(snapshot, key) {
  for (const agent of snapshot.agents || []) if (agent.pane_id === key) return agent;
  return null;
}

// ── herdr live state ───────────────────────────────────────────────────────

export async function readHerdr({ force = false } = {}) {
  const now = Date.now();
  if (!force && herdrCache && now - herdrAt < HERDR_CACHE_MS) return herdrCache;
  if (herdrInFlight) return herdrInFlight;
  herdrInFlight = (async () => {
    const socketPath = herdrSocketPath();
    if (!herdrSocketExists(socketPath)) {
      return { available: false, protocol: null, version: null, snapshot: null, error: { code: 'herdr_unavailable', message: `herdr socket not found at ${socketPath}` } };
    }
    try {
      const snapshot = await new HerdrClient({ socketPath }).snapshot();
      return {
        available: true,
        protocol: snapshot.protocol || null,
        version: snapshot.version || null,
        snapshot,
        error: null,
      };
    } catch (error) {
      return {
        available: false,
        protocol: null,
        version: null,
        snapshot: null,
        error: {
          code: error instanceof HerdrError ? error.code : 'herdr_unavailable',
          message: String((error && error.message) || error),
        },
      };
    }
  })().then((data) => {
    if (data.available || (data.error && data.error.code !== 'herdr_unavailable')) {
      herdrCache = data;
      herdrAt = Date.now();
    }
    return data;
  }).finally(() => {
    herdrInFlight = null;
  });
  return herdrInFlight;
}


// ── remote Herdr machines ─────────────────────────────────────────────────

/** Labels this deployment attaches through the local Herdr CLI. */
export function machineLabels() {
  const configured = pluginConfig.machines;
  if (Array.isArray(configured)) return configured.filter((label) => typeof label === 'string' && label);
  const env = process.env.DSH_CLAUDE_AGENTS_MACHINES;
  if (typeof env === 'string' && env.trim()) return env.split(',').map((label) => label.trim()).filter(Boolean);
  return [...DEFAULT_MACHINE_LABELS];
}

/** Test hook: replace the machine set and/or the remote client factory. */
export function configureMachines({ labels, clientFactory } = {}) {
  pluginConfig = { ...pluginConfig, machines: labels === undefined ? pluginConfig.machines : labels };
  machineFactory = typeof clientFactory === 'function' ? clientFactory : null;
  machineClients.clear();
  machineCache.clear();
  machineInitAt = 0;
  machineInitError = null;
}

function machineClientFor(label) {
  const existing = machineClients.get(label);
  if (existing) return existing;
  const client = machineFactory ? machineFactory(label) : new MachineClient({ label });
  machineClients.set(label, client);
  return client;
}

async function ensureMachines() {
  if (machineClients.size > 0 && machineInitError === null) return;
  if (machineInitError && Date.now() - machineInitAt < MACHINE_INIT_RETRY_MS) return;
  const labels = machineLabels();
  if (machineFactory) {
    for (const label of labels) machineClientFor(label);
    machineInitError = null;
    machineInitAt = Date.now();
    return;
  }
  try {
    const saved = await listMachines();
    const enabled = new Map(saved.filter((machine) => machine.enabled).map((machine) => [machine.label, machine]));
    const missing = labels.filter((label) => !enabled.has(label));
    if (missing.length > 0) {
      machineInitError = { code: 'machine_not_found', message: `saved Herdr machine not enabled: ${missing.join(', ')}` };
      machineInitAt = Date.now();
      return;
    }
    for (const label of labels) machineClientFor(label);
    machineInitError = null;
    machineInitAt = Date.now();
  } catch (error) {
    machineInitError = toErrorFacts(error);
    machineInitAt = Date.now();
  }
}

/** Refresh every configured remote snapshot. Exported for tests and on-demand use. */
export async function refreshMachines() {
  await ensureMachines();
  if (machineInitError) return;
  await Promise.all([...machineClients.values()].map((client) => refreshMachine(client)));
}

async function refreshMachine(client) {
  const cached = machineCache.get(client.label) || { snapshot: null, at: 0, loading: false, error: null };
  if (cached.loading) return;
  machineCache.set(client.label, { ...cached, loading: true });
  try {
    const snapshot = await client.snapshot();
    machineCache.set(client.label, { snapshot, at: Date.now(), loading: false, error: null });
  } catch (error) {
    machineCache.set(client.label, { snapshot: cached.snapshot, at: cached.at, loading: false, error: toErrorFacts(error) });
  }
}

function machineViewCached(label) {
  return machineCache.get(label) || { snapshot: null, at: 0, loading: false, error: null };
}

export function machinesView() {
  const now = Date.now();
  const labels = new Set([...machineLabels(), ...machineClients.keys()]);
  const views = [];
  for (const label of labels) {
    const cached = machineViewCached(label);
    const agents = cached.snapshot ? cached.snapshot.agents || [] : [];
    views.push({
      label,
      available: Boolean(cached.snapshot),
      loading: Boolean(cached.loading),
      updatedAt: cached.at || null,
      error: cached.error || (cached.snapshot ? null : machineInitError),
      agentCount: agents.length,
      snapshot: cached.snapshot,
    });
    if (!cached.loading && (!cached.snapshot || now - cached.at > MACHINE_REFRESH_MS)) {
      void refreshMachine(machineClientFor(label));
    }
  }
  return views;
}

function toErrorFacts(error) {
  if (!error) return { code: 'unknown', message: 'unknown error' };
  return {
    code: typeof error.code === 'string' && error.code ? error.code : 'unknown',
    message: String((error && error.message) || error),
  };
}

// ── Claude Code local state ────────────────────────────────────────────────

/**
 * Scan this machine's Claude Code process state.
 *
 * @param {string} home `~/.claude`
 * @param {{now?: number, alive?: (pid:number)=>boolean}} [options]
 */
export async function scanClaudeState(home, { now, alive } = {}) {
  const at = typeof now === 'number' ? now : Date.now();
  const isAlive = typeof alive === 'function' ? alive : isProcessAlive;
  const notes = [];
  const sessions = await readLiveSessions(home, isAlive, notes);
  const jobs = await readJobs(home);
  const projectDirs = await listDirectories(path.join(home, 'projects'));

  const enriched = await Promise.all(
    sessions.map(async (session) => {
      const transcript = await readTranscript(home, projectDirs, session);
      const tasks = await readTasks(home, session.sessionId);
      const job = jobs.get(session.sessionId) || null;
      const updatedAt = finite(session.updatedAt) ? session.updatedAt : null;
      const startedAt = finite(session.startedAt) ? session.startedAt : null;
      const transcriptAt = transcript && finite(transcript.lastEventAt) ? transcript.lastEventAt : 0;
      return {
        sessionId: session.sessionId,
        name: session.name || transcriptName(transcript) || `claude-${session.pid}`,
        nameSource: typeof session.nameSource === 'string' ? session.nameSource : null,
        status: session.status === 'busy' ? 'busy' : 'idle',
        kind: session.kind === 'bg' ? 'bg' : 'interactive',
        cwd: typeof session.cwd === 'string' ? session.cwd : null,
        pid: session.pid,
        version: session.version || null,
        model: transcript && transcript.model ? transcript.model : null,
        permissionMode: transcript && transcript.permissionMode ? transcript.permissionMode : null,
        lastPrompt: truncate(transcript && transcript.lastPrompt, 400),
        startedAt,
        updatedAt,
        lastActivityAt: Math.max(updatedAt || 0, transcriptAt) || null,
        tokens: job && finite(job.tokens) ? job.tokens : null,
        job: job ? { state: job.state || null, needs: truncate(job.needs, 300), detail: truncate(job.detail, 300) } : null,
        tasks,
      };
    }),
  );

  return { sessions: enriched, notes };
}

async function readLiveSessions(home, isAlive, notes) {
  const dir = path.join(home, 'sessions');
  let names;
  try {
    names = await fs.readdir(dir);
  } catch {
    notes.push('sessions-unreadable');
    return [];
  }

  const byId = new Map();
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const doc = await readJson(path.join(dir, name));
    if (!doc || typeof doc.sessionId !== 'string' || !doc.sessionId) continue;
    if (!finite(doc.pid) || doc.pid <= 0 || doc.pid > 1_000_000) continue;
    if (!isAlive(doc.pid)) continue;
    const existing = byId.get(doc.sessionId);
    const a = finite(doc.updatedAt) ? doc.updatedAt : 0;
    const b = existing && finite(existing.updatedAt) ? existing.updatedAt : 0;
    if (!existing || a > b) byId.set(doc.sessionId, doc);
  }
  return [...byId.values()];
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && error.code === 'EPERM');
  }
}

async function readJobs(home) {
  const dir = path.join(home, 'jobs');
  const jobs = new Map();
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return jobs;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const doc = await readJson(path.join(dir, entry.name, 'state.json'));
    if (!doc || typeof doc.sessionId !== 'string' || !doc.sessionId) continue;
    jobs.set(doc.sessionId, doc);
  }
  return jobs;
}

async function readTasks(home, sessionId) {
  const dir = path.join(home, 'tasks', sessionId);
  let names;
  try {
    names = await fs.readdir(dir);
  } catch {
    return null;
  }
  const items = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const doc = await readJson(path.join(dir, name));
    if (!doc || typeof doc.subject !== 'string') continue;
    items.push({ status: typeof doc.status === 'string' ? doc.status : 'pending', subject: doc.subject });
  }
  if (items.length === 0) return null;
  const done = items.filter((item) => item.status === 'completed' || item.status === 'deleted').length;
  const current = items
    .filter((item) => item.status === 'in_progress')
    .map((item) => truncate(item.subject, 120))
    .slice(0, 2);
  return { total: items.length, done, current };
}

// ── transcripts ────────────────────────────────────────────────────────────

async function readTranscript(home, projectDirs, session) {
  const file = await locateTranscript(home, projectDirs, session);
  if (!file) return null;
  let stat;
  try {
    stat = await fs.stat(file);
  } catch {
    return null;
  }
  const cached = transcriptCache.get(file);
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached.info;

  let info = null;
  try {
    info = await parseTranscriptTail(file, stat.size);
  } catch {
    info = null;
  }
  if (!info) return null;

  transcriptCache.set(file, { size: stat.size, mtimeMs: stat.mtimeMs, info });
  if (transcriptCache.size > TRANSCRIPT_CACHE_LIMIT) {
    const oldest = transcriptCache.keys().next().value;
    if (oldest !== undefined) transcriptCache.delete(oldest);
  }
  return info;
}

async function locateTranscript(home, projectDirs, session) {
  if (typeof session.cwd !== 'string' || !session.cwd) return null;
  const encoded = session.cwd.replaceAll('/', '-');
  const direct = path.join(home, 'projects', encoded, `${session.sessionId}.jsonl`);
  try {
    await fs.access(direct);
    return direct;
  } catch {
    // Fall through: some sessions record a cwd whose encoding differs.
  }
  for (const dir of projectDirs) {
    const candidate = path.join(home, 'projects', dir, `${session.sessionId}.jsonl`);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

async function parseTranscriptTail(file, size) {
  const start = Math.max(0, size - TRANSCRIPT_TAIL_BYTES);
  const length = size - start;
  if (length <= 0) return null;

  const handle = await fs.open(file, 'r');
  let text;
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    text = buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }

  const lines = text.split('\n');
  if (start > 0) lines.shift();

  const info = { model: null, permissionMode: null, lastPrompt: null, name: null, lastEventAt: 0 };
  for (const line of lines) {
    if (!line) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!event || typeof event !== 'object') continue;

    const stamp = Date.parse(typeof event.timestamp === 'string' ? event.timestamp : '');
    if (Number.isFinite(stamp) && stamp > info.lastEventAt) info.lastEventAt = stamp;

    switch (event.type) {
      case 'api-request':
        if (event.params && typeof event.params.model === 'string') info.model = event.params.model;
        break;
      case 'permission-mode':
        if (typeof event.permissionMode === 'string') info.permissionMode = event.permissionMode;
        break;
      case 'last-prompt':
        if (typeof event.lastPrompt === 'string') info.lastPrompt = event.lastPrompt;
        break;
      case 'agent-name':
        if (typeof event.agentName === 'string' && event.agentName) info.name = event.agentName;
        break;
      case 'custom-title':
        if (typeof event.customTitle === 'string' && event.customTitle) info.name = info.name || event.customTitle;
        break;
      case 'ai-title':
        if (!info.name && typeof event.aiTitle === 'string' && event.aiTitle) info.name = event.aiTitle;
        break;
      default:
        break;
    }
  }
  return info;
}

function transcriptName(transcript) {
  return transcript && typeof transcript.name === 'string' && transcript.name ? transcript.name : null;
}

// ── helpers ────────────────────────────────────────────────────────────────

function safeGet(ctx, name) {
  try {
    return ctx.get(name);
  } catch {
    return undefined;
  }
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function listDirectories(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function truncate(value, max) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
