import { beforeEach, describe, expect, it, vi } from "vitest";

type Run = { id: string; projectId: string; status: string; executor: string; qcReport: Record<string, unknown>; updatedAt: Date };
const store = vi.hoisted(() => ({ runs: new Map<string, Run>(), clock: 1 }));

vi.mock("@/lib/db", () => ({
  prisma: {
    libtvRun: {
      findMany: vi.fn(async () => [...store.runs.values()].map((r) => ({ id: r.id, projectId: r.projectId, qcReport: JSON.parse(JSON.stringify(r.qcReport)) }))),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const r = store.runs.get(where.id);
        return r ? { ...r, qcReport: JSON.parse(JSON.stringify(r.qcReport)) } : null;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; updatedAt?: Date }; data: { qcReport: Record<string, unknown> } }) => {
        const r = store.runs.get(where.id);
        if (!r || (where.updatedAt && where.updatedAt.getTime() !== r.updatedAt.getTime())) return { count: 0 };
        r.qcReport = JSON.parse(JSON.stringify(data.qcReport));
        r.updatedAt = new Date(++store.clock);
        return { count: 1 };
      }),
    },
  },
}));
const director = vi.hoisted(() => ({ reviewAndStore: vi.fn() }));
vi.mock("./director", () => director);
vi.mock("./glm-assemble", () => ({ renderHookVariant: vi.fn() }));
vi.mock("./server-executor", () => ({ storyboardFrames: vi.fn() }));
vi.mock("@/services/performance/store", () => ({ loadLearning: vi.fn(async () => null) }));

import { advanceAutoVariants } from "./variants";
import { BudgetExceededError } from "@/services/ops/budget-guard";

beforeEach(() => {
  vi.clearAllMocks();
  store.runs.clear();
  for (const id of ["r1", "r2"]) store.runs.set(id, { id, projectId: "p1", status: "completed", executor: "openrouter", qcReport: { engine: "edit-v2" }, updatedAt: new Date(store.clock) });
});

describe("advanceAutoVariants: the director review", () => {
  it("records a refused review as skipped and moves on to the next run instead of wedging", async () => {
    const refusal = new BudgetExceededError({ projectId: "p1", runId: "r1", kind: "vision_qc", model: "m" }, 0.01, { level: "run", limitUsd: 0, spentUsd: 0 });
    director.reviewAndStore.mockRejectedValueOnce(refusal).mockResolvedValueOnce({ shots: [] });
    const out = await advanceAutoVariants();
    expect(store.runs.get("r1")!.qcReport.director).toEqual({ skipped: true, reason: expect.stringMatching(/Budget exceeded/), at: expect.any(String) });
    expect(director.reviewAndStore).toHaveBeenCalledWith("r2");
    expect(out).toEqual({ runId: "r2", style: "director" });

    // Next cron call: r1 is past the director step (no second paid attempt) and gets its variant.
    director.reviewAndStore.mockClear();
    await advanceAutoVariants().catch(() => null);
    expect(director.reviewAndStore).not.toHaveBeenCalledWith("r1");
  });
});
