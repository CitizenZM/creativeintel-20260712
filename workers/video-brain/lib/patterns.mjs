// Fix propagation (design §7.4): every fix carries a pattern fingerprint; the brain searches every video repo and skill
// for the same pattern and lists what is still open. Read-only: it reports, the Doctor (or a session) fixes.
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export const PATTERNS = [
  { id: 'retired-model-seedance-1-5', fixedIn: 'ad-studio generate.mjs ROUTES 2026-11-17', re: /['"]bytedance\/seedance-1-5-pro['"]/, ignore: /retired|price:|label:|old id|\/\//, why: 'seedance-1-5-pro is gone from OpenRouter; any live route to it fails every scene' },
  { id: 'whisper-initial-prompt', fixedIn: 'ad-studio 17f5cf2 (vo_words.py)', re: /initial_prompt\s*=/, ignore: /^\s*#/, why: 'faster-whisper initial_prompt skipped the start of lines (word timing off)' },
  { id: 'loudness-not-minus-14', fixedIn: 'ad-studio PLAN-20261117 phase 1 (-14 LUFS master)', re: /master[^\n]*loudnorm=I=-1[5-9]|loudnorm=I=-1[5-9][^\n]*master/i, ignore: /^\s*(#|\/\/)|bed|stem|voice|sfx/i, why: 'the final master targets -14 LUFS; -16 reads quiet next to other ads (stems/beds at -16 before the duck are fine)' },
  { id: 'music-fade-in-at-zero', fixedIn: 'ad-studio PLAN-20261117 hook rules (sound at 0 s)', re: /afade=t=in:st=0:d=(0\.[1-9]|[1-9])/, ignore: /^\s*(#|\/\/)/, why: 'the hook needs sound at frame 0; a fade-in of >= 0.1 s at 0 s makes the opening silent (30 ms anti-pop fades are fine)' },
  { id: 'tee-head-truncation', fixedIn: 'Affiliate OS learning 2026-11-17', re: /\btee\b[^|\n]*\|\s*head\b/, ignore: /^\s*#/, why: '`tee file | head -N` truncates the file at N lines (SIGPIPE)' },
];

const SKIP = new Set(['node_modules', '.git', '.next', 'out', 'dist', 'data', 'deliver', 'deliver2', 'all-videos-by-product', 'r2', 'r3', 'r4', 'r5', 'productions', 'videos', 'gallery', 'raw', 'library', 'assets', 'public', 'repos']);
const EXT = /\.(mjs|js|ts|tsx|py|sh|md)$/;

async function* walk(dir, depth = 0) {
  if (depth > 5) return;
  let ents; try { ents = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    if (e.name.startsWith('.') && e.name !== '.') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) yield* walk(p, depth + 1); } else if (EXT.test(e.name)) yield p;
  }
}

/** pure: hits of every pattern in one file's text */
export function scanText(file, text, patterns = PATTERNS) {
  const hits = [];
  const lines = text.split('\n');
  for (const p of patterns) lines.forEach((l, i) => { if (p.re.test(l) && !(p.ignore && p.ignore.test(l))) hits.push({ pattern: p.id, fixedIn: p.fixedIn, file, line: i + 1, status: 'open' }); });
  return hits;
}

export async function scanRoots(roots, patterns = PATTERNS) {
  const hits = [];
  for (const root of roots) {
    try { await stat(root); } catch { continue; }
    for await (const f of walk(root)) {
      if (/\.md$/.test(f) && !/SKILL\.md$/.test(f)) continue; // docs describe old states; only skill instructions count
      if (/(__tests__|\.test\.|test_)/.test(f)) continue;
      let text; try { const s = await stat(f); if (s.size > 400_000) continue; text = await readFile(f, 'utf8'); } catch { continue; }
      hits.push(...scanText(f, text, patterns));
    }
  }
  return hits;
}
