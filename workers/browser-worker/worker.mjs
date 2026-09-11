#!/usr/bin/env node
// worker.mjs
//
// Local Mac worker daemon: polls the deployed app's worker API for
// BrowserGenJob rows, dispatches each to a site-specific playbook that
// drives the operator's logged-in Chrome via `browser-harness`, uploads
// the resulting image/video to Cloudinary, and reports completion/failure
// back to the API.
//
// This process never touches the database directly — it only speaks HTTPS
// to /api/worker/browser-jobs, secured by header `x-worker-token`.
//
// Env vars:
//   APP_URL              default "https://creativeintel.vercel.app"
//   BROWSER_WORKER_TOKEN required — sent as x-worker-token on every request
//   WORKER_SITES         default "ai_studio" — comma-separated list of sites
//                        this worker instance is willing to claim (e.g.
//                        "ai_studio,flow,kling")
//   POLL_INTERVAL_MS     default 20000 — delay between claim attempts when idle
//
// Run: node worker.mjs   (see README.md for launchd setup)

import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

import { runGeminiAppJob } from './playbooks/gemini-app.mjs';
import { runFlowJob } from './playbooks/flow.mjs';

// ---- Config -----------------------------------------------------------

const APP_URL = (process.env.APP_URL || 'https://creativeintel.vercel.app').replace(/\/+$/, '');
const WORKER_TOKEN = process.env.BROWSER_WORKER_TOKEN || '';
const WORKER_SITES = (process.env.WORKER_SITES || 'ai_studio')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 20000);
const HEARTBEAT_INTERVAL_MS = 60 * 1000;

const WORKER_ID = `mac-browser-worker-${randomUUID().slice(0, 8)}`;

const API_ENDPOINT = `${APP_URL}/api/worker/browser-jobs`;

// NOTE: the "ai_studio" site key is retained for backward compatibility with
// existing BrowserGenJob rows/queue configs, but it now dispatches to the
// Gemini App (gemini.google.com) implementation — aistudio.google.com itself
// is a dead end for token-free generation (Nano Banana image models there
// require a linked paid API billing account). See gemini-app.mjs.
const PLAYBOOKS = {
  ai_studio: runGeminiAppJob,
  flow: runFlowJob,
};

// ---- Logging ------------------------------------------------------------

function log(...args) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${WORKER_ID}]`, ...args);
}

function logError(...args) {
  const ts = new Date().toISOString();
  console.error(`[${ts}] [${WORKER_ID}]`, ...args);
}

// ---- API client ------------------------------------------------------

async function callWorkerApi(action, payload = {}) {
  if (!WORKER_TOKEN) {
    throw new Error('BROWSER_WORKER_TOKEN is not set — refusing to call worker API without auth');
  }
  const res = await fetch(API_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-worker-token': WORKER_TOKEN,
    },
    body: JSON.stringify({ action, ...payload }),
  });

  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  if (!res.ok) {
    throw new Error(`worker API ${action} failed: HTTP ${res.status} ${JSON.stringify(body).slice(0, 500)}`);
  }
  return body;
}

async function claimJob() {
  // Contract: POST { action: "claim", workerId, sites } -> { job } | { job: null }
  const body = await callWorkerApi('claim', { workerId: WORKER_ID, sites: WORKER_SITES });
  return body.job || null;
}

async function completeJob(id, resultUrl) {
  // Contract: POST { action: "complete", id, resultUrl } -> ok
  return callWorkerApi('complete', { id, resultUrl });
}

async function failJob(id, error) {
  // Contract: POST { action: "fail", id, error } -> ok
  return callWorkerApi('fail', { id, error: String(error && error.message ? error.message : error).slice(0, 2000) });
}

async function heartbeat(id) {
  // Contract: POST { action: "heartbeat", id, workerId } -> ok
  try {
    await callWorkerApi('heartbeat', { id, workerId: WORKER_ID });
  } catch (err) {
    logError('heartbeat failed (non-fatal):', err.message || err);
  }
}

// ---- Cloudinary upload --------------------------------------------------

let cloudinaryConfigured = false;

async function getCloudinary() {
  const { v2: cloudinary } = await import('cloudinary');
  if (!cloudinaryConfigured) {
    if (process.env.CLOUDINARY_URL) {
      // The cloudinary SDK auto-reads CLOUDINARY_URL from env on import, but we
      // config explicitly too in case it was set after module load (e.g. dotenv).
      cloudinary.config(true); // true = read from CLOUDINARY_URL env var
    } else if (
      process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
    ) {
      cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
      });
    } else {
      throw new Error(
        'Cloudinary is not configured: set CLOUDINARY_URL or CLOUDINARY_CLOUD_NAME/CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET'
      );
    }
    cloudinaryConfigured = true;
  }
  return cloudinary;
}

async function uploadToCloudinary(filePath, job) {
  const cloudinary = await getCloudinary();
  const resourceType = job.kind === 'video' ? 'video' : 'image';
  const result = await cloudinary.uploader.upload(filePath, {
    resource_type: resourceType,
    folder: 'browser-gen-jobs',
    public_id: `${job.site}-${job.id}`,
    overwrite: true,
  });
  return result.secure_url;
}

// ---- Job dispatch --------------------------------------------------------

async function runJob(job) {
  const playbook = PLAYBOOKS[job.site];
  if (!playbook) {
    throw new Error(`No playbook registered for site "${job.site}"`);
  }
  return playbook(job);
}

async function processJob(job) {
  log(`claimed job ${job.id} (site=${job.site}, kind=${job.kind})`);

  let heartbeatTimer;
  try {
    heartbeatTimer = setInterval(() => {
      heartbeat(job.id);
    }, HEARTBEAT_INTERVAL_MS);

    const { filePath } = await runJob(job);
    log(`job ${job.id}: playbook produced file ${filePath}, uploading to Cloudinary`);

    const resultUrl = await uploadToCloudinary(filePath, job);
    log(`job ${job.id}: uploaded to ${resultUrl}`);

    await completeJob(job.id, resultUrl);
    log(`job ${job.id}: marked complete`);

    // Best-effort local cleanup; don't fail the job over a cleanup error.
    try {
      await unlink(filePath);
    } catch {
      // ignore
    }
  } catch (err) {
    logError(`job ${job.id} failed:`, err && err.message ? err.message : err);
    try {
      await failJob(job.id, err);
    } catch (reportErr) {
      logError(`job ${job.id}: also failed to report failure to API:`, reportErr.message || reportErr);
    }
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  }
}

// ---- Main loop ------------------------------------------------------------

let shuttingDown = false;

async function mainLoop() {
  log(`starting. APP_URL=${APP_URL} WORKER_SITES=${WORKER_SITES.join(',')} POLL_INTERVAL_MS=${POLL_INTERVAL_MS}`);

  if (!WORKER_TOKEN) {
    logError('BROWSER_WORKER_TOKEN is not set. Exiting.');
    process.exit(1);
  }

  while (!shuttingDown) {
    let job = null;
    try {
      job = await claimJob();
    } catch (err) {
      logError('claim failed:', err.message || err);
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    if (!job) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    // Cap one job at a time by awaiting fully before looping back to claim.
    await processJob(job);
  }

  log('main loop exited, shutdown complete.');
}

function handleShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`received ${signal}, finishing current job (if any) then exiting...`);
  // The current in-flight processJob() await in mainLoop will complete its
  // iteration; the while(!shuttingDown) check then stops the loop. We do not
  // forcibly kill an in-progress browser-harness step, to avoid leaving Chrome
  // or temp files in a half-finished state.
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

mainLoop().catch((err) => {
  logError('fatal error in main loop:', err);
  process.exit(1);
});
