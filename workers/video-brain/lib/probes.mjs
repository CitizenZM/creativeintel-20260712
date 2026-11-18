// Capability check (能力体检): free, read-only probes of everything the pipeline calls. No paid generation.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, statfs } from 'node:fs/promises';
import path from 'node:path';

const pexec = promisify(execFile);
const now = () => new Date().toISOString();
const ok = (name, detail) => ({ name, ok: true, detail, at: now() });
const bad = (name, detail) => ({ name, ok: false, detail: String(detail).slice(0, 200), at: now() });

async function cmd(name, bin, args, re) {
  try { const { stdout, stderr } = await pexec(bin, args, { timeout: 20_000 }); const out = (stdout || stderr).split('\n')[0]; return re && !re.test(stdout + stderr) ? bad(name, out) : ok(name, out.slice(0, 80)); } catch (e) { return bad(name, e.message); }
}

/** models the Ad Studio routes and engines use, parsed from pipeline/generate.mjs */
export async function routedModels(adStudioRoot) {
  const src = await readFile(path.join(adStudioRoot, 'pipeline', 'generate.mjs'), 'utf8');
  const sect = (name) => (src.split(`export const ${name} = {`)[1] || '').split('\n};')[0];
  const ids = new Set();
  for (const s of [sect('ROUTES'), sect('ENGINES')]) for (const m of s.matchAll(/model:\s*'([a-z0-9-]+\/[a-z0-9.:-]+)'/g)) ids.add(m[1]);
  return [...ids];
}

export function missingModels(used, listed) { const have = new Set(listed); return used.filter((m) => !have.has(m)); }

async function openrouterVideo(adStudioRoot, key) {
  if (!key) return bad('openrouter video models', 'no OPENROUTER_API_KEY in ad-studio .env.local');
  try {
    const r = await fetch('https://openrouter.ai/api/v1/videos/models', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) });
    if (!r.ok) return bad('openrouter video models', `HTTP ${r.status}`);
    const j = await r.json(); const listed = (j.data || j.models || []).map((m) => m.id || m.slug || m.name);
    const miss = missingModels(await routedModels(adStudioRoot), listed);
    return miss.length ? bad('openrouter video models', `routed but not listed: ${miss.join(', ')}`) : ok('openrouter video models', `${listed.length} listed, all routed models present`);
  } catch (e) { return bad('openrouter video models', e.message); }
}

/** python the Ad Studio pipeline resolves (falls back to python3 if the pipeline predates the resolver) */
export async function pipelinePython(adStudioRoot) {
  try { const m = await import(path.join(adStudioRoot, 'pipeline', 'lib.mjs')); return m.PYTHON || 'python3'; } catch { return 'python3'; }
}

export const MIN_CREDITS_USD = 5;
/** pure: spendable = min(account credit, key limit remaining) */
export function balanceVerdict(account, keyInfo = {}) {
  const keyLeft = keyInfo.limit != null && keyInfo.limit_remaining != null ? Number(keyInfo.limit_remaining) : null;
  const left = keyLeft == null ? account : Math.min(account, keyLeft);
  const detail = keyLeft == null ? `$${account.toFixed(2)} left` : `$${left.toFixed(2)} spendable (account $${account.toFixed(2)}, key ${keyInfo.limit_reset || ''} cap $${keyInfo.limit} with $${keyLeft.toFixed(2)} left)`;
  if (left >= MIN_CREDITS_USD) return ok('openrouter balance', detail);
  return bad('openrouter balance', `${detail}: video/keyframe calls fail with 402 - ${keyLeft != null && keyLeft < account ? 'raise the key limit on openrouter.ai/settings/keys' : 'top up credits'}`);
}
async function openrouterCredits(key) {
  if (!key) return bad('openrouter balance', 'no key');
  try {
    const r = await fetch('https://openrouter.ai/api/v1/credits', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) });
    if (!r.ok) return bad('openrouter balance', `HTTP ${r.status}`);
    const d = (await r.json()).data || {}; const account = Number(d.total_credits || 0) - Number(d.total_usage || 0);
    // a key can carry its own monthly cap: OpenRouter answers 402 when the KEY's limit is spent even with account credit left
    const k = await fetch('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) }).then((x) => x.json()).then((j) => j.data || {}).catch(() => ({}));
    return balanceVerdict(account, k);
  } catch (e) { return bad('openrouter balance', e.message); }
}

export async function envKey(file, name) {
  try { const m = (await readFile(file, 'utf8')).match(new RegExp(`^${name}=(.*)$`, 'm')); return m ? m[1].replace(/^["']|["']$/g, '').trim() : null; } catch { return null; }
}

export async function runProbes({ adStudioRoot, obs }) {
  const key = process.env.OPENROUTER_API_KEY || (await envKey(path.join(adStudioRoot, '.env.local'), 'OPENROUTER_API_KEY'));
  const res = await Promise.all([
    cmd('ffmpeg', 'ffmpeg', ['-version'], /ffmpeg version/),
    cmd('ffprobe', 'ffprobe', ['-version'], /ffprobe version/),
    // the interpreter the pipeline itself resolves (pipeline/lib.mjs PYTHON) under this process's PATH = the worker's PATH
    pipelinePython(adStudioRoot).then((py) => cmd('whisper (word timing)', py, ['-c', 'import faster_whisper; print("faster-whisper ok")'], /ok/)),
    pipelinePython(adStudioRoot).then((py) => cmd('edge-tts (voice)', py, ['-c', 'import edge_tts; print("edge-tts ok")'], /ok/)),
    cmd('adstudio worker (launchd)', 'launchctl', ['list', 'co.celldigital.adstudio-worker'], /"PID"/),
    cmd('ego lite (reference fetch)', 'zsh', ['-lc', 'command -v ego-browser && echo found'], /found/),
    openrouterVideo(adStudioRoot, key),
    openrouterCredits(key),
    (async () => { try { const s = await statfs(adStudioRoot); const gb = (s.bavail * s.bsize) / 1e9; return gb > 20 ? ok('disk', `${gb.toFixed(0)} GB free`) : bad('disk', `${gb.toFixed(1)} GB free (< 20)`); } catch (e) { return bad('disk', e.message); } })(),
    (async () => { try { const r = await fetch('http://127.0.0.1:5310/', { signal: AbortSignal.timeout(25_000) }); return r.status < 500 ? ok('ad-studio web :5310', `HTTP ${r.status}`) : bad('ad-studio web :5310', `HTTP ${r.status}`); } catch (e) { return bad('ad-studio web :5310', e.message); } })(),
  ]);
  const hb = (obs.heartbeats || []).filter((h) => /adstudio/i.test(h.workerId)).sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt))[0];
  const age = hb ? (Date.now() - Date.parse(hb.lastSeenAt)) / 60000 : null;
  res.push(hb && age < 10 ? ok('worker heartbeat', `${age.toFixed(1)} min ago`) : bad('worker heartbeat', hb ? `${age.toFixed(0)} min ago` : 'never seen'));
  return res;
}
