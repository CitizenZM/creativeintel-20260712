/**
 * The end card an Ad Studio run closes on: one of Xark's E01–E12 templates, rendered by the same code as Xark's own
 * edit (edit/endcard-render.ts endCardLayers) with the project's brand look. The Mac worker asks for it once per run
 * (worker action "endcard") and Ad Studio's renderer animates the layers, drawing the logo and CTA button itself.
 * Data comes from the run's frozen input (offer, brand kit); a template whose data is missing returns null and the
 * video keeps Ad Studio's own close.
 */
import { prisma } from "@/lib/db";
import { endCardLayers, type EndCardData, type EndCardTemplate, type EndCardTheme } from "./edit/endcard-render";
import { loadBrandStyle } from "./edit/brand-style";

type J = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** a complete short phrase (≤ 7 words): the whole text, else its first clause; never a sentence cut mid-way */
const short = (v: unknown) => {
  if (typeof v !== "string" || !v.trim()) return null;
  const fits = (t: string) => t.split(/\s+/).filter(Boolean).length <= 7;
  const t = v.trim().replace(/[.!]+$/, "");
  if (fits(t)) return t;
  const clause = t.split(/[,;:—–-]\s/)[0].trim();
  return fits(clause) ? clause : null;
};
/** no offer text: the brand promise, else the strongest selling point, else the product name (E01 and others need a headline) */
function fallbackHeadline(input: J): string | null {
  const c = (input.context ?? {}) as { brand?: { promise?: string }; insights?: { sellingPoints?: { point?: string }[] }; setup?: { productName?: string } };
  return short(c.brand?.promise) ?? short(c.insights?.sellingPoints?.[0]?.point) ?? short(c.setup?.productName) ?? short((input.project as J | undefined)?.productName);
}

/** the template's data from the run input: offer prices / percent / code, CTA, landing URL */
export function endCardData(input: J, theme: string): EndCardData {
  const o = (input.offer ?? {}) as J;
  const kit = (input.brandKit ?? {}) as J;
  const project = (input.project ?? {}) as J;
  const b = (input.branding ?? {}) as { headline?: string; cta?: string; linkUrl?: string };
  const was = num(o.was), now = num(o.now);
  const pct = was && now && was > now ? Math.round((1 - now / was) * 100) : null;
  const cta = Array.isArray(kit.ctaOptions) ? (kit.ctaOptions as (string | { text?: string })[]).map((c) => (typeof c === "string" ? c : c?.text)).find(Boolean) : null;
  return {
    headline: b.headline || (typeof o.text === "string" && o.text) || (typeof kit.offerText === "string" && kit.offerText) || fallbackHeadline(input),
    pct, price: now, comparePrice: was, currency: "$",
    code: (typeof o.code === "string" && o.code) || null,
    button: b.cta || cta || null,
    url: b.linkUrl || (typeof kit.landingUrl === "string" && kit.landingUrl) || (typeof project.productUrl === "string" ? project.productUrl : null),
    theme: theme as EndCardTheme,
  };
}

export async function renderRunEndCard(runId: string) {
  const run = await prisma.adStudioRun.findUnique({ where: { id: runId }, select: { projectId: true, input: true } });
  const input = (run?.input ?? {}) as J;
  const ec = input.endCard as { id?: string; theme?: string; name?: string } | null;
  if (!run || !ec?.id) return { endCard: null };
  const look = await loadBrandStyle(run.projectId);
  const res = await endCardLayers(ec.id as EndCardTemplate, endCardData(input, ec.theme ?? "brand"), { w: 1080, h: 1920 }, look, { durationSec: 3.5 });
  if (!res) return { endCard: null, reason: `${ec.id} needs data this run does not have (price, code, rating…) — Ad Studio's own close is used` };
  return {
    endCard: {
      id: ec.id, name: ec.name ?? ec.id, theme: ec.theme ?? "brand", hideButton: res.hideButton,
      layers: res.layers.map((l) => ({ png: l.png.toString("base64"), y: l.y, delaySec: l.delaySec, durSec: l.durSec, anim: l.anim, role: l.role })),
    },
  };
}
