import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const llm = vi.hoisted(() => ({ analyzeWithClaude: vi.fn(async () => { throw new Error("no model calls while planning a catalog"); }) }));
const compile = vi.hoisted(() => ({ compileRunFromStoryboard: vi.fn(), LibtvCompileError: class extends Error {} }));
vi.mock("@/services/ai/claude-client", () => llm);
vi.mock("@/services/video-gen/libtv-compile", () => compile);

import { parseFeed } from "./feeds";
import { planCatalog, skuPromo } from "./plan";
import type { CatalogProduct } from "./types";

const fx = (name: string) => readFileSync(path.join(__dirname, "__fixtures__", name), "utf8");
const products: CatalogProduct[] = [
  ...parseFeed(fx("shopify-products.json"), { sourceUrl: "https://shop.example/products.json", currency: "USD" }).products,
  ...parseFeed(fx("google-merchant.xml")).products,
  ...parseFeed(fx("meta-catalog.csv")).products,
];
const RUN_DATE = "2026-11-01T12:00:00.000Z";
const bySku = <T extends { sku: string }>(list: T[], sku: string) => list.find((x) => x.sku === sku)!;

describe("skuPromo", () => {
  it("feed sale price → price / comparePrice / pct; catalog code + deadline; sale end date as deadline fallback", () => {
    const fryer = bySku(products, "CS-LE-5QT-BLK");
    expect(skuPromo(fryer, { code: "SAVE10" })).toMatchObject({ price: 89.99, comparePrice: 119.99, pct: 25, code: "SAVE10", currency: "$" });
    const core = bySku(products, "LV-CORE300");
    expect(skuPromo(core, {})).toMatchObject({ price: 79.99, comparePrice: 99.99, pct: 20, deadline: "2026-11-30T23:59-08:00" });
    expect(skuPromo(bySku(products, "RB-BL-1000"), {})).toMatchObject({ price: 39.99, comparePrice: null, pct: null });
  });
});

describe("planCatalog — image mode (free, local)", () => {
  const plan = planCatalog("p1", products, { mode: "image", runDate: RUN_DATE });
  it("plans every sellable SKU with a packshot and skips the rest with a reason", () => {
    expect(plan.skus.map((s) => s.sku)).toEqual(["CS-LE-5QT-BLK", "RB-BL-1000", "LV-CORE300", "TCL-85QM8", "OTT-P3", "OTT-MINI"]);
    expect(plan.skipped).toEqual([
      { sku: "huggie-hoop-earrings", reason: "out of stock" },
      { sku: "LV-FILTER", reason: "out of stock" },
    ]);
    expect(plan.cost).toMatchObject({ paid: false, totalUsd: { low: 0, expected: 0, high: 0 } });
    expect(plan.compiles).toBe(false);
    expect(llm.analyzeWithClaude).not.toHaveBeenCalled();
  });
  it("picks only the templates whose facts exist (offer only for SKUs on sale)", () => {
    const fryer = bySku(plan.skus, "CS-LE-5QT-BLK");
    expect(fryer.image!.templates).toContain("offer-burst");
    expect(fryer.image!.copy.headline).toBeTruthy();
    expect(bySku(plan.skus, "RB-BL-1000").image!.templates).not.toContain("offer-burst");
    // A catalog-wide code gives every SKU an offer.
    const coded = planCatalog("p1", products, { mode: "image", promo: { code: "SAVE10" }, runDate: RUN_DATE });
    expect(bySku(coded.skus, "RB-BL-1000").image!.templates).toContain("offer-burst");
  });
  it("caps at maxSkus", () => {
    const capped = planCatalog("p1", products, { mode: "image", maxSkus: 2, runDate: RUN_DATE });
    expect(capped.skus).toHaveLength(2);
    expect(capped.skipped.filter((s) => s.reason === "over maxSkus").map((s) => s.sku)).toEqual(["LV-CORE300", "TCL-85QM8", "OTT-P3", "OTT-MINI"]);
  });
  it("skips SKUs without an image", () => {
    const noImg = { ...bySku(products, "RB-BL-1000"), sku: "NOIMG", images: [] };
    expect(planCatalog("p1", [noImg], { mode: "image" }).skipped).toEqual([{ sku: "NOIMG", reason: "no image" }]);
  });
});

describe("planCatalog — video-template mode", () => {
  const plan = planCatalog("p1", products, { mode: "video-template", platforms: ["tiktok"], runDate: RUN_DATE });
  it("locks one storyboard template per category, shared by its SKUs", () => {
    expect(plan.templates.map((t) => t.category).sort()).toEqual(["auto_accessories", "home_air_cleaning", "kitchen_appliance", "sports_outdoor_cycling", "tv"]);
    const auto = plan.templates.find((t) => t.category === "auto_accessories")!;
    expect(auto.skus).toEqual(["OTT-P3", "OTT-MINI"]);
    expect(bySku(plan.skus, "OTT-MINI").templateId).toBe(auto.id);
  });
  it("template scenes are product-free; the SKU packshot goes into product slots in the edit", () => {
    for (const t of plan.templates) {
      expect(t.frames.length).toBeGreaterThan(2);
      for (const f of t.frames) {
        expect(f.imagePrompt ?? "").not.toMatch(/image 1/);
        expect(f.locked.refs ?? "none").not.toMatch(/product/);
      }
      expect(t.productSlotFrames.length).toBeGreaterThan(0);
      expect(t.frames.find((f) => f.frameNumber === t.endCardFrame)?.locked.endCard).toBeTruthy();
    }
  });
  it("each SKU gets its own packshot, copy and price / offer end card", () => {
    const p3 = bySku(plan.skus, "OTT-P3");
    expect(p3.slots![0]).toMatchObject({ packshotUrl: "https://img.example/p3.jpg", productName: "Ottocast P3 CarPlay AI Box" });
    expect(p3.slots![0].endCard.data).toMatchObject({ price: 99.99, comparePrice: 129.99, pct: 23 });
    const mini = bySku(plan.skus, "OTT-MINI");
    expect(mini.slots![0].endCard.data).toMatchObject({ price: 59.99 });
    expect(mini.slots![0].endCard.data?.comparePrice).toBeUndefined();
    expect(Object.values(p3.slots![0].voiceovers).join(" ")).not.toEqual(Object.values(mini.slots![0].voiceovers).join(" "));
  });
  it("costs the first render of each template only; every SKU after that is a free re-edit", () => {
    expect(plan.cost.paid).toBe(true);
    expect(plan.cost.perSkuUsd).toEqual({ low: 0, expected: 0, high: 0 });
    const sum = plan.templates.reduce((s, t) => s + t.firstRenderUsd.expected, 0);
    expect(plan.cost.totalUsd.expected).toBeCloseTo(sum, 6);
    expect(plan.cost.firstRenderUsd.expected).toBeGreaterThan(0);
    const two = planCatalog("p1", products, { mode: "video-template", platforms: ["tiktok", "meta_feed"], runDate: RUN_DATE });
    expect(two.templates).toHaveLength(10);
  });
});

describe("planCatalog — video-full mode (paid: estimate only)", () => {
  it("returns the per-SKU cost estimate and never compiles", () => {
    const plan = planCatalog("p1", products, { mode: "video-full", platforms: ["tiktok"], runDate: RUN_DATE });
    expect(plan.compiles).toBe(false);
    expect(plan.cost.paid).toBe(true);
    expect(plan.cost.approvalRequired).toBe(true);
    for (const s of plan.skus) expect(s.full!.costUsd.expected).toBeGreaterThan(0);
    const tpl = planCatalog("p1", products, { mode: "video-template", platforms: ["tiktok"], runDate: RUN_DATE });
    expect(plan.cost.totalUsd.expected).toBeGreaterThan(tpl.cost.totalUsd.expected);
    expect(plan.cost.recommendedBudgetUsd).toBeGreaterThanOrEqual(plan.cost.totalUsd.high);
    expect(compile.compileRunFromStoryboard).not.toHaveBeenCalled();
    expect(llm.analyzeWithClaude).not.toHaveBeenCalled();
  });
  it("scales linearly with SKUs and checks the owner's approved budget without approving anything", () => {
    const base = bySku(products, "RB-BL-1000");
    const two = planCatalog("p1", [base, { ...base, sku: "B" }], { mode: "video-full", platforms: ["tiktok"], runDate: RUN_DATE });
    const four = planCatalog("p1", [base, { ...base, sku: "B" }, { ...base, sku: "C" }, { ...base, sku: "D" }], { mode: "video-full", platforms: ["tiktok"], runDate: RUN_DATE });
    expect(four.cost.totalUsd.expected).toBeCloseTo(two.cost.totalUsd.expected * 2, 6);
    const tight = planCatalog("p1", [base], { mode: "video-full", platforms: ["tiktok"], runDate: RUN_DATE, budget: { budgetUsd: 0.5, spentUsd: 0.25 } });
    expect(tight.cost.budget).toMatchObject({ approvedUsd: 0.5, spentUsd: 0.25, fits: false });
    expect(tight.cost.budget!.shortfallUsd).toBeGreaterThan(0);
    const roomy = planCatalog("p1", [base], { mode: "video-full", platforms: ["tiktok"], runDate: RUN_DATE, budget: { budgetUsd: 500, spentUsd: 0 } });
    expect(roomy.cost.budget).toMatchObject({ fits: true, shortfallUsd: 0 });
    const none = planCatalog("p1", [base], { mode: "video-full", platforms: ["tiktok"], runDate: RUN_DATE, budget: { budgetUsd: null, spentUsd: 0 } });
    expect(none.cost.budget).toMatchObject({ approvedUsd: null, fits: false });
    expect(none.cost.note).toMatch(/set-budget/);
  });
});
