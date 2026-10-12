import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeModel, type FakeModel } from "@/test-utils/fake-rows";

const h = vi.hoisted(() => ({ researchJob: null as unknown as FakeModel }));
vi.mock("@/lib/db", () => ({
  prisma: {
    get researchJob() {
      return h.researchJob;
    },
  },
}));

import { completeJob, completeStep, recordStepSources, startStep, type JobStep } from "./job-progress";

const steps = () => h.researchJob.rows.get("j1")!.steps as JobStep[];
const step = (name: string) => steps().find((s) => s.name === name)!;

beforeEach(() => {
  h.researchJob = createFakeModel([
    { id: "j1", status: "running", progress: 0, steps: ["Crawl", "Ads", "Social"].map((name) => ({ name, status: "pending", progress: 0 })) },
  ]);
});

describe("research job steps are conflict-safe", () => {
  it("parallel per-owner source records for one step all land", async () => {
    await Promise.all(
      ["meta", "tiktok", "youtube", "reddit"].map((name) => recordStepSources("j1", "Ads", [{ name, status: "ran", count: 2 }]))
    );
    expect(step("Ads").sources?.map((s) => s.name).sort()).toEqual(["meta", "reddit", "tiktok", "youtube"]);
  });

  it("startStep / completeStep / recordStepSources interleaved across steps keep every update", async () => {
    await Promise.all([
      startStep("j1", "Crawl"),
      startStep("j1", "Ads"),
      recordStepSources("j1", "Social", [{ name: "reddit", status: "ran", count: 1 }]),
      completeStep("j1", "Social"),
    ]);
    expect(step("Crawl").status).toBe("running");
    expect(step("Ads").status).toBe("running");
    expect(step("Social")).toMatchObject({ status: "complete", sources: [{ name: "reddit" }] });
  });

  it("re-applies onto the steps another writer stored between read and write", async () => {
    h.researchJob.onBeforeWrite = (n) => {
      if (n === 0) h.researchJob.concurrentWrite("j1", { steps: steps().map((s) => (s.name === "Crawl" ? { ...s, status: "complete" } : s)) });
    };
    await startStep("j1", "Ads");
    expect(step("Crawl").status).toBe("complete");
    expect(step("Ads").status).toBe("running");
  });

  it("completeJob finalizes the CURRENT steps and is a no-op for a missing job", async () => {
    await startStep("j1", "Ads");
    await completeJob("j1");
    expect(steps().every((s) => s.status === "complete")).toBe(true);
    expect(h.researchJob.rows.get("j1")).toMatchObject({ status: "complete", progress: 100 });
    await expect(completeJob("missing")).resolves.toBeUndefined();
  });
});
