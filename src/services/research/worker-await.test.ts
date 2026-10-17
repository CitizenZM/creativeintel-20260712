import { describe, expect, it } from "vitest";
import { deferWorkerTask, ignoredWorkerPayload, ResearchWaiting, suspendForWorkers, withWorkerDeferral } from "./worker-await";

describe("worker deferral context", () => {
  it("suspends at the phase barrier with deduplicated worker IDs", async () => {
    await expect(withWorkerDeferral(async () => {
      await Promise.resolve();
      expect(deferWorkerTask("a")).toBe(true);
      deferWorkerTask("a"); deferWorkerTask("b");
      suspendForWorkers();
    })).rejects.toEqual(new ResearchWaiting(["a", "b"]));
  });
  it("does not share deferred tasks between simultaneous research jobs", async () => {
    const results = await Promise.allSettled(["one", "two"].map((id) => withWorkerDeferral(async () => {
      deferWorkerTask(id); await Promise.resolve(); suspendForWorkers();
    })));
    expect(results.map((r) => r.status === "rejected" ? r.reason.taskIds : [])).toEqual([["one"], ["two"]]);
    expect(deferWorkerTask("outside")).toBe(false);
  });
  it("carries exhausted payloads only in their research context", async () => {
    await withWorkerDeferral(async () => { expect(ignoredWorkerPayload("bad")).toBe(true); }, ["bad"]);
    expect(ignoredWorkerPayload("bad")).toBe(false);
  });
});
