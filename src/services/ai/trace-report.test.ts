import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ prisma: { aiUsage: { findMany: vi.fn() } } }));
import { summarizeAiTrace, summarizeRunJobs } from "./trace-report";

describe("AI trace report", () => {
  it("orders calls and keeps unknown prices separate from known spend", () => {
    const report = summarizeAiTrace([
      { provider: "bach", model: "video", capability: "video", stage: "render", runId: "r1", latencyMs: 2000, inputTokens: 0, outputTokens: 0, costUsd: null, createdAt: new Date("2026-10-17T01:00:02Z") },
      { provider: "glm", model: "text", capability: "text", stage: "plan", runId: null, latencyMs: 1000, inputTokens: 100, outputTokens: 40, costUsd: 0, createdAt: new Date("2026-10-17T01:00:00Z") },
    ]);
    expect(report.timeline.map((row) => row.stage)).toEqual(["plan", "render"]);
    expect(report.stages.render).toMatchObject({ calls: 1, knownCostUsd: 0, unpricedCalls: 1, modelLatencyMs: 2000 });
    expect(report.stages.plan).toMatchObject({ inputTokens: 100, outputTokens: 40, knownCostUsd: 0, unpricedCalls: 0 });
  });

  it("shows queue delay and execution time separately", () => {
    expect(summarizeRunJobs([{
      nodeName: "V1", kind: "video", status: "completed", createdAt: new Date("2026-10-17T01:00:00Z"),
      startedAt: new Date("2026-10-17T01:00:05Z"), completedAt: new Date("2026-10-17T01:01:05Z"),
    }])[0]).toMatchObject({ queueMs: 5000, executionMs: 60000 });
  });
});
