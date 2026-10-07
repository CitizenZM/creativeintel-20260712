/**
 * Product coverage — the storyboard check behind "where is the product?" (first live run, NXTPAPER 14:
 * at 12.5 s the tablet sat blank in a corner, and the CTA showed it half out of frame).
 *
 * Rules, judged on the locked frames before anything is generated:
 *   1. the product is on screen in frame 1, or by 1.0 s
 *   2. it is on screen for ≥ 60 % of the ad
 *   3. it appears at least twice
 *   4. the CTA frame is a product hero
 *   5. every product shot's prompt makes the product the main subject, centered, ≥ 40 % of the frame
 *      (and its motion prompt keeps the camera on it)
 * A frame "shows the product" when it is edited from the product reference AND its keyframe prompt
 * names the product. Every rule that can be met by rewriting a prompt is auto-fixed (fix: true);
 * the issues say what was wrong and whether it was fixed. Pure; the input frames are not mutated.
 */
import type { LockedFrame, LockedRefs } from "@/services/video-gen/locked-script";

export const FIRST_PRODUCT_BY_SEC = 1.0;
export const MIN_COVERAGE = 0.6;
export const MIN_APPEARANCES = 2;
/** Share of the frame the product fills in a product shot (keyframe prompt wording). */
export const PRODUCT_FRAMING_MIN = 0.4;

export type CoverageFrame = LockedFrame;

export type CoverageCode = "late_first_product" | "low_coverage" | "too_few_appearances" | "cta_not_hero" | "weak_product_framing";

export interface CoverageIssue {
  code: CoverageCode;
  message: string;
  frameNumber?: number;
  fixed: boolean;
}

export interface CoverageResult<F> {
  frames: F[];
  issues: CoverageIssue[];
  /** Share of the ad with the product on screen (after fixes). */
  coverage: number;
  /** When the product first appears (after fixes); null = never. */
  firstProductSec: number | null;
  /** Frames that show the product (after fixes). */
  appearances: number;
}

const withProduct = (r: LockedRefs | undefined): LockedRefs => (r === "cast" || r === "cast+product" ? "cast+product" : "product");
const hasProductRef = (r: LockedRefs | undefined) => r === "product" || r === "cast+product";
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The keyframe prompt asks for the product as the centred main subject at ≥ 40 % of the frame. */
export function hasProductFraming(prompt: string): boolean {
  const pct = [...prompt.matchAll(/(\d{2,3})\s*%/g)].some((m) => Number(m[1]) >= PRODUCT_FRAMING_MIN * 100 && Number(m[1]) <= 100);
  return /\bmain subject\b/i.test(prompt) && /\bcent(?:er|re)(?:ed|d)?\b/i.test(prompt) && pct;
}

export function productFramingClause(product: string): string {
  return `The ${product} from image 1 is the main subject, centered in the frame, filling at least ${Math.round(PRODUCT_FRAMING_MIN * 100)}% of the frame height, fully visible and never cropped.`;
}

export function cameraOnProductClause(product: string): string {
  return `The camera keeps the ${product} centered and fully in frame; it never pans or drifts away from it.`;
}

export function heroPrompt(product: string): string {
  return `Hero shot of the ${product} from image 1, front view, on a clean softly lit surface. ${productFramingClause(product)} Photorealistic, 35mm, natural light, no on-screen text.`;
}

function append(prompt: string | undefined, clause: string): string {
  const p = (prompt ?? "").trim();
  if (!p) return clause;
  return `${p}${/[.!?]$/.test(p) ? "" : "."} ${clause}`;
}

export function validateProductCoverage<F extends CoverageFrame>(input: F[], opts: { productName?: string; fix?: boolean } = {}): CoverageResult<F> {
  const fix = opts.fix ?? true;
  const product = opts.productName?.trim() || "product";
  const names = new RegExp(`from image 1|\\b${esc(product)}\\b|\\bthe product\\b`, "i");
  const frames = input.map((f) => ({ ...f, locked: { ...f.locked } })) as F[];
  const issues: CoverageIssue[] = [];
  const len = (f: F) => Math.max(0, f.endSec - f.startSec);
  const total = frames.reduce((n, f) => Math.max(n, f.endSec), 0) - frames.reduce((n, f) => Math.min(n, f.startSec), Infinity);
  const shows = (f: F) => hasProductRef(f.locked.refs) && names.test(f.imagePrompt ?? "");
  const isCta = (f: F) => (f.segment ?? "").toUpperCase() === "CTA";
  const isProductShot = (f: F) => f.locked.refs === "product" && f.locked.engine !== "local" && !f.locked.talk;
  // A presenter talk frame's prompts are fixed (quoted line, lip-sync brief): it counts, but is never rewritten.
  const fixable = (f: F) => !f.locked.talk;
  const addProduct = (f: F) => {
    f.locked.refs = withProduct(f.locked.refs);
    if (!names.test(f.imagePrompt ?? "")) f.imagePrompt = append(f.imagePrompt, `The ${product} from image 1 is clearly visible in the shot.`);
  };
  const stats = () => {
    const on = frames.filter(shows);
    return {
      first: on.length ? Math.min(...on.map((f) => f.startSec)) : null,
      coverage: total > 0 ? on.reduce((n, f) => n + len(f), 0) / total : 0,
      appearances: on.length,
    };
  };

  // 1. Early: frame 1 (or a frame starting by 1.0 s) shows the product.
  let s = stats();
  if (frames.length && (s.first === null || s.first > FIRST_PRODUCT_BY_SEC + 1e-6)) {
    const first = frames.find((f) => f.startSec <= FIRST_PRODUCT_BY_SEC + 1e-6 && fixable(f)) ?? frames.find((f) => f.startSec <= FIRST_PRODUCT_BY_SEC + 1e-6) ?? frames[0];
    const canFix = fix && fixable(first);
    if (canFix) addProduct(first);
    issues.push({ code: "late_first_product", frameNumber: first.frameNumber, fixed: canFix, message: `The product first appears at ${s.first === null ? "never" : `${s.first}s`}; it must be on screen by ${FIRST_PRODUCT_BY_SEC}s.` });
  }

  // 4. The CTA is a product hero (before coverage: it may add product time).
  for (const f of frames.filter(isCta)) {
    if (f.locked.engine === "local" || !fixable(f)) continue; // an uploaded packshot / end-card still is the hero already
    const hero = f.locked.refs === "product" && /\bhero\b/i.test(f.imagePrompt ?? "") && shows(f);
    if (hero) continue;
    if (fix) {
      f.locked.refs = "product";
      f.imagePrompt = heroPrompt(product);
      f.videoPrompt = `Slow push-in toward the ${product}, then hold. ${cameraOnProductClause(product)} Natural speed.`;
    }
    issues.push({ code: "cta_not_hero", frameNumber: f.frameNumber, fixed: fix, message: `CTA frame ${f.frameNumber} is not a product hero shot.` });
  }

  // 2. Coverage ≥ 60 %: add the product to the longest frames without it.
  s = stats();
  if (s.coverage < MIN_COVERAGE - 1e-9) {
    const before = s.coverage;
    if (fix) {
      for (const f of frames.filter((x) => !shows(x) && fixable(x)).sort((a, b) => len(b) - len(a))) {
        if (stats().coverage >= MIN_COVERAGE - 1e-9) break;
        addProduct(f);
      }
    }
    const after = stats().coverage;
    issues.push({ code: "low_coverage", fixed: fix && after >= MIN_COVERAGE - 1e-9, message: `The product is on screen ${Math.round(before * 100)}% of the ad; at least ${Math.round(MIN_COVERAGE * 100)}% is required.` });
  }

  // 3. At least two appearances.
  s = stats();
  if (s.appearances < MIN_APPEARANCES) {
    const before = s.appearances;
    if (fix) {
      for (const f of frames.filter((x) => !shows(x) && fixable(x)).sort((a, b) => len(b) - len(a))) {
        if (stats().appearances >= MIN_APPEARANCES) break;
        addProduct(f);
      }
    }
    issues.push({ code: "too_few_appearances", fixed: fix && stats().appearances >= MIN_APPEARANCES, message: `The product appears in ${before} frame(s); it must appear at least ${MIN_APPEARANCES} times.` });
  }

  // 5. Product shots: the product is the centred main subject at ≥ 40 % of the frame, and the camera stays on it.
  for (const f of frames.filter(isProductShot)) {
    const weakImage = !hasProductFraming(f.imagePrompt ?? "");
    const weakMotion = !/\bcent(?:er|re)(?:ed|d) and fully in frame\b/i.test(f.videoPrompt ?? "");
    if (!weakImage && !weakMotion) continue;
    if (fix) {
      if (weakImage) f.imagePrompt = append(f.imagePrompt, productFramingClause(product));
      if (weakMotion) f.videoPrompt = append(f.videoPrompt, cameraOnProductClause(product));
    }
    if (weakImage) issues.push({ code: "weak_product_framing", frameNumber: f.frameNumber, fixed: fix, message: `Frame ${f.frameNumber} is a product shot but its prompt does not make the product the centered main subject at ≥ ${Math.round(PRODUCT_FRAMING_MIN * 100)}% of the frame.` });
  }

  const final = stats();
  return { frames, issues, coverage: Math.round(final.coverage * 1000) / 1000, firstProductSec: final.first, appearances: final.appearances };
}
