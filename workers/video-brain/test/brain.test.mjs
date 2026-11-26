// tests never message Barron or call the model
process.env.VIDEO_BRAIN_HARVEST = '0'; process.env.VIDEO_BRAIN_DIGEST = '0'; process.env.VIDEO_BRAIN_STRATEGIST = '0'; process.env.VIDEO_BRAIN_RULES_PR = '0'; process.env.VIDEO_BRAIN_CRITIC = '0';
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
  const h = harvest({ incidents: { s: { signature: 's', kind: 'model', count: 3, status: 'open', runbook: 'rb', runs: ['a', 'b', 'c'], lastSeen: new Date().toISOString() }, stale: { signature: 'z', kind: 'code', count: 5, status: 'open', runbook: 'rb', runs: ['x'], lastSeen: '2026-01-01T00:00:00.000Z' } }, checks: { a: { runId: 'a', renderedAt: '2026-11-18T01:00:00.000Z', fields: [{ field: 'loudness', pass: false }] }, b: { runId: 'b', fields: [{ field: 'loudness', pass: false }] }, old1: { runId: 'old1', renderedAt: '2026-11-05T00:00:00.000Z', fields: [{ field: 'duration', pass: false }] }, old2: { runId: 'old2', renderedAt: '2026-11-06T00:00:00.000Z', fields: [{ field: 'duration', pass: false }] } } });
  assert.equal(h.length, 2); assert.equal(h[0].status, 'confirmed');
  assert.ok(!h.some((l) => /duration/.test(l.rule)), 'videos from before the pipeline baseline are not learned from');
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
  const empty = async () => ({ projects: [], stages: [], runs: [] });
  const r = await tick({ call, now, home, strategist, local: empty });
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
  await tick({ call, now: now + 60_000, home, strategist, local: empty });
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

test('local Ad Studio jobs: state mapping, final file, xark-managed jobs never auto-approved', async () => {
  const { toRun, localProjectId } = await import('../lib/local.mjs');
  const done = toRun('j1', { projectId: '20261105-ms1z7', hookType: 'pain', created: ago(50) }, { state: 'done', finished: ago(48), cost: 2.2, estimate: { usd: 1.9 }, result: { duration: 21.4 } }, '/x/final.mp4');
  assert.equal(done.status, 'completed'); assert.equal(done.finalPath, '/x/final.mp4'); assert.equal(done.projectId, 'local:20261105-ms1z7'); assert.equal(done.metrics.runtime, 21.4);
  const xk = toRun('xk-1', { source: 'xark', projectId: 'xark' }, { state: 'approval', started: ago(1), estimate: { usd: 1 } }, null);
  assert.equal(xk.status, 'awaiting_approval'); assert.equal(xk.managedBy, 'xark'); assert.equal(localProjectId({ source: 'xark' }), 'local:xark-lab');
  const own = toRun('j2', { projectId: 'p' }, { state: 'approval', started: ago(1), estimate: { usd: 1 } }, null);
  assert.deepEqual(approvals([xk, own], policy, 0, NOW).map((a) => a.ok), [false, true]);
  assert.match(approvals([xk], policy, 0, NOW)[0].reason, /Xark Studio/);
  assert.equal(retries([{ ...toRun('j3', {}, { state: 'failed', error: 'fetch failed', finished: ago(1) }, null) }], NOW).length, 0);
  assert.equal(classify('OpenRouter 402: This request requires at least $1.00 in balance').kind, 'human');
});

test('second check of a local file: missing file fails the file field', () => {
  const c = compare(run({ id: 'local:x', estUsd: 0 }), { file: { bytes: 0 }, probeError: 'No such file' });
  assert.equal(c.pass, false); assert.deepEqual(c.fields.map((f) => f.field), ['file', 'probe']);
});

test('digest: due once per Pacific day after 07:30; lists what waits on Barron', async () => {
  const { digestDue, buildDigest } = await import('../lib/digest.mjs');
  assert.equal(digestDue(null, Date.parse('2026-11-18T15:00:00Z')), null); // 07:00 PT
  assert.equal(digestDue(null, Date.parse('2026-11-18T15:45:00Z')), '2026-11-18'); // 07:45 PT
  assert.equal(digestDue('2026-11-18', Date.parse('2026-11-18T20:00:00Z')), null);
  const text = buildDigest({ at: '2026-11-18T15:45:00Z', spend: { todayUsd: 1, capUsd: 20 }, loops: [{ name: 'TCL QM7L', status: 'idle-defect', step: 'setup', nextAction: 'Confirm product details', agent: 'Researcher' }, { name: 'Nike', status: 'idle-defect', step: 'insights', nextAction: 'Run teardown', agent: 'Strategist' }], probes: [{ name: 'openrouter balance', ok: false, detail: '$1 left' }], incidents: [], checks: [] }, [{ at: 'x', kind: 'decide' }]);
  assert.match(text, /需要你（1）:\n- TCL QM7L: Confirm product details/);
  assert.match(text, /openrouter balance: \$1 left/); assert.match(text, /Nike @insights/); assert.match(text, /creative\.xark\.io\/brain/);
  assert.ok(!/@/.test(text.replace(/@\w+:/g, '').replace(/@insights|@setup/g, '')), 'no e-mail addresses');
});

test('tick wiring: digest sent once a day, failure reported as an event', async () => {
  const { mkdtemp, writeFile } = await import('node:fs/promises');
  const home = await mkdtemp(path.join(tmpdir(), 'vb-dig-'));
  await writeFile(path.join(home, 'state.json'), JSON.stringify({ checks: {}, incidents: {}, probes: [], patterns: [], loopStatus: {}, acted: {}, probesAt: '2026-11-18T16:00:00.000Z', patternsAt: '2026-11-18T16:00:00.000Z', syncHash: 'x' }));
  const { tick } = await import('../brain.mjs?digest');
  const sent = [];
  const notify = async (t) => { sent.push(t); return { ok: true }; };
  let pub;
  const call = async (a, b = {}) => a === 'observe' ? { status: 200, policy, learnings: [], spend: { autoApprovedTodayUsd: 0, byProject7d: {} }, perf: [], heartbeats: [], projects: [], stages: [], runs: [] } : a === 'publish' ? ((pub = b.snapshot), { status: 200, ok: true, verified: true }) : { status: 200 };
  const at = Date.parse('2026-11-18T16:00:00Z');
  await tick({ call, now: at, home, strategist: null, local: async () => ({ projects: [], stages: [], runs: [] }), notify });
  await tick({ call, now: at + 300_000, home, strategist: null, local: async () => ({ projects: [], stages: [], runs: [] }), notify });
  assert.equal(sent.length, 1);
  const failHome = await mkdtemp(path.join(tmpdir(), 'vb-dig2-'));
  await writeFile(path.join(failHome, 'state.json'), JSON.stringify({ checks: {}, incidents: {}, probes: [], patterns: [], loopStatus: {}, acted: {}, probesAt: '2026-11-18T16:00:00.000Z', patternsAt: '2026-11-18T16:00:00.000Z', syncHash: 'x' }));
  await tick({ call, now: at, home: failHome, strategist: null, local: async () => ({ projects: [], stages: [], runs: [] }), notify: async () => ({ ok: false, reason: 'no creds' }) });
  assert.ok(pub.events.some((e) => /digest NOT delivered: no creds/.test(e.summary)));
});

test('probes: python check uses the interpreter the pipeline resolves', async () => {
  const { pipelinePython } = await import('../lib/probes.mjs');
  assert.equal(await pipelinePython('/nonexistent'), 'python3');
  const root = path.join(process.env.HOME, 'Projects', 'ad-studio-20261104');
  const py = await pipelinePython(root);
  assert.ok(typeof py === 'string' && py.length > 0);
});

test('critic: frame picks, verdict, check fields', async () => {
  const { picks, verdict, withCritic } = await import('../lib/critic.mjs');
  assert.deepEqual(picks(3, 9), [0.05, 3, 6]);
  assert.deepEqual(verdict({ first_frame: 7, product_clear: 7, consistency: 7, no_garbled_text: 7, sells: 7 }), { avg: 7, pass: true });
  assert.equal(verdict({ first_frame: 9, product_clear: 9, consistency: 9, no_garbled_text: 3, sells: 9 }).pass, false);
  const c = withCritic({ runId: 'r', pass: true, fields: [{ field: 'duration', pass: true }] }, { model: 'google/g', scores: { first_frame: 3, product_clear: 3, consistency: 3, no_garbled_text: 3, sells: 3, issues: ['x'] }, avg: 3, pass: false });
  assert.equal(c.pass, false); assert.equal(c.fields[1].field, 'critic (g)'); assert.match(c.fields[1].actual, /x$/);
});

test('batch: CSV with quoted commas; INDEX rows become finished runs of one project', async () => {
  const { parseCsv, readBatches } = await import('../lib/batch.mjs');
  const rows = parseCsv('file,product,voice-over\r\na.mp4,grip,"Hi, ""friends"", 30% off"\nb.mp4,clip,x\n');
  assert.equal(rows.length, 2); assert.equal(rows[0]['voice-over'], 'Hi, "friends", 30% off');
  const { mkdtemp, writeFile } = await import('node:fs/promises');
  const dir = await mkdtemp(path.join(tmpdir(), 'vb-batch-'));
  await writeFile(path.join(dir, 'INDEX.csv'), 'file,product\nv1.mp4,grip\nmissing.mp4,clip\n'); await writeFile(path.join(dir, 'v1.mp4'), 'x');
  const out = await readBatches([{ id: 't', name: 'T', brand: 'b', dir, index: 'INDEX.csv' }]);
  assert.equal(out.projects.length, 1); assert.equal(out.runs.length, 2);
  assert.ok(out.runs[0].finalPath.endsWith('v1.mp4')); assert.equal(out.runs[1].finalPath, null); assert.equal(out.runs[0].projectId, 'batch:t');
  assert.deepEqual(approvals(out.runs, policy, 0, NOW), []);
});

test('rules PR: only confirmed script-side learnings; one PR per content hash; none when main matches', async () => {
  const { rulesFile, plan, hashOf, proposeRules } = await import('../lib/rules-pr.mjs');
  const L = [{ id: 'L2', status: 'confirmed', scope: 'pipeline:script', rule: 'b' }, { id: 'L1', status: 'confirmed', scope: 'global', rule: 'a' }, { id: 'L3', status: 'candidate', scope: 'global', rule: 'c' }, { id: 'L4', status: 'confirmed', scope: 'ops:launchd', rule: 'd' }];
  const f = rulesFile(L); assert.deepEqual(JSON.parse(f).rules.map((r) => r.id), ['L1', 'L2']);
  assert.equal(plan(f, f).action, 'none');
  assert.equal(plan('{"rules":[]}', f).action, 'open');
  assert.equal(plan('{"rules":[]}', f, { hash: hashOf(f), url: 'u' }).action, 'pending');
  // wiring with a fake shell: worktree → test → commit → push → gh pr create, worktree removed
  const cmds = [];
  const { mkdir, readFile } = await import('node:fs/promises');
  let wt;
  const sh = async (cmd, args) => { cmds.push([cmd, ...args].join(' ')); if (args[2] === 'show') return { stdout: '{"rules":[]}' }; if (args[2] === 'worktree' && args[3] === 'add') { wt = args[7]; await mkdir(path.join(wt, 'pipeline'), { recursive: true }); } if (cmd === 'gh' && args[1] === 'view') return { stdout: JSON.stringify({ state: 'OPEN', headRefName: cmds.find((c) => c.includes('worktree add')).split(' ')[7], files: [{ path: 'pipeline/brain-rules.json' }] }) }; if (cmd === 'gh') return { stdout: 'https://github.com/x/pull/9\n' }; return { stdout: '' }; };
  const r = await proposeRules('/repo', L, {}, { sh });
  assert.equal(r.action, 'opened'); assert.equal(r.url, 'https://github.com/x/pull/9');
  assert.deepEqual(JSON.parse(await readFile(path.join(wt, 'pipeline', 'brain-rules.json'), 'utf8')).rules.map((x) => x.id), ['L1', 'L2']);
  const order = ['worktree add', 'node --test', 'commit', 'push', 'gh pr create', 'worktree remove'].map((k) => cmds.findIndex((c) => c.includes(k)));
  assert.ok(order.every((i, k) => i >= 0 && (k === 0 || i > order[k - 1])), order.join(','));
});

test('batch candidates: Xark project at studio with no runs, one per tick, 24 h cooldown, never local/batch', async () => {
  const { batchCandidates } = await import('../lib/think.mjs');
  const L = (id, o = {}) => ({ projectId: id, step: 'studio', stage: 'project', runs: { active: 0, done: 0, failed: 0 }, ...o });
  assert.deepEqual(batchCandidates([L('a'), L('b')], {}, NOW).map((l) => l.projectId), ['a']);
  assert.deepEqual(batchCandidates([L('a'), L('b')], { a: new Date(NOW - H).toISOString() }, NOW).map((l) => l.projectId), ['b']);
  assert.deepEqual(batchCandidates([L('local:x'), L('batch:y'), L('c', { step: 'setup' }), L('d', { runs: { active: 0, done: 1, failed: 0 } })], {}, NOW), []);
});

test('balance: the key cap counts, not just account credit (402 on 2026-11-18 with $94 on the account, $0.50 on the key)', async () => {
  const { balanceVerdict } = await import('../lib/probes.mjs');
  const v = balanceVerdict(94.89, { limit: 60, limit_remaining: 0.497, limit_reset: 'monthly' });
  assert.equal(v.ok, false); assert.match(v.detail, /raise the key limit/);
  assert.equal(balanceVerdict(94.89, { limit: null, limit_remaining: null }).ok, true);
  assert.equal(balanceVerdict(2, {}).ok, false);
});

test('free candidates: only funds failures, no product made yet, not local/batch, 24 h cooldown', async () => {
  const { freeCandidates } = await import('../lib/think.mjs');
  const L = (id, o = {}) => ({ projectId: id, step: 'produce', runs: { active: 0, done: 0, failed: 1 }, ...o });
  const runs = [{ projectId: 'a', status: 'failed', error: 'OpenRouter 402 balance' }, { projectId: 'b', status: 'failed', error: 'TypeError x' }];
  assert.deepEqual(freeCandidates([L('b'), L('a')], runs, {}, NOW).map((l) => l.projectId), ['a']);
  assert.deepEqual(freeCandidates([L('a')], runs, { a: new Date(NOW - H).toISOString() }, NOW), []);
  assert.deepEqual(freeCandidates([L('a', { runs: { active: 0, done: 1, failed: 1 } }), L('local:x', { runs: { active: 0, done: 0, failed: 0 } })], runs, {}, NOW), []);
});

test('harvested incident learnings never reach the script prompt (rules PR #1 proposed a 402 ops failure as a script rule)', async () => {
  const { harvest } = await import('../lib/learn.mjs');
  const { rulesFile } = await import('../lib/rules-pr.mjs');
  const h = harvest({ incidents: { s: { signature: 'openrouter 402 balance', kind: 'human', count: 3, status: 'open', runbook: 'top up', runs: ['a', 'b', 'c'], lastSeen: new Date().toISOString() }, m: { signature: 'model gone', kind: 'model', count: 3, status: 'open', runbook: 'fallback', runs: ['x', 'y', 'z'], lastSeen: new Date().toISOString() } }, checks: {} });
  assert.deepEqual(h.map((l) => l.scope).sort(), ['ops:human', 'ops:model']);
  assert.deepEqual(JSON.parse(rulesFile(h)).rules, []);
});

test('cost check allows the pre-gate key frames (false failures on 2026-11-18: +$0.03..$0.55 over the clip reservation)', () => {
  const ok = compare(run({ estUsd: 1.38, actualUsd: 1.73, estimateScenes: 6 }), { file: { bytes: 1 }, probe: { duration: 20, width: 1080, height: 1920, vcodec: 'h264', acodec: 'aac' } });
  assert.equal(ok.fields.find((f) => f.field === 'cost').pass, true);
  const over = compare(run({ estUsd: 1, actualUsd: 3, estimateScenes: 4 }), { file: { bytes: 1 }, probe: { duration: 20, width: 1080, height: 1920, vcodec: 'h264', acodec: 'aac' } });
  assert.equal(over.fields.find((f) => f.field === 'cost').pass, false);
});
