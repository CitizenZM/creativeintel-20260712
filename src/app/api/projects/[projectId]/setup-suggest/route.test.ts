import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeModel, type FakeModel } from "@/test-utils/fake-rows";

const h = vi.hoisted(() => ({ project: null as unknown as FakeModel, selection: null as unknown as FakeModel, ai: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: {
    get project() {
      return h.project;
    },
    get campaignSelection() {
      return h.selection;
    },
  },
}));
vi.mock("@/services/ai/claude-client", () => ({ analyzeWithClaude: h.ai }));

import { POST } from "./route";

const post = () => POST(new Request("https://x/api", { method: "POST" }), { params: Promise.resolve({ projectId: "p1" }) });
const project = () => h.project.rows.get("p1")!;

beforeEach(() => {
  h.project = createFakeModel([{ id: "p1", brandName: "TCL", campaignGoal: null, goalType: null, briefingText: null, fieldStatus: { productName: "confirmed" } }]);
  h.selection = createFakeModel([{ id: "s1", projectId: "p1", platform: null }]);
  h.ai.mockReset();
  h.ai.mockResolvedValue({ campaignGoal: "AI goal", goalType: "conversion", platform: "tiktok" });
});

describe("POST /setup-suggest", () => {
  it("fills the empty fields and marks them suggested", async () => {
    const res = await post();
    const body = await res.json();
    expect(project()).toMatchObject({ campaignGoal: "AI goal", goalType: "conversion" });
    expect(h.selection.rows.get("s1")!.platform).toBe("tiktok");
    expect(project().fieldStatus).toMatchObject({ productName: "confirmed", campaignGoal: "suggested", goalType: "suggested", "campaign.platform": "suggested" });
    expect(body.filled).toEqual(["campaignGoal", "goalType", "campaign.platform"]);
  });

  it("leaves a field the user filled while the model was thinking alone (decided at write time)", async () => {
    h.ai.mockImplementation(async () => {
      h.project.concurrentWrite("p1", { campaignGoal: "typed goal", fieldStatus: { productName: "confirmed", campaignGoal: "confirmed" } });
      h.selection.concurrentWrite("s1", { platform: "meta" });
      return { campaignGoal: "AI goal", goalType: "conversion", platform: "tiktok" };
    });
    const body = await (await post()).json();
    expect(project().campaignGoal).toBe("typed goal");
    expect(project().goalType).toBe("conversion");
    expect(h.selection.rows.get("s1")!.platform).toBe("meta");
    expect(project().fieldStatus).toEqual(expect.objectContaining({ campaignGoal: "confirmed", goalType: "suggested" }));
    expect(project().fieldStatus).not.toHaveProperty("campaign.platform");
    expect(body.filled).toEqual(["goalType"]);
  });

  it("re-decides on a write conflict", async () => {
    h.project.onBeforeWrite = (n) => {
      if (n === 0) h.project.concurrentWrite("p1", { goalType: "storytelling" });
    };
    await post();
    expect(project().goalType).toBe("storytelling");
    expect(project().campaignGoal).toBe("AI goal");
    expect(project().fieldStatus).not.toHaveProperty("goalType");
  });

  it("still stamps __suggestedAt when the AI is unavailable", async () => {
    h.ai.mockRejectedValue(new Error("down"));
    await post();
    expect(project().fieldStatus).toMatchObject({ productName: "confirmed", __suggestedAt: expect.any(String) });
    expect(project().campaignGoal).toBeNull();
  });
});
