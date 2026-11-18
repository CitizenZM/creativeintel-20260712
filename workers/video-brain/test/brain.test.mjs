import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { think, loopOf, approvals, retries } from '../lib/think.mjs';
import { signatureOf, classify, aggregate } from '../lib/incidents.mjs';
import { compare } from '../lib/verify.mjs';
import { scanText } from '../lib/patterns.mjs';
import { harvest, renderBlock, writeBlock, BEGIN, END, SEED } from '../lib/learn.mjs';
import { missingModels, routedModels } from '../lib/probes.mjs';

const NOW = Date.parse('2026-11-18T12:00:00Z');
const H = 3_600_000;
const policy = { autoApprove: true, maxRunUsd: 3, maxDayUsd: 20, maxRunAgeH: 24 };
const ago = (h) => new Date(NOW - h * H).toISOString();
const run = (o) => ({ id: 'r' + Math.random().toString(36).slice(2, 8), projectId: 'p1', status: 'completed', step: null, progress: 0, estUsd: 1, actualUsd: null, finalMp4Url: null, error: null, metrics: null, retries: 0, updatedAt: ago(1), createdAt: ago(2), hookType: 'pain', engine: 'auto', ...o });
const project = (o = {}) => ({ id: 'p1', name: 'Mixik', brandName: 'MIXIK', updatedAt: ago(1), ...o });
const stages = (gap) => ({ projectId: 'p1', stages: ['setup', 'research', 'insights', 'creative', 'studio', 'deliver'].map((id) => ({ id, state: id === gap ? 'partial' : gap && ['setup', 'research', 'insights', 'creative', 'studio'].indexOf(id) > ['setup', 'research', 'insights', 'creative', 'studio'].indexOf(gap) ? 'todo' : 'done', action: `do ${id}` })) });
const L = (o = {}) => loopOf(o.project || project(), o.stages || stages(null), o.runs || [], o.perf || [], 0, o.checks || {}, policy, 0, NOW);

test('loop: active run → execute stage, 15 min checkpoint', () => {
  const l = L({ runs: [run({ status: 'generating', step: 'render', progress: 60 })] });
  assert.equal(l.step, 'produce'); assert.equal(l.stage, 'execute'); assert.equal(l.status, 'active');
  assert.equal(Date.parse(l.nextCheckpointAt) - NOW, 15 * 60_000);
});
test('loop: awaiting approval within cap → gate/active; over cap → waiting on budget (legal wait)', () => {
  assert.equal(L({ runs: [run({ status: 'awaiting_approval', estUsd: 1 })] }).status, 'active');
  const w = L({ runs: [run({ status: 'awaiting_approval', estUsd: 5 })] });
  assert.equal(w.status, 'waiting'); assert.equal(w.waitingOn, 'budget');
});
test('loop: finished but unchecked → verify; checked & fresh → waiting ad-data; old → waiting client; perf → learn', () => {
  const r = run({ finalMp4Url: 'https://x/v.mp4', updatedAt: ago(5) });
  assert.equal(L({ runs: [r] }).stage, 'verify');
  const checked = { [r.id]: { pass: true } };
  const a = L({ runs: [r], checks: checked }); assert.equal(a.waitingOn, 'ad-data');
  const old = run({ finalMp4Url: 'u', updatedAt: ago(100) });
  assert.equal(L({ runs: [old], checks: { [old.id]: {} } }).waitingOn, 'client');
  const perf = [{ projectId: 'p1', rows: 3, impressions: 1000, views3s: 300, clicks: 12, lastUpdatedAt: ago(1) }];
  const m = L({ runs: [r], checks: checked, perf }); assert.equal(m.stage, 'learn'); assert.match(m.doing, /hook rate 30%/);
});
test('loop: stage gap → project step; stalled > 48 h without a legal wait → idle-defect', () => {
  const l = L({ stages: stages('insights') }); assert.equal(l.step, 'insights'); assert.equal(l.status, 'active');
  const i = L({ project: project({ updatedAt: ago(60) }), stages: stages('creative') });
  assert.equal(i.status, 'idle-defect'); assert.ok(i.idleSince);
});
test('loop: latest failure transient → recover active; filter → blocked', () => {
  assert.equal(L({ runs: [run({ status: 'failed', error: 'worker stopped (heartbeat)' })] }).status, 'active');
  assert.equal(L({ runs: [run({ status: 'failed', error: 'veo blocked by safety filter' })] }).status, 'blocked');
});
test('approvals: day cap accumulates across runs in one tick', () => {
  const rs = [1, 2, 3].map((i) => run({ status: 'awaiting_approval', estUsd: 2, updatedAt: ago(i) }));
  const out = approvals(rs, { ...policy, maxDayUsd: 6 }, 0, NOW);
  assert.deepEqual(out.map((a) => a.ok), [true, true, false]);
});
test('retries: only transient, < 2 retries, within 24 h', () => {
  const rs = [run({ status: 'failed', error: 'fetch failed' }), run({ status: 'failed', error: 'fetch failed', retries: 2 }), run({ status: 'failed', error: 'fetch failed', updatedAt: ago(30) }), run({ status: 'failed', error: 'TypeError x is undefined' })];
  assert.equal(retries(rs, NOW).length, 1);
});
test('think: sorts idle-defect first and counts stages', () => {
  const obs = { policy, spend: { autoApprovedTodayUsd: 0, byProject7d: {} }, perf: [], projects: [project(), project({ id: 'p2', name: 'Old', updatedAt: ago(80) })], stages: [stages(null), { ...stages('setup'), projectId: 'p2' }], runs: [run({ status: 'generating' })] };
  const t = think(obs, {}, NOW);
  assert.equal(t.loops[0].projectId, 'p2'); assert.equal(t.stageCounts.execute, 1); assert.equal(t.executing.length, 1);
});

test('incidents: one signature for the same cause, reopen after resolve', () => {
  assert.equal(signatureOf('OpenRouter 503: job abc12345def failed at /Users/x/a/b.mp4 after 30s'), signatureOf('OpenRouter 503: job ffee99887766 failed at /tmp/q/r.mp4 after 12s'));
  assert.equal(classify('google/veo-3.1-lite blocked by content policy').retry, false);
  assert.equal(classify('ETIMEDOUT').kind, 'platform');
  let m = aggregate({}, [run({ id: 'a', status: 'failed', error: 'fetch failed 1', updatedAt: ago(100) }), run({ id: 'b', status: 'failed', error: 'fetch failed 2', updatedAt: ago(90) })], NOW);
  const k = Object.keys(m); assert.equal(k.length, 1); assert.equal(m[k[0]].count, 2); assert.equal(m[k[0]].status, 'resolved');
  m = aggregate(m, [run({ id: 'c', status: 'failed', error: 'fetch failed 3', updatedAt: ago(1) })], NOW);
  assert.equal(m[k[0]].status, 'reopened'); assert.equal(m[k[0]].count, 3);
});

test('second check compare: passes a good file, fails duration/aspect/loudness/cost/url', () => {
  const good = compare(run({ estUsd: 2, actualUsd: 2.1, metrics: { runtime: 21.0 } }), { http: { status: 200, type: 'video/mp4' }, probe: { duration: 21.05, width: 1080, height: 1920, vcodec: 'h264', acodec: 'aac' }, lufs: -14.3 });
  assert.equal(good.pass, true, JSON.stringify(good.fields.filter((f) => !f.pass)));
  const bad = compare(run({ estUsd: 1, actualUsd: 5 }), { http: { status: 404, type: 'text/html' }, probe: { duration: 31, width: 1920, height: 1080, vcodec: 'hevc', acodec: null }, lufs: -19 });
  const failed = bad.fields.filter((f) => !f.pass).map((f) => f.field).sort();
  assert.deepEqual(failed, ['aspect', 'audio track', 'cost', 'duration', 'loudness', 'url', 'video codec'].sort());
});

test('patterns: finds live retired-model routes, ignores comments/price tables', () => {
  const text = "broll: {model: 'bytedance/seedance-1-5-pro'},\n// old: 'bytedance/seedance-1-5-pro' retired\n'bytedance/seedance-1-5-pro': {label: 'x', price: 1},";
  const hits = scanText('f.mjs', text).filter((h) => h.pattern === 'retired-model-seedance-1-5');
  assert.deepEqual(hits.map((h) => h.line), [1]);
  assert.equal(scanText('a.sh', 'node x | tee out.txt | head -5').length, 1);
  // false positives seen on the first live scan (2026-11-18): per-stem -16 LUFS and 30 ms anti-pop fades
  assert.equal(scanText('m.py', "'-af', 'afade=t=out:st=1,loudnorm=I=-16:TP=-2:LRA=11'  # every bed at -16 LUFS").length, 0);
  assert.equal(scanText('r.py', 'af = f"afade=t=in:st=0:d=0.03,afade=t=out"').length, 0);
  assert.equal(scanText('r.mjs', "'-af', 'afade=t=in:st=0:d=0.5'").length, 1);
  assert.equal(scanText('r.mjs', "// final master: loudnorm=I=-16").length, 0);
  assert.equal(scanText('r.mjs', "const masterAf = 'loudnorm=I=-16:TP=-1.5'").length, 1);
});

test('probes: routed models parsed from the real generate.mjs; missing detection', async () => {
  const root = path.join(process.env.HOME, 'Projects', 'ad-studio-20261104');
  const ids = await routedModels(root).catch(() => []);
  if (ids.length) { assert.ok(ids.includes('google/veo-3.1-lite')); assert.ok(!ids.includes('bytedance/seedance-1-5-pro')); }
  assert.deepEqual(missingModels(['a/x', 'b/y'], ['a/x']), ['b/y']);
});

test('learn: harvest recurring incidents + repeated check failures; marker block is idempotent', async () => {
  const h = harvest({ incidents: { s: { signature: 's', kind: 'model', count: 3, status: 'open', runbook: 'rb', runs: ['a', 'b', 'c'] } }, checks: { a: { runId: 'a', fields: [{ field: 'loudness', pass: false }] }, b: { runId: 'b', fields: [{ field: 'loudness', pass: false }] } } });
  assert.equal(h.length, 2); assert.equal(h[0].status, 'confirmed');
  const dir = await mkdtemp(path.join(tmpdir(), 'vb-'));
  const f = path.join(dir, 'L.md'); await writeFile(f, '# keep me\n');
  const block = renderBlock([...SEED, ...h], 'T');
  assert.equal(await writeBlock(f, block), true);
  assert.equal(await writeBlock(f, block), false);
  const text = await readFile(f, 'utf8');
  assert.ok(text.startsWith('# keep me')); assert.equal(text.split(BEGIN).length, 2); assert.ok(text.includes(END));
});

test('tick wiring: approves within caps, retries transient, checks, syncs skills, publishes', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'vb-home-'));
  const skills = path.join(home, 'skills'); await mkdir(path.join(skills, 'ad-studio'), { recursive: true });
  await writeFile(path.join(skills, 'ad-studio', 'SKILL.md'), '---\nname: ad-studio\n---\n# body\n');
  const adRoot = path.join(home, 'ad'); await mkdir(adRoot, { recursive: true });
  process.env.VIDEO_BRAIN_SKILLS_DIR = skills; process.env.AD_STUDIO_ROOT = adRoot;
  const now = Date.now();
  await writeFile(path.join(home, 'state.json'), JSON.stringify({ checks: {}, incidents: {}, probes: [], patterns: [], loopStatus: {}, acted: {}, probesAt: new Date(now).toISOString(), patternsAt: new Date(now).toISOString() }));
  const { tick } = await import('../brain.mjs?wiring');
  const small = run({ id: 'small', status: 'awaiting_approval', estUsd: 1, updatedAt: new Date(now - H).toISOString() });
  const big = run({ id: 'big', status: 'awaiting_approval', estUsd: 9, updatedAt: new Date(now - H).toISOString() });
  const failed = run({ id: 'fail', status: 'failed', error: 'socket hang up', updatedAt: new Date(now - H).toISOString() });
  const calls = [];
  const call = async (action, body = {}) => {
    calls.push({ action, body });
    if (action === 'observe') return { status: 200, policy, learnings: [], spend: { todayUsd: 0, autoApprovedTodayUsd: 0, byProject7d: {} }, perf: [], heartbeats: [], projects: [project({ updatedAt: new Date(now).toISOString() }), project({ id: 'p2', name: 'Stalled', updatedAt: new Date(now - 80 * H).toISOString() })], stages: [stages(null), { ...stages('insights'), projectId: 'p2' }], runs: [small, big, failed] };
    if (action === 'approve') return { status: 200, ok: true };
    if (action === 'retry') return { status: 200, ok: true, status2: 'awaiting_approval' };
    if (action === 'publish') return { status: 200, ok: true, verified: true, bytes: JSON.stringify(body.snapshot).length };
    return { status: 400 };
  };
  const asked = [];
  const strategist = async (prompt) => { asked.push(prompt); return { hypothesis: 'h', nextAction: 'Write the insights brief', verifyHow: 'insights stage done', checkpointHours: 6, owner: 'Strategist' }; };
  const r = await tick({ call, now, home, strategist });
  assert.equal(r.ok, true);
  assert.deepEqual(calls.filter((c) => c.action === 'approve').map((c) => c.body.runId), ['small']);
  assert.deepEqual(calls.filter((c) => c.action === 'retry').map((c) => c.body.runId), ['fail']);
  const pub = calls.find((c) => c.action === 'publish').body.snapshot;
  assert.equal(pub.v, 1); assert.equal(pub.loops.length, 2);
  assert.equal(asked.length, 1); assert.equal(pub.loops.find((l) => l.projectId === 'p2').nextAction, 'Write the insights brief'); assert.ok(pub.events.some((e) => /auto-approved/.test(e.summary)));
  assert.ok(pub.events.some((e) => /held at the gate/.test(e.summary)));
  assert.ok((await readFile(path.join(skills, 'ad-studio', 'LEARNINGS.md'), 'utf8')).includes(BEGIN));
  assert.ok((await readFile(path.join(skills, 'ad-studio', 'SKILL.md'), 'utf8')).includes('LEARNINGS.md'));
  assert.ok(JSON.parse(await readFile(path.join(adRoot, 'data', 'brain-learnings.json'), 'utf8')).rules.length > 0);
  // second tick: no duplicate approve/retry
  calls.length = 0;
  await tick({ call, now: now + 60_000, home, strategist });
  assert.equal(calls.filter((c) => c.action === 'retry').length, 0);
  assert.equal(calls.filter((c) => c.action === 'approve').length, 0);
  assert.equal(asked.length, 1);
});

test('strategist: picks stalled/measuring projects once a day, capped; applies output for 24 h', async () => {
  const { pick, apply, promptFor } = await import('../lib/strategist.mjs');
  const loops = [{ projectId: 'a', status: 'idle-defect', step: 'insights' }, { projectId: 'b', status: 'active', step: 'measure' }, { projectId: 'c', status: 'active', step: 'produce' }];
  assert.deepEqual(pick(loops, {}, NOW).map((l) => l.projectId), ['a', 'b']);
  const memo = { a: { at: new Date(NOW - H).toISOString(), day: new Date(NOW).toISOString().slice(0, 10), out: { hypothesis: 'h', nextAction: 'n', verifyHow: 'v', checkpointHours: 6, owner: 'Director' } } };
  assert.deepEqual(pick(loops, memo, NOW).map((l) => l.projectId), ['b']);
  assert.deepEqual(pick(loops, {}, NOW, 1).map((l) => l.projectId), ['a']);
  const out = apply([{ projectId: 'a', doing: 'd', nextAction: 'x', agent: 'Researcher' }], memo, NOW)[0];
  assert.equal(out.nextAction, 'n'); assert.equal(out.agent, 'Director'); assert.equal(Date.parse(out.nextCheckpointAt), NOW + 5 * H);
  assert.equal(apply([{ projectId: 'a', nextAction: 'x' }], memo, NOW + 30 * H)[0].nextAction, 'x');
  assert.match(promptFor({ projectId: 'a', name: 'P', step: 'insights', status: 'idle-defect', nextAction: 'x' }, { stages: [], runs: [], perf: [] }, []), /Project: P/);
});
