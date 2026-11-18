/**
 * GET ?card=E01..E12&theme=brand|dark|light|festive — a still preview of an end-card template for the Ad Studio
 * gallery, drawn by Xark's own end-card code (edit/endcard-render.ts) with this project's brand look. Templates that
 * need data (price, code, rating, quote…) get sample values, marked as such in the gallery. PNG, 360×640.
 */
import { NextResponse } from "next/server";
import sharp, { type OverlayOptions } from "sharp";
import { withAccess } from "@/lib/auth/route-guard";
import { END_CARD_THEMES } from "@/services/video-gen/adstudio-catalog";
import { RENDERABLE_END_CARDS, endCardLayers, oneLinePill, type EndCardData, type EndCardTemplate, type EndCardTheme } from "@/services/video-gen/edit/endcard-render";
import { loadBrandStyle } from "@/services/video-gen/edit/brand-style";
import { prisma } from "@/lib/db";
import { cleanBranding } from "@/services/video-gen/adstudio-branding";

export const maxDuration = 30;
const C = { w: 1080, h: 1920 };
const BG: Record<string, string> = { dark: "#101317", light: "#f6f4f0", festive: "#4a0d14" };

/** sample values so every template can be previewed */
/** a remote image fitted into a box, or null (a missing logo or photo never breaks the preview) */
async function fitted(url: string | null | undefined, w: number, h: number): Promise<Buffer | null> {
  if (!url || !/^https?:/.test(url)) return null;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    return await sharp(Buffer.from(await r.arrayBuffer())).resize({ width: w, height: h, fit: "inside" }).png().toBuffer();
  } catch { return null; }
}

const SAMPLE: EndCardData = {
  headline: "Glow in seconds", pct: 20, price: 22, comparePrice: 28, currency: "$", code: "GLOW20", tag: "Gift set · save 20%",
  sticker: "link in bio ↓", button: "Shop now", deadline: "Ends Sunday", rating: 4.8, reviewCount: "2,140",
  quote: "My skin drinks it up — I use it on every flight.", quoteBy: "Verified buyer", appName: "Your App", benefits: ["Track your routine", "Reorder in one tap"],
  downloads: "100K+", url: "https://example.com/shop", skus: [{ label: "Mist", price: 22 }, { label: "Toner", price: 26 }, { label: "Serum", price: 34 }],
};

async function unguardedGET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const q = new URL(request.url).searchParams;
  const card = (q.get("card") ?? "").toUpperCase() as EndCardTemplate;
  const theme = (END_CARD_THEMES as readonly string[]).includes(q.get("theme") ?? "") ? (q.get("theme") as EndCardTheme) : "brand";
  if (!RENDERABLE_END_CARDS.includes(card)) return NextResponse.json({ error: "unknown card" }, { status: 400 });
  const [look, project] = await Promise.all([
    loadBrandStyle(projectId),
    prisma.project.findUnique({ where: { id: projectId }, select: { userProductImages: true, productPageImages: true } }),
  ]);
  // the carousel (E07) and other product tiles use this project's Setup photos
  const photos = [...(Array.isArray(project?.userProductImages) ? project.userProductImages : []), ...(Array.isArray(project?.productPageImages) ? project.productPageImages : [])]
    .map((i) => (i as { url?: string })?.url).filter((u): u is string => typeof u === "string" && /^https?:/.test(u));
  // what the user typed in the panel replaces the sample values and the project's own logo / photo
  const typed = cleanBranding({ logoUrl: q.get("logo"), productImageUrl: q.get("photo"), linkUrl: q.get("url"), couponCode: q.get("code"), couponText: q.get("offer"), headline: q.get("headline"), cta: q.get("cta") });
  const sample: EndCardData = { ...SAMPLE, ...(typed.headline ? { headline: typed.headline } : {}), ...(typed.couponCode ? { code: typed.couponCode } : {}), ...(typed.couponText ? { tag: typed.couponText } : {}), ...(typed.linkUrl ? { url: typed.linkUrl } : {}), ...(typed.cta ? { button: typed.cta } : {}) };
  if (typed.productImageUrl) photos.unshift(typed.productImageUrl);
  const skus = SAMPLE.skus!.map((k, i) => ({ ...k, imageUrl: photos[i % Math.max(1, photos.length)] ?? null }));
  const res = await endCardLayers(card, { ...sample, skus, theme }, C, look);
  if (!res) return NextResponse.json({ error: "template returned nothing" }, { status: 422 });
  const layers = [...res.layers];
  const comp: OverlayOptions[] = [];
  // like the finished video (Ad Studio XarkEnd): brand logo on top, product photo in the middle when the template has no main element
  const [logo, photo] = await Promise.all([
    fitted(typed.logoUrl ?? look.logoUrl, 380, 120),
    layers.some((l) => l.role === "main") ? null : fitted(photos[0], 560, 560),
  ]);
  const under: OverlayOptions[] = []; // photo and logo sit under the template's own layers
  const place = async (png: Buffer, y: number) => { const m = await sharp(png).metadata(); under.push({ input: png, top: Math.round(y * C.h - (m.height ?? 0) / 2), left: Math.round((C.w - (m.width ?? 0)) / 2) }); };
  if (photo) await place(photo, 0.4);
  if (logo) await place(logo, 0.178);
  for (const l of layers) {
    // a layer can come out wider or taller than the frame (long headline in the brand font): shrink it to fit
    let png = l.png; let m = await sharp(png).metadata();
    if ((m.width ?? 0) > C.w || (m.height ?? 0) > C.h) { png = await sharp(png).resize({ width: C.w, height: C.h, fit: "inside" }).png().toBuffer(); m = await sharp(png).metadata(); }
    const h = m.height ?? 0, w = m.width ?? 0;
    comp.push({ input: png, top: Math.min(C.h - h, Math.max(0, Math.round(l.y * C.h - h / 2))), left: Math.max(0, Math.round((C.w - w) / 2)) });
  }
  if (!res.hideButton) {
    const btn = await oneLinePill((sample.button ?? "Shop now").toUpperCase(), C, { size: 58, fg: look.buttonText, bg: look.button, family: look.headline.family, fontFile: look.headline.file, widthPct: 0.5 });
    const m = await sharp(btn).metadata();
    comp.push({ input: btn, top: Math.round(0.603 * C.h - (m.height ?? 0) / 2), left: Math.round((C.w - (m.width ?? 0)) / 2) });
  }
  const bg = theme === "brand" ? look.button : BG[theme];
  const png = await sharp({ create: { width: C.w, height: C.h, channels: 4, background: bg } })
    .composite([...(theme === "brand" ? [{ input: Buffer.from(`<svg width="${C.w}" height="${C.h}"><rect width="100%" height="100%" fill="#000" opacity="0.45"/></svg>`) }] : []), ...under, ...comp])
    .png()
    .toBuffer()
    // sharp runs resize before composite inside one pipeline, so shrink in a second pass
    .then((full) => sharp(full).resize(360, 640).png().toBuffer());
  return new NextResponse(new Uint8Array(png), { headers: { "content-type": "image/png", "cache-control": "private, max-age=3600" } });
}

export const GET = withAccess(unguardedGET);
