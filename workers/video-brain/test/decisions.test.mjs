// tests never message Barron or call the model; skills/jobs/ad-studio data live in temp folders
process.env.VIDEO_BRAIN_DIGEST = '0'; process.env.VIDEO_BRAIN_HARVEST = '0'; process.env.VIDEO_BRAIN_STRATEGIST = '0'; process.env.VIDEO_BRAIN_RULES_PR = '0'; process.env.VIDEO_BRAIN_CRITIC = '0';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const tmp = await mkdtemp(path.join(tmpdir(), 'vb-dec-'));
process.env.VIDEO_BRAIN_SKILLS_DIR = path.join(tmp, 'skills'); process.env.AD_STUDIO_ROOT = path.join(tmp, 'ad');
process.env.XARK_JOBS_DIR = path.join(tmp, 'jobs'); process.env.XARK_DIRECTIVES_FILE = path.join(tmp, 'directives.json');
const { tick, statusLine } = await import('../brain.mjs?decisions');
const { think, loopOf, batchCandidates, freeCandidates } = await import('../lib/think.mjs');
const { buildDigest } = await import('../lib/digest.mjs');

const H = 3_600_000;
const NOW = Date.parse('2026-11-18T16:00:00Z'); // 08:00 Pacific: the digest is due
const policy = { autoApprove: true, maxRunUsd: 3, maxDayUsd: 20, maxRunAgeH: 24 };
const iso = (ms) => new Date(ms).toISOString();
const empty = async () => ({ projects: [], stages: [], runs: [] });
const run = (o) => ({ id: 'r1', projectId: 'p1', status: 'completed', step: null, progress: 0, estUsd: 1, actualUsd: null, finalMp4Url: null, error: null, retries: 0, updatedAt: iso(NOW - H), hookType: 'pain', engine: 'auto', ...o });
const obsOf = (o = {}) => ({ status: 200, policy, learnings: [], spend: { todayUsd: 0, autoApprovedTodayUsd: 0, byProject7d: {} }, perf: [], heartbeats: [], projects: [], stages: [], runs: [], ...o });

async function freshHome(extra = {}) {
  const home = await mkdtemp(path.join(tmp, 'home-'));
  await writeFile(path.join(home, 'state.json'), JSON.stringify({ checks: {}, incidents: {}, probes: [], patterns: [], loopStatus: {}, acted: {}, probesAt: iso(NOW), patternsAt: iso(NOW), syncHash: 'x', ...extra }));
  return home;
}
function recorder(obs) {
  const pubs = [];
  const call = async (a, b = {}) => a === 'observe' ? structuredClone(obs) : a === 'publish' ? (pubs.push(b.snapshot), { status: 200, ok: true, verified: true }) : { status: 200, ok: true };
  return { call, pubs };
}

test('I6 digest: sent but unverified → exactly one send over 3 ticks; read-only verify ≤ 3 times, then one "sent, unverified" event', async () => {
  const home = await freshHome();
  const { call, pubs } = recorder(obsOf());
  const sent = []; const verified = [];
  const notify = async (t) => { sent.push(t); return { ok: false, sent: true, messageId: 'om_1', reasons: ['read-back failed'] }; };
  const verifyNotify = async (id, text) => { verified.push([id, text]); return { ok: false, reasons: ['read-back failed'] }; };
  for (let i = 0; i < 6; i++) await tick({ call, now: NOW + i * 300_000, home, strategist: null, local: empty, notify, verifyNotify });
  assert.equal(sent.length, 1, 'the DM went out once; a failed read-back never re-sends');
  assert.equal(verified.length, 3);
  assert.ok(verified.every(([id, text]) => id === 'om_1' && text === sent[0]));
  const evs = pubs.flatMap((p) => p.events.map((e) => e.summary));
  assert.equal(evs.filter((s) => /digest sent, unverified/.test(s)).length, 1);
});

test('I6 digest: the pending message is persisted right after the send (a crash later in the tick cannot re-send)', async () => {
  const home = await freshHome();
  const obs = obsOf();
  const call = async (a) => { if (a === 'publish') throw new Error('publish crashed'); return a === 'observe' ? structuredClone(obs) : { status: 200, ok: true }; };
  const sent = [];
  const notify = async (t) => { sent.push(t); return { ok: false, sent: true, messageId: 'om_2' }; };
  await assert.rejects(tick({ call, now: NOW, home, strategist: null, local: empty, notify, verifyNotify: async () => ({ ok: false }) }));
  await assert.rejects(tick({ call, now: NOW + 300_000, home, strategist: null, local: empty, notify, verifyNotify: async () => ({ ok: false }) }));
  assert.equal(sent.length, 1);
});

test('I6 digest: a send with no messageId is retried next tick; a later verified read-back clears the pending entry', async () => {
  const home = await freshHome();
  const { call, pubs } = recorder(obsOf());
  let n = 0;
  const notify = async () => { n += 1; return n === 1 ? { ok: false, reason: 'Feishu send failed' } : { ok: false, sent: true, messageId: 'om_3' }; };
  const verifyNotify = async () => ({ ok: true });
  for (let i = 0; i < 4; i++) await tick({ call, now: NOW + i * 300_000, home, strategist: null, local: empty, notify, verifyNotify });
  assert.equal(n, 2);
  const evs = pubs.flatMap((p) => p.events.map((e) => e.summary));
  assert.ok(evs.some((s) => /digest NOT delivered: Feishu send failed/.test(s)));
  assert.ok(evs.some((s) => /digest read back: verified/.test(s)));
  assert.ok(!evs.some((s) => /unverified/.test(s)));
});

test('B1 stalled event: emitted only when the stalled set changes, plus one reminder per 24 h', async () => {
  const home = await freshHome({ digestDay: '2026-11-18' });
  const stalled = (id) => ({ id, name: id.toUpperCase(), updatedAt: iso(NOW - 80 * H) });
  const st = (id) => ({ projectId: id, stages: [{ id: 'setup', state: 'done' }, { id: 'research', state: 'partial', action: 'Run competitor research' }] });
  const a = recorder(obsOf({ projects: [stalled('p1')], stages: [st('p1')] }));
  const count = (pubs) => pubs.flatMap((p) => p.events).filter((e) => /stalled without a legal wait/.test(e.summary)).length;
  for (let i = 0; i < 3; i++) await tick({ call: a.call, now: NOW + i * 300_000, home, strategist: null, local: empty, notify: null });
  assert.equal(count(a.pubs), 1);
  const b = recorder(obsOf({ projects: [stalled('p1'), stalled('p2')], stages: [st('p1'), st('p2')] }));
  await tick({ call: b.call, now: NOW + 3 * 300_000, home, strategist: null, local: empty, notify: null });
  await tick({ call: b.call, now: NOW + 4 * 300_000, home, strategist: null, local: empty, notify: null });
  assert.equal(count(b.pubs), 1, 'a new stalled project → one more event');
  await tick({ call: b.call, now: NOW + 25 * H, home, strategist: null, local: empty, notify: null });
  assert.equal(count(b.pubs), 2, 'same set after 24 h → one reminder');
});

test('B2 local/batch loop delivered > 72 h ago without ad data is done, not waiting on the client; server loops unchanged', () => {
  const old = (pid) => run({ projectId: pid, finalMp4Url: 'u', updatedAt: iso(NOW - 100 * H) });
  const loop = (pid, n = 1) => loopOf({ id: pid, name: pid, updatedAt: iso(NOW - 100 * H) }, null, Array.from({ length: n }, (_, i) => ({ ...old(pid), id: `${pid}-${i}` })), [], 0, Object.fromEntries(Array.from({ length: n }, (_, i) => [`${pid}-${i}`, { pass: true }])), policy, 0, NOW);
  for (const pid of ['local:mixik', 'batch:acw-bf']) {
    const l = loop(pid, 3);
    assert.equal(l.status, 'done'); assert.equal(l.waitingOn, null);
    assert.equal(l.doing, 'delivered 3 videos; results not tracked for local/batch jobs');
  }
  const s = loop('srv1');
  assert.equal(s.status, 'waiting'); assert.equal(s.waitingOn, 'client');
  const loops = ['local:mixik', 'batch:acw-bf'].map((p) => loop(p));
  assert.deepEqual(batchCandidates(loops, {}, NOW), []);
  assert.deepEqual(freeCandidates(loops, [], {}, NOW), []);
});

test('B3 refused auto-approval: stale estimate → waitingOn estimate; budget out → funds; cap overrun stays budget; run still not approved', async () => {
  const stale = run({ status: 'awaiting_approval', estUsd: 1, updatedAt: iso(NOW - 30 * H) });
  const big = run({ id: 'r2', status: 'awaiting_approval', estUsd: 5 });
  const L = (r, opts) => loopOf({ id: 'p1', name: 'P', updatedAt: iso(NOW) }, null, [r], [], 0, {}, policy, 0, NOW, opts);
  const e = L(stale);
  assert.equal(e.waitingOn, 'estimate'); assert.equal(e.nextAction, 're-plan (free) to refresh the estimate, or cancel if obsolete');
  const f = L(stale, { budgetOut: true });
  assert.equal(f.waitingOn, 'funds'); assert.equal(f.nextAction, 'raise the OpenRouter key cap first');
  const c = L(big);
  assert.equal(c.waitingOn, 'budget'); assert.match(c.nextAction, /Barron approves/);
  // label only: the brain still does not approve the stale run
  const home = await freshHome({ digestDay: '2026-11-18' });
  const calls = [];
  const obs = obsOf({ projects: [{ id: 'p1', name: 'P', updatedAt: iso(NOW) }], runs: [stale] });
  const call = async (a) => { calls.push(a); return a === 'observe' ? structuredClone(obs) : { status: 200, ok: true, verified: true }; };
  const r = await tick({ call, now: NOW, home, strategist: null, local: empty, notify: null });
  assert.equal(calls.filter((a) => a === 'approve').length, 0);
  assert.equal(r.snapshot.loops[0].waitingOn, 'estimate');
  // budget out (probe failing) → the same loop says funds
  const home2 = await freshHome({ digestDay: '2026-11-18', probes: [{ name: 'openrouter balance', ok: false, detail: 'key cap spent' }] });
  const r2 = await tick({ call, now: NOW, home: home2, strategist: null, local: empty, notify: null });
  assert.equal(r2.snapshot.loops[0].waitingOn, 'funds');
  assert.equal(calls.filter((a) => a === 'approve').length, 0);
});

test('B3 digest: estimate loops are not asked of Barron; funds shows once', () => {
  const lp = (name, waitingOn, nextAction) => ({ name, status: 'waiting', step: 'produce', agent: 'Producer', waitingOn, nextAction });
  const text = buildDigest({ at: '2026-11-18T15:45:00Z', spend: {}, loops: [lp('A', 'estimate', 're-plan (free) to refresh the estimate, or cancel if obsolete'), lp('B', 'funds', 'raise the OpenRouter key cap first'), lp('C', 'funds', 'raise the OpenRouter key cap first'), lp('D', 'budget', 'Barron approves in Studio')], probes: [], incidents: [], checks: [] });
  assert.ok(!/- A:/.test(text), 'estimate is free work, not a Barron ask');
  assert.equal(text.match(/raise the OpenRouter key cap first/g).length, 1);
  assert.match(text, /- D: Barron approves in Studio/);
  assert.match(text, /需要你（2）/);
});

test('D1 setup ask carries the stage link; falls back when the API has no href', () => {
  const st = (href) => ({ projectId: 'p1', stages: [{ id: 'setup', state: 'partial', action: 'Confirm the product details', ...(href ? { href } : {}) }] });
  const L = (s) => loopOf({ id: 'p1', name: 'P', updatedAt: iso(NOW - 80 * H) }, s, [], [], 0, {}, policy, 0, NOW);
  assert.equal(L(st('/projects/p1/overview')).nextAction, 'Confirm the product details → https://creative.xark.io/projects/p1/overview');
  assert.equal(L(st(null)).nextAction, 'Confirm the product details');
  const t = think(obsOf({ projects: [{ id: 'p1', name: 'P', updatedAt: iso(NOW - 80 * H) }], stages: [st('/projects/p1/overview')] }), {}, NOW);
  assert.match(buildDigest({ at: iso(NOW), loops: t.loops }), /- P: Confirm the product details → https:\/\/creative\.xark\.io\/projects\/p1\/overview/);
});

test('S2 per-phase timings land on the __VIDEO_BRAIN__ line as new integer-ms fields; old keys kept', async () => {
  const home = await freshHome({ digestDay: '2026-11-18' });
  const { call } = recorder(obsOf());
  const r = await tick({ call, now: NOW, home, strategist: null, local: empty, notify: null });
  const line = statusLine(r, Date.now() - 5);
  assert.match(line, /^__VIDEO_BRAIN__\{/);
  const j = JSON.parse(line.slice('__VIDEO_BRAIN__'.length));
  for (const k of ['ok', 'verified', 'dryRun', 'ms', 'loops', 'stages', 'queue', 'executing', 'recovery', 'checks', 'incidents', 'probesFailing', 'patterns', 'learnings', 'events', 'approvedNow', 'bytes', 'error']) assert.ok(k in j, `kept ${k}`);
  for (const k of ['observe', 'act', 'checks', 'probes', 'learn', 'think', 'publish']) assert.ok(Number.isInteger(j.phaseMs[k]) && j.phaseMs[k] >= 0, `phaseMs.${k}`);
});

test('I6 notify adapter: sent-but-unverified carries sent + messageId; verifyDigest only reads back (never sends)', async () => {
  const { sendDigest, verifyDigest } = await import('../lib/digest.mjs');
  const calls = [];
  const mod = { loadFeishuConfig: () => ({ ok: true }), sendVerifiedDM: async () => (calls.push('send'), { ok: true, messageId: 'om_9', verified: false, reasons: ['read-back failed'] }), verifyFeishuDM: async (cfg, id, text) => (calls.push(`verify ${id} ${text}`), { verified: true, reasons: [] }) };
  const importer = async () => mod;
  assert.deepEqual(await sendDigest('hi', { importer }), { ok: false, sent: true, messageId: 'om_9', reasons: ['read-back failed'] });
  assert.deepEqual(await verifyDigest('om_9', 'hi', { importer }), { ok: true, reasons: [] });
  assert.deepEqual(calls, ['send', 'verify om_9 hi']);
});
