// tests never message Barron or call the model
process.env.VIDEO_BRAIN_DIGEST = '0'; process.env.VIDEO_BRAIN_STRATEGIST = '0'; process.env.VIDEO_BRAIN_RULES_PR = '0'; process.env.VIDEO_BRAIN_CRITIC = '0';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('tick wiring: a ready Xark storyboard with nothing produced gets one batch call, then not again for 24 h', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'vb-batch-'));
  const now = Date.now();
  await writeFile(path.join(home, 'state.json'), JSON.stringify({ checks: {}, incidents: {}, probes: [], patterns: [], loopStatus: {}, acted: {}, probesAt: new Date(now).toISOString(), patternsAt: new Date(now).toISOString(), syncHash: 'x' }));
  const { tick } = await import('../brain.mjs?batchwire');
  const done = ['setup', 'research', 'insights', 'creative', 'studio'].map((id) => ({ id, state: 'done', action: '' }));
  const calls = [];
  let pub;
  const call = async (a, b = {}) => {
    calls.push([a, b]);
    if (a === 'observe') return { status: 200, policy: { autoApprove: true, maxRunUsd: 3, maxDayUsd: 20, maxRunAgeH: 24 }, learnings: [], spend: { autoApprovedTodayUsd: 0, byProject7d: {} }, perf: [], heartbeats: [], projects: [{ id: 'p9', name: 'TCL Analysis', brandName: 'TCL', updatedAt: new Date(now).toISOString() }], stages: [{ projectId: 'p9', stages: done }], runs: [] };
    if (a === 'batch') return { status: 200, ok: true, runs: [{ id: 'run9', status: 'queued' }] };
    if (a === 'publish') { pub = b.snapshot; return { status: 200, ok: true, verified: true }; }
    return { status: 200 };
  };
  const empty = async () => ({ projects: [], stages: [], runs: [] });
  await tick({ call, now, home, local: empty });
  assert.deepEqual(calls.filter(([a]) => a === 'batch').map(([, b]) => b.projectId), ['p9']);
  assert.ok(pub.events.some((e) => /started an Ad Studio batch for TCL Analysis/.test(e.summary)));
  calls.length = 0;
  await tick({ call, now: now + 300_000, home, local: empty });
  assert.equal(calls.filter(([a]) => a === 'batch').length, 0);
});
