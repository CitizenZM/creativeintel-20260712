// R4 checks: T7 first-frame field (uniform/blank opening fails, probe error omits it), T6 batch round blocks,
// T9 advisory pipeline review never flips pass, T17 provider-JSON signatures only behind an HTTP code / provider prefix.
// tests never message Barron or call the model; no brain.mjs import (no learnings sync)
process.env.VIDEO_BRAIN_HARVEST = '0'; process.env.VIDEO_BRAIN_DIGEST = '0'; process.env.VIDEO_BRAIN_STRATEGIST = '0'; process.env.VIDEO_BRAIN_RULES_PR = '0'; process.env.VIDEO_BRAIN_CRITIC = '0';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { compare, probeUrl } from '../lib/verify.mjs';
import { loopOf, blockingCheck } from '../lib/think.mjs';
import { toRun } from '../lib/local.mjs';
import { signatureOf } from '../lib/incidents.mjs';

const pexec = promisify(execFile);
const H = 3_600_000;
const NOW = Date.parse('2026-11-25T12:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

// ---------- T7: first frame ----------
let dir;
const make = async (name, args) => { dir ||= await mkdtemp(path.join(tmpdir(), 'brain-ff-')); const f = path.join(dir, name); await pexec('ffmpeg', ['-y', '-v', 'error', ...args, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', f]); return f; };
const firstFrame = (facts) => compare({ id: 'r', projectId: 'p' }, facts).fields.find((x) => x.field === 'first frame');

test('T7: a video that opens on 1 s of black fails the first-frame field', async () => {
  const f = await make('black-open.mp4', ['-f', 'lavfi', '-i', 'color=black:s=360x640:d=1:r=25', '-f', 'lavfi', '-i', 'testsrc=s=360x640:d=2:r=25', '-filter_complex', '[0:v][1:v]concat=n=2:v=1[v]', '-map', '[v]']);
  const facts = await probeUrl(f);
  assert.ok(facts.firstFrame, 'frame 0 was probed');
  const fld = firstFrame(facts);
  assert.ok(fld, 'first frame field present');
  assert.equal(fld.pass, false, fld.actual);
  assert.equal(compare({ id: 'r', projectId: 'p' }, facts).pass, false);
});

test('T7: a normal opening (testsrc) passes the first-frame field', async () => {
  const f = await make('testsrc.mp4', ['-f', 'lavfi', '-i', 'testsrc=s=360x640:d=2:r=25']);
  const fld = firstFrame(await probeUrl(f));
  assert.ok(fld); assert.equal(fld.pass, true, fld.actual);
});

test('T7: a solid title card with white text strokes passes (not a blank frame)', async () => {
  const boxes = [[60, 280, 240, 8], [60, 300, 8, 60], [150, 300, 8, 60], [232, 300, 8, 60], [60, 370, 180, 8]].map(([x, y, w, h]) => `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=white:t=fill`).join(',');
  const f = await make('card.mp4', ['-f', 'lavfi', '-i', 'color=0x203040:s=360x640:d=2:r=25', '-vf', boxes]);
  const fld = firstFrame(await probeUrl(f));
  assert.ok(fld); assert.equal(fld.pass, true, fld.actual);
});

test('T7: probe error -> no first-frame field (never fails the check on the probe)', async () => {
  const facts = await probeUrl(path.join(tmpdir(), 'brain-no-such-video.mp4'));
  assert.equal(facts.firstFrame, undefined);
  assert.equal(firstFrame(facts), undefined);
  const ok = { file: { bytes: 1e6 }, probe: { duration: 10, width: 1080, height: 1920, vcodec: 'h264', acodec: 'aac' }, lufs: -14 };
  assert.equal(firstFrame(ok), undefined);
  assert.equal(compare({ id: 'r', projectId: 'p' }, ok).pass, true);
});

// ---------- T9: advisory pipeline review ----------
const good = { file: { bytes: 1e6 }, probe: { duration: 10, width: 1080, height: 1920, vcodec: 'h264', acodec: 'aac' }, lufs: -14 };

test('T9: low pipeline review scores add an advisory field and never flip pass', () => {
  const c = compare({ id: 'r', projectId: 'p', review: { scores: { hook: 3, sell: 4, offer: 8 } } }, good);
  const f = c.fields.find((x) => x.field === 'pipeline review');
  assert.ok(f, 'field present'); assert.equal(f.advisory, true); assert.equal(f.pass, false);
  assert.match(f.actual, /hook 3/); assert.match(f.actual, /sell 4/);
  assert.equal(c.pass, true);
  const hi = compare({ id: 'r', projectId: 'p', review: { scores: { hook: 7, sell: 6 } } }, good);
  assert.equal(hi.fields.find((x) => x.field === 'pipeline review').pass, true);
  assert.equal(compare({ id: 'r', projectId: 'p' }, good).fields.some((x) => x.field === 'pipeline review'), false);
});

test('T9: local toRun carries the pipeline review; blockingCheck never lists advisory fields', () => {
  const r = toRun('20261125-a', { created: iso(NOW - 2 * H) }, { state: 'done', finished: iso(NOW - H), review: { scores: { hook: 3, sell: 9 } } }, '/x/final.mp4');
  assert.deepEqual(r.review, { scores: { hook: 3, sell: 9 } });
  const checks = { [r.id]: { runId: r.id, renderedAt: r.updatedAt, pass: false, fields: [{ field: 'duration', actual: '30 s', expected: '5–24.5 s', pass: false }, { field: 'pipeline review', actual: 'hook 3', expected: 'hook & sell ≥ 5', pass: false, advisory: true }] } };
  assert.deepEqual(blockingCheck(r, checks, NOW).map((f) => f.field), ['duration']);
});

// ---------- T6: batch projects block on the latest round ----------
const policy = { autoApprove: true, maxRunUsd: 3, maxDayUsd: 20, maxRunAgeH: 24 };
const bp = { id: 'batch:acw-bf', name: 'acw batch', brandName: 'acw', updatedAt: iso(NOW - H) };
const bstages = { projectId: bp.id, local: true, stages: ['setup', 'research', 'insights', 'creative', 'studio'].map((id) => ({ id, state: 'done' })) };
const brun = (file, hAgo) => ({ id: `batch:acw-bf:${file}`, local: true, managedBy: 'batch', projectId: bp.id, status: 'completed', finalPath: `/v/${file}`, retries: 0, hookType: file, engine: 'batch', updatedAt: iso(NOW - hAgo * H) });
const chk = (r, fields) => ({ runId: r.id, renderedAt: r.updatedAt, pass: fields.every((f) => f.pass), fields });
const ok = { field: 'duration', actual: '10 s', expected: '5–24.5 s', pass: true };
const longDur = { field: 'duration', actual: '31.80 s', expected: '5–24.5 s', pass: false };
const notMeasured = { field: 'loudness', actual: 'not measured', expected: '-14 LUFS ±1.5', pass: false };
const bloop = (runs, checks) => loopOf(bp, bstages, runs, [], 0, checks, policy, 0, NOW);

test('T6: a batch with a failing video in its latest round is blocked "N/M failed second check" even when the newest passes', () => {
  const runs = [brun('01.mp4', 3), brun('02.mp4', 2.5), brun('03.mp4', 1)];
  const checks = { [runs[0].id]: chk(runs[0], [longDur]), [runs[1].id]: chk(runs[1], [ok]), [runs[2].id]: chk(runs[2], [ok]) };
  const l = bloop(runs, checks);
  assert.equal(l.status, 'blocked'); assert.equal(l.agent, 'Doctor'); assert.equal(l.stage, 'verify');
  assert.match(l.doing, /^1\/3 failed second check/);
  assert.match(l.doing, /01\.mp4/);
  assert.equal(l.nextAction, 're-render with fitLength');
});

test('T6: failures of an older round and "loudness not measured" do not block the batch', () => {
  const old = brun('00-old.mp4', 5 * 24); const nm = brun('02.mp4', 2); const fine = brun('03.mp4', 1);
  const checks = { [old.id]: chk(old, [longDur]), [nm.id]: chk(nm, [ok, notMeasured]), [fine.id]: chk(fine, [ok]) };
  const l = bloop([old, nm, fine], checks);
  assert.equal(l.status, 'done', l.doing);
});

// ---------- T17: signatures ----------
test('T17: a prompt echo containing JSON is not parsed as a provider body', () => {
  const s = 'claude -p STORYBOARD e.g. keep the hook. Reply as {"message":"one line"} exited 1: rate limit';
  assert.equal(signatureOf(s), 'claude -p storyboard e.g. keep the hook. reply as {"message":"one line"} exited #: rate limit');
});

test('T17: sentence() keeps e.g. / i.e. inside the provider message', () => {
  assert.match(signatureOf('OpenRouter 400: {"error":{"message":"Bad input, e.g. a missing field. Retry later"}}'), /bad input, e\.g\. a missing field$/);
  assert.match(signatureOf('OpenRouter 400: {"error":{"message":"Bad size, i.e. not 9:16. Retry later"}}'), /bad size, i\.e\. not #:#$/);
});

test('T17: the live 401 and 402 signatures are unchanged; a bare provider body still uses the provider path', () => {
  assert.equal(signatureOf('401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_011ChMHAzEe8paV8cuKZ7MYQ"}'), '# 401 invalid x-api-key');
  assert.equal(signatureOf('OpenRouter 402: {"error":{"message":"This request requires at least $1.00 in balance for image or video output","code":402,"metadata":{"limit_source":"openrouter_key_limit"}}}'), 'openrouter #: 402 this request requires at least $# in balance for image or video output');
  assert.equal(signatureOf('{"error":{"message":"Internal error. Try again","code":500}}'), '500 internal error');
});

// ---------- T9 follow-up: the critic and harvest also ignore advisory fields ----------
import { withCritic } from '../lib/critic.mjs';
import { harvest } from '../lib/learn.mjs';

test('T9: a passing critic keeps pass true when only the advisory pipeline review is low', () => {
  const c0 = compare({ id: 'r', projectId: 'p', review: { scores: { hook: 2, sell: 3 } } }, good);
  const c = withCritic(c0, { model: 'google/x', avg: 8, pass: true, scores: { first_frame: 8, product_clear: 8, consistency: 8, no_garbled_text: 8, sells: 8, issues: [] } });
  assert.equal(c.fields.find((f) => f.field === 'pipeline review').pass, false);
  assert.equal(c.pass, true);
});

test('T9: 3 checks failing only the advisory pipeline review produce no learning', () => {
  const at = '2026-11-25T10:00:00.000Z';
  const checks = Object.fromEntries(['a', 'b', 'c'].map((id) => [id, { runId: id, renderedAt: at, pass: true, fields: [{ field: 'duration', pass: true }, { field: 'pipeline review', actual: 'hook 2', expected: 'hook & sell ≥ 5', pass: false, advisory: true }] }]));
  assert.deepEqual(harvest({ incidents: {}, checks, now: '2026-11-25T12:00:00.000Z' }), []);
});
