/**
 * Cutdowns (15 s / 10 s) of a finished storyboard edit. The hook and the CTA
 * stay; the body is cut in whole voiceover beats (consecutive frames that share
 * a line), keeping the payoff beat first and then the beats that carry proof
 * (numbers, claims on screen) until the target length — so every spoken line
 * that survives is complete. Kept frames are re-timed end to end; the edit is
 * then re-planned on its own beat grid, with its own music drop.
 */
import type { AssembleFrame } from "../glm-assemble";

interface Beat {
  frames: AssembleFrame[];
  sec: number;
  score: number;
  order: number;
}

const proofScore = (t: string) => (/\d/.test(t) ? 2 : 0) + (/%|nits|zones|hz|4k|hdr|stars?|rated|vs\.?|save|\$/i.test(t) ? 1 : 0);

export function cutdownFrames(frames: AssembleFrame[], targetSec: number): AssembleFrame[] {
  const sorted = [...frames].sort((a, b) => a.startSec - b.startSec);
  const len = (f: AssembleFrame) => Math.max(0, f.endSec - f.startSec);
  const total = sorted.reduce((n, f) => n + len(f), 0);
  if (total <= targetSec + 0.01) return sorted;
  // A long hook or end card is trimmed too: hook ≤ 4 s (2 s for ≤ 10 s), end card ≤ 4 s.
  const cap = (fs: AssembleFrame[], maxSec: number, fromEnd = false) => {
    const out: AssembleFrame[] = [];
    let t = 0;
    for (const f of fromEnd ? [...fs].reverse() : fs) {
      if (t + len(f) > maxSec + 0.01 && out.length) break;
      out.push(f);
      t += len(f);
    }
    return fromEnd ? out.reverse() : out;
  };
  const hookAll = sorted.filter((f) => (f.segment ?? "").toUpperCase() === "HOOK");
  const ctaAll = sorted.filter((f) => (f.segment ?? "").toUpperCase() === "CTA");
  const hook = cap(hookAll, targetSec <= 10 ? 2 : 4);
  const cta = cap(ctaAll, 4, true);
  const body = sorted.filter((f) => !hookAll.includes(f) && !ctaAll.includes(f));
  // Group the body into voiceover beats.
  const beats: Beat[] = [];
  for (const f of body) {
    const last = beats[beats.length - 1];
    const vo = (f.voiceover ?? "").trim();
    if (last && vo && (last.frames[last.frames.length - 1].voiceover ?? "").trim() === vo) {
      last.frames.push(f);
      last.sec += len(f);
      last.score = Math.max(last.score, proofScore(`${vo} ${f.text ?? ""}`));
    } else beats.push({ frames: [f], sec: len(f), score: proofScore(`${vo} ${f.text ?? ""}`), order: beats.length });
  }
  const fixed = hook.reduce((n, f) => n + len(f), 0) + cta.reduce((n, f) => n + len(f), 0);
  let budget = targetSec - fixed;
  const keep = new Set<Beat>();
  // The payoff (first body beat) answers the hook — always first in line.
  const ranked = [...beats].sort((a, b) => (a.order === 0 ? -1 : b.order === 0 ? 1 : b.score - a.score || a.order - b.order));
  for (const b of ranked) {
    if (b.sec <= budget + 0.01) {
      keep.add(b);
      budget -= b.sec;
    }
  }
  const kept = [...hook, ...beats.filter((b) => keep.has(b)).flatMap((b) => b.frames), ...cta];
  // Re-time end to end.
  let t = 0;
  return kept.map((f) => {
    const out = { ...f, startSec: t, endSec: t + len(f) };
    t += len(f);
    return out;
  });
}
