import { describe, expect, it, vi } from "vitest";

const stagesOf = vi.fn();
vi.mock("@/lib/db", () => {
  const empty = async () => [];
  return {
    prisma: {
      adStudioRun: { findMany: empty },
      project: { findMany: async () => [{ id: "p1", name: "P", updatedAt: new Date() }] },
      adPerformance: { groupBy: empty },
      spendEntry: { aggregate: async () => ({ _sum: { estUsd: 0, actualUsd: 0 } }), groupBy: empty },
      workerHeartbeat: { findMany: empty },
      opsEvent: { findMany: empty },
    },
  };
});
vi.mock("@/services/project-stages", () => ({ getProjectStages: (id: string) => stagesOf(id) }));
vi.mock("@/services/ops/health", () => ({ scanHealth: async () => ({ ok: true, counts: {}, issues: [], heartbeats: [] }) }));
vi.mock("./store", () => ({ getLearnings: async () => [], getPolicy: async () => ({}) }));

describe("observe stages", () => {
  it("passes each stage href through so the brain can link setup asks", async () => {
    stagesOf.mockResolvedValue({ stages: [{ id: "setup", state: "partial", action: "Confirm the product", detail: "1/4", href: "/projects/p1/overview", label: "Setup", criteria: [] }], next: { id: "setup" } });
    const { observe } = await import("./observe");
    const out = await observe(new Date("2026-11-18T16:00:00Z"));
    expect(out.stages[0]).toEqual({ projectId: "p1", stages: [{ id: "setup", state: "partial", action: "Confirm the product", detail: "1/4", href: "/projects/p1/overview" }], next: "setup" });
  });
});
