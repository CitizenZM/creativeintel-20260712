import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeModel, type FakeModel } from "@/test-utils/fake-rows";

const h = vi.hoisted(() => ({ brandKit: null as unknown as FakeModel, project: null as unknown as FakeModel, ai: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: {
    get brandKit() {
      return h.brandKit;
    },
    get project() {
      return h.project;
    },
    brand: { findUnique: vi.fn(async () => null) },
    insight: { findMany: vi.fn(async () => []) },
    brandAsset: { count: vi.fn(async () => 9) },
  },
}));
vi.mock("@/services/ai/claude-client", () => ({ analyzeWithClaude: h.ai }));
vi.mock("@/services/brand-kit", () => ({
  ensureBrandKit: vi.fn(async () => h.brandKit.rows.get("k1")),
  refreshCompleteness: vi.fn(async () => ({ score: 0 })),
}));
vi.mock("@/services/research/product-adapters/shared", () => ({ fetchHtml: vi.fn() }));
vi.mock("@/services/storage", () => ({ uploadFromUrl: vi.fn() }));

import { POST } from "./route";

const post = () => POST(new Request("https://x/api", { method: "POST" }), { params: Promise.resolve({ projectId: "p1" }) });
const kit = () => h.brandKit.rows.get("k1")!;

beforeEach(() => {
  h.project = createFakeModel([{ id: "p1", brandName: "TCL", brandUrl: null, productUrl: "https://tcl.test/p", productPageTitle: null, productPageText: null, productPageImages: [], category: null, campaignGoal: null }]);
  h.brandKit = createFakeModel([{ id: "k1", projectId: "p1", fieldStatus: {}, offerText: null, toneGuidelines: null, skuName: null, landingUrl: null }]);
  (h.brandKit as unknown as { findUniqueOrThrow: unknown }).findUniqueOrThrow = async (a: { where: Record<string, unknown> }) => ({ ...(await h.brandKit.findUnique(a)), assets: [] });
  h.ai.mockReset();
  h.ai.mockResolvedValue({ toneGuidelines: "AI tone", skuName: "AI sku" });
});

describe("POST /brand-kit/suggest", () => {
  it("fills empty fields and marks exactly those as suggested", async () => {
    const res = await post();
    const body = await res.json();
    expect(kit()).toMatchObject({ toneGuidelines: "AI tone", skuName: "AI sku", landingUrl: "https://tcl.test/p" });
    expect(kit().fieldStatus).toMatchObject({ tone: "suggested", skuName: "suggested", landingUrl: "suggested", __suggestedAt: expect.any(String) });
    expect(body.suggested.fields.sort()).toEqual(["landingUrl", "skuName", "tone"]);
  });

  it("never overwrites a field the user filled while the model was thinking", async () => {
    h.ai.mockImplementation(async () => {
      // the user types a tone and a (different) sku while the LLM call is in flight
      h.brandKit.concurrentWrite("k1", { toneGuidelines: "typed by the user", fieldStatus: {} });
      return { toneGuidelines: "AI tone", skuName: "AI sku" };
    });
    const res = await post();
    const body = await res.json();
    expect(kit().toneGuidelines).toBe("typed by the user");
    expect(kit().skuName).toBe("AI sku");
    expect(kit().fieldStatus).not.toHaveProperty("tone");
    expect(kit().fieldStatus).toMatchObject({ skuName: "suggested" });
    expect(body.suggested.fields).not.toContain("tone");
  });

  it("decides again on a write conflict: a field filled between our read and write is left alone", async () => {
    h.brandKit.onBeforeWrite = (n) => {
      if (n === 0) h.brandKit.concurrentWrite("k1", { skuName: "typed sku" });
    };
    await post();
    expect(kit().skuName).toBe("typed sku");
    expect(kit().toneGuidelines).toBe("AI tone");
    expect(kit().fieldStatus).not.toHaveProperty("skuName");
  });
});
