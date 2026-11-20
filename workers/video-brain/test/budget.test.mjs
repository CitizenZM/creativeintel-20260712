// tests never message Barron or call the model
process.env.VIDEO_BRAIN_DIGEST = '0'; process.env.VIDEO_BRAIN_HARVEST = '0'; process.env.VIDEO_BRAIN_STRATEGIST = '0'; process.env.VIDEO_BRAIN_RULES_PR = '0'; process.env.VIDEO_BRAIN_CRITIC = '0';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('second checks stop at the tick time budget and say so (ticks must stay under the 300 s launchd interval)', async () => {
  process.env.VIDEO_BRAIN_CHECK_BUDGET_MS = '-1';
  const home = await mkdtemp(path.join(tmpdir(), 'vb-budget-'));
  const now = Date.now();
  await writeFile(path.join(home, 'state.json'), JSON.stringify({ checks: {}, incidents: {}, probes: [], patterns: [], loopStatus: {}, acted: {}, probesAt: new Date(now).toISOString(), patternsAt: new Date(now).toISOString(), syncHash: 'x' }));
  const { tick } = await import('../brain.mjs?budget');
  const { toRun } = await import('../lib/local.mjs');
  const done = toRun('d1', { projectId: 'p' }, { state: 'done', finished: new Date(now - 3_600_000).toISOString() }, '/nonexistent/final.mp4');
  let pub;
  const call = async (a, b = {}) => a === 'observe' ? { status: 200, policy: { autoApprove: false, maxRunUsd: 3, maxDayUsd: 20, maxRunAgeH: 24 }, learnings: [], spend: { autoApprovedTodayUsd: 0, byProject7d: {} }, perf: [], heartbeats: [], projects: [], stages: [], runs: [] } : a === 'publish' ? ((pub = b.snapshot), { status: 200, ok: true, verified: true }) : { status: 200 };
  await tick({ call, now, home, local: async () => ({ projects: [{ id: 'local:p', name: 'P', updatedAt: new Date(now).toISOString() }], stages: [], runs: [done] }) });
  assert.equal(pub.checks.length, 0);
  assert.ok(pub.events.some((e) => /time budget/.test(e.summary)));
});
