// S1: the strategist must close stdin, surface the real cause on a non-zero exit, and retry errored memos after 6 h
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as strat from '../lib/strategist.mjs';
const { runClaude, pick } = strat;

const OUT = { hypothesis: 'h', nextAction: 'n', verifyHow: 'v', checkpointHours: 6, owner: 'Director' };
/** fake execFile: records the call, returns a child whose stdin.end is tracked, calls back async */
function fakeExec({ err = null, stdout = '', stderr = '' }) {
  const calls = { stdinEnded: false };
  const exec = (bin, args, opts, cb) => { calls.bin = bin; calls.args = args; setImmediate(() => cb(err, stdout, stderr)); return { stdin: { end: () => { calls.stdinEnded = true; } } }; };
  return { exec, calls };
}

test('runClaude: closes stdin and resolves structured_output', async () => {
  const { exec, calls } = fakeExec({ stdout: JSON.stringify({ is_error: false, structured_output: OUT }) });
  assert.deepEqual(await runClaude('p', { exec }), OUT);
  assert.equal(calls.bin, 'claude');
  assert.equal(calls.stdinEnded, true);
});

test('runClaude: non-zero exit still reads stdout JSON (subtype/result) and keeps the stderr tail', async () => {
  const err = Object.assign(new Error('Command failed: claude -p ...very long prompt...'), { code: 1 });
  const stderr = 'x'.repeat(500) + 'Warning: no stdin data received in 3s';
  const stdout = JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true, result: 'Credit balance is too low' });
  const { exec } = fakeExec({ err, stdout, stderr });
  const e = await runClaude('p', { exec }).then(() => null, (x) => x);
  assert.ok(e);
  assert.match(e.message, /error_max_turns/);
  assert.match(e.message, /Credit balance is too low/);
  assert.match(e.message, /no stdin data received in 3s$/);
  assert.doesNotMatch(e.message, /Command failed/);
  assert.ok(e.message.length <= 300 + 200, e.message.length);
});

test('runClaude: non-zero exit with no stdout -> last 300 chars of stderr', async () => {
  const stderr = 'a'.repeat(400) + 'END';
  const { exec } = fakeExec({ err: new Error('Command failed: claude'), stdout: '', stderr });
  const e = await runClaude('p', { exec }).then(() => null, (x) => x);
  assert.equal(e.message, `claude -p: ${stderr.slice(-300)}`);
});

test('runClaude: exit 0 but is_error -> rejects with subtype and result', async () => {
  const { exec } = fakeExec({ stdout: JSON.stringify({ is_error: true, subtype: 'error_during_execution', result: 'boom' }) });
  await assert.rejects(runClaude('p', { exec }), /error_during_execution.*boom/);
});

const NOW = Date.parse('2026-11-25T12:00:00Z');
const loop = (id) => ({ projectId: id, status: 'idle-defect', step: 'execute' });
const ago = (h) => new Date(NOW - h * 3_600_000).toISOString();

test('pick: an errored memo is retried after 6 h, a good memo holds 24 h', () => {
  assert.equal(strat.ERROR_RETRY_MS, 6 * 3_600_000);
  const memo = {
    e5: { at: ago(5), day: '2026-11-25', error: 'x' },
    e7: { at: ago(7), day: '2026-11-25', error: 'x' },
    ok7: { at: ago(7), day: '2026-11-25', out: {} },
  };
  const ids = pick([loop('e5'), loop('e7'), loop('ok7'), loop('new')], memo, NOW).map((l) => l.projectId);
  assert.deepEqual(ids, ['e7', 'new']);
});

test('pick: daily cap counts errored calls too', () => {
  const memo = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`p${i}`, { at: ago(7), day: '2026-11-25', error: 'x' }]));
  assert.deepEqual(pick([loop('p0'), loop('new')], memo, NOW), []);
});
