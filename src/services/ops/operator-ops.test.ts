import { describe, expect, it } from "vitest";
import { operatorActionSchema } from "@/services/operator";

describe("operator actions: cost, budget, report", () => {
  it("parses estimate-run, set-budget, spend-report and campaign-report", () => {
    for (const body of [
      { action: "estimate-run", projectId: "p", runId: "r" },
      { action: "estimate-run", projectId: "p", storyboardId: "s", videoModel: "Veo 3.1 Lite 720p (OpenRouter)", clipDurationSec: 4 },
      { action: "set-budget", projectId: "p", usd: 8.5 },
      { action: "set-budget", projectId: "p", runId: "r", usd: null },
      { action: "spend-report", projectId: "p", since: "2026-10-01" },
      { action: "campaign-report", projectId: "p", narrative: "template" },
    ]) {
      expect(operatorActionSchema.safeParse(body).success, JSON.stringify(body)).toBe(true);
    }
  });

  it("rejects a negative or absurd budget", () => {
    expect(operatorActionSchema.safeParse({ action: "set-budget", projectId: "p", usd: -1 }).success).toBe(false);
    expect(operatorActionSchema.safeParse({ action: "set-budget", projectId: "p", usd: 1e9 }).success).toBe(false);
    expect(operatorActionSchema.safeParse({ action: "campaign-report", projectId: "p", narrative: "pdf" }).success).toBe(false);
  });
});

describe("operator actions: ops health", () => {
  it("parses ops-health and ops-recover (dry run unless dryRun: false)", () => {
    expect(operatorActionSchema.safeParse({ action: "ops-health" }).success).toBe(true);
    const def = operatorActionSchema.parse({ action: "ops-recover" });
    expect(def).toEqual({ action: "ops-recover", dryRun: true });
    expect(operatorActionSchema.parse({ action: "ops-recover", dryRun: false })).toEqual({ action: "ops-recover", dryRun: false });
    expect(operatorActionSchema.safeParse({ action: "ops-recover", dryRun: "no" }).success).toBe(false);
  });
});
