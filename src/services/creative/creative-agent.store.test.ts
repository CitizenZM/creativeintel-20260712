import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeModel, type FakeModel } from "@/test-utils/fake-rows";

const h = vi.hoisted(() => ({ project: null as unknown as FakeModel, storyboard: null as unknown as FakeModel }));
vi.mock("@/lib/db", () => {
  const prisma = {
    get project() {
      return h.project;
    },
    get storyboard() {
      return h.storyboard;
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      // all-or-nothing: restore both tables if the callback throws
      const snap = [h.project, h.storyboard].map((m) => new Map([...m.rows].map(([k, v]) => [k, { ...v }])));
      try {
        return await fn(prisma);
      } catch (e) {
        h.project.rows = snap[0];
        h.storyboard.rows = snap[1];
        throw e;
      }
    },
  };
  return { prisma };
});
vi.mock("@/services/artifacts/archive", () => ({
  archiveProjectFields: vi.fn(),
  archiveStoryboard: vi.fn(),
  archiveAround: async (_l: string, _a: unknown, write: () => Promise<unknown>) => write(),
}));
const agent = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("./creative-agent", async (orig) => ({ ...(await orig<typeof import("./creative-agent")>()), runCreativeAgent: agent.run }));

import { creativeAgentTurn } from "./creative-agent.store";

const plan = { platforms: [{ platform: "tiktok" }], goal: "cold" };
const frames = [{ frameNumber: 1, scene: "a" }];

beforeEach(() => {
  h.project = createFakeModel([{ id: "p1", campaignPlan: plan, productBrief: null, creativeEditHistory: [] }]);
  h.storyboard = createFakeModel([{ id: "sb1", projectId: "p1", deletedAt: null, frames, frameHistory: null }]);
  agent.run.mockReset();
  agent.run.mockResolvedValue({
    reply: "ok",
    applied: [{ summary: "changed scene" }],
    rejected: [],
    planChanged: true,
    plan: { ...plan, goal: "warm" },
    framesChanged: true,
    frames: [{ frameNumber: 1, scene: "b" }],
    changedFrames: [1],
  });
});

describe("creativeAgentTurn writes", () => {
  it("stores the new plan and frames when nothing moved during the model call", async () => {
    const res = await creativeAgentTurn("p1", "make it warmer", "sb1", { llm: vi.fn() });
    expect(res.status).toBe(200);
    expect((h.project.rows.get("p1")!.campaignPlan as { goal: string }).goal).toBe("warm");
    expect((h.storyboard.rows.get("sb1")!.frames as Array<{ scene: string }>)[0].scene).toBe("b");
  });

  it("answers 409 and writes NOTHING when the plan changed while the assistant was working", async () => {
    agent.run.mockImplementationOnce(async () => {
      h.project.concurrentWrite("p1", { campaignPlan: { ...plan, goal: "edited by hand" } });
      return { reply: "ok", applied: [{ summary: "x" }], rejected: [], planChanged: true, plan: { ...plan, goal: "warm" }, framesChanged: true, frames: [{ frameNumber: 1, scene: "b" }], changedFrames: [1] };
    });
    const res = await creativeAgentTurn("p1", "make it warmer", "sb1", { llm: vi.fn() });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/plan changed while the assistant was working/);
    expect((h.project.rows.get("p1")!.campaignPlan as { goal: string }).goal).toBe("edited by hand");
    expect((h.storyboard.rows.get("sb1")!.frames as Array<{ scene: string }>)[0].scene).toBe("a");
  });

  it("rolls back the plan write when only the storyboard moved", async () => {
    agent.run.mockImplementationOnce(async () => {
      h.storyboard.concurrentWrite("sb1", { frames: [{ frameNumber: 1, scene: "a", imageUrl: "https://img/1.png" }] });
      return { reply: "ok", applied: [{ summary: "x" }], rejected: [], planChanged: true, plan: { ...plan, goal: "warm" }, framesChanged: true, frames: [{ frameNumber: 1, scene: "b" }], changedFrames: [1] };
    });
    const res = await creativeAgentTurn("p1", "m", "sb1", { llm: vi.fn() });
    expect(res.status).toBe(409);
    expect((h.project.rows.get("p1")!.campaignPlan as { goal: string }).goal).toBe("cold");
    expect((h.storyboard.rows.get("sb1")!.frames as Array<{ imageUrl?: string }>)[0].imageUrl).toBe("https://img/1.png");
  });
});
