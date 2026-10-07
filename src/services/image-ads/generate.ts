/**
 * Image Ads — a static ad set from the same plan as the video (Creatify "Image Ads"): every chosen
 * template × format rendered locally (sharp + pango, no paid model), uploaded through the storage
 * helper and kept on Project.imageAdSets (latest first, last 5 sets).
 */
import { pMap } from "@/lib/parallel";
import { deriveCopy, missingFacts, promoFrom, type BriefLike, type PlanLike } from "./copy";
import { productCutout } from "./cutout";
import { AD_FORMATS, formatById } from "./formats";
import { paletteFrom } from "./palette";
import { renderImageAd } from "./render";
import { TEMPLATE_IDS, templateById } from "./templates";
import type { AdLook, FormatId, ImageAdCopy, ImageAdPromo, ImageAdProof, TemplateId } from "./types";

export interface ImageAdItem {
  template: TemplateId;
  format: FormatId;
  w: number;
  h: number;
  url: string;
  bytes: number;
  notes: string[];
}

export interface ImageAdSet {
  version: 1;
  createdAt: string;
  items: ImageAdItem[];
  skipped: { template: TemplateId; reason: string }[];
  copy: Pick<ImageAdCopy, "headline" | "sub" | "cta" | "offerHeadline">;
}

export interface RenderSetInput {
  copy: ImageAdCopy;
  promo: ImageAdPromo;
  look: AdLook;
  assets: { product: Buffer | null; logo?: Buffer | null; before?: Buffer | null };
  templates?: TemplateId[];
  formats?: FormatId[];
  concurrency?: number;
}

/** Render the set locally (no I/O beyond CPU): PNG buffers + notes, templates without their facts skipped. */
export async function renderImageAdSet(input: RenderSetInput) {
  const templates = (input.templates?.length ? input.templates : TEMPLATE_IDS).map(templateById);
  const formats = (input.formats?.length ? input.formats : AD_FORMATS.map((f) => f.id)).map(formatById);
  const product = input.assets.product ? await productCutout(input.assets.product) : null;
  const skipped: { template: TemplateId; reason: string }[] = [];
  const jobs: { t: (typeof templates)[number]; f: (typeof formats)[number] }[] = [];
  for (const t of templates) {
    const missing = missingFacts(t, input.copy, input.promo);
    if (missing.length) skipped.push({ template: t.id, reason: `missing ${missing.join(", ")}` });
    else for (const f of formats) jobs.push({ t, f });
  }
  const items = await pMap(
    jobs,
    async ({ t, f }) => {
      const r = await renderImageAd({ template: t, format: f, copy: input.copy, promo: input.promo, look: input.look, assets: { product, logo: input.assets.logo, before: input.assets.before } });
      return { template: t.id, format: f.id, w: f.w, h: f.h, png: r.png, notes: r.notes };
    },
    { concurrency: input.concurrency ?? 3 }
  );
  return { items, skipped, product: product ? { method: product.method } : null };
}

export interface ImageAdSetOptions {
  brief?: BriefLike | null;
  plan?: PlanLike | null;
  promo?: ImageAdPromo;
  proof?: ImageAdProof | null;
  templates?: TemplateId[];
  formats?: FormatId[];
  copy?: Partial<ImageAdCopy>;
  productUrl?: string | null;
  beforeUrl?: string | null;
  /** Local buffers (tests, scripts) instead of URLs. */
  assets?: { product?: Buffer; logo?: Buffer; before?: Buffer };
}

async function fetchImage(url: string | null | undefined): Promise<Buffer | null> {
  if (!url) return null;
  const { safeFetchBuffer } = await import("@/lib/safe-fetch");
  const r = await safeFetchBuffer(url, { timeoutMs: 30_000 });
  return r.ok ? r.buffer : null;
}

export async function generateImageAdSet(projectId: string, opts: ImageAdSetOptions = {}): Promise<ImageAdSet> {
  const { prisma } = await import("@/lib/db");
  const { loadBrandStyle } = await import("@/services/video-gen/edit/brand-style");
  const { uploadBuffer } = await import("@/services/storage");
  const [project, kit, style] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { id: true, brandName: true, productName: true, productBrief: true, campaignPlan: true, productPageImages: true, imageAdSets: true } }),
    prisma.brandKit.findUnique({ where: { projectId }, select: { colorsHex: true, assets: { where: { kind: "PACKSHOT" }, orderBy: { createdAt: "desc" }, select: { url: true, variant: true } } } }),
    loadBrandStyle(projectId),
  ]);
  if (!project) throw new Error("Project not found");
  const brief = opts.brief ?? (project.productBrief as BriefLike | null);
  const plan = opts.plan ?? (project.campaignPlan as PlanLike | null);
  const promo = promoFrom(opts.promo, plan);
  const packshots = kit?.assets ?? [];
  const pageImages = (Array.isArray(project.productPageImages) ? project.productPageImages : []) as { url?: string }[];
  const productUrl = opts.productUrl ?? (packshots.find((a) => a.variant === "transparent") ?? packshots.find((a) => a.variant === "front") ?? packshots[0])?.url ?? pageImages[0]?.url ?? null;
  const [product, logo, before] = await Promise.all([
    opts.assets?.product ?? fetchImage(productUrl),
    opts.assets?.logo ?? fetchImage(style.logoUrl),
    opts.assets?.before ?? fetchImage(opts.beforeUrl),
  ]);
  if (!product) throw new Error("No product image — add a packshot to the brand kit or pass productUrl");

  const copy = deriveCopy({ brief, plan, brandName: project.brandName, productName: project.productName, promo, proof: opts.proof, ctaText: style.ctaText, overrides: opts.copy });
  const look: AdLook = { palette: paletteFrom(style, (Array.isArray(kit?.colorsHex) ? kit.colorsHex : []) as { hex?: string; usage?: string }[]), headline: style.headline, body: style.body };
  const rendered = await renderImageAdSet({ copy, promo, look, assets: { product, logo, before }, templates: opts.templates, formats: opts.formats });

  const stamp = Date.now().toString(36);
  const items: ImageAdItem[] = [];
  for (const r of rendered.items) {
    const up = await uploadBuffer({ buffer: r.png, filename: `${r.template}-${r.format}-${stamp}.png`, contentType: "image/png", folder: `image-ads/${projectId}` });
    if (up.provider === "inline") throw new Error("No asset storage configured — image ads need Cloudinary or Vercel Blob");
    items.push({ template: r.template, format: r.format, w: r.w, h: r.h, url: up.url, bytes: up.bytes, notes: r.notes });
  }
  const set: ImageAdSet = {
    version: 1,
    createdAt: new Date().toISOString(),
    items,
    skipped: rendered.skipped,
    copy: { headline: copy.headline, sub: copy.sub, cta: copy.cta, offerHeadline: copy.offerHeadline },
  };
  const previous = Array.isArray(project.imageAdSets) ? (project.imageAdSets as unknown as ImageAdSet[]) : [];
  await prisma.project.update({ where: { id: projectId }, data: { imageAdSets: [set, ...previous].slice(0, 5) as object[] } });
  return set;
}
