import { describe, expect, it } from "vitest";
import { clipEta } from "./run-eta";
import type { LibtvRunView } from "./types";

const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString();
const job = (status: string, start: number | null, end: number | null, modelName = "model") => ({
  kind: "video", status, modelName,
  startedAt: start === null ? null : at(start),
  completedAt: end === null ? null : at(end),
});
const run = (jobs: ReturnType<typeof job>[], status = "running") => ({ status, videoModel: "model", jobs }) as LibtvRunView;

describe("clipEta", () => {
  it("uses completed same-model clips and discounts elapsed work", () => {
    const result = clipEta(run([
      job("completed", 0, 4), job("completed", 4, 10),
      job("running", 11, null), job("queued", null, null),
    ]), Date.parse(at(13)));
    expect(result).toEqual({ minMinutes: 6, maxMinutes: 14, sampleSize: 2 });
  });

  it("withholds an ETA when evidence is insufficient or the run is done", () => {
    expect(clipEta(run([job("completed", 0, 4), job("queued", null, null)]))).toBeNull();
    expect(clipEta(run([job("completed", 0, 4), job("completed", 4, 10), job("queued", null, null)], "assembling"))).toBeNull();
    expect(clipEta(run([job("completed", 0, 4, "other"), job("completed", 4, 10), job("queued", null, null)]))).toBeNull();
  });
});
