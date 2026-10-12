import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeModel, type FakeModel } from "@/test-utils/fake-rows";

const h = vi.hoisted(() => ({ project: null as unknown as FakeModel }));
vi.mock("@/lib/db", () => ({
  prisma: {
    get project() {
      return h.project;
    },
  },
}));
vi.mock("@/services/research/product-page-scraper", () => ({ scrapeProductPageDetailed: vi.fn() }));

import { PATCH } from "./route";

const patch = (body: unknown, id = "p1") =>
  PATCH(new Request("https://x/api", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), {
    params: Promise.resolve({ projectId: id }),
  });

beforeEach(() => {
  h.project = createFakeModel([{ id: "p1", productName: null, productUrl: null, fieldStatus: { campaignGoal: "suggested" } }]);
});

describe("PATCH product — confirmed marks", () => {
  it("parallel edits of different fields keep each other's marks", async () => {
    const res = await Promise.all([patch({ productName: "QM8L" }), patch({ productUrl: "https://tcl.test/qm8l" })]);
    expect(res.map((r) => r.status)).toEqual([200, 200]);
    const row = h.project.rows.get("p1")!;
    expect(row).toMatchObject({ productName: "QM8L", productUrl: "https://tcl.test/qm8l" });
    expect(row.fieldStatus).toEqual({ campaignGoal: "suggested", productName: "confirmed", productUrl: "confirmed" });
    expect(row.productConfirmedAt).toBeTruthy();
  });

  it("404s for an unknown project", async () => {
    expect((await patch({ productName: "x" }, "nope")).status).toBe(404);
  });
});
