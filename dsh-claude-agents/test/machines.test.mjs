/**
 * Unit test for the remote-machine CLI client: argument shapes and parsing,
 * with a fake runner so no herdr process (and no SSH) is spawned.
 */
import assert from 'node:assert/strict';

import { MachineClient, MachineError, listMachines, runHerdr } from '../machines.js';

const snapshot = {
  protocol: 22,
  version: '0.9.1',
  workspaces: [{ workspace_id: 'w1', label: 'laoyang' }],
  tabs: [],
  agents: [{ pane_id: 'w1:p1', agent: 'opencode', agent_status: 'idle' }],
};

const calls = [];
const fakeRunner = async (args, timeoutMs) => {
  calls.push({ args, timeoutMs });
  const method = args.join(' ');
  if (method.includes('machine list')) {
    return JSON.stringify([{ label: 'symbol-150-jms', enabled: true }]);
  }
  if (method.includes('api snapshot')) {
    return JSON.stringify({ id: 'cli:api:snapshot', result: { snapshot } });
  }
  if (method.includes('agent prompt') || method.includes('agent send-keys')) {
    return JSON.stringify({ id: 'cli:agent', result: { type: 'agent_prompted' } });
  }
  if (method.includes('agent read')) {
    return 'line1\nline2\n';
  }
  throw new MachineError('herdr_cli_error', `unexpected args: ${args.join(' ')}`);
};

// runHerdr delegates to the injected runner
const delegated = await runHerdr(['machine', 'list', '--json'], { run: fakeRunner });
assert.deepEqual(JSON.parse(delegated), [{ label: 'symbol-150-jms', enabled: true }]);

// listMachines
calls.length = 0;
const machines = await listMachines({ run: fakeRunner });
assert.deepEqual(machines, [{ label: 'symbol-150-jms', enabled: true }]);
assert.deepEqual(calls[0].args, ['machine', 'list', '--json']);

// snapshot
calls.length = 0;
const client = new MachineClient({ label: 'symbol-150-jms', run: fakeRunner });
const remoteSnapshot = await client.snapshot();
assert.deepEqual(calls[0].args, ['--machine', 'symbol-150-jms', 'api', 'snapshot']);
assert.equal(remoteSnapshot.agents.length, 1);

// prompt
calls.length = 0;
await client.prompt('w1:p1', 'hello world with spaces');
assert.deepEqual(calls[0].args, ['--machine', 'symbol-150-jms', 'agent', 'prompt', 'w1:p1', 'hello world with spaces']);
assert.ok(calls[0].timeoutMs >= 20_000);

// send-keys
calls.length = 0;
await client.sendKeys('w1:p1', ['enter']);
assert.deepEqual(calls[0].args, ['--machine', 'symbol-150-jms', 'agent', 'send-keys', 'w1:p1', 'enter']);

// read
calls.length = 0;
const text = await client.read('w1:p1', 40);
assert.deepEqual(calls[0].args, [
  '--machine',
  'symbol-150-jms',
  'agent',
  'read',
  'w1:p1',
  '--source',
  'recent-unwrapped',
  '--lines',
  '40',
]);
assert.equal(text, 'line1\nline2\n');

// malformed snapshot payload is a typed error
const broken = new MachineClient({
  label: 'symbol-150-jms',
  run: async () => JSON.stringify({ id: 'x', result: {} }),
});
await assert.rejects(
  () => broken.snapshot(),
  (error) => error instanceof MachineError && error.code === 'bad-response',
);

// non-JSON machine list is a typed error
await assert.rejects(
  () => listMachines({ run: async () => 'not json' }),
  (error) => error instanceof MachineError && error.code === 'bad-response',
);

// a runner rejection keeps its code
const failing = new MachineClient({
  label: 'symbol-150-jms',
  run: async () => {
    throw new MachineError('machine_unreachable', 'ssh: connect timed out');
  },
});
await assert.rejects(
  () => failing.snapshot(),
  (error) => error instanceof MachineError && error.code === 'machine_unreachable',
);

console.log('machines.test.mjs: all assertions passed');
