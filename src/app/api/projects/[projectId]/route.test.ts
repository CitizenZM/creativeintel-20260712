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

import { PATCH } from "./route";

const patch = (body: unknown, id = "p1") =>
  PATCH(new Request("https://x/api", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), {
    params: Promise.resolve({ projectId: id }),
  });
const row = () => h.project.rows.get("p1")!;

beforeEach(() => {
  h.project = createFakeModel([{ id: "p1", campaignGoal: null, goalType: null, fieldStatus: { productName: "suggested", "campaign.platform": "suggested" } }]);
});

describe("PATCH /api/projects/[projectId] — fieldStatus", () => {
  it("confirmField calls in parallel each keep the other's mark", async () => {
    h.project.rows.get("p1")!.fieldStatus = { a: "suggested", b: "suggested", c: "suggested" };
    const res = await Promise.all([patch({ action: "confirmField", field: "a" }), patch({ action: "confirmField", field: "b" })]);
    expect(res.map((r) => r.status)).toEqual([200, 200]);
    expect(row().fieldStatus).toEqual({ a: "confirmed", b: "confirmed", c: "suggested" });
  });

  it("confirmAllSuggestions merges onto a mark added since it started", async () => {
    h.project.onBeforeWrite = (n) => {
      if (n === 0) h.project.concurrentWrite("p1", { fieldStatus: { productName: "suggested", "campaign.platform": "suggested", "competitor.x": "suggested" } });
    };
    const res = await patch({ action: "confirmAllSuggestions" });
    expect(res.status).toBe(200);
    expect(row().fieldStatus).toEqual({ productName: "confirmed", "campaign.platform": "confirmed", "competitor.x": "confirmed" });
  });

  it("saving a tracked field writes it and confirms it without dropping a concurrent mark", async () => {
    h.project.onBeforeWrite = (n) => {
      if (n === 0) h.project.concurrentWrite("p1", { fieldStatus: { productName: "confirmed", goalType: "suggested" } });
    };
    const res = await patch({ campaignGoal: "Drive sales" });
    expect(res.status).toBe(200);
    expect(row()).toMatchObject({ campaignGoal: "Drive sales" });
    expect(row().fieldStatus).toEqual({ productName: "confirmed", goalType: "suggested", campaignGoal: "confirmed" });
    expect((await res.json()).campaignGoal).toBe("Drive sales");
  });

  it("404s for an unknown project on every status path", async () => {
    expect((await patch({ action: "confirmAllSuggestions" }, "nope")).status).toBe(404);
    expect((await patch({ action: "confirmField", field: "a" }, "nope")).status).toBe(404);
    expect((await patch({ campaignGoal: "x" }, "nope")).status).toBe(404);
  });
});
