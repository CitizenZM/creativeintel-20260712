// incidents: dedup memory beyond the 20 display runs + 401 credential runbook; probes: launchd verdict (read-only)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { aggregate, classify, IDS_CAP, signatureOf } from '../lib/incidents.mjs';
import { buildDigest } from '../lib/digest.mjs';
import { launchdVerdict } from '../lib/probes.mjs';

const NOW = Date.parse('2026-11-25T12:00:00Z');
const at = (h) => new Date(NOW - h * 3_600_000).toISOString();
const failed = (n) => Array.from({ length: n }, (_, i) => ({ id: `run-${String(i).padStart(30, '0')}`, status: 'failed', error: 'fetch failed', updatedAt: at(1) }));

test('aggregate: re-seeing the same 25 failed runs does not inflate count; display stays at 20', () => {
  const runs = failed(25);
  const m1 = aggregate({}, runs, NOW);
  const m2 = aggregate(m1, runs, NOW);
  const [inc] = Object.values(m2);
  assert.equal(inc.count, 25);
  assert.equal(inc.runs.length, 20);
  assert.equal(inc.ids.length, 25);
});

test('aggregate: old entries without ids migrate from runs (no double count)', () => {
  const runs = failed(3);
  const old = Object.fromEntries(Object.entries(aggregate({}, runs, NOW)).map(([k, v]) => { const rest = { ...v }; delete rest.ids; return [k, rest]; }));
  const [inc] = Object.values(aggregate(old, runs, NOW));
  assert.equal(inc.count, 3);
  assert.deepEqual(inc.ids, runs.map((r) => r.id));
});

test('aggregate: ids are capped; worst-case snapshot (40 incidents x cap ids) stays well under SNAPSHOT_MAX_BYTES', async () => {
  const [inc] = Object.values(aggregate({}, failed(IDS_CAP + 30), NOW));
  assert.equal(inc.ids.length, IDS_CAP);
  const src = await readFile(new URL('../../../src/services/brain/contract.ts', import.meta.url), 'utf8');
  const max = Number(src.match(/SNAPSHOT_MAX_BYTES\s*=\s*([\d_]+)/)[1].replace(/_/g, ''));
  const runId = 'x'.repeat(34); // live run ids are 34 chars
  const worst = JSON.stringify(Array.from({ length: 40 }, () => ({ ...inc, ids: Array(IDS_CAP).fill(runId) }))).length; // brain.mjs publishes up to 40 incidents
  assert.ok(worst < max / 2, `40 incidents x ${IDS_CAP} ids = ${worst} bytes, must leave half of ${max} for the rest of the snapshot`);
});

const AUTH = '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_011ChMHAzEe8paV8cuKZ7MYQ"}';

test('classify: 401 authentication_error is a human credential incident, no retry; digest names it', () => {
  const c = classify(AUTH);
  assert.equal(c.kind, 'human');
  assert.equal(c.retry, false);
  assert.match(c.runbook, /credential rejected \(401\)/);
  for (const e of ['Unauthorized', 'OpenRouter 401: No auth credentials found', 'invalid_api_key']) assert.equal(classify(e).kind, 'human', e);
  const incidents = Object.values(aggregate({}, [{ id: 'a1', error: AUTH, updatedAt: at(1) }], NOW));
  const text = buildDigest({ at: new Date(NOW).toISOString(), incidents });
  assert.match(text, /credential rejected/);
});

test('classify: a Shopify CDN 403 is not a credential incident (no 403/forbidden in the 401 rule)', () => {
  const c = classify('GET https://cdn.shopify.com/x.png -> 403');
  assert.notEqual(c.kind, 'human');
  assert.notEqual(classify('403 Forbidden').kind, 'human');
});

test('launchdVerdict: PID present = running, whatever the last exit', () => {
  const dict = `{\n\t"StandardOutPath" = "/tmp/w.log";\n\t"LimitLoadToSessionType" = "Aqua";\n\t"Label" = "co.celldigital.adstudio-worker";\n\t"OnDemand" = false;\n\t"LastExitStatus" = -15;\n\t"PID" = 43032;\n\t"Program" = "/usr/local/bin/node";\n};`;
  assert.deepEqual(launchdVerdict(dict), { ok: true, detail: 'PID 43032, last exit -15' });
  assert.deepEqual(launchdVerdict(dict.replace('-15', '0')), { ok: true, detail: 'PID 43032, last exit 0' });
});

test('launchdVerdict: no PID = not running', () => {
  const v = launchdVerdict(`{\n\t"Label" = "co.celldigital.adstudio-worker";\n\t"LastExitStatus" = 256;\n};`);
  assert.equal(v.ok, false);
  assert.match(v.detail, /not running/);
  assert.match(v.detail, /last exit 256/);
});

test('wiring: the adstudio worker (launchd) probe uses launchdVerdict on launchctl list, 10 s timeout', async () => {
  const src = await readFile(new URL('../lib/probes.mjs', import.meta.url), 'utf8');
  assert.match(src, /export function launchdVerdict\(/);
  const line = src.split('\n').find((l) => l.includes("'adstudio worker (launchd)'"));
  assert.match(line || '', /launchdProbe\('adstudio worker \(launchd\)', 'co\.celldigital\.adstudio-worker'\)/);
  const body = src.slice(src.indexOf('async function launchdProbe('), src.indexOf('\n}\n', src.indexOf('async function launchdProbe(')));
  assert.match(body, /pexec\('launchctl', \['list', label\], \{ timeout: 10_000 \}\)/);
  assert.match(body, /launchdVerdict\(stdout\)/);
  assert.doesNotMatch(body, /kickstart|kill|bootout|unload|stop/, 'read-only: never restarts or stops the service');
});

// I8: an incident classified before a runbook existed must be re-classified from its sample on every aggregate
test('aggregate: a stored open incident is re-classified from its sample (401 stored as code -> human); counts and ids kept', () => {
  const sig = '# {"type":"error"...}';
  const prev = { [sig]: { signature: sig, kind: 'code', runbook: 'unknown cause: Doctor diagnoses it and opens a fix PR with a failing test', sample: AUTH, count: 7, firstSeen: at(30), lastSeen: at(2), status: 'open', runs: ['r1', 'r2'], ids: ['r1', 'r2'] } };
  const out = aggregate(prev, [], NOW);
  assert.equal(Object.keys(out).length, 1);
  const [inc] = Object.values(out); // S4: re-keyed from its sample (request_id no longer part of the signature)
  assert.equal(inc.kind, 'human');
  assert.match(inc.runbook, /credential rejected \(401\)/);
  assert.equal(inc.signature, signatureOf(AUTH));
  assert.equal(inc.count, 7);
  assert.deepEqual(inc.ids, ['r1', 'r2']);
  assert.match(buildDigest({ at: new Date(NOW).toISOString(), incidents: [inc] }), /credential rejected/);
});

test('aggregate: a resolved incident is not re-classified', () => {
  const prev = { s: { signature: 's', kind: 'code', runbook: 'old', sample: AUTH, count: 1, firstSeen: at(100), lastSeen: at(90), status: 'resolved', runs: [], ids: [] } };
  assert.equal(Object.values(aggregate(prev, [], NOW))[0].kind, 'code');
});

test('classify: ENOSPC / no space left is a human disk-full incident, no retry (not transient)', () => {
  for (const e of ["ENOSPC: no space left on device, write '/Users/x/out.mp4'", 'ffmpeg: No space left on device (timeout after write)']) {
    const c = classify(e);
    assert.equal(c.kind, 'human', e);
    assert.equal(c.retry, false, e);
    assert.match(c.runbook, /disk full/);
  }
  const inc = Object.values(aggregate({}, [{ id: 'd1', error: 'ENOSPC: no space left on device', updatedAt: at(1) }], NOW))[0];
  assert.equal(inc.kind, 'human');
});

// C1: a slow tick makes every probe time out together; only a failure that repeats on a sequential re-run is a FAIL
import * as probesLib from '../lib/probes.mjs';
const { balanceVerdict } = probesLib;
const confirmFailures = (...a) => probesLib.confirmFailures(...a);
const P = (name, ok, detail = '') => ({ name, ok, detail, at: 't' });

test('confirmFailures: failed probes are re-run sequentially; pass on re-run = ok, fail again = FAIL', async () => {
  const order = [];
  let inFlight = 0, maxInFlight = 0;
  const rerun = async (name) => { inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); order.push(name); await new Promise((r) => setTimeout(r, 5)); inFlight--; return name === 'b' ? P('b', true, 'fine') : P(name, false, 'still broken'); };
  const out = await confirmFailures([P('a', true, 'x'), P('b', false, ''), P('c', false, '')], rerun, 60_000);
  assert.deepEqual(order, ['b', 'c'], 'only failed probes are re-run, in order');
  assert.equal(maxInFlight, 1, 'sequential');
  assert.deepEqual(out.map((r) => [r.name, r.ok]), [['a', true], ['b', true], ['c', false]]);
  assert.equal(out[2].detail, 'still broken');
});

test('confirmFailures: total budget; a probe not re-run keeps its first result; empty detail -> timeout/no output', async () => {
  let t = 0;
  const clock = () => t;
  const rerun = async (name) => { t += 40_000; return P(name, false, ''); };
  const out = await confirmFailures([P('a', false, ''), P('b', false, ''), P('c', false, 'first')], rerun, 60_000, clock);
  // a re-run at t=0 (ends 40 s), b re-run at 40 s (ends 80 s), c: budget exhausted -> first result kept
  assert.deepEqual(out.map((r) => r.ok), [false, false, false]);
  assert.equal(out[0].detail, 'timeout/no output');
  assert.equal(out[1].detail, 'timeout/no output');
  assert.equal(out[2].detail, 'first');
});

test('confirmFailures: a re-run that hangs past the remaining budget keeps the first result', async () => {
  const out = await confirmFailures([P('slow', false, '')], () => new Promise(() => {}), 30);
  assert.equal(out[0].ok, false);
  assert.equal(out[0].detail, 'timeout/no output');
});

test('confirmFailures: openrouter balance still FAILS when the balance is low on both runs', async () => {
  const low = balanceVerdict(1.2);
  assert.equal(low.ok, false);
  const out = await confirmFailures([low], async () => balanceVerdict(1.1), 60_000);
  assert.equal(out[0].ok, false);
  assert.equal(out[0].name, 'openrouter balance');
  assert.match(out[0].detail, /\$1\.10 left/);
});

test('wiring: runProbes confirms failures with a 60 s total budget before returning', async () => {
  const src = await readFile(new URL('../lib/probes.mjs', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export async function runProbes('));
  assert.match(body, /const res = await confirmFailures\(await Promise\.all\(.*\), 60_000\);/);
});
