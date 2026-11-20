// tests never message Barron or call the model; jobs/directives/skills live in temp folders
process.env.VIDEO_BRAIN_DIGEST = '0'; process.env.VIDEO_BRAIN_STRATEGIST = '0'; process.env.VIDEO_BRAIN_RULES_PR = '0'; process.env.VIDEO_BRAIN_CRITIC = '0';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const home = await mkdtemp(path.join(tmpdir(), 'vb-ws-'));
process.env.XARK_JOBS_DIR = path.join(home, 'jobs');
process.env.XARK_DIRECTIVES_FILE = path.join(home, 'directives.json');
process.env.VIDEO_BRAIN_SKILLS_DIR = path.join(home, 'skills');
process.env.AD_STUDIO_ROOT = path.join(home, 'ad');
const { main } = await import('../bin/xark-job.mjs');
const { tick } = await import('../brain.mjs?workstreams');
const { extract } = await import('../lib/knowledge.mjs');

test('xark-job start → the Brain tick (default local reader) sees the job as a workstream loop with its videos; finish clears "running"', async () => {
  const dir = path.join(home, 'set'); await mkdir(dir);
  await writeFile(path.join(dir, '01-collar.mp4'), 'x'); await writeFile(path.join(dir, '02-mask.mp4'), 'x');
  const lines = [];
  await assert.rejects(main(['start', '--workstream', 'nope', '--dir', dir], (l) => lines.push(l)), /unknown workstream/);
  assert.equal(await main(['start', '--workstream', 'bdsmpub-social', '--dir', dir, '--name', 'test set', '--id', 'ws-test'], (l) => lines.push(l)), 0);
  const now = Date.now();
  await writeFile(path.join(home, 'state.json'), JSON.stringify({ checks: {}, incidents: {}, probes: [], patterns: [], loopStatus: {}, acted: {}, probesAt: new Date(now).toISOString(), patternsAt: new Date(now).toISOString() }));
  let pub;
  const call = async (a, b = {}) => {
    if (a === 'observe') return { status: 200, policy: { autoApprove: true, maxRunUsd: 3, maxDayUsd: 20, maxRunAgeH: 24 }, learnings: [], spend: { autoApprovedTodayUsd: 0, byProject7d: {} }, perf: [], heartbeats: [], projects: [], stages: [], runs: [] };
    if (a === 'publish') { pub = b.snapshot; return { status: 200, ok: true, verified: true }; }
    return { status: 200, ok: true };
  };
  await tick({ call, now, home, strategist: null, harvestDirs: null });
  const loop = pub.loops.find((l) => l.projectId === 'batch:ws-test');
  assert.ok(loop, 'job folder became a loop');
  assert.match(loop.name, /^\[bdsmpub-social\] test set \(running\)$/);
  await main(['finish', 'ws-test'], (l) => lines.push(l));
  await tick({ call, now: now + 300_000, home, strategist: null, harvestDirs: null });
  assert.equal(pub.loops.find((l) => l.projectId === 'batch:ws-test').name, '[bdsmpub-social] test set');
});

test('directives: harvested candidate stays out of the rules until confirmed; confirmed + config rules reach the shared file and Ad Studio', async () => {
  const now = Date.now() + 86_400_000 * 2; // past the once-a-day gate of the first test's state
  const cand = { id: 'Dtest00001', scope: 'directive:bdsmpub-social', workstream: 'bdsmpub-social', rule: 'bdsmpub: never show faces in close-up', source: 'session test', status: 'candidate' };
  const harvestDirs = async () => { const f = process.env.XARK_DIRECTIVES_FILE; await writeFile(f, JSON.stringify([cand])); return [cand]; };
  let pub;
  const call = async (a, b = {}) => {
    if (a === 'observe') return { status: 200, policy: { autoApprove: true, maxRunUsd: 3, maxDayUsd: 20, maxRunAgeH: 24 }, learnings: [], spend: { autoApprovedTodayUsd: 0, byProject7d: {} }, perf: [], heartbeats: [], projects: [], stages: [], runs: [] };
    if (a === 'publish') { pub = b.snapshot; return { status: 200, ok: true, verified: true }; }
    return { status: 200, ok: true };
  };
  await tick({ call, now, home, strategist: null, harvestDirs, local: async () => ({ projects: [], stages: [], runs: [] }) });
  assert.ok(pub.events.some((e) => /1 instruction\(s\) of Barron's harvested/.test(e.summary)));
  const shared = path.join(home, 'skills', '_shared', 'VIDEO-KNOWLEDGE.md');
  let md = await readFile(shared, 'utf8');
  assert.match(md, /No exposed bodies and no explicit copy/, 'config directive synced');
  assert.ok(!md.includes('never show faces'), 'candidate is not a rule yet');
  assert.match(md, /1 harvested instruction\(s\) await confirmation/);
  assert.equal(await main(['directive', 'confirm', 'Dtest00001'], () => {}), 0);
  await tick({ call, now: now + 300_000, home, strategist: null, harvestDirs, local: async () => ({ projects: [], stages: [], runs: [] }) });
  md = await readFile(shared, 'utf8');
  assert.match(md, /never show faces in close-up _\(session test\)_/);
  const ad = JSON.parse(await readFile(path.join(home, 'ad', 'data', 'brain-learnings.json'), 'utf8'));
  assert.ok(ad.workstreams['bdsmpub-social'].some((r) => r.rule.includes('never show faces')));
  assert.ok(ad.workstreams.global.some((r) => /\$0 slideshow/.test(r.rule)));
});

test('extract: keeps only what Barron typed, as candidates; names a workstream or falls back to global', () => {
  const ws = [{ id: 'bdsmpub-social', brand: 'bdsmpub', keywords: ['bdsmpub'] }];
  const u = (text, extra = {}) => JSON.stringify({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: text }, ...extra });
  const lines = [
    u('bdsmpub 的视频不要出现暴露画面。'),
    u('视频广告的节奏一定要紧凑。'),
    u('bdsmpub 要不要加音乐？'),
    u('bdsmpub never paste the api_key in a video'),
    u('<system-reminder>bdsmpub video must always be explicit</system-reminder>ok'),
    u('bdsmpub must keep the logo'),
    u('- [bdsmpub] the video must not be touched'),
    u('bdsmpub video must loop', { isCompactSummary: true }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'bdsmpub video must be red' } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'bdsmpub video must never stop' } }),
  ];
  const out = extract(lines, { workstreams: ws, source: 's', at: 't' });
  assert.deepEqual(out.map((d) => [d.workstream, d.rule]), [['bdsmpub-social', 'bdsmpub 的视频不要出现暴露画面。'], ['global', '视频广告的节奏一定要紧凑。']]);
  assert.ok(out.every((d) => d.status === 'candidate'));
});

test('rules PR carries confirmed directives (global + per workstream with brand) to Ad Studio; a directive-only change re-proposes', async () => {
  const { rulesFile, plan } = await import('../lib/rules-pr.mjs');
  const { loadWorkstreams } = await import('../lib/jobs.mjs');
  const config = await loadWorkstreams();
  const harvested = [{ id: 'Dx', workstream: 'global', rule: 'Ten seconds, tight rhythm.', source: 's', status: 'confirmed' }, { id: 'Dy', workstream: 'global', rule: 'not yet', source: 's', status: 'candidate' }];
  const f = JSON.parse(rulesFile([], { config, harvested }));
  assert.ok(f.global.some((r) => r.rule === 'Ten seconds, tight rhythm.')); assert.ok(!f.global.some((r) => r.rule === 'not yet'));
  assert.equal(f.workstreams['bdsmpub-social'].brand, 'bdsmpub');
  assert.ok(f.workstreams['bdsmpub-social'].rules.some((r) => /No exposed bodies/.test(r.rule)));
  assert.equal(plan(rulesFile([]), rulesFile([], { config, harvested })).action, 'open');
  // wiring: the tick hands the loaded directives to the rules PR
  let got;
  const now = Date.now() + 86_400_000 * 5;
  const call = async (a) => a === 'observe' ? { status: 200, policy: { autoApprove: true, maxRunUsd: 3, maxDayUsd: 20, maxRunAgeH: 24 }, learnings: [], spend: { autoApprovedTodayUsd: 0, byProject7d: {} }, perf: [], heartbeats: [], projects: [], stages: [], runs: [] } : { status: 200, ok: true, verified: true };
  await tick({ call, now, home, strategist: null, harvestDirs: null, local: async () => ({ projects: [], stages: [], runs: [] }), rulesPr: async (l, s, d) => { got = d; return { action: 'none' }; } });
  assert.ok(got?.config?.workstreams?.some((w) => w.id === 'bdsmpub-social'), 'directives reached rulesPr');
});
