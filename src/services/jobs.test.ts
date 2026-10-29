import { describe, expect, it } from "vitest";
import { resumeJobSteps } from "./jobs";

describe("resumeJobSteps", () => {
  it("keeps completed results but retries interrupted and failed steps", () => {
    const items = [
      { key: "first", label: "First" },
      { key: "second", label: "Second" },
      { key: "third", label: "Third" },
    ];
    expect(resumeJobSteps(items, [
      { key: "first", label: "Old label", status: "done", resultId: "script-1" },
      { key: "second", label: "Second", status: "running" },
      { key: "third", label: "Third", status: "failed", error: "timeout" },
    ])).toEqual([
      { key: "first", label: "First", status: "done", resultId: "script-1" },
      { key: "second", label: "Second", status: "queued" },
      { key: "third", label: "Third", status: "queued" },
    ]);
  });

  it("keeps failed items failed for automatic queue redelivery", () => {
    expect(resumeJobSteps([{ key: "a", label: "A" }], [
      { key: "a", label: "A", status: "failed", error: "provider rejected" },
    ], true)).toEqual([{ key: "a", label: "A", status: "failed", error: "provider rejected" }]);
  });
});
