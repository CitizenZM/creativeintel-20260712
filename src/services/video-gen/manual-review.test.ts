import { describe, expect, it } from "vitest";
import { manualReviewJobs } from "./manual-review";

describe("manualReviewJobs", () => {
  it("flags uncertain keyframes and drifted clips, but not passed or unfinished outputs", () => {
    const jobs = [
      { id: "uncertain", kind: "image", status: "completed", settings: { qcIssues: ["label"], qcOk: null } },
      { id: "pass", kind: "image", status: "completed", settings: { consistency: {}, qcOk: true } },
      { id: "drift", kind: "video", status: "completed", settings: { driftFlag: true } },
      { id: "pending", kind: "video", status: "running", settings: { driftFlag: true } },
    ];
    expect(manualReviewJobs(jobs).map((job) => job.id)).toEqual(["uncertain", "drift"]);
  });
});
