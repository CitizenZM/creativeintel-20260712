/**
 * Defects → explicit corrections for the next edit prompt. A re-roll that only
 * re-runs the same prompt repeats the same mistake; naming the fix ("bezel
 * must be thin as in the product ref") is what moves the image model.
 */
const RULES: { test: RegExp; fix: (spec: string) => string }[] = [
  { test: /painting|picture frame|framed/i, fix: () => "The TV must read as a TV, not a framed painting: a hair-thin metal edge flush with the wall, no mat, no wooden or decorative frame." },
  { test: /bezel/i, fix: () => "The bezel must be thin and uniform on all four sides exactly as in the product reference — never a thick border." },
  { test: /stick|too thin|thickness|too thick|side profile|depth/i, fix: (spec) => `Keep the product's real thickness and side profile from the product reference${spec ? ` (${spec})` : ""}: a slim slab with visible depth and edge details, never a featureless stick and never chunky.` },
  { test: /aspect|proportion|stretch|squash/i, fix: () => "Keep the product's exact width-to-height proportions from the product reference — no stretching or squashing." },
  { test: /port|button/i, fix: () => "Ports and buttons in the same number and positions as in the product reference." },
  { test: /camera/i, fix: () => "The camera module has the same shape, size and position as in the product reference." },
  { test: /stand|feet|foot/i, fix: () => "The stand has the exact shape, position and finish of the product reference." },
  { test: /logo|garbled|text|letter/i, fix: () => "No invented lettering: the logo only as printed on the product reference (or none); no other text anywhere." },
  { test: /colou?r/i, fix: () => "The product's body colour and finish exactly as in the product reference." },
  { test: /warp|bent|melt|distort|shape|missing from the frame/i, fix: (spec) => `Show the exact product from the product reference, rigid, straight and undistorted${spec ? ` (${spec})` : ""}.` },
  { test: /face|identity|cast missing/i, fix: () => "Each person from the casting sheet keeps the exact same face — face shape, eyes, nose, jaw and mouth." },
  { test: /hair/i, fix: () => "Same hair colour, length and style as on the casting sheet." },
  { test: /skin/i, fix: () => "Same skin tone as on the casting sheet." },
  { test: /\bage\b|older|younger/i, fix: () => "Same apparent age as on the casting sheet." },
  { test: /cloth|wardrobe|outfit|shirt|sweater|jacket/i, fix: () => "Same clothing as on the casting sheet (or the start frame)." },
  { test: /limb|\barm|\bleg/i, fix: () => "Correct anatomy: exactly two arms and two legs per person." },
  { test: /hand|finger/i, fix: () => "Natural hands with five fingers each." },
  { test: /collage|split|panel|diptych/i, fix: () => "One single continuous photograph — no collage, split screen or panels." },
  { test: /scene changed|room|lighting/i, fix: () => "Keep the room, lighting, lens and framing distance identical to the start frame." },
];

export const CORRECTIONS_MARKER = "CORRECTIONS (the previous attempt failed QC — fix exactly these):";

/** Map named defects to correction sentences (deduplicated, at most `max`). */
export function correctionsFor(defects: string[], opts: { productSpec?: string; max?: number } = {}): string[] {
  const spec = opts.productSpec?.trim() ?? "";
  const out: string[] = [];
  for (const d of defects) {
    const rule = RULES.find((r) => r.test.test(d));
    const fix = rule ? rule.fix(spec) : `Fix: ${d.replace(/\s+/g, " ").trim().replace(/\.?$/, ".")}`;
    if (!out.includes(fix)) out.push(fix);
  }
  return out.slice(0, opts.max ?? 6);
}

/** Append the corrections block to a prompt; idempotent (replaces an earlier block). */
export function applyCorrections(prompt: string, corrections: readonly string[] | undefined | null): string {
  const i = prompt.indexOf(CORRECTIONS_MARKER);
  const base = (i >= 0 ? prompt.slice(0, i) : prompt).trimEnd();
  if (!corrections?.length) return base;
  return `${base} ${CORRECTIONS_MARKER} ${corrections.join(" ")}`;
}
