import { describe, expect, it, vi } from "vitest";

const rows: Record<string, unknown> = {
  "brain:snapshot": { v: 1, at: new Date().toISOString(), queue: [], executing: [], loops: [] },
  "brain:events": [],
  "brain:learnings": [],
};
const findMany = vi.fn(async () => [{ id: "run1", projectId: "p", status: "generating", step: "voice", progress: 55, estUsd: 1, actualUsd: null, hookType: "pain", engine: "auto", updatedAt: new Date() }]);
vi.mock("@/lib/db", () => ({
  prisma: {
    appSetting: { findUnique: vi.fn(async ({ where }: { where: { key: string } }) => (rows[where.key] ? { value: rows[where.key] } : null)) },
    adStudioRun: { findMany },
  },
}));

describe("getView wiring", () => {
  it("overlays the live run state on the published snapshot", async () => {
    const { getView } = await import("./store");
    const v = await getView();
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(v.snapshot?.executing.map((t) => [t.id, t.step])).toEqual([["run1", "voice"]]);
    expect((v.snapshot as unknown as { liveAt?: string }).liveAt).toBeTruthy();
  });
  it("falls back to the snapshot when the live read fails", async () => {
    findMany.mockRejectedValueOnce(new Error("db down"));
    const { getView } = await import("./store");
    const v = await getView();
    expect(v.snapshot?.executing).toEqual([]);
  });
});
