import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeModel, type FakeModel } from "@/test-utils/fake-rows";

const h = vi.hoisted(() => ({ project: null as unknown as FakeModel }));
vi.mock("@/lib/db", () => ({
  prisma: {
    get project() {
      return h.project;
    },
    campaignSelection: { upsert: vi.fn(async ({ create }: { create: object }) => create) },
  },
}));

import { PATCH } from "./route";

const patch = (body: unknown) =>
  PATCH(new Request("https://x/api", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), {
    params: Promise.resolve({ projectId: "p1" }),
  });

beforeEach(() => {
  h.project = createFakeModel([{ id: "p1", fieldStatus: { __suggestedAt: "2026-10-01T00:00:00Z", campaignGoal: "suggested" } }]);
});

describe("campaign-selection status marks", () => {
  it("parallel saves of different fields keep every mark (and the bookkeeping key)", async () => {
    await Promise.all([patch({ platform: "tiktok" }), patch({ selectedEnvironment: "kitchen" }), patch({ selectedActorRole: "chef", suggested: true })]);
    expect(h.project.rows.get("p1")!.fieldStatus).toEqual({
      __suggestedAt: "2026-10-01T00:00:00Z",
      campaignGoal: "suggested",
      "campaign.platform": "confirmed",
      "campaign.selectedEnvironment": "confirmed",
      "campaign.selectedActorRole": "suggested",
    });
  });
});
