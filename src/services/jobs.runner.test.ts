import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  row: {
    steps: [] as Array<{ key: string; label: string; status: string; resultId?: string }>,
    startedAt: null as Date | null,
    cancelRequested: false,
    status: "queued",
    done: 0,
  },
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    job: {
      findUnique: vi.fn(async () => state.row),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(state.row, data);
        return state.row;
      }),
    },
  },
}));

import { runJobItems } from "./jobs";

const items = [{ key: "a", label: "A" }, { key: "b", label: "B" }];

describe("runJobItems checkpoint recovery", () => {
  beforeEach(() => {
    state.row.steps = [];
    state.row.startedAt = null;
    state.row.status = "queued";
    state.row.done = 0;
  });

  it("does not pay for a completed item again after redelivery", async () => {
    state.row.steps = [
      { key: "a", label: "A", status: "done", resultId: "script-a" },
      { key: "b", label: "B", status: "running" },
    ];
    const worker = vi.fn(async (item: (typeof items)[number]) => ({ id: `script-${item.key}` }));
    const status = await runJobItems("job-1", items, (item) => item, worker);
    expect(status).toBe("completed");
    expect(worker).toHaveBeenCalledTimes(1);
    expect(worker).toHaveBeenCalledWith(items[1], 1);
    expect(state.row.done).toBe(2);
    expect(state.row.steps.map((step) => step.resultId)).toEqual(["script-a", "script-b"]);
  });

  it("leaves unstarted items queued for another delivery", async () => {
    const worker = vi.fn();
    const status = await runJobItems("job-2", items, (item) => item, worker, {
      deadlineMs: -1, requeueOnDeadline: true,
    });
    expect(status).toBe("queued");
    expect(worker).not.toHaveBeenCalled();
    expect(state.row.steps.map((step) => step.status)).toEqual(["queued", "queued"]);
  });

  it("does not re-bill an item that already failed on an earlier delivery", async () => {
    state.row.steps = [
      { key: "a", label: "A", status: "failed" },
      { key: "b", label: "B", status: "queued" },
    ];
    const worker = vi.fn(async () => ({ id: "script-b" }));
    const status = await runJobItems("job-3", items, (item) => item, worker, { requeueOnDeadline: true });
    expect(status).toBe("completed");
    expect(worker).toHaveBeenCalledTimes(1);
    expect(worker).toHaveBeenCalledWith(items[1], 1);
    expect(state.row.done).toBe(1);
    expect(state.row.steps.map((step) => step.status)).toEqual(["failed", "done"]);
  });
});
