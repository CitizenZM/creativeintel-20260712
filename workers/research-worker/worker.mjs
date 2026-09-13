#!/usr/bin/env node
// worker.mjs
//
// Local Mac worker daemon for research WorkerTasks. Polls the deployed app for
// `ad_library_fetch` tasks, drives the operator's ego-browser (ego-lite)
// against the three public ad libraries, and posts AdCandidate[] back.
//
// This process never touches the database — it only speaks HTTPS to
// /api/worker/tasks, secured by header `x-worker-token`.
//
// Env vars:
//   APP_URL          default "https://creativeintel.vercel.app"
//   WORKER_TOKEN     required — sent as x-worker-token on every request
//   WORKER_KINDS     default "ad_library_fetch"
//   POLL_INTERVAL_MS default 6000 — delay between claim attempts when idle;
//                    kept short because browser_fetch tasks block a research run
//   EGO_BROWSER_BIN  default "ego-browser"
//
// Run: node worker.mjs   (see README.md for launchd setup)

import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import { runMetaAdLibrary } from './playbooks/meta-ad-library.mjs';
import { runTikTokAdLibrary } from './playbooks/tiktok-ad-library.mjs';
import { runGoogleAdsTransparency } from './playbooks/google-ads-transparency.mjs';
import { runBrowserFetch } from './playbooks/browser-fetch.mjs';

// ---- Config -----------------------------------------------------------

const APP_URL = (process.env.APP_URL || 'https://creativeintel.vercel.app').replace(/\/+$/, '');
const WORKER_TOKEN = process.env.WORKER_TOKEN || '';
// Vercel Deployment Protection (SSO) is on for this project; without the bypass
// secret every API call is answered with an HTML login page.
const VERCEL_BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '';
const WORKER_KINDS =(process.env.WORKER_KINDS || 'ad_library_fetch,browser_fetch')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 6000);
const HEARTBEAT_INTERVAL_MS = 60 * 1000;
// Public sites get a breather between tasks so a queue burst never reads as a crawl.
const COOLDOWN_MS = Number(process.env.TASK_COOLDOWN_MS || 15000);

const WORKER_ID = `mac-research-worker-${randomUUID().slice(0, 8)}`;
const API_ENDPOINT = `${APP_URL}/api/worker/tasks`;

const PLAYBOOKS = {
  meta: runMetaAdLibrary,
  tiktok: runTikTokAdLibrary,
  google: runGoogleAdsTransparency,
};

// ---- Logging ------------------------------------------------------------

function log(...args) {
  console.log(`[${new Date().toISOString()}] [${WORKER_ID}]`, ...args);
}

function logError(...args) {
  console.error(`[${new Date().toISOString()}] [${WORKER_ID}]`, ...args);
}

// ---- API client ---------------------------------------------------------

async function callWorkerApi(action, payload = {}) {
  if (!WORKER_TOKEN) {
    throw new Error('WORKER_TOKEN is not set — refusing to call the worker API without auth');
  }
  const headers = { 'content-type': 'application/json', 'x-worker-token': WORKER_TOKEN };
  if (VERCEL_BYPASS) headers['x-vercel-protection-bypass'] = VERCEL_BYPASS;
  const res = await fetch(API_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action, ...payload }),
  });

  const text = await res.text();
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('text/html') || /<html/i.test(text.slice(0, 200))) {
    throw new Error(
      `worker API ${action} was answered with an HTML page (HTTP ${res.status}) — blocked by Vercel Deployment Protection. Set VERCEL_AUTOMATION_BYPASS_SECRET (Vercel → Settings → Deployment Protection → Protection Bypass for Automation).`
    );
  }
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  if (!res.ok) {
    throw new Error(
      `worker API ${action} failed: HTTP ${res.status} ${JSON.stringify(body).slice(0, 500)}`
    );
  }
  return body;
}

async function claimTask() {
  const body = await callWorkerApi('claim', { workerId: WORKER_ID, kinds: WORKER_KINDS });
  return body.task || null;
}

async function completeTask(id, result) {
  return callWorkerApi('complete', { id, result });
}

async function failTask(id, error) {
  return callWorkerApi('fail', {
    id,
    error: String(error?.message ?? error).slice(0, 2000),
  });
}

async function heartbeat(id) {
  try {
    await callWorkerApi('heartbeat', { id });
  } catch (err) {
    logError('heartbeat failed (non-fatal):', err.message || err);
  }
}

// ---- Task dispatch ------------------------------------------------------

async function runTask(task) {
  const payload = task.payload || {};

  // A plain page fetch — the app asks for this when its own server-side fetch
  // was refused by the site. It returns a page, not ad candidates.
  if (task.kind === 'browser_fetch') {
    const { result, note } = await runBrowserFetch(payload);
    if (!result) throw new Error(note || 'browser_fetch produced no page');
    return { result, note };
  }

  const playbook = PLAYBOOKS[payload.source];
  if (!playbook) {
    throw new Error(`No playbook registered for source "${payload.source}"`);
  }
  if (!payload.advertiser) {
    throw new Error('payload.advertiser is required');
  }
  return playbook(payload);
}

async function processTask(task) {
  log(
    `claimed task ${task.id} (kind=${task.kind}` +
      (task.kind === 'browser_fetch'
        ? `, url="${task.payload?.url}")`
        : `, source=${task.payload?.source}, advertiser="${task.payload?.advertiser}")`)
  );

  let heartbeatTimer;
  try {
    heartbeatTimer = setInterval(() => {
      heartbeat(task.id);
    }, HEARTBEAT_INTERVAL_MS);

    const { candidates, result, note } = await runTask(task);
    if (result) {
      log(`task ${task.id}: ${note}`);
      await completeTask(task.id, result);
      log(`task ${task.id}: complete (browser_fetch)`);
    } else {
      log(`task ${task.id}: ${candidates.length} candidates — ${note}`);
      const res = await completeTask(task.id, { candidates });
      log(`task ${task.id}: complete (accepted ${res.accepted ?? 0}, saved ${res.saved ?? 0})`);
    }
  } catch (err) {
    logError(`task ${task.id} failed:`, err?.message || err);
    try {
      await failTask(task.id, err);
    } catch (reportErr) {
      logError(`task ${task.id}: also failed to report failure:`, reportErr.message || reportErr);
    }
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  }
}

// ---- Main loop ----------------------------------------------------------

let shuttingDown = false;

async function mainLoop() {
  log(`starting. APP_URL=${APP_URL} KINDS=${WORKER_KINDS.join(',')} POLL_INTERVAL_MS=${POLL_INTERVAL_MS}`);

  if (!WORKER_TOKEN) {
    logError('WORKER_TOKEN is not set. Exiting.');
    process.exit(1);
  }

  while (!shuttingDown) {
    let task = null;
    try {
      task = await claimTask();
    } catch (err) {
      logError('claim failed:', err.message || err);
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    if (!task) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    // One task at a time: the browser is a single shared resource.
    await processTask(task);
    // The cooldown exists so a queue burst against an ad library does not read
    // as a crawl. A browser_fetch is a single ordinary page load and a research
    // run is blocked waiting on it, so it does not serve its purpose there.
    if (task.kind !== 'browser_fetch') await sleep(COOLDOWN_MS);
  }

  log('main loop exited, shutdown complete.');
}

function handleShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`received ${signal}, finishing the current task (if any) then exiting...`);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

mainLoop().catch((err) => {
  logError('fatal error in main loop:', err);
  process.exit(1);
});
