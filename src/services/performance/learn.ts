/**
 * The learning loop: which hook styles win on real results. Hook rate (3-second
 * views ÷ impressions) is the thumb-stop metric; CTR (clicks ÷ impressions) is
 * the click metric. A winner is only called when a two-proportion z-test says
 * the gap is unlikely to be noise (|z| ≥ 1.96 ≈ 95 %).
 */

export interface StyleStats {
  hookStyle: string;
  ads: number;
  impressions: number;
  hookRate: number;
  ctr: number;
  spend: number;
}

export interface Learning {
  styles: StyleStats[];
  hookWinner: { hookStyle: string; lift: number; z: number } | null;
  ctrWinner: { hookStyle: string; lift: number; z: number } | null;
  /** Hook styles ordered by evidence (best first) — the variant order for new masters. */
  order: string[];
}

type Row = { hookStyle: string | null; impressions: number; views3s: number; clicks: number; spend: number };

export const HOOK_STYLE_NAME: Record<string, string> = { q: "question", c: "contrast", p: "product blast" };

function zTest(x1: number, n1: number, x2: number, n2: number): number {
  if (n1 <= 0 || n2 <= 0) return 0;
  const p1 = x1 / n1;
  const p2 = x2 / n2;
  const p = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  return se > 0 ? (p1 - p2) / se : 0;
}

export function learn(rows: Row[]): Learning {
  const by = new Map<string, { ads: number; impressions: number; views3s: number; clicks: number; spend: number }>();
  for (const r of rows) {
    if (!r.hookStyle) continue;
    const s = by.get(r.hookStyle) ?? { ads: 0, impressions: 0, views3s: 0, clicks: 0, spend: 0 };
    s.ads++;
    s.impressions += r.impressions;
    s.views3s += r.views3s;
    s.clicks += r.clicks;
    s.spend += r.spend;
    by.set(r.hookStyle, s);
  }
  const raw = [...by.entries()].map(([hookStyle, s]) => ({ hookStyle, ...s }));
  const styles: StyleStats[] = raw
    .map((s) => ({
      hookStyle: s.hookStyle,
      ads: s.ads,
      impressions: s.impressions,
      hookRate: s.impressions ? s.views3s / s.impressions : 0,
      ctr: s.impressions ? s.clicks / s.impressions : 0,
      spend: Math.round(s.spend * 100) / 100,
    }))
    .sort((a, b) => b.hookRate - a.hookRate);
  const winner = (metric: "views3s" | "clicks") => {
    const ranked = [...raw].filter((s) => s.impressions > 0).sort((a, b) => b[metric] / b.impressions - a[metric] / a.impressions);
    if (ranked.length < 2) return null;
    const [a, b] = ranked;
    const z = zTest(a[metric], a.impressions, b[metric], b.impressions);
    const ra = a[metric] / a.impressions;
    const rb = b[metric] / b.impressions;
    return z >= 1.96 && rb > 0 ? { hookStyle: a.hookStyle, lift: Math.round((ra / rb - 1) * 1000) / 10, z: Math.round(z * 100) / 100 } : null;
  };
  const hookWinner = winner("views3s");
  const ctrWinner = winner("clicks");
  // Variant order: significant CTR winner first, then hook-rate winner, then by hook rate.
  const order = [...new Set([ctrWinner?.hookStyle, hookWinner?.hookStyle, ...styles.map((s) => s.hookStyle)].filter((x): x is string => !!x))];
  return { styles, hookWinner, ctrWinner, order };
}

/** A prompt block for script writing; empty when there is nothing significant yet. */
export function renderLearningBlock(l: Learning | null): string {
  if (!l || !l.styles.length) return "";
  const lines = l.styles.map(
    (s) => `- ${HOOK_STYLE_NAME[s.hookStyle] ?? s.hookStyle} hooks: hook rate ${(s.hookRate * 100).toFixed(1)}%, CTR ${(s.ctr * 100).toFixed(2)}% over ${s.impressions.toLocaleString("en-US")} impressions`
  );
  const verdicts = [
    l.hookWinner ? `${HOOK_STYLE_NAME[l.hookWinner.hookStyle]} hooks stop the scroll best (+${l.hookWinner.lift}% hook rate, significant)` : null,
    l.ctrWinner ? `${HOOK_STYLE_NAME[l.ctrWinner.hookStyle]} hooks get the most clicks (+${l.ctrWinner.lift}% CTR, significant)` : null,
  ].filter(Boolean);
  return `REAL RESULTS FROM THIS BRAND'S PAST A/B TESTS:\n${lines.join("\n")}${verdicts.length ? `\nVerdict: ${verdicts.join("; ")}. Lead with that hook style unless the brief says otherwise.` : "\nNo significant winner yet — keep testing all three hook styles."}`;
}
