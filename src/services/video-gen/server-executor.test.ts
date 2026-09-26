import { beforeEach, describe, expect, it, vi } from "vitest";

type Job = {
  id: string;
  runId: string;
  nodeName: string;
  kind: string;
  status: string;
  prompt: string;
  sourceUrl: string | null;
  resultUrl: string | null;
  remoteUrl: string | null;
  nodeId: string | null;
  leftRefs: string[] | null;
  settings: Record<string, unknown> | null;
  attempts: number;
  error: string | null;
};
type Run = {
  id: string;
  executor: string;
  status: string;
  aspectRatio: string;
  clipDurationSec: number | null;
  storyboardId: string | null;
  workerId: string | null;
  error: string | null;
  masterMp4Url: string | null;
};

const store = vi.hoisted(() => ({ runs: new Map<string, Run>(), jobs: [] as Job[] }));

const db = vi.hoisted(() => {
  const matches = (value: unknown, cond: unknown) =>
    cond && typeof cond === "object" && "in" in (cond as object) ? (cond as { in: unknown[] }).in.includes(value) : value === cond;
  return {
    libtvRun: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const run = store.runs.get(where.id);
        return run ? { ...run, jobs: store.jobs.filter((j) => j.runId === run.id).map((j) => ({ ...j })) } : null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Run> }) => {
        const run = store.runs.get(where.id)!;
        Object.assign(run, data);
        return run;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; status: unknown }; data: Partial<Run> }) => {
        const run = store.runs.get(where.id);
        if (!run || !matches(run.status, where.status)) return { count: 0 };
        Object.assign(run, data);
        return { count: 1 };
      }),
      findMany: vi.fn(async ({ where }: { where: { executor: string; status: unknown } }) =>
        [...store.runs.values()].filter((r) => r.executor === where.executor && matches(r.status, where.status)).map((r) => ({ id: r.id }))
      ),
    },
    libtvJob: {
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; status: string }; data: { status: string } }) => {
        const job = store.jobs.find((j) => j.id === where.id);
        if (!job || job.status !== where.status) return { count: 0 };
        job.status = data.status;
        job.attempts += 1;
        return { count: 1 };
      }),
      findMany: vi.fn(async ({ where }: { where: { runId: string } }) => store.jobs.filter((j) => j.runId === where.runId).map((j) => ({ ...j }))),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Job> }) => {
        const job = store.jobs.find((j) => j.id === where.id)!;
        Object.assign(job, data);
        return job;
      }),
    },
    storyboard: {
      findUnique: vi.fn(async () => ({ frames: [{ frameNumber: 1 }, { frameNumber: 2 }, { frameNumber: 3 }], frameSeconds: 2 })),
    },
  };
});

vi.mock("@/lib/db", () => ({ prisma: db }));

const queue = vi.hoisted(() => ({
  jobDone: vi.fn(async (input: { jobId: string; resultUrl?: string | null; remoteUrl?: string | null; skipped?: boolean }) => {
    const job = store.jobs.find((j) => j.id === input.jobId)!;
    job.status = input.skipped ? "skipped" : "completed";
    job.resultUrl = input.resultUrl ?? job.resultUrl;
    job.remoteUrl = input.remoteUrl ?? job.remoteUrl;
  }),
  jobFailed: vi.fn(async (jobId: string, error: string) => {
    const job = store.jobs.find((j) => j.id === jobId)!;
    job.status = "failed";
    job.error = error;
  }),
  runDone: vi.fn(async ({ runId, masterMp4Url }: { runId: string; masterMp4Url: string }) => {
    Object.assign(store.runs.get(runId)!, { status: "completed", masterMp4Url });
  }),
  runFailed: vi.fn(async (runId: string, error: string) => {
    Object.assign(store.runs.get(runId)!, { status: "failed", error });
  }),
}));
vi.mock("./libtv-queue", () => queue);

const assemble = vi.hoisted(() => vi.fn(async () => "https://cdn/master.mp4"));
vi.mock("./glm-assemble", () => ({ assembleGlmMaster: assemble }));

import { advanceActiveRuns, driveRun, tickRun, type EngineAdapter, type TaskResult } from "./server-executor";

function job(partial: Partial<Job> & Pick<Job, "id" | "nodeName" | "kind">): Job {
  return {
    runId: "run1",
    status: "queued",
    prompt: `${partial.nodeName} prompt`,
    sourceUrl: null,
    resultUrl: null,
    remoteUrl: null,
    nodeId: null,
    leftRefs: null,
    settings: null,
    attempts: 0,
    error: null,
    ...partial,
  };
}

function seed(executor = "comfyui") {
  store.runs.clear();
  store.runs.set("run1", {
    id: "run1",
    executor,
    status: "approved",
    aspectRatio: "9:16",
    clipDurationSec: 5,
    storyboardId: "sb1",
    workerId: null,
    error: null,
    masterMp4Url: null,
  });
  store.jobs = [
    job({ id: "u1", nodeName: "PROD-1", kind: "upload", sourceUrl: "https://cdn/packshot.png" }),
    job({ id: "k1", nodeName: "K1", kind: "image", leftRefs: ["PROD-1"], settings: { coversFrames: [1, 2] } }),
    job({ id: "k3", nodeName: "K3", kind: "image", leftRefs: ["PROD-1"], settings: { compositeLocally: true, frameNumber: 3 } }),
    job({ id: "v1", nodeName: "V1", kind: "video", leftRefs: ["FF K1"], settings: { coversFrames: [1, 2], duration: 4 } }),
  ];
}

function fakeAdapter(overrides: Partial<EngineAdapter> = {}) {
  const videoTasks = new Map<string, TaskResult>();
  const adapter: EngineAdapter & { videoTasks: Map<string, TaskResult> } = {
    engine: "comfyui",
    workerId: "test-server",
    maxVideosInFlight: 2,
    imagesPerTick: 3,
    notConfiguredError: "TEST_URL is not configured",
    isConfigured: () => true,
    generateImage: vi.fn(async (_prompt: string, ctx) => ({ url: `https://cdn/${ctx.nodeName}.png` })),
    submitVideo: vi.fn(async (_input, ctx) => {
      videoTasks.set(`task-${ctx.nodeName}`, { status: "PROCESSING" });
      return `task-${ctx.nodeName}`;
    }),
    pollVideo: vi.fn(async (taskId: string): Promise<TaskResult> => videoTasks.get(taskId) ?? { status: "PROCESSING" }),
    videoTasks,
    ...overrides,
  };
  return adapter;
}

const statusOf = (id: string) => store.jobs.find((j) => j.id === id)!.status;

beforeEach(() => {
  vi.clearAllMocks();
  seed();
});

describe("tickRun", () => {
  it("ignores runs owned by another engine", async () => {
    seed("glm");
    const adapter = fakeAdapter();
    expect(await tickRun(adapter, "run1")).toBe("idle");
    expect(adapter.generateImage).not.toHaveBeenCalled();
  });

  it("fails the run when the engine is not configured", async () => {
    const adapter = fakeAdapter({ isConfigured: () => false });
    expect(await tickRun(adapter, "run1")).toBe("failed");
    expect(store.runs.get("run1")!.error).toBe("TEST_URL is not configured");
  });

  it("walks uploads → keyframes → clips → assembly across ticks", async () => {
    const adapter = fakeAdapter();

    expect(await tickRun(adapter, "run1")).toBe("running");
    const run = store.runs.get("run1")!;
    expect(run.status).toBe("running");
    expect(run.workerId).toBe("test-server");
    expect(statusOf("u1")).toBe("completed");
    expect(store.jobs.find((j) => j.id === "u1")!.resultUrl).toBe("https://cdn/packshot.png");
    // CTA keyframe holds on the packshot without a generation.
    expect(statusOf("k3")).toBe("skipped");
    expect(store.jobs.find((j) => j.id === "k3")!.resultUrl).toBe("https://cdn/packshot.png");
    expect(adapter.generateImage).toHaveBeenCalledTimes(1);
    expect(adapter.generateImage).toHaveBeenCalledWith("K1 prompt", expect.objectContaining({ runId: "run1", nodeName: "K1", aspectRatio: "9:16" }));
    // The clip starts off its finished keyframe in the same tick, using the job's own duration.
    expect(adapter.submitVideo).toHaveBeenCalledWith(
      { prompt: "V1 prompt", imageUrl: "https://cdn/K1.png" },
      expect.objectContaining({ nodeName: "V1", durationSec: 4 })
    );
    expect(store.jobs.find((j) => j.id === "v1")!.nodeId).toBe("task-V1");
    expect(statusOf("v1")).toBe("running");

    expect(await tickRun(adapter, "run1")).toBe("running");
    expect(assemble).not.toHaveBeenCalled();

    adapter.videoTasks.set("task-V1", { status: "SUCCESS", url: "https://cdn/V1.mp4", remoteUrl: "https://remote/V1.mp4" });
    expect(await tickRun(adapter, "run1")).toBe("done");
    const v1 = store.jobs.find((j) => j.id === "v1")!;
    expect([v1.status, v1.resultUrl, v1.remoteUrl]).toEqual(["completed", "https://cdn/V1.mp4", "https://remote/V1.mp4"]);
    expect(assemble).toHaveBeenCalledWith(expect.objectContaining({ runId: "run1", aspectRatio: "9:16", frames: expect.any(Array) }));
    expect(queue.runDone).toHaveBeenCalledWith({ runId: "run1", masterMp4Url: "https://cdn/master.mp4", creditsSpent: 0 });
    expect(run.status).toBe("completed");
  });

  it("holds a clip until its keyframe is done, and caps clips in flight", async () => {
    store.jobs.push(
      job({ id: "k5", nodeName: "K5", kind: "image" }),
      job({ id: "k7", nodeName: "K7", kind: "image" }),
      job({ id: "v5", nodeName: "V5", kind: "video", leftRefs: ["FF K5"] }),
      job({ id: "v7", nodeName: "V7", kind: "video", leftRefs: ["FF K7"] })
    );
    const adapter = fakeAdapter({ maxVideosInFlight: 2, imagesPerTick: 10 });
    await tickRun(adapter, "run1");
    expect(adapter.submitVideo).toHaveBeenCalledTimes(2);
    expect(["v1", "v5", "v7"].map(statusOf).filter((s) => s === "running")).toHaveLength(2);
  });

  it("supports engines whose keyframes finish asynchronously", async () => {
    let imageDone = false;
    const adapter = fakeAdapter({
      generateImage: vi.fn(async () => ({ taskId: "img-K1" })),
      pollImage: vi.fn(async (taskId: string): Promise<TaskResult> =>
        imageDone ? { status: "SUCCESS", url: `https://cdn/${taskId}.png` } : { status: "PROCESSING" }
      ),
    });
    await tickRun(adapter, "run1");
    const k1 = () => store.jobs.find((j) => j.id === "k1")!;
    expect([k1().status, k1().nodeId]).toEqual(["running", "img-K1"]);
    expect(adapter.submitVideo).not.toHaveBeenCalled();

    imageDone = true;
    await tickRun(adapter, "run1");
    expect([k1().status, k1().resultUrl]).toEqual(["completed", "https://cdn/img-K1.png"]);
    expect(adapter.submitVideo).toHaveBeenCalledWith({ prompt: "V1 prompt", imageUrl: "https://cdn/img-K1.png" }, expect.anything());
  });

  it("fails the run when a clip fails", async () => {
    const adapter = fakeAdapter();
    await tickRun(adapter, "run1");
    adapter.videoTasks.set("task-V1", { status: "FAIL", error: "out of VRAM" });
    expect(await tickRun(adapter, "run1")).toBe("failed");
    expect(store.runs.get("run1")!.error).toMatch(/V1 — out of VRAM/);
    expect(assemble).not.toHaveBeenCalled();
  });

  it("records a keyframe error on the job", async () => {
    const adapter = fakeAdapter({ generateImage: vi.fn(async () => Promise.reject(new Error("checkpoint missing"))) });
    expect(await tickRun(adapter, "run1")).toBe("failed");
    expect(store.jobs.find((j) => j.id === "k1")!.error).toBe("checkpoint missing");
  });

  it("keeps going when a poll throws", async () => {
    const adapter = fakeAdapter();
    await tickRun(adapter, "run1");
    (adapter.pollVideo as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("socket hang up"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await tickRun(adapter, "run1")).toBe("running");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("does nothing for a run that is not active", async () => {
    store.runs.get("run1")!.status = "awaiting_approval";
    expect(await tickRun(fakeAdapter(), "run1")).toBe("idle");
  });
});

describe("driveRun / advanceActiveRuns", () => {
  it("ticks until the run settles", async () => {
    const adapter = fakeAdapter();
    let polls = 0;
    adapter.pollVideo = vi.fn(async (): Promise<TaskResult> => (++polls >= 2 ? { status: "SUCCESS", url: "https://cdn/V1.mp4" } : { status: "PROCESSING" }));
    expect(await driveRun(adapter, "run1", 10_000, 0)).toBe("done");
  });

  it("only advances runs of its own engine", async () => {
    store.runs.set("other", { ...store.runs.get("run1")!, id: "other", executor: "glm" });
    const adapter = fakeAdapter();
    adapter.pollVideo = vi.fn(async (): Promise<TaskResult> => ({ status: "SUCCESS", url: "https://cdn/V1.mp4" }));
    expect(await advanceActiveRuns(adapter, 5_000, 0)).toBe(1);
    expect(db.libtvRun.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ executor: "comfyui" }) }));
  });
});
