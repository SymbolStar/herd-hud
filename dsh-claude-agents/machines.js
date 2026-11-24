/**
 * Remote Herdr machines through the local CLI's `--machine` forwarding.
 *
 * The local Herdr server already owns the SSH profiles and their credentials,
 * so we never read or store them: every remote operation is one spawned
 * `herdr --machine <label> ...` command that the local server forwards.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Machines to attach when the plugin has no explicit configuration. */
export const DEFAULT_MACHINE_LABELS = ['symbol-150-jms'];

/**
 * The desktop app may start with a minimal PATH (LaunchServices), which can
 * omit Homebrew. Resolve the CLI once from the usual install locations.
 */
export function resolveHerdrBin() {
  if (process.env.HERDR_BIN) return process.env.HERDR_BIN;
  const candidates = [
    '/opt/homebrew/bin/herdr',
    '/usr/local/bin/herdr',
    '/home/linuxbrew/.linuxbrew/bin/herdr',
    path.join(os.homedir(), '.local/bin/herdr'),
    path.join(os.homedir(), 'bin/herdr'),
  ];
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // try next
    }
  }
  return 'herdr';
}

const HERDR_BIN = resolveHerdrBin();
const DEFAULT_TIMEOUT_MS = 20_000;
const PROMPT_TIMEOUT_MS = 25_000;
const MAX_BUFFER = 4 * 1024 * 1024;

export class MachineError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MachineError';
    this.code = code;
  }
}

function cliError(error, stderr) {
  const text = String(stderr || '').trim();
  if (text) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && parsed.error) {
        const code = typeof parsed.error.code === 'string' && parsed.error.code ? parsed.error.code : 'herdr_cli_error';
        const message =
          typeof parsed.error.message === 'string' && parsed.error.message ? parsed.error.message : 'herdr command failed';
        return new MachineError(code, message);
      }
    } catch {
      // plain-text stderr, handled below
    }
  }
  const first = text.split('\n').find((line) => line.trim()) || (error && error.message) || 'herdr command failed';
  let code = 'herdr_cli_error';
  if (/timed out|timeout/i.test(first)) code = 'timeout';
  else if (/unknown machine|no such machine|not found/i.test(first)) code = 'machine_not_found';
  else if (/ssh|connection|unreachable|network/i.test(first)) code = 'machine_unreachable';
  return new MachineError(code, String(first).slice(0, 400));
}

/** Run one `herdr` CLI invocation without a shell. */
export function runHerdr(args, { timeoutMs = DEFAULT_TIMEOUT_MS, run } = {}) {
  const runner = typeof run === 'function' ? run : defaultRun;
  return runner(args, timeoutMs);
}

function defaultRun(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(HERDR_BIN, args, { timeout: timeoutMs, maxBuffer: MAX_BUFFER, env: process.env }, (error, stdout, stderr) => {
      if (error) {
        reject(cliError(error, stderr));
        return;
      }
      resolve(String(stdout || ''));
    });
  });
}

/** Saved SSH machine profiles on the local Herdr server. */
export async function listMachines({ run } = {}) {
  const stdout = await runHerdr(['machine', 'list', '--json'], { run });
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new MachineError('bad-response', 'herdr machine list did not return JSON');
  }
  return Array.isArray(parsed) ? parsed : [];
}

export class MachineClient {
  constructor({ label, run, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.label = label;
    this.run = run;
    this.timeoutMs = timeoutMs;
  }

  call(args, timeoutMs) {
    return runHerdr(['--machine', this.label, ...args], { timeoutMs, run: this.run });
  }

  async snapshot() {
    const stdout = await this.call(['api', 'snapshot']);
    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      throw new MachineError('bad-response', `machine ${this.label} returned a non-JSON snapshot`);
    }
    const snapshot = parsed && parsed.result && parsed.result.snapshot;
    if (!snapshot || !Array.isArray(snapshot.agents)) {
      throw new MachineError('bad-response', `machine ${this.label} returned an unexpected snapshot payload`);
    }
    return snapshot;
  }

  async prompt(paneId, text) {
    return this.call(['agent', 'prompt', paneId, text], PROMPT_TIMEOUT_MS);
  }

  async sendKeys(paneId, keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    return this.call(['agent', 'send-keys', paneId, ...list]);
  }

  async read(paneId, lines) {
    return this.call(['agent', 'read', paneId, '--source', 'recent-unwrapped', '--lines', String(lines)]);
  }
}
