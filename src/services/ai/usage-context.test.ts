import { describe, expect, it } from "vitest";
import { captureAiUsage, logAiUsage, type AiUsageEntry } from "./usage";
import { currentAiTrace, withAiTrace } from "./usage-context";

describe("AI operation trace", () => {
  it("carries an operation through nested async calls and records usage", async () => {
    const entries: AiUsageEntry[] = [];
    await captureAiUsage(entries, () => withAiTrace({ traceId: "autopilot-1", stage: "plan" }, async () => {
      await Promise.resolve();
      await withAiTrace({ traceId: "autopilot-1", runId: "run-1", stage: "render" }, () =>
        logAiUsage({ provider: "test", model: "model", capability: "video", videoSeconds: 4 })
      );
      expect(currentAiTrace()).toEqual({ traceId: "autopilot-1", stage: "plan" });
    }));
    expect(entries).toEqual([{ provider: "test", model: "model", capability: "video", videoSeconds: 4, traceId: "autopilot-1", runId: "run-1", stage: "render" }]);
    expect(currentAiTrace()).toBeUndefined();
  });
});
