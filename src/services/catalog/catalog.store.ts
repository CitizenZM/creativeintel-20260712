/**
 * CatalogRun persistence + the operator actions' work:
 *   importCatalog         feed URL (guarded fetch) or inline text → parseFeed → CatalogRun "imported"
 *   planCatalogRun        planCatalog over the stored products → results.plan, status "planned"
 *                         (paid modes read the owner-approved budget to report fit; never reserve,
 *                         approve or compile anything)
 *   renderCatalogImages   image mode: the next `limit` SKUs rendered locally (sharp + pango, $0),
 *                         uploaded, recorded in results.images[sku]; call again to continue
 */
import { prisma } from "@/lib/db";
import { archiveAround, archiveCatalogRun } from "@/services/artifacts/archive";
import { pMap } from "@/lib/parallel";
import type { FormatId, TemplateId } from "@/services/image-ads/types";
import { briefLite } from "./brief-lite";
import { parseFeed } from "./feeds";
import { planCatalog, skuImageAd, summarizeCatalogPlan, type CatalogPlan, type CatalogPromo } from "./plan";
import type { CatalogMode, CatalogProduct, FeedFormat, FeedSkip } from "./types";

export class CatalogError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const FEED_MAX_BYTES = 15_000_000;

interface StoredResults {
  skipped?: FeedSkip[];
  warnings?: string[];
  plan?: CatalogPlan;
  images?: Record<string, { items?: { template: string; format: string; w: number; h: number; url: string; bytes: number }[]; skipped?: { template: string; reason: string }[]; error?: string; at: string }>;
}

async function ensureProject(projectId: string) {
  const p = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!p) throw new CatalogError("Project not found", 404);
}

async function loadRun(projectId: string, catalogRunId: string) {
  const run = await prisma.catalogRun.findFirst({ where: { id: catalogRunId, projectId } });
  if (!run) throw new CatalogError("Catalog run not found", 404);
  return { ...run, products: (Array.isArray(run.products) ? run.products : []) as unknown as CatalogProduct[], results: ((run.results ?? {}) as StoredResults) };
}

export async function importCatalog(input: { projectId: string; feedUrl?: string; feedText?: string; format?: FeedFormat; currency?: string }) {
  if (!input.feedUrl && !input.feedText) throw new CatalogError("feedUrl or feedText required", 400);
  await ensureProject(input.projectId);
  let text = input.feedText ?? "";
  let sourceUrl: string | null = null;
  if (input.feedUrl) {
    const { safeFetchText } = await import("@/lib/safe-fetch");
    const r = await safeFetchText(input.feedUrl, undefined, { timeoutMs: 45_000, maxBytes: FEED_MAX_BYTES });
    if (!r.ok) throw new CatalogError(`Could not fetch the feed: ${r.error ?? `HTTP ${r.status}`}`, 502);
    text = r.text;
    sourceUrl = r.finalUrl || input.feedUrl;
  }
  let parsed;
  try {
    parsed = parseFeed(text, { format: input.format, sourceUrl, currency: input.currency });
  } catch (err) {
    throw new CatalogError(err instanceof Error ? err.message : String(err), 400);
  }
  if (!parsed.products.length) throw new CatalogError(`No products in the feed (${parsed.skipped.length} row(s) skipped)`, 422);
  const run = await prisma.catalogRun.create({
    data: {
      projectId: input.projectId,
      source: input.feedUrl ?? `inline:${parsed.format}`,
      format: parsed.format,
      products: parsed.products as object[],
      mode: "image",
      status: "imported",
      results: { skipped: parsed.skipped, warnings: parsed.warnings } as object,
    },
  });
  return {
    id: run.id,
    format: parsed.format,
    count: parsed.products.length,
    skipped: parsed.skipped,
    warnings: parsed.warnings.slice(0, 20),
    sample: parsed.products.slice(0, 3).map((p) => ({ sku: p.sku, title: p.title, price: p.price, salePrice: p.salePrice, images: p.images.length, availability: p.availability })),
  };
}

export async function planCatalogRun(input: {
  projectId: string;
  catalogRunId: string;
  mode: CatalogMode;
  platforms?: string[];
  goal?: string;
  promo?: CatalogPromo;
  maxSkus?: number;
  templates?: string[];
  formats?: string[];
}) {
  const run = await loadRun(input.projectId, input.catalogRunId);
  let budget: { budgetUsd: number | null; spentUsd: number } | undefined;
  let prices;
  if (input.mode !== "image") {
    // Read-only: the owner-approved budget is reported against, never reserved, raised or approved here.
    const [{ spendLedger }, { loadPriceTable }] = await Promise.all([import("@/services/ops/budget-guard"), import("@/services/ops/prices")]);
    budget = (await (await spendLedger()).budgets(input.projectId, null)).project;
    prices = await loadPriceTable();
  }
  const plan = planCatalog(input.projectId, run.products, {
    mode: input.mode,
    platforms: input.platforms,
    goal: input.goal,
    promo: input.promo,
    maxSkus: input.maxSkus,
    templates: input.templates as TemplateId[] | undefined,
    formats: input.formats as FormatId[] | undefined,
    budget,
    prices,
  });
  const results: StoredResults = { ...run.results, plan, images: input.mode === "image" ? run.results.images : undefined };
  await archiveAround("catalog plan", (o) => archiveCatalogRun(run.id, o), () => prisma.catalogRun.update({ where: { id: run.id }, data: { mode: input.mode, status: "planned", results: results as object } }));
  return { catalogRunId: run.id, summary: summarizeCatalogPlan(plan) };
}

export async function renderCatalogImages(input: { projectId: string; catalogRunId: string; limit?: number; formats?: string[] }) {
  const run = await loadRun(input.projectId, input.catalogRunId);
  const plan = run.results.plan;
  if (!plan || plan.mode !== "image") throw new CatalogError("Plan this catalog run in image mode first (catalog-plan mode \"image\")", 409);
  const images = { ...(run.results.images ?? {}) };
  const todo = plan.skus.filter((s) => !images[s.sku]?.items?.length).slice(0, Math.max(1, Math.min(20, input.limit ?? 3)));

  const [{ safeFetchBuffer }, { uploadBuffer }, { renderImageAdSet }, { loadBrandStyle }, { paletteFrom }] = await Promise.all([
    import("@/lib/safe-fetch"),
    import("@/services/storage"),
    import("@/services/image-ads/generate"),
    import("@/services/video-gen/edit/brand-style"),
    import("@/services/image-ads/palette"),
  ]);
  const [style, kit] = await Promise.all([loadBrandStyle(input.projectId), prisma.brandKit.findUnique({ where: { projectId: input.projectId }, select: { colorsHex: true } }).catch(() => null)]);
  const look = { palette: paletteFrom(style, (Array.isArray(kit?.colorsHex) ? kit.colorsHex : []) as { hex?: string; usage?: string }[]), headline: style.headline, body: style.body };
  const byId = new Map(run.products.map((p) => [p.sku, p]));
  const rendered: string[] = [];
  const failed: { sku: string; error: string }[] = [];

  await pMap(
    todo,
    async (s) => {
      const at = new Date().toISOString();
      try {
        const product = byId.get(s.sku);
        if (!product) throw new Error("SKU is no longer in the stored products");
        const img = await safeFetchBuffer(s.packshotUrl, { timeoutMs: 30_000 });
        if (!img.ok || !img.buffer) throw new Error(`packshot fetch failed (${img.error ?? "no data"})`);
        const { copy, templates } = skuImageAd(product, briefLite(product), s.promo, { templates: s.image?.templates });
        const formats = (input.formats?.length ? input.formats : s.image?.formats) as FormatId[] | undefined;
        const out = await renderImageAdSet({ copy, promo: s.promo, look, assets: { product: img.buffer }, templates, formats, concurrency: 2 });
        const stamp = Date.now().toString(36);
        const items = [];
        for (const r of out.items) {
          const up = await uploadBuffer({ buffer: r.png, filename: `${r.template}-${r.format}-${stamp}.png`, contentType: "image/png", folder: `catalog/${input.projectId}/${run.id}/${s.sku}` });
          if (up.provider === "inline") throw new Error("No asset storage configured — catalog image ads need Cloudinary or Vercel Blob");
          items.push({ template: r.template, format: r.format, w: r.w, h: r.h, url: up.url, bytes: up.bytes });
        }
        images[s.sku] = { items, skipped: out.skipped, at };
        rendered.push(s.sku);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        images[s.sku] = { error, at };
        failed.push({ sku: s.sku, error });
      }
    },
    { concurrency: 1 }
  );

  const remaining = plan.skus.filter((s) => !images[s.sku]?.items?.length && !images[s.sku]?.error).length;
  const status = remaining ? "rendering" : "rendered";
  await archiveAround("catalog images", (o) => archiveCatalogRun(run.id, o), () => prisma.catalogRun.update({ where: { id: run.id }, data: { status, results: { ...run.results, images } as object } }));
  return { catalogRunId: run.id, rendered, failed, remaining, status, costUsd: 0 };
}
