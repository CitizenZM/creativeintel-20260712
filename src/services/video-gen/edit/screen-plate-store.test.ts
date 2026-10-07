import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Job = { id: string; runId: string; resultUrl: string | null; settings: Record<string, unknown> | null; updatedAt: Date };
const store = vi.hoisted(() => ({ jobs: [] as Job[], clock: 1 }));
vi.mock("@/lib/db", () => ({
  prisma: {
    libtvJob: {
      findFirst: vi.fn(async ({ where }: { where: { runId: string; resultUrl: string } }) => {
        const j = store.jobs.find((x) => x.runId === where.runId && x.resultUrl === where.resultUrl);
        return j ? { ...j, settings: j.settings ? JSON.parse(JSON.stringify(j.settings)) : null } : null;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; updatedAt?: Date }; data: { settings: Record<string, unknown> } }) => {
        const j = store.jobs.find((x) => x.id === where.id);
        if (!j || (where.updatedAt && where.updatedAt.getTime() !== j.updatedAt.getTime())) return { count: 0 };
        j.settings = JSON.parse(JSON.stringify(data.settings));
        j.updatedAt = new Date(++store.clock);
        return { count: 1 };
      }),
    },
  },
}));
const claude = vi.hoisted(() => ({ analyzeWithClaude: vi.fn(async () => ({ found: false })) }));
vi.mock("@/services/ai/claude-client", () => claude);

import { detectedTrack, guardedScreenVision, jobTrackCache } from "./screen-plate-store";
import { MemorySpendLedger, setSpendLedger } from "@/services/ops/budget-guard";
import type { TrackKey } from "./screen-plate";

const TRACK: TrackKey[] = [{ t: 0, quad: [[0.1, 0.1], [0.9, 0.1], [0.9, 0.5], [0.1, 0.5]] }];

beforeEach(() => {
  vi.clearAllMocks();
  store.jobs = [{ id: "v1", runId: "r1", resultUrl: "https://cdn/V1.mp4", settings: { duration: 4 }, updatedAt: new Date(store.clock) }];
});
afterEach(() => setSpendLedger(null));

describe("screen plate track cache (re-edits don't re-detect)", () => {
  it("detects once, stores the track on the clip's job, and reuses it", async () => {
    const cache = jobTrackCache("r1");
    const detect = vi.fn(async () => TRACK);
    expect(await detectedTrack(detect, cache.bind("https://cdn/V1.mp4", { detect: "vision" }))).toEqual(TRACK);
    expect(store.jobs[0].settings).toMatchObject({ duration: 4, screenPlateTracks: { "vision|": TRACK } });
    // A later re-edit (variant, locale, export) of the same run.
    const again = vi.fn(async () => TRACK);
    expect(await detectedTrack(again, jobTrackCache("r1").bind("https://cdn/V1.mp4", { detect: "vision" }))).toEqual(TRACK);
    expect(again).not.toHaveBeenCalled();
  });

  it("does not cache a failed detection, and works without a cache or a job", async () => {
    const empty = vi.fn(async () => [] as TrackKey[]);
    await detectedTrack(empty, jobTrackCache("r1").bind("https://cdn/V1.mp4", { detect: "vision" }));
    expect(store.jobs[0].settings).not.toHaveProperty("screenPlateTracks");
    expect(await detectedTrack(async () => TRACK)).toEqual(TRACK);
    expect(await detectedTrack(async () => TRACK, jobTrackCache("r1").bind("https://cdn/other.mp4", { detect: "vision" }))).toEqual(TRACK);
  });
});

describe("guardedScreenVision", () => {
  it("refuses the vision call over budget without calling the model", async () => {
    const ledger = new MemorySpendLedger();
    setSpendLedger(ledger);
    await ledger.setBudget({ projectId: "p1", runId: "r1" }, 0);
    await expect(guardedScreenVision({ projectId: "p1", runId: "r1" })("data:image/jpeg;base64,AA", "sys")).rejects.toThrow(/Budget exceeded/);
    expect(claude.analyzeWithClaude).not.toHaveBeenCalled();
  });

  it("records the call in the run's ledger", async () => {
    const ledger = new MemorySpendLedger();
    setSpendLedger(ledger);
    await guardedScreenVision({ projectId: "p1", runId: "r1" })("data:image/jpeg;base64,AA", "sys");
    expect(claude.analyzeWithClaude).toHaveBeenCalledTimes(1);
    expect(await ledger.entries({ projectId: "p1" })).toEqual([expect.objectContaining({ runId: "r1", kind: "vision_qc" })]);
  });
});
