/**
 * What the viewer gets, from the render plan: the edit plan (edit-plan.ts cards / shots / CTA) after
 * an edit-v2 render, or the locked storyboard frames when re-scoring a finished run. Pure apart from
 * layersFromOverlays (reads PNG sizes).
 */
import type { PlatformId } from "@/services/creative/types";
import type { PlanLayer, PreflightPlan } from "./types";

/** `{NXTPAPER 14|Next Paper Fourteen}` → the shown form. */
const shown = (t: string) => t.replace(/\{([^|}]*)\|[^}]*\}/g, "$1").replace(/\s+/g, " ").trim();

export interface StoryboardFrameLike {
  startSec?: number;
  endSec?: number;
  segment?: string | null;
  textOverlay?: string | null;
  voiceover?: string | null;
  locked?: { engine?: string; refs?: string; localImage?: string; zoomHit?: unknown; compare?: unknown } | null;
}

/** A shot shows the product: a product-referenced keyframe, an official still, a zoom hit, a comparison, or the end card. */
function showsProduct(f: StoryboardFrameLike): boolean {
  const l = f.locked ?? {};
  return (f.segment ?? "").toUpperCase() === "CTA" || l.refs === "product" || l.engine === "local" || !!l.localImage || !!l.zoomHit || !!l.compare;
}

export function planFromStoryboard(frames: StoryboardFrameLike[], opts: { goal?: string | null; brandName?: string | null; captionCoverage?: number | null } = {}): PreflightPlan {
  const timed = frames.map((f, i) => ({ f, t0: Number.isFinite(f.startSec) ? f.startSec! : i * 2, t1: Number.isFinite(f.endSec) ? f.endSec! : (i + 1) * 2 }));
  const cta = timed.find((x) => (x.f.segment ?? "").toUpperCase() === "CTA");
  const roleOf = (seg: string | null | undefined) => ((seg ?? "").toUpperCase() === "HOOK" ? "hook" : (seg ?? "").toUpperCase() === "CTA" ? "cta" : "claim");
  return {
    goal: opts.goal ?? null,
    brandName: opts.brandName ?? null,
    texts: timed.filter((x) => x.f.textOverlay?.trim()).map((x) => ({ text: x.f.textOverlay!.trim(), startSec: x.t0, endSec: x.t1, role: roleOf(x.f.segment) })),
    voiceover: timed.filter((x) => x.f.voiceover?.trim()).map((x) => ({ text: shown(x.f.voiceover!), startSec: x.t0, endSec: x.t1 })),
    productShots: timed.filter((x) => showsProduct(x.f)).map((x) => ({ startSec: x.t0, endSec: x.t1 })),
    ctaSec: cta ? cta.t0 : null,
    captionCoverage: opts.captionCoverage ?? null,
    layers: null,
  };
}

export interface EditPlanLike {
  ctaSec: number | null;
  cards: { text: string; startSec: number; endSec: number; role: string }[];
  shots: { startSec: number; endSec: number; segment: string; kind: string; zoomHit?: unknown; compare?: unknown }[];
  ctaButton: { text: string; startSec: number } | null;
  durationSec: number;
}

export function planFromEdit(
  plan: EditPlanLike,
  frames: { startSec: number; endSec: number; voiceover?: string | null }[],
  extra: { layers?: PlanLayer[] | null; captionCoverage?: number | null; goal?: string | null; brandName?: string | null; captions?: { text: string; startSec: number; endSec: number }[] } = {}
): PreflightPlan {
  return {
    goal: extra.goal ?? null,
    brandName: extra.brandName ?? null,
    texts: [
      ...plan.cards.map((c) => ({ text: c.text, startSec: c.startSec, endSec: c.endSec, role: c.role })),
      ...(plan.ctaButton ? [{ text: plan.ctaButton.text, startSec: plan.ctaButton.startSec, endSec: plan.durationSec, role: "cta" }] : []),
      ...(extra.captions ?? []).map((c) => ({ ...c, role: "caption" })),
    ].sort((a, b) => a.startSec - b.startSec || 0),
    voiceover: frames.filter((f) => f.voiceover?.trim()).map((f) => ({ text: shown(f.voiceover!), startSec: f.startSec, endSec: f.endSec })),
    productShots: plan.shots.filter((s) => s.segment === "CTA" || !!s.zoomHit || !!s.compare).map((s) => ({ startSec: s.startSec, endSec: s.endSec })),
    ctaSec: plan.ctaSec,
    captionCoverage: extra.captionCoverage ?? null,
    layers: extra.layers ?? null,
  };
}

/** The visible-ink box of a transparent PNG (shadow padding and empty margins trimmed). */
export async function inkBox(png: Buffer | string): Promise<{ left: number; top: number; width: number; height: number; fullW: number; fullH: number } | null> {
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++)
      if (data[(y * info.width + x) * 4 + 3] > 96) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1, fullW: info.width, fullH: info.height };
}

/** Readable overlay boxes of an edit-v2 render (centred horizontally on the frame or `cx`, `y` is the centre share of the height), trimmed to ink. */
export async function layersFromOverlays(overlays: { file: string | Buffer; y: number; startSec: number; endSec: number; role?: string; cx?: number }[], canvas: { w: number; h: number }): Promise<PlanLayer[]> {
  const out: PlanLayer[] = [];
  for (const o of overlays) {
    const b = await inkBox(o.file).catch(() => null);
    if (!b) continue;
    // Centred on the frame, or on `cx` when the edit laid it out in a platform safe box.
    const left = Math.round((o.cx ?? canvas.w / 2) - b.fullW / 2);
    const top = Math.round(canvas.h * o.y - b.fullH / 2);
    out.push({ role: o.role ?? "text", x: left + b.left, y: top + b.top, w: b.width, h: b.height, startSec: o.startSec, endSec: o.endSec });
  }
  return out;
}

export function defaultPlatform(aspectRatio: string): PlatformId {
  if (aspectRatio === "16:9") return "youtube_instream_skippable";
  if (aspectRatio === "4:5" || aspectRatio === "1:1") return "meta_feed";
  return "tiktok";
}
