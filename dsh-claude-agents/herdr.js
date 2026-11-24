/**
 * Minimal client for the Herdr unix-socket API.
 *
 * The protocol is one JSON request line and one JSON response line:
 *   -> {"id":"...","method":"agent.prompt","params":{...}}\n
 *   <- {"id":"...","result":{...}}  or  {"id":"...","error":{"code","message"}}
 *
 * Everything here is transport + typed convenience; policy (allowed targets,
 * rate limits, text caps) belongs to the caller.
 */

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

/** Protocol generation this client was written against (herdr 0.9.1). */
export const HERDR_PROTOCOL = 22;
export const DEFAULT_TIMEOUT_MS = 2000;

/** A herdr failure carrying a stable machine-readable code. */
export class HerdrError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'HerdrError';
    this.code = code;
  }
}

export function herdrSocketPath() {
  if (process.env.HERDR_SOCKET_PATH) return process.env.HERDR_SOCKET_PATH;
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'herdr', 'herdr.sock');
}

export function herdrSocketExists(socketPath = herdrSocketPath()) {
  try {
    return fs.statSync(socketPath).isSocket();
  } catch {
    return false;
  }
}

let requestCounter = 0;

export class HerdrClient {
  constructor({ socketPath = herdrSocketPath(), timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.socketPath = socketPath;
    this.timeoutMs = timeoutMs;
  }

  /** Send one request and resolve with its `result` object. */
  request(method, params = {}, { timeoutMs } = {}) {
    const id = `dsh-${process.pid}-${Date.now().toString(36)}-${(requestCounter += 1)}`;
    const payload = `${JSON.stringify({ id, method, params })}\n`;
    const limit = typeof timeoutMs === 'number' ? timeoutMs : this.timeoutMs;

    return new Promise((resolve, reject) => {
      let settled = false;
      let buffer = '';
      const socket = net.createConnection({ path: this.socketPath });

      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        fn(value);
      };

      const timer = setTimeout(() => {
        finish(reject, new HerdrError('timeout', `herdr ${method} timed out after ${limit} ms`));
      }, limit);
      if (typeof timer.unref === 'function') timer.unref();

      socket.setNoDelay?.(true);
      socket.on('connect', () => socket.write(payload));
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        const newline = buffer.indexOf('\n');
        if (newline === -1) return;
        const line = buffer.slice(0, newline);
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch {
          finish(reject, new HerdrError('bad-response', 'herdr sent a non-JSON response'));
          return;
        }
        if (parsed && parsed.error) {
          const code = typeof parsed.error.code === 'string' && parsed.error.code ? parsed.error.code : 'herdr-error';
          const message =
            typeof parsed.error.message === 'string' && parsed.error.message
              ? parsed.error.message
              : 'herdr request failed';
          finish(reject, new HerdrError(code, message));
          return;
        }
        finish(resolve, parsed ? parsed.result : undefined);
      });
      socket.on('error', (error) => {
        const message = error && error.message ? String(error.message) : 'herdr socket is unavailable';
        finish(reject, new HerdrError('herdr_unavailable', message));
      });
      socket.on('close', () => {
        if (!settled) finish(reject, new HerdrError('herdr_unavailable', 'herdr closed the connection'));
      });
    });
  }

  async ping() {
    return this.request('ping', {});
  }

  /** Full live session snapshot: workspaces, tabs, panes, agents. */
  async snapshot() {
    const result = await this.request('session.snapshot', {}, { timeoutMs: Math.max(this.timeoutMs, 3000) });
    if (!result || result.type !== 'session_snapshot' || !result.snapshot) {
      throw new HerdrError('bad-response', 'herdr returned an unexpected snapshot payload');
    }
    return result.snapshot;
  }

  /** Submit text + Enter to a live agent (pane id or unique agent name). */
  async prompt(target, text, { wait } = {}) {
    const params = { target, text };
    if (wait) params.wait = wait;
    return this.request('agent.prompt', params);
  }

  /** Read the agent's recent terminal output. */
  async read(target, { lines = 120, source = 'recent_unwrapped', format = 'text' } = {}) {
    return this.request(
      'agent.read',
      { target, source, lines, format, strip_ansi: true },
      { timeoutMs: Math.max(this.timeoutMs, 3000) },
    );
  }

  /** Send logical key presses (enter, esc, ...) to a live agent. */
  async sendKeys(target, keys) {
    return this.request('agent.send_keys', { target, keys: Array.isArray(keys) ? keys : [keys] });
  }

  /** Read one agent's info (name, status, cwd, ...). */
  async agent(target) {
    return this.request('agent.get', { target });
  }
}
