// Idle backoff wiring (2026-11-06): each worker, pointed at a stub API that never has work, must slow its
// claim polling down (doubling up to MAX_IDLE_POLL_MS) instead of claiming at a fixed interval.
// Run: node --test workers/idle-backoff.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WORKERS = [
  { dir: 'libtv-worker', tokenEnv: 'WORKER_TOKEN' },
  { dir: 'browser-worker', tokenEnv: 'BROWSER_WORKER_TOKEN' },
  { dir: 'research-worker', tokenEnv: 'WORKER_TOKEN' },
];

async function countClaims({ dir, tokenEnv }, env, ms) {
  let claims = 0;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (body.includes('"claim"')) claims++;
      res.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
      res.end('{}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const child = spawn(process.execPath, [fileURLToPath(new URL(`./${dir}/worker.mjs`, import.meta.url))], {
    env: { ...process.env, APP_URL: url, [tokenEnv]: 'test-token', ...env },
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, ms));
  child.kill('SIGKILL');
  await new Promise((r) => server.close(r));
  return claims;
}

for (const w of WORKERS) {
  test(`${w.dir}: idle claims back off (doubling, capped)`, { timeout: 20_000 }, async () => {
    // 50 ms base: a fixed poll would claim ~50 times in 2.5 s; 50+100+200+400+400+… claims ~9.
    const backoff = await countClaims(w, { POLL_INTERVAL_MS: '50', MAX_IDLE_POLL_MS: '400' }, 2500);
    assert.ok(backoff >= 3, `${w.dir} should still poll (got ${backoff})`);
    assert.ok(backoff <= 14, `${w.dir} polled ${backoff} times in 2.5 s — no idle backoff`);
    // the cap is honoured: a cap equal to the base means a fixed poll again
    const fixed = await countClaims(w, { POLL_INTERVAL_MS: '50', MAX_IDLE_POLL_MS: '50' }, 2500);
    assert.ok(fixed > backoff * 2, `${w.dir}: cap not read from MAX_IDLE_POLL_MS (fixed ${fixed} vs backoff ${backoff})`);
  });
}
