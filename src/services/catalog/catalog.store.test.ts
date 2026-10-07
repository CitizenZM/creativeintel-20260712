import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  project: { findUnique: vi.fn() },
  brandKit: { findUnique: vi.fn() },
  catalogRun: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
}));
const fetcher = vi.hoisted(() => ({ safeFetchText: vi.fn(), safeFetchBuffer: vi.fn() }));
const storage = vi.hoisted(() => ({ uploadBuffer: vi.fn() }));
const render = vi.hoisted(() => ({ renderImageAdSet: vi.fn() }));
const ledger = vi.hoisted(() => ({ budgets: vi.fn(), reserve: vi.fn(), setBudget: vi.fn() }));
const compile = vi.hoisted(() => ({ compileRunFromStoryboard: vi.fn(), LibtvCompileError: class extends Error {} }));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/safe-fetch", () => fetcher);
vi.mock("@/services/storage", () => storage);
vi.mock("@/services/image-ads/generate", () => render);
vi.mock("@/services/ops/budget-guard", () => ({ spendLedger: async () => ledger }));
vi.mock("@/services/video-gen/libtv-compile", () => compile);
vi.mock("@/services/ai/claude-client", () => ({ analyzeWithClaude: vi.fn(async () => { throw new Error("no model calls"); }) }));
vi.mock("@/services/video-gen/edit/brand-style", async (orig) => {
  const real = await orig<typeof import("@/services/video-gen/edit/brand-style")>();
  return { ...real, loadBrandStyle: vi.fn(async () => real.DEFAULT_STYLE) };
});

import { CatalogError, importCatalog, planCatalogRun, renderCatalogImages } from "./catalog.store";
import { parseFeed } from "./feeds";

const fx = (name: string) => readFileSync(path.join(__dirname, "__fixtures__", name), "utf8");

beforeEach(() => {
  vi.clearAllMocks();
  db.project.findUnique.mockResolvedValue({ id: "p1" });
  db.brandKit.findUnique.mockResolvedValue({ colorsHex: [] });
  db.catalogRun.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "cr1", ...data }));
  db.catalogRun.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "cr1", ...data }));
  ledger.budgets.mockResolvedValue({ project: { budgetUsd: 2, spentUsd: 0 }, run: null });
});

describe("importCatalog", () => {
  it("parses inline feed text and stores a CatalogRun", async () => {
    const out = await importCatalog({ projectId: "p1", feedText: fx("meta-catalog.csv") });
    expect(out).toMatchObject({ id: "cr1", format: "meta-csv", count: 2, skipped: [{ sku: "OTT-BAD", reason: "no title" }] });
    const data = db.catalogRun.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ projectId: "p1", source: "inline:meta-csv", format: "meta-csv", mode: "image", status: "imported" });
    expect(data.products).toHaveLength(2);
    expect(fetcher.safeFetchText).not.toHaveBeenCalled();
  });

  it("fetches a feed URL through the guarded fetch (mocked) and resolves relative Shopify URLs", async () => {
    fetcher.safeFetchText.mockResolvedValue({ ok: true, status: 200, text: fx("shopify-products.json"), contentType: "application/json", finalUrl: "https://shop.example/products.json" });
    const out = await importCatalog({ projectId: "p1", feedUrl: "https://shop.example/products.json", currency: "USD" });
    expect(out.format).toBe("shopify");
    expect(fetcher.safeFetchText).toHaveBeenCalledWith("https://shop.example/products.json", undefined, expect.objectContaining({ maxBytes: expect.any(Number) }));
    expect(db.catalogRun.create.mock.calls[0][0].data.products[0].url).toBe("https://shop.example/products/cosori-pro-le-air-fryer");
  });

  it("refuses bad input with a status", async () => {
    await expect(importCatalog({ projectId: "p1" })).rejects.toMatchObject({ status: 400 });
    fetcher.safeFetchText.mockResolvedValue({ ok: false, status: 404, text: "", contentType: "", finalUrl: "x", error: "HTTP 404" });
    await expect(importCatalog({ projectId: "p1", feedUrl: "https://x.example/feed.xml" })).rejects.toBeInstanceOf(CatalogError);
    db.project.findUnique.mockResolvedValue(null);
    await expect(importCatalog({ projectId: "nope", feedText: "a,b" })).rejects.toMatchObject({ status: 404 });
  });
});

describe("planCatalogRun", () => {
  const products = parseFeed(fx("meta-catalog.csv")).products;
  beforeEach(() => db.catalogRun.findFirst.mockResolvedValue({ id: "cr1", projectId: "p1", products, results: { skipped: [], warnings: [] } }));

  it("image mode: stores the plan, no budget read", async () => {
    const out = await planCatalogRun({ projectId: "p1", catalogRunId: "cr1", mode: "image" });
    expect(out.summary).toMatchObject({ mode: "image", skus: 2 });
    expect(ledger.budgets).not.toHaveBeenCalled();
    expect(db.catalogRun.update).toHaveBeenCalledWith({ where: { id: "cr1" }, data: { mode: "image", status: "planned", results: expect.objectContaining({ plan: expect.objectContaining({ mode: "image" }) }) } });
  });

  it("video-full: checks the owner's budget, returns the estimate and never compiles or reserves spend", async () => {
    const out = await planCatalogRun({ projectId: "p1", catalogRunId: "cr1", mode: "video-full", platforms: ["tiktok"] });
    expect(ledger.budgets).toHaveBeenCalledWith("p1", null);
    expect(out.summary.cost).toMatchObject({ paid: true, approvalRequired: true, budget: expect.objectContaining({ approvedUsd: 2 }) });
    expect(ledger.reserve).not.toHaveBeenCalled();
    expect(ledger.setBudget).not.toHaveBeenCalled();
    expect(compile.compileRunFromStoryboard).not.toHaveBeenCalled();
  });

  it("404s an unknown run", async () => {
    db.catalogRun.findFirst.mockResolvedValue(null);
    await expect(planCatalogRun({ projectId: "p1", catalogRunId: "x", mode: "image" })).rejects.toMatchObject({ status: 404 });
  });
});

describe("renderCatalogImages", () => {
  const products = parseFeed(fx("meta-catalog.csv")).products;
  let results: Record<string, unknown>;
  beforeEach(async () => {
    db.catalogRun.findFirst.mockResolvedValue({ id: "cr1", projectId: "p1", products, results: { skipped: [], warnings: [] } });
    await planCatalogRun({ projectId: "p1", catalogRunId: "cr1", mode: "image" });
    results = db.catalogRun.update.mock.calls[0][0].data.results;
    db.catalogRun.update.mockClear();
    db.catalogRun.findFirst.mockResolvedValue({ id: "cr1", projectId: "p1", products, mode: "image", status: "planned", results });
    fetcher.safeFetchBuffer.mockResolvedValue({ ok: true, buffer: Buffer.from("png") });
    render.renderImageAdSet.mockImplementation(async (i: { templates: string[]; formats: string[] }) => ({
      items: i.templates.flatMap((t) => i.formats.map((f) => ({ template: t, format: f, w: 1080, h: 1080, png: Buffer.from("x"), notes: [] }))),
      skipped: [],
      product: null,
    }));
    storage.uploadBuffer.mockImplementation(async (i: { filename: string; buffer: Buffer }) => ({ url: `https://cdn.test/${i.filename}`, provider: "vercel-blob", bytes: 1 }));
  });

  it("renders the next SKUs locally, uploads and records them; a later call continues", async () => {
    const first = await renderCatalogImages({ projectId: "p1", catalogRunId: "cr1", limit: 1, formats: ["1080x1080"] });
    expect(first).toMatchObject({ rendered: ["OTT-P3"], remaining: 1, status: "rendering" });
    expect(render.renderImageAdSet).toHaveBeenCalledWith(expect.objectContaining({ formats: ["1080x1080"], templates: expect.arrayContaining(["hero-product", "offer-burst"]) }));
    expect(storage.uploadBuffer).toHaveBeenCalledWith(expect.objectContaining({ folder: "catalog/p1/cr1/OTT-P3", contentType: "image/png" }));
    const saved = db.catalogRun.update.mock.calls[0][0].data;
    expect(saved.results.images["OTT-P3"].items[0].url).toMatch(/^https:\/\/cdn\.test\//);

    db.catalogRun.findFirst.mockResolvedValue({ id: "cr1", projectId: "p1", products, mode: "image", status: "rendering", results: saved.results });
    const second = await renderCatalogImages({ projectId: "p1", catalogRunId: "cr1", limit: 5, formats: ["1080x1080"] });
    expect(second).toMatchObject({ rendered: ["OTT-MINI"], remaining: 0, status: "rendered" });
  });

  it("records a SKU whose packshot can't be fetched and moves on", async () => {
    fetcher.safeFetchBuffer.mockResolvedValueOnce({ ok: false, error: "HTTP 404" });
    const out = await renderCatalogImages({ projectId: "p1", catalogRunId: "cr1", limit: 2, formats: ["1080x1080"] });
    expect(out.failed).toEqual([{ sku: "OTT-P3", error: expect.stringMatching(/packshot/) }]);
    expect(out.rendered).toEqual(["OTT-MINI"]);
  });

  it("needs an image-mode plan and hosted storage", async () => {
    storage.uploadBuffer.mockResolvedValue({ url: "data:x", provider: "inline", bytes: 1 });
    const out = await renderCatalogImages({ projectId: "p1", catalogRunId: "cr1", limit: 1, formats: ["1080x1080"] });
    expect(out.failed[0].error).toMatch(/storage/i);
    db.catalogRun.findFirst.mockResolvedValue({ id: "cr1", projectId: "p1", products, mode: "video-full", status: "planned", results: { plan: { mode: "video-full", skus: [] } } });
    await expect(renderCatalogImages({ projectId: "p1", catalogRunId: "cr1" })).rejects.toMatchObject({ status: 409 });
  });
});
