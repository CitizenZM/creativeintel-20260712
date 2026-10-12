import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeModel, type FakeModel } from "@/test-utils/fake-rows";

const h = vi.hoisted(() => ({ project: null as unknown as FakeModel, ai: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: {
    get project() {
      return h.project;
    },
    contentAsset: { findMany: vi.fn(async () => []) },
    competitor: { create: vi.fn(async ({ data }: { data: { name: string; url: string | null } }) => ({ id: `c-${data.name}`, name: data.name, url: data.url })) },
  },
}));
vi.mock("@/services/ai/claude-client", () => ({ analyzeWithClaude: h.ai }));

import { suggestCompetitors } from "./competitor-suggest";

beforeEach(() => {
  h.project = createFakeModel([{ id: "p1", brandName: "TCL", brandUrl: null, category: null, productName: null, productPageTitle: null, productPageText: null, campaignGoal: null, competitors: [], brand: null, fieldStatus: { productName: "suggested", __suggestedAt: "t" } }]);
  h.ai.mockResolvedValue({ competitors: [{ name: "Samsung", reason: "r" }] });
});

describe("suggestCompetitors status marks", () => {
  it("adds its marks to the status map as it is AFTER the model call", async () => {
    h.ai.mockImplementation(async () => {
      // the user confirms another field while the model is thinking
      h.project.concurrentWrite("p1", { fieldStatus: { productName: "confirmed", __suggestedAt: "t" } });
      return { competitors: [{ name: "Samsung", reason: "r" }] };
    });
    const added = await suggestCompetitors("p1", 1);
    expect(added.map((a) => a.name)).toEqual(["Samsung"]);
    expect(h.project.rows.get("p1")!.fieldStatus).toEqual({ productName: "confirmed", __suggestedAt: "t", "competitor.c-Samsung": "suggested" });
  });
});
