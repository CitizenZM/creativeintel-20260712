// libtv-cli.mjs
//
// Thin, argv-array wrapper around the `libtv` binary. Never builds a shell
// string: prompts contain quotes, newlines and CJK, and a shell string would
// either break or become an injection surface.
//
// Every command returns { code, stdout, stderr, json[] } where `json` is the
// parsed JSON lines the CLI emits. `--run` blocks until the task is terminal;
// the CLI reports "status": 2 for success and 3 for failure.

import { spawn } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export const DEFAULT_LIBTV_BIN = path.join(homedir(), '.libtv', 'libtv');

/** Token expired (接口错误 [10001]: 用户未授权) — only `libtv login web` fixes it. */
export class LibtvAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LibtvAuthError';
    this.needsLogin = true;
  }
}

export class LibtvCommandError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = 'LibtvCommandError';
    Object.assign(this, detail);
  }
}

function looksLikeAuthFailure(text) {
  return /用户未授权/.test(text) || /\[10001\]/.test(text);
}

function parseJsonLines(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // Progress chatter interleaved with JSON — ignore the unparseable line.
    }
  }
  return out;
}

function deepFind(value, predicate, depth = 0) {
  if (depth > 6 || value == null || typeof value !== 'object') return null;
  if (!Array.isArray(value) && predicate(value)) return value;
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    const hit = deepFind(child, predicate, depth + 1);
    if (hit) return hit;
  }
  return null;
}

export function extractNodeId(jsonLines) {
  for (const entry of jsonLines) {
    const node = deepFind(entry, (o) => typeof o.nodeId === 'string' && o.nodeId.length > 0);
    if (node) return node.nodeId;
  }
  for (const entry of jsonLines) {
    const node = deepFind(
      entry,
      (o) => (typeof o.id === 'string' || typeof o.id === 'number') && ('type' in o || 'name' in o || 'title' in o)
    );
    if (node) return String(node.id);
  }
  return null;
}

export function extractProjectUuid(jsonLines) {
  for (const entry of jsonLines) {
    const node = deepFind(entry, (o) => typeof o.uuid === 'string' && o.uuid.length >= 16);
    if (node) return node.uuid;
  }
  return null;
}

/** `--run` outcome: 2 = success, 3 = failed. */
export function extractRunStatus(jsonLines) {
  let status = null;
  for (const entry of jsonLines) {
    const node = deepFind(entry, (o) => typeof o.status === 'number' && o.status >= 0 && o.status <= 5);
    if (node) status = node.status;
  }
  return status;
}

export function createLibtvCli({ cwd, bin = process.env.LIBTV_BIN || DEFAULT_LIBTV_BIN, dryRun = false, log = console.log } = {}) {
  async function exec(args, { timeoutMs = 30 * 60 * 1000 } = {}) {
    const printable = [bin, ...args]
      .map((a) => (/[\s"'\n]/.test(a) ? JSON.stringify(a) : a))
      .join(' ');

    if (dryRun) {
      log(`[dry-run] ${printable}`);
      return { code: 0, stdout: '', stderr: '', json: [], dryRun: true, command: printable };
    }

    log(`$ ${printable}`);

    return new Promise((resolve, reject) => {
      const child = spawn(bin, args, { cwd, env: process.env });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new LibtvCommandError(`libtv timed out after ${timeoutMs}ms: ${printable}`));
      }, timeoutMs);

      child.stdout.on('data', (d) => {
        stdout += d.toString();
      });
      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(new LibtvCommandError(`failed to spawn ${bin}: ${err.message}`));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        const combined = `${stdout}\n${stderr}`;
        if (looksLikeAuthFailure(combined)) {
          reject(new LibtvAuthError(`libtv token expired (10001 用户未授权) while running: ${printable}`));
          return;
        }
        const json = parseJsonLines(stdout);
        if (code !== 0) {
          reject(
            new LibtvCommandError(`libtv exited ${code}: ${printable}\n${combined.slice(-1500)}`, {
              code,
              stdout,
              stderr,
              json,
            })
          );
          return;
        }
        resolve({ code, stdout, stderr, json, command: printable });
      });
    });
  }

  return {
    bin,
    cwd,
    dryRun,
    exec,

    async projectCreate(name) {
      const res = await exec(['project', 'create', name], { timeoutMs: 120000 });
      const uuid = extractProjectUuid(res.json);
      if (!uuid && !dryRun) {
        throw new LibtvCommandError(`could not read a canvas uuid from: ${res.stdout.slice(0, 500)}`);
      }
      return { uuid: uuid || `dry-run-${Date.now().toString(36)}`, raw: res };
    },

    async projectUse(uuid) {
      return exec(['project', 'use', uuid], { timeoutMs: 120000 });
    },

    async upload(nodeName, filePath, type) {
      const args = ['upload', nodeName, '--file', filePath];
      if (type) args.push('-t', type);
      const res = await exec(args, { timeoutMs: 15 * 60 * 1000 });
      return { nodeId: extractNodeId(res.json), raw: res };
    },

    /**
     * settings is a plain object; every pair goes through one `-s key=value`.
     * `model` must be the display name, e.g. "Seedream 5.0 Pro".
     */
    async nodeCreate({ nodeName, type, leftRefs = [], prompt, modelName, settings = {}, run = true }) {
      const args = ['node', 'create', nodeName, '-t', type];
      for (const ref of leftRefs) args.push('--left', ref);
      if (prompt) args.push('--prompt', prompt);
      if (modelName) args.push('-s', `model=${modelName}`);
      for (const [key, value] of Object.entries(settings)) {
        if (value === undefined || value === null) continue;
        args.push('-s', `${key}=${value}`);
      }
      if (run) args.push('--run');

      const res = await exec(args, { timeoutMs: 40 * 60 * 1000 });
      const status = extractRunStatus(res.json);
      if (run && status === 3) {
        throw new LibtvCommandError(`node "${nodeName}" generation failed (status 3)`, { json: res.json });
      }
      return { nodeId: extractNodeId(res.json), status, raw: res };
    },

    /** The CLI names the file itself, so diff the output directory. */
    async download({ nodeName, outDir, withoutWatermark = true, vip = true, expectedExt = '.mp4' }) {
      const before = await listFiles(outDir);
      const args = ['download', '-n', nodeName, '-o', outDir];
      if (withoutWatermark) args.push('--without-ai-watermark');
      if (vip) args.push('--vip');
      const res = await exec(args, { timeoutMs: 20 * 60 * 1000 });
      if (dryRun) return { filePath: path.join(outDir, `${nodeName}${expectedExt}`), raw: res, dryRun: true };

      const after = await listFiles(outDir);
      const added = after.filter((f) => !before.includes(f));
      const filePath = added.length
        ? path.join(outDir, added[0])
        : await newestFile(outDir);
      if (!filePath) {
        throw new LibtvCommandError(`download wrote nothing for node "${nodeName}" — check the node name matches exactly`);
      }
      return { filePath, raw: res };
    },
  };
}

async function listFiles(dir) {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

async function newestFile(dir) {
  const names = await listFiles(dir);
  let best = null;
  let bestMtime = 0;
  for (const name of names) {
    const full = path.join(dir, name);
    try {
      const s = await stat(full);
      if (s.isFile() && s.mtimeMs > bestMtime) {
        best = full;
        bestMtime = s.mtimeMs;
      }
    } catch {
      // ignore
    }
  }
  return best;
}
