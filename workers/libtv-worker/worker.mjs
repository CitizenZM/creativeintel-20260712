#!/usr/bin/env node
// worker.mjs
//
// Local Mac worker for LibTV runs. Claims an approved LibtvRun from the
// deployed app over HTTPS, binds a canvas, walks the node graph with the
// `libtv` CLI (which needs the operator's browser login, hence "local"),
// downloads every keyframe and clip, assembles the cut locally with
// assemble.py, and reports per-node status back. It never touches the DB.
//
// Env:
//   APP_URL                 default "https://creativeintel.vercel.app"
//   WORKER_TOKEN            required — sent as x-worker-token
//   LIBTV_BIN               default "~/.libtv/libtv"
//   LIBTV_RUNS_DIR          default "~/Projects/libtv-ad-studio/runs"
//   POLL_INTERVAL_MS        default 20000
//   CLOUDINARY_URL          (or CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET)
//   BLOB_READ_WRITE_TOKEN   fallback storage
//   LIBTV_MUSIC_FILE        optional music bed; enables the aubio beat grid
//
// Flags:
//   --dry-run       print every libtv/ffmpeg command instead of running it
//   --fixture[=p]   read a run payload from JSON instead of claiming one
//                   (default fixtures/run.json); no API calls are made
//   --once          process at most one run, then exit
//
// Run: node worker.mjs   (see README.md for launchd setup)

import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as sleep } from 'node:timers/promises';

import { createLibtvCli, LibtvAuthError } from './libtv-cli.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---- Config ---------------------------------------------------------------

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const ONCE = argv.includes('--once');
const fixtureArg = argv.find((a) => a === '--fixture' || a.startsWith('--fixture='));
const FIXTURE_PATH = fixtureArg
  ? fixtureArg.includes('=')
    ? fixtureArg.split('=').slice(1).join('=')
    : path.join(HERE, 'fixtures', 'run.json')
  : null;

const APP_URL = (process.env.APP_URL || 'https://creativeintel.vercel.app').replace(/\/+$/, '');
const WORKER_TOKEN = process.env.WORKER_TOKEN || '';
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 20000);
const HEARTBEAT_INTERVAL_MS = 60 * 1000;
const RUNS_DIR =
  process.env.LIBTV_RUNS_DIR || path.join(homedir(), 'Projects', 'libtv-ad-studio', 'runs');
const API_ENDPOINT = `${APP_URL}/api/worker/libtv`;
const WORKER_ID = `mac-libtv-worker-${randomUUID().slice(0, 8)}`;

function log(...args) {
  console.log(`[${new Date().toISOString()}] [${WORKER_ID}]`, ...args);
}

function logError(...args) {
  console.error(`[${new Date().toISOString()}] [${WORKER_ID}]`, ...args);
}

// ---- API client -----------------------------------------------------------

async function callWorkerApi(action, payload = {}) {
  if (FIXTURE_PATH) {
    log(`[fixture] would report ${action}`, JSON.stringify(payload).slice(0, 300));
    return {};
  }
  if (!WORKER_TOKEN) {
    throw new Error('WORKER_TOKEN is not set — refusing to call the worker API without auth');
  }
  const res = await fetch(API_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-worker-token': WORKER_TOKEN },
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

const api = {
  claim: () => callWorkerApi('claim', { workerId: WORKER_ID }).then((b) => b.run || null),
  bindCanvas: (runId, canvasUuid, canvasName) =>
    callWorkerApi('bind_canvas', { runId, workerId: WORKER_ID, canvasUuid, canvasName }),
  jobStarted: (jobId) => callWorkerApi('job_started', { jobId }),
  jobDone: (payload) => callWorkerApi('job_done', payload),
  jobFailed: (jobId, error) => callWorkerApi('job_failed', { jobId, error: String(error).slice(0, 2000) }),
  runAssembling: (runId) => callWorkerApi('run_assembling', { runId }),
  runDone: (payload) => callWorkerApi('run_done', payload),
  runFailed: (runId, error, needsLogin = false) =>
    callWorkerApi('run_failed', { runId, error: String(error).slice(0, 2000), needsLogin }),
  heartbeat: (runId) =>
    callWorkerApi('heartbeat', { runId, workerId: WORKER_ID }).catch((err) =>
      logError('heartbeat failed (non-fatal):', err.message || err)
    ),
};

// ---- Storage --------------------------------------------------------------

function cloudinaryConfigured() {
  return (
    !!process.env.CLOUDINARY_URL ||
    (!!process.env.CLOUDINARY_CLOUD_NAME && !!process.env.CLOUDINARY_API_KEY && !!process.env.CLOUDINARY_API_SECRET)
  );
}

let cloudinaryReady = false;

async function uploadToCloudinary(filePath, { folder, publicId, resourceType }) {
  const { v2: cloudinary } = await import('cloudinary');
  if (!cloudinaryReady) {
    if (process.env.CLOUDINARY_URL) {
      cloudinary.config(true);
    } else {
      cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
        secure: true,
      });
    }
    cloudinaryReady = true;
  }
  const result = await cloudinary.uploader.upload(filePath, {
    resource_type: resourceType,
    folder,
    public_id: publicId,
    overwrite: true,
  });
  return result.secure_url;
}

async function uploadToBlob(filePath, { folder, publicId, contentType }) {
  const { put } = await import('@vercel/blob');
  const buffer = await readFile(filePath);
  const res = await put(`${folder}/${publicId}${path.extname(filePath)}`, buffer, {
    access: 'public',
    contentType,
    token: process.env.BLOB_READ_WRITE_TOKEN,
    addRandomSuffix: true,
  });
  return res.url;
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mp4' || ext === '.mov') return 'video/mp4';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

/** Falls back to file:// so a credential-less operator still gets a working run. */
async function publishFile(filePath, { runId, nodeName, kind }) {
  const folder = `creativeintel/libtv/${runId}`;
  const resourceType = kind === 'video' ? 'video' : 'image';

  if (DRY_RUN) {
    log(`[dry-run] would publish ${filePath} as ${folder}/${nodeName}`);
    return { url: `file://${filePath}`, provider: 'dry-run' };
  }

  if (cloudinaryConfigured()) {
    try {
      return { url: await uploadToCloudinary(filePath, { folder, publicId: nodeName, resourceType }), provider: 'cloudinary' };
    } catch (err) {
      logError('cloudinary upload failed, falling back:', err.message || err);
    }
  }

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      return {
        url: await uploadToBlob(filePath, { folder, publicId: nodeName, contentType: contentTypeFor(filePath) }),
        provider: 'vercel-blob',
      };
    } catch (err) {
      logError('vercel blob upload failed, falling back:', err.message || err);
    }
  }

  logError(
    `WARNING: no storage provider configured (CLOUDINARY_URL / BLOB_READ_WRITE_TOKEN). ` +
      `Reporting a local file:// path for ${nodeName}; the dashboard will not be able to show it.`
  );
  return { url: `file://${filePath}`, provider: 'local' };
}

// ---- Helpers --------------------------------------------------------------

async function downloadToFile(url, destPath) {
  if (DRY_RUN) {
    log(`[dry-run] would download ${url} -> ${destPath}`);
    return destPath;
  }
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`failed to download ${url}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(destPath));
  return destPath;
}

function extensionForUrl(url, fallback = '.png') {
  try {
    const ext = path.extname(new URL(url).pathname);
    return ext && ext.length <= 5 ? ext : fallback;
  } catch {
    return fallback;
  }
}

function runProcess(cmd, args, { cwd } = {}) {
  const printable = [cmd, ...args].map((a) => (/[\s"']/.test(a) ? JSON.stringify(a) : a)).join(' ');
  if (DRY_RUN) {
    log(`[dry-run] ${printable}`);
    return Promise.resolve({ code: 0, stdout: '', stderr: '' });
  }
  log(`$ ${printable}`);
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: process.env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString();
      process.stdout.write(d);
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
      process.stderr.write(d);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-1200)}`));
      else resolve({ code, stdout, stderr });
    });
  });
}

function sanitize(name) {
  return String(name || '')
    .replace(/[^a-zA-Z0-9 _.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---- Run execution --------------------------------------------------------

async function prepareRunDir(runId) {
  const runDir = path.join(RUNS_DIR, runId);
  for (const sub of ['refs', 'keyframes', 'clips', 'composites', 'final']) {
    await mkdir(path.join(runDir, sub), { recursive: true });
  }
  return runDir;
}

async function bindCanvas(payload, cli, runDir) {
  const existing = payload.run.canvasUuid || payload.project?.libtvCanvasUuid;
  if (existing) {
    log(`binding existing canvas ${existing}`);
    await cli.projectUse(existing);
    return existing;
  }

  const name =
    sanitize(
      payload.run.canvasName ||
        `CI ${payload.project?.brandName || 'brand'} ${payload.scriptTitle || payload.storyboardTitle || 'ad'} ${payload.run.id.slice(0, 8)}`
    ).slice(0, 60) || `CI run ${payload.run.id.slice(0, 8)}`;

  log(`creating canvas "${name}"`);
  const { uuid } = await cli.projectCreate(name);
  await cli.projectUse(uuid);
  await writeFile(path.join(runDir, 'canvas.json'), JSON.stringify({ uuid, name }, null, 2));
  await api.bindCanvas(payload.run.id, uuid, name);
  return uuid;
}

function nodeSettings(job) {
  const out = {};
  for (const [key, value] of Object.entries(job.settings || {})) {
    if (key === 'compositeLocally' || key === 'frameNumber' || key === 'segment') continue;
    out[key] = value;
  }
  return out;
}

async function executeJob(job, { cli, runDir, runId }) {
  if (job.kind === 'upload') {
    const ext = extensionForUrl(job.sourceUrl || '', '.png');
    const dest = path.join(runDir, 'refs', `${job.nodeName}${ext}`);
    await downloadToFile(job.sourceUrl, dest);
    const { nodeId } = await cli.upload(job.nodeName, dest, '图片');
    return { nodeId, resultUrl: job.sourceUrl, localPath: dest, creditsSpent: 0 };
  }

  if (job.settings?.compositeLocally) {
    log(`node ${job.nodeName}: composited locally (CTA/end card), skipping LibTV`);
    return { skipped: true, creditsSpent: 0 };
  }

  const outDir = path.join(runDir, job.kind === 'video' ? 'clips' : 'keyframes');
  const { nodeId } = await cli.nodeCreate({
    nodeName: job.nodeName,
    type: job.kind === 'video' ? 'video' : 'image',
    leftRefs: job.leftRefs || [],
    prompt: job.prompt,
    modelName: job.modelName,
    settings: nodeSettings(job),
    run: true,
  });

  const { filePath } = await cli.download({
    nodeName: job.nodeName,
    outDir,
    expectedExt: job.kind === 'video' ? '.mp4' : '.png',
  });
  const published = await publishFile(filePath, { runId, nodeName: job.nodeName, kind: job.kind });

  return {
    nodeId,
    resultUrl: published.url,
    localPath: filePath,
    creditsSpent: job.creditsEstimated ?? 0,
  };
}

async function assemble(payload, runDir) {
  const script = path.join(HERE, 'assemble.py');
  const args = [
    script,
    '--run-dir',
    runDir,
    '--aspect',
    payload.run.aspectRatio || '9:16',
    '--frame-seconds',
    '2',
  ];
  if (process.env.LIBTV_MUSIC_FILE) args.push('--music', process.env.LIBTV_MUSIC_FILE);
  if (DRY_RUN) args.push('--dry-run');

  await runProcess('python3', args, { cwd: runDir });

  return {
    master: path.join(runDir, 'final', 'master.mp4'),
    preview: path.join(runDir, 'final', 'preview-720p.mp4'),
    contactSheet: path.join(runDir, 'final', 'contact-sheet.jpg'),
  };
}

async function processRun(payload) {
  const runId = payload.run.id;
  log(`claimed run ${runId} (${payload.jobs.length} nodes, est. ${payload.run.creditsEstimated} credits)`);

  const runDir = await prepareRunDir(runId);
  await writeFile(path.join(runDir, 'run.json'), JSON.stringify(payload, null, 2));

  const cli = createLibtvCli({ cwd: runDir, dryRun: DRY_RUN, log });
  const heartbeatTimer = setInterval(() => api.heartbeat(runId), HEARTBEAT_INTERVAL_MS);

  let creditsSpent = 0;
  try {
    await bindCanvas(payload, cli, runDir);

    const manifest = { runId, frames: payload.frames, nodes: [] };

    for (const job of payload.jobs) {
      await api.jobStarted(job.id);
      try {
        const result = await executeJob(job, { cli, runDir, runId });
        creditsSpent += result.creditsSpent ?? 0;
        manifest.nodes.push({
          nodeName: job.nodeName,
          kind: job.kind,
          shotIndex: job.shotIndex,
          segment: job.settings?.segment ?? null,
          frameNumber: job.settings?.frameNumber ?? null,
          localPath: result.localPath ?? null,
          resultUrl: result.resultUrl ?? null,
          skipped: !!result.skipped,
        });
        await api.jobDone({
          jobId: job.id,
          nodeId: result.nodeId,
          resultUrl: result.resultUrl,
          localPath: result.localPath,
          creditsSpent: result.creditsSpent,
          skipped: result.skipped,
        });
      } catch (err) {
        if (err instanceof LibtvAuthError) throw err;
        logError(`node ${job.nodeName} failed:`, err.message || err);
        await api.jobFailed(job.id, err.message || err);
      }
    }

    await writeFile(path.join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    await api.runAssembling(runId);
    const outputs = await assemble(payload, runDir);

    const [master, preview, sheet] = await Promise.all([
      publishFile(outputs.master, { runId, nodeName: 'master', kind: 'video' }).catch((e) => {
        logError('master publish failed:', e.message || e);
        return null;
      }),
      publishFile(outputs.preview, { runId, nodeName: 'preview-720p', kind: 'video' }).catch(() => null),
      publishFile(outputs.contactSheet, { runId, nodeName: 'contact-sheet', kind: 'image' }).catch(() => null),
    ]);

    await api.runDone({
      runId,
      masterMp4Url: master?.url,
      previewMp4Url: preview?.url,
      contactSheetUrl: sheet?.url,
      creditsSpent,
    });
    log(`run ${runId} complete — ${creditsSpent} credits, master at ${master?.url ?? 'n/a'}`);
    return { ok: true };
  } catch (err) {
    const needsLogin = err instanceof LibtvAuthError;
    logError(`run ${runId} failed${needsLogin ? ' (needs libtv login web)' : ''}:`, err.message || err);
    await api.runFailed(runId, err.message || String(err), needsLogin).catch((e) => logError('report failed:', e));
    return { ok: false, needsLogin };
  } finally {
    clearInterval(heartbeatTimer);
  }
}

// ---- Main loop ------------------------------------------------------------

let shuttingDown = false;

async function mainLoop() {
  log(
    `starting. APP_URL=${APP_URL} RUNS_DIR=${RUNS_DIR} dryRun=${DRY_RUN} fixture=${FIXTURE_PATH ?? 'none'}`
  );

  if (FIXTURE_PATH) {
    const payload = JSON.parse(await readFile(FIXTURE_PATH, 'utf8'));
    const result = await processRun(payload);
    log(`fixture run finished: ${JSON.stringify(result)}`);
    return;
  }

  if (!WORKER_TOKEN) {
    logError('WORKER_TOKEN is not set. Exiting.');
    process.exit(1);
  }

  while (!shuttingDown) {
    let payload = null;
    try {
      payload = await api.claim();
    } catch (err) {
      logError('claim failed:', err.message || err);
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    if (!payload) {
      if (ONCE) break;
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    const result = await processRun(payload);
    if (result.needsLogin) {
      logError('libtv token is dead — run `libtv login web` and restart this worker. Exiting.');
      process.exit(2);
    }
    if (ONCE) break;
  }

  log('main loop exited, shutdown complete.');
}

function handleShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`received ${signal}, finishing the current run then exiting (--run is never interrupted)...`);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

mainLoop().catch((err) => {
  logError('fatal error in main loop:', err);
  process.exit(1);
});
