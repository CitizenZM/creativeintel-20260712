// QA Critic from a different model family (design §9 decision 5 = A): the pipeline's own review is Claude judging Claude's
// work (self-scores 31-34/40 vs independent 5.2/10). This looks at a 3x2 sheet of frames from the finished video with a
// Gemini vision model via OpenRouter and scores what a viewer sees. ≤ MAX_PER_DAY calls (≈ $0.003 each).
import { execFile } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const pexec = promisify(execFile);
export const CRITIC_MODEL = process.env.VIDEO_BRAIN_CRITIC_MODEL || 'google/gemini-3.8-flash';
export const MAX_PER_DAY = 10;
export const PASS_AT = 6;
export const KEYS = ['first_frame', 'product_clear', 'consistency', 'no_garbled_text', 'sells'];
export const SYSTEM = `You are a strict short-form video ad critic. You see six frames of one 9:16 ad in order (top-left is the first frame, then left to right, top to bottom).
Score 1-10 each, using the whole scale (most ads are a 5):
first_frame: would the first frame stop a thumb (motion, a face with a feeling, a result, a surprising object = high; empty room, plain pack shot, flat colour card <= 4).
product_clear: the product is recognisable and looks the same in every frame it appears.
consistency: people, places and lighting stay consistent across frames (no person or product changing identity).
no_garbled_text: 10 = all visible text is clean and readable; <= 3 if any AI-garbled letters, fake labels or broken words appear.
sells: a muted viewer would understand what is sold and why to buy.
issues: up to 3 short concrete problems a video editor can fix (max 15 words each). Answer JSON only.`;

export const SCHEMA = { type: 'object', additionalProperties: false, required: [...KEYS, 'issues'], properties: { ...Object.fromEntries(KEYS.map((k) => [k, { type: 'integer' }])), issues: { type: 'array', items: { type: 'string' } } } };

export function picks(n, durationSec) { const d = Math.max(1, durationSec); return Array.from({ length: n }, (_, i) => +(Math.min(d - 0.05, i === 0 ? 0.05 : (d * i) / n)).toFixed(2)); }

/** six frames → one 3x2 JPEG sheet (each frame 270x480) */
export async function sheet(video, durationSec) {
  const dir = await mkdtemp(path.join(tmpdir(), 'vb-critic-'));
  const out = path.join(dir, 'sheet.jpg');
  const inputs = picks(6, durationSec).flatMap((t) => ['-ss', String(t), '-i', video]);
  const filt = picks(6, durationSec).map((_, i) => `[${i}:v]scale=270:480,setsar=1[f${i}]`).join(';') + ';' + [0, 1, 2, 3, 4, 5].map((i) => `[f${i}]`).join('') + 'xstack=inputs=6:layout=0_0|w0_0|w0+w1_0|0_h0|w0_h0|w0+w1_h0[out]';
  await pexec('ffmpeg', ['-y', '-v', 'error', ...inputs, '-filter_complex', filt, '-map', '[out]', '-frames:v', '1', '-q:v', '4', out], { timeout: 120_000 });
  return out;
}

export function verdict(scores) {
  const avg = KEYS.reduce((s, k) => s + Number(scores[k] || 0), 0) / KEYS.length;
  return { avg: +avg.toFixed(1), pass: avg >= PASS_AT && Number(scores.no_garbled_text) >= 5 };
}

export async function critique(video, durationSec, key) {
  const img = await sheet(video, durationSec);
  const b64 = (await readFile(img)).toString('base64');
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(90_000),
    body: JSON.stringify({ model: CRITIC_MODEL, temperature: 0, response_format: { type: 'json_schema', json_schema: { name: 'critique', strict: true, schema: SCHEMA } },
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: [{ type: 'text', text: 'Score this ad.' }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } }] }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`critic ${CRITIC_MODEL} HTTP ${r.status}: ${JSON.stringify(j.error || j).slice(0, 200)}`);
  const text = j.choices?.[0]?.message?.content || '';
  const scores = JSON.parse(String(text).replace(/^```json\s*|```\s*$/g, ''));
  return { model: CRITIC_MODEL, scores, ...verdict(scores), cost: j.usage?.cost ?? null };
}

/** add the critic's result to a second-check record as fields (pure) */
export function withCritic(check, c) {
  const fields = [...check.fields, { field: `critic (${c.model.split('/')[1]})`, expected: `avg ≥ ${PASS_AT}, clean text`, actual: `${c.avg} · ${KEYS.map((k) => `${k} ${c.scores[k]}`).join(', ')}${c.scores.issues?.length ? ' · ' + c.scores.issues.join(' / ') : ''}`, pass: c.pass, source: 'second model family' }];
  return { ...check, fields, pass: fields.every((f) => f.pass), critic: c };
}
