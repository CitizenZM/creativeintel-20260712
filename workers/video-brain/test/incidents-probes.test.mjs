// incidents: dedup memory beyond the 20 display runs + 401 credential runbook; probes: launchd verdict (read-only)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { aggregate, classify, IDS_CAP } from '../lib/incidents.mjs';
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
