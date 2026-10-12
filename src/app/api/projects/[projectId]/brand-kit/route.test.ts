import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeModel, type FakeModel } from "@/test-utils/fake-rows";

const h = vi.hoisted(() => ({ brandKit: null as unknown as FakeModel, project: null as unknown as FakeModel }));
vi.mock("@/lib/db", () => ({
  prisma: {
    get brandKit() {
      return h.brandKit;
    },
    get project() {
      return h.project;
    },
  },
}));
vi.mock("@/services/brand-kit", () => ({
  ensureBrandKit: vi.fn(async () => ({ id: "k1" })),
  getBrandKitCompleteness: vi.fn(),
  refreshCompleteness: vi.fn(async () => ({ score: 0 })),
}));
vi.mock("@/services/storage", () => ({ getStorageStatus: () => ({ provider: "inline", configured: false }) }));

import { PUT } from "./route";

const put = (body: unknown) =>
  PUT(new Request("https://x/api", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), {
    params: Promise.resolve({ projectId: "p1" }),
  });
const kit = () => h.brandKit.rows.get("k1")!;

beforeEach(() => {
  h.project = createFakeModel([{ id: "p1" }]);
  h.brandKit = createFakeModel([{ id: "k1", projectId: "p1", offerText: null, toneGuidelines: null, skuName: null, fieldStatus: { tone: "suggested", offer: "suggested" } }]);
  // the route re-reads the kit with findUniqueOrThrow + include
  (h.brandKit as unknown as { findUniqueOrThrow: unknown }).findUniqueOrThrow = async (a: { where: Record<string, unknown> }) => {
    const row = await h.brandKit.findUnique(a);
    return { ...row, assets: [] };
  };
});

describe("PUT /brand-kit", () => {
  it("two saves of DIFFERENT fields from the same loaded kit both survive", async () => {
    const baseline = { offerText: "", toneGuidelines: "", skuName: "" };
    // both tabs loaded the empty kit; each changes its own field
    const [a, b] = await Promise.all([
      put({ offerText: "10% off", toneGuidelines: "", skuName: "", baseline }),
      put({ offerText: "", toneGuidelines: "warm and direct", skuName: "", baseline }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(kit()).toMatchObject({ offerText: "10% off", toneGuidelines: "warm and direct" });
  });

  it("does not revert a field that changed after the client loaded it", async () => {
    h.brandKit.onBeforeWrite = (n) => {
      if (n === 0) h.brandKit.concurrentWrite("k1", { skuName: "Widget 3000", fieldStatus: { skuName: "suggested" } });
    };
    const baseline = { offerText: "", toneGuidelines: "", skuName: "" };
    const res = await put({ offerText: "10% off", toneGuidelines: "", skuName: "", baseline });
    expect(res.status).toBe(200);
    expect(kit()).toMatchObject({ offerText: "10% off", skuName: "Widget 3000" });
    expect(kit().fieldStatus).toEqual({ skuName: "suggested" }); // offer confirmed (absent), skuName mark kept, tone mark of the old row was not resurrected
  });

  it("still writes every sent field when the client sends no baseline", async () => {
    const res = await put({ offerText: "5% off", toneGuidelines: "calm" });
    expect(res.status).toBe(200);
    expect(kit()).toMatchObject({ offerText: "5% off", toneGuidelines: "calm" });
    expect(kit().fieldStatus).toEqual({});
  });

  it("404s when the project is gone", async () => {
    h.project.rows.clear();
    h.project.findUnique = async () => null;
    expect((await put({ offerText: "x" })).status).toBe(404);
  });
});
