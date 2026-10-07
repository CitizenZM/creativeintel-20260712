/**
 * Text auto-fit: the biggest type that fits a box within a line limit. One natural (unwrapped)
 * measurement gives a close first guess analytically; then render-and-check, shrinking on overflow
 * and growing while it still fits — usually 2–3 pango renders per slot. Pure apart from `render`.
 */

export interface Measured {
  width: number;
  height: number;
}

export interface FitOptions {
  box: { w: number; h: number };
  maxLines: number;
  maxSize: number;
  minSize: number;
}

/**
 * Size guess from a single-line measurement at `ref` px: for each line count, the width budget
 * (wrapping wastes ~15 %) and the height budget; keep the best.
 */
export function estimateSize(natural: Measured & { ref: number }, box: { w: number; h: number }, maxLines: number, maxSize: number): number {
  let best = 0;
  for (let lines = 1; lines <= Math.max(1, maxLines); lines++) {
    const byWidth = (natural.ref * box.w * lines * (lines === 1 ? 0.98 : 0.85)) / Math.max(1, natural.width);
    const byHeight = (natural.ref * box.h) / (lines * Math.max(1, natural.height));
    best = Math.max(best, Math.min(byWidth, byHeight));
  }
  return Math.max(1, Math.min(maxSize, Math.floor(best)));
}

export interface FitResult<T> extends Measured {
  size: number;
  fits: boolean;
  out: T;
}

/**
 * Render at `start`; shrink in proportion to the overflow until it fits (or hits minSize), or grow
 * by 25 % steps while it fits. `lineCount(measured, size)` says how many lines a render wrapped into.
 */
export async function fitLoop<T extends Measured>(
  render: (size: number) => Promise<T>,
  lineCount: (m: Measured, size: number) => number,
  o: FitOptions,
  start: number
): Promise<FitResult<T>> {
  const ok = (m: Measured, s: number) => m.width <= o.box.w + 0.5 && m.height <= o.box.h + 0.5 && lineCount(m, s) <= o.maxLines;
  let size = Math.max(o.minSize, Math.min(o.maxSize, Math.round(start)));
  let m = await render(size);
  if (ok(m, size)) {
    for (let i = 0; i < 6 && size < o.maxSize; i++) {
      const up = Math.min(o.maxSize, Math.ceil(size * 1.25));
      const mu = await render(up);
      if (ok(mu, up)) {
        size = up;
        m = mu;
        continue;
      }
      const mid = Math.round(size * 1.1);
      if (mid > size && mid < up) {
        const mm = await render(mid);
        if (ok(mm, mid)) {
          size = mid;
          m = mm;
        }
      }
      break;
    }
    return { size, fits: true, width: m.width, height: m.height, out: m };
  }
  for (let i = 0; i < 16 && size > o.minSize; i++) {
    const wr = Math.min(1, o.box.w / Math.max(1, m.width));
    const hr = Math.min(1, o.box.h / Math.max(1, m.height));
    const factor = Math.max(0.6, Math.min(0.94, wr, Math.sqrt(hr), hr < 1 || wr < 1 ? 0.94 : 0.9));
    size = Math.max(o.minSize, Math.floor(size * factor));
    m = await render(size);
    if (ok(m, size)) return { size, fits: true, width: m.width, height: m.height, out: m };
  }
  return { size, fits: ok(m, size), width: m.width, height: m.height, out: m };
}

const CONNECTOR = /^(&|\+|-|—|–|·|\||and|or|with|for|by|of|the|a|to)$/i;

/** One word shorter, with an ellipsis (for text that won't fit even at the minimum size). */
export function shortenText(text: string): string {
  const words = text.replace(/…$/, "").trim().split(/\s+/);
  if (words.length <= 1) return text;
  words.pop();
  while (words.length > 1 && CONNECTOR.test(words[words.length - 1])) words.pop();
  return `${words.join(" ").replace(/[,;:.\-–—]+$/, "")}…`;
}
