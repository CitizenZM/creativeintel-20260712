import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
        [...store.runs.values()]
          .filter((r) => r.executor === where.executor && matches(r.status, where.status))
          .map((r) => ({ id: r.id, status: r.status, jobs: store.jobs.filter((j) => j.runId === r.id).map((j) => ({ status: j.status })) }))
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

const assemble = vi.hoisted(() =>
  vi.fn(async () => ({ masterUrl: "https://cdn/master.mp4", voiceoverUrl: "https://cdn/vo.mp3", subtitlesUrl: "https://cdn/subs.srt" }))
);
vi.mock("./glm-assemble", () => ({ assembleGlmMaster: assemble }));

const consistency = vi.hoisted(() => ({ scoreFrame: vi.fn() }));
vi.mock("./consistency/score", async (orig) => ({ ...(await orig<typeof import("./consistency/score")>()), scoreFrame: consistency.scoreFrame }));
// The yes/no reviewer never reaches a model in tests.
const review = vi.hoisted(() => ({ reviewKeyframe: vi.fn(async () => null) }));
vi.mock("./keyframe-qc", async (orig) => ({ ...(await orig<typeof import("./keyframe-qc")>()), reviewKeyframe: review.reviewKeyframe }));

import { advanceActiveRuns, driveRun, NO_TEXT_IMAGE, NO_TEXT_VIDEO, tickRun, type EngineAdapter, type TaskResult } from "./server-executor";

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
    expect(adapter.generateImage).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^${NO_TEXT_IMAGE} K1 prompt`)), expect.objectContaining({ runId: "run1", nodeName: "K1", aspectRatio: "9:16" }));
    // The clip starts off its finished keyframe in the same tick, using the job's own duration.
    expect(adapter.submitVideo).toHaveBeenCalledWith(
      { prompt: expect.stringMatching(new RegExp(`^${NO_TEXT_VIDEO} Steady, slow camera movement.* V1 prompt`)), imageUrl: "https://cdn/K1.png" },
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
    expect(queue.runDone).toHaveBeenCalledWith({
      runId: "run1",
      masterMp4Url: "https://cdn/master.mp4",
      voiceoverUrl: "https://cdn/vo.mp3",
      subtitlesUrl: "https://cdn/subs.srt",
      previewMp4Url: null,
      contactSheetUrl: null,
      qcReport: null,
      creditsSpent: 0,
    });
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
    expect(adapter.submitVideo).toHaveBeenCalledWith({ prompt: expect.stringContaining("V1 prompt"), imageUrl: "https://cdn/img-K1.png" }, expect.anything());
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
    expect(await driveRun(adapter, "run1", 10_000, 0, 0)).toBe("done");
  });

  it("only advances runs of its own engine", async () => {
    store.runs.set("other", { ...store.runs.get("run1")!, id: "other", executor: "glm" });
    const adapter = fakeAdapter();
    adapter.pollVideo = vi.fn(async (): Promise<TaskResult> => ({ status: "SUCCESS", url: "https://cdn/V1.mp4" }));
    expect(await advanceActiveRuns(adapter, 5_000, 0, 0)).toBe(1);
    expect(db.libtvRun.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ executor: "comfyui" }) }));
  });
});

describe("assembly timing", () => {
  function allDone() {
    for (const j of store.jobs) {
      j.status = j.id === "k3" ? "skipped" : "completed";
      j.resultUrl = `https://cdn/${j.nodeName}.png`;
    }
  }

  it("leaves assembly to a fresh invocation when too little budget is left", async () => {
    seed();
    allDone();
    Object.assign(store.runs.get("run1")!, { status: "running" });
    expect(await tickRun(fakeAdapter(), "run1", { remainingMs: 30_000 })).toBe("running");
    expect(store.runs.get("run1")!.status).toBe("running");
    expect(assemble).not.toHaveBeenCalled();
    expect(await tickRun(fakeAdapter(), "run1", { remainingMs: 250_000 })).toBe("done");
    expect(store.runs.get("run1")!.masterMp4Url).toBe("https://cdn/master.mp4");
  });

  it("re-assembles a run that was killed mid-assembly", async () => {
    seed();
    allDone();
    Object.assign(store.runs.get("run1")!, { status: "assembling", updatedAt: new Date(Date.now() - 10 * 60_000) });
    expect(await tickRun(fakeAdapter(), "run1")).toBe("done");
    expect(store.runs.get("run1")!.status).toBe("completed");
  });

  it("re-queues a clip whose submission was cut off before it got a task id", async () => {
    seed();
    const k1 = store.jobs.find((j) => j.id === "k1")!;
    Object.assign(k1, { status: "completed", resultUrl: "https://cdn/K1.png" });
    Object.assign(store.jobs.find((j) => j.id === "k3")!, { status: "skipped", resultUrl: "https://cdn/packshot.png" });
    Object.assign(store.jobs.find((j) => j.id === "u1")!, { status: "completed", resultUrl: "https://cdn/packshot.png" });
    Object.assign(store.jobs.find((j) => j.id === "v1")!, { status: "running", nodeId: null, attempts: 1, startedAt: new Date(Date.now() - 10 * 60_000) });
    Object.assign(store.runs.get("run1")!, { status: "running" });
    const adapter = fakeAdapter();
    await tickRun(adapter, "run1");
    await tickRun(adapter, "run1");
    expect(adapter.submitVideo).toHaveBeenCalled();
    expect(store.jobs.find((j) => j.id === "v1")!.nodeId).toBe("task-V1");
  });

  it("does not touch an assembly that is still in progress", async () => {
    seed();
    allDone();
    Object.assign(store.runs.get("run1")!, { status: "assembling", updatedAt: new Date() });
    expect(await tickRun(fakeAdapter(), "run1")).toBe("idle");
    expect(assemble).not.toHaveBeenCalled();
  });
});

describe("no-text prompts", () => {
  it("tells every generated keyframe and clip to carry no text, first", async () => {
    const { withNoText } = await import("./server-executor");
    expect(withNoText("a green duffle bag", "image")).toBe(`${NO_TEXT_IMAGE} a green duffle bag`);
    expect(withNoText("slow push-in", "video").startsWith(NO_TEXT_VIDEO)).toBe(true);
    expect(withNoText(withNoText("x", "image"), "image")).toBe(`${NO_TEXT_IMAGE} x`);

    seed();
    const adapter = fakeAdapter();
    await tickRun(adapter, "run1");
    await tickRun(adapter, "run1");
    expect((adapter.generateImage as ReturnType<typeof vi.fn>).mock.calls[0][0].startsWith(`${NO_TEXT_IMAGE} K1 prompt`)).toBe(true);
    expect((adapter.submitVideo as ReturnType<typeof vi.fn>).mock.calls[0][0].prompt.startsWith(NO_TEXT_VIDEO)).toBe(true);
  });
});

describe("face-safe clips", () => {
  it("holds a clip with people on its keyframe instead of sending it to the video model", async () => {
    const animateStill = vi.fn(async () => "https://cdn/still-V1.mp4");
    vi.doMock("./animatic-executor", () => ({ animateStill }));
    seed();
    store.jobs.find((j) => j.id === "k1")!.prompt = "A frustrated founder sweeps receipts off his desk";
    const adapter = fakeAdapter();
    await tickRun(adapter, "run1");
    await tickRun(adapter, "run1");
    expect(adapter.submitVideo).not.toHaveBeenCalled();
    expect(animateStill).toHaveBeenCalledWith("https://cdn/K1.png", expect.objectContaining({ nodeName: "V1" }));
    expect(store.jobs.find((j) => j.id === "v1")!.resultUrl).toBe("https://cdn/still-V1.mp4");
    vi.doUnmock("./animatic-executor");
  });
});

describe("consistency gate (keyframes edited from references)", () => {
  const verdict = (score: number, pass: boolean, defects: string[] = []) => ({
    score, pass, reviewed: true, shotType: "product-closeup", product: null, cast: [], defects, reasons: pass ? [] : [`score ${score} < 0.78`], majorDefects: pass ? 0 : 1, sceneConsistent: null,
  });
  const settingsOf = (id: string) => store.jobs.find((j) => j.id === id)!.settings as Record<string, unknown>;

  function seedGated() {
    seed();
    const k1 = store.jobs.find((j) => j.id === "k1")!;
    k1.settings = { coversFrames: [1, 2], editFrom: "product", directedKeyframe: "Close-up of the tablet on a walnut desk", productSpec: "6.6 mm thick" };
  }
  function countingAdapter() {
    let n = 0;
    return fakeAdapter({ generateImage: vi.fn(async (_p: string, ctx) => ({ url: `https://cdn/${ctx.nodeName}-${n++}.png` })) });
  }

  beforeEach(() => {
    process.env.KEYFRAME_QC = "on";
    consistency.scoreFrame.mockReset();
  });
  afterEach(() => {
    delete process.env.KEYFRAME_QC;
  });

  it("re-queues a failing keyframe with its defects as corrections, then records the passing score", async () => {
    seedGated();
    consistency.scoreFrame.mockResolvedValueOnce(verdict(0.42, false, ["bezel thicker: 9.4% vs 1.9% of the short side"])).mockResolvedValueOnce(verdict(0.91, true));
    const adapter = countingAdapter();

    await tickRun(adapter, "run1");
    expect(consistency.scoreFrame).toHaveBeenCalledWith(
      "https://cdn/K1-0.png",
      { cast: [], product: [{ image: "https://cdn/packshot.png" }], start: undefined },
      expect.objectContaining({ shot: "Close-up of the tablet on a walnut desk", kind: "start", productSpec: "6.6 mm thick" })
    );
    expect(statusOf("k1")).toBe("queued");
    expect(settingsOf("k1")).toMatchObject({ qcAttempts: 1, qcRejectedUrl: "https://cdn/K1-0.png", qcCorrections: [expect.stringMatching(/bezel must be thin/)] });
    expect(adapter.submitVideo).not.toHaveBeenCalled();

    await tickRun(adapter, "run1");
    const prompt = (adapter.generateImage as ReturnType<typeof vi.fn>).mock.calls[1][0] as string;
    expect(prompt).toMatch(/CORRECTIONS .* bezel must be thin and uniform/);
    expect((adapter.generateImage as ReturnType<typeof vi.fn>).mock.calls[1][1].settings.qcCorrections).toHaveLength(1);
    expect(statusOf("k1")).toBe("completed");
    expect(store.jobs.find((j) => j.id === "k1")!.resultUrl).toBe("https://cdn/K1-1.png");
    expect(settingsOf("k1").qcCorrections).toBeUndefined();
    expect(settingsOf("k1").consistency).toMatchObject({ score: 0.91, pass: true, attempts: 2, bestOf: false, chosenUrl: "https://cdn/K1-1.png" });
    // The clip starts off the corrected keyframe.
    expect(adapter.submitVideo).toHaveBeenCalledWith(expect.objectContaining({ imageUrl: "https://cdn/K1-1.png" }), expect.anything());
  });

  it("keeps the best-scoring attempt after two re-rolls", async () => {
    seedGated();
    consistency.scoreFrame
      .mockResolvedValueOnce(verdict(0.4, false, ["bezel thicker"]))
      .mockResolvedValueOnce(verdict(0.62, false, ["aspect ratio wrong"]))
      .mockResolvedValueOnce(verdict(0.5, false, ["bezel thicker"]));
    const adapter = countingAdapter();
    for (let i = 0; i < 3; i++) await tickRun(adapter, "run1");
    expect(adapter.generateImage).toHaveBeenCalledTimes(3);
    expect(statusOf("k1")).toBe("completed");
    expect(store.jobs.find((j) => j.id === "k1")!.resultUrl).toBe("https://cdn/K1-1.png");
    expect(settingsOf("k1").consistency).toMatchObject({ score: 0.62, pass: false, bestOf: true, attempts: 3, tries: [{ score: 0.4 }, { score: 0.62 }, { score: 0.5 }] });
  });

  it("leaves keyframes without references on the yes/no review", async () => {
    seed(); // K1 has leftRefs but no editFrom
    await tickRun(fakeAdapter(), "run1");
    expect(consistency.scoreFrame).not.toHaveBeenCalled();
    expect(review.reviewKeyframe).toHaveBeenCalledWith("https://cdn/K1.png", "K1 prompt", undefined);
    expect(statusOf("k1")).toBe("completed");
  });
});

describe("clip drift results", () => {
  it("records the drift report, and re-generates once with a new seed when the clip asks for it", async () => {
    seed();
    const v1 = store.jobs.find((j) => j.id === "v1")!;
    v1.settings = { ...v1.settings, seed: 1000, autoRegenOnDrift: 1 };
    const drift = { driftFlag: true, reasons: ["mid-clip score 0.41 < 0.7"] };
    const adapter = fakeAdapter();
    await tickRun(adapter, "run1");
    adapter.videoTasks.set("task-V1", { status: "SUCCESS", url: "https://cdn/V1-a.mp4", creditsSpent: 20, settingsPatch: { drift, driftFlag: true }, regenerate: true });
    await tickRun(adapter, "run1");
    expect(statusOf("v1")).toBe("queued");
    expect(store.jobs.find((j) => j.id === "v1")!.settings).toMatchObject({ driftRegens: 1, driftRejectedUrl: "https://cdn/V1-a.mp4", priorCreditsSpent: 20, driftFlag: true });
    await tickRun(adapter, "run1"); // the re-queued clip is submitted on the next tick
    const submits = (adapter.submitVideo as ReturnType<typeof vi.fn>).mock.calls;
    expect(submits).toHaveLength(2);
    expect(submits[0][0].seed).toBe(1000);
    expect(submits[1][0].seed).toBe(1101);

    adapter.videoTasks.set("task-V1", { status: "SUCCESS", url: "https://cdn/V1-b.mp4", creditsSpent: 20, settingsPatch: { drift: { driftFlag: false, reasons: [] }, driftFlag: false } });
    expect(await tickRun(adapter, "run1")).toBe("done");
    expect(store.jobs.find((j) => j.id === "v1")!.settings).toMatchObject({ driftFlag: false, driftRegens: 1 });
    expect(queue.jobDone).toHaveBeenCalledWith(expect.objectContaining({ jobId: "v1", resultUrl: "https://cdn/V1-b.mp4", creditsSpent: 40 }));
  });
});

describe("spend guard at the paid call sites", () => {
  const SEEDREAM = { openrouterModel: "bytedance-seed/seedream-5-0-flash" };
  async function paidRun(budgetUsd: number, k1Settings: Record<string, unknown> = {}) {
    const { MemorySpendLedger, setSpendLedger } = await import("@/services/ops/budget-guard");
    const ledger = new MemorySpendLedger();
    setSpendLedger(ledger);
    await ledger.setBudget({ projectId: "p1", runId: "run1" }, budgetUsd);
    seed("openrouter");
    Object.assign(store.runs.get("run1")!, { projectId: "p1" });
    store.jobs.find((j) => j.id === "k1")!.settings = { coversFrames: [1, 2], ...SEEDREAM, ...k1Settings };
    store.jobs.find((j) => j.id === "v1")!.settings = { coversFrames: [1, 2], duration: 4, openrouterModel: "google/veo-3.1-lite" };
    return ledger;
  }
  afterEach(async () => (await import("@/services/ops/budget-guard")).setSpendLedger(null));

  it("refuses a clip past the run's approved budget without calling the provider", async () => {
    const ledger = await paidRun(0.05);
    const adapter = fakeAdapter({ engine: "openrouter" });
    await tickRun(adapter, "run1");
    await tickRun(adapter, "run1");
    expect(adapter.generateImage).toHaveBeenCalledTimes(1);
    expect(adapter.submitVideo).not.toHaveBeenCalled();
    expect(store.jobs.find((j) => j.id === "v1")!.error).toMatch(/Budget exceeded.*run run1.*\$0\.05/);
    const entries = await ledger.entries({ projectId: "p1" });
    expect(entries.map((e) => [e.kind, e.estUsd])).toEqual([["image", 0.0189]]); // 5% reservation headroom
  });

  it("reserves a clip at submit and reconciles it with the cost its poll reports", async () => {
    const ledger = await paidRun(1);
    const { logAiUsage } = await import("@/services/ai/usage");
    const adapter = fakeAdapter({
      engine: "openrouter",
      pollVideo: vi.fn(async (): Promise<TaskResult> => {
        logAiUsage({ provider: "openrouter", model: "google/veo-3.1-lite", capability: "video", videoSeconds: 4, costUsd: 0.119 });
        return { status: "SUCCESS", url: "https://cdn/V1.mp4" };
      }),
    });
    await tickRun(adapter, "run1");
    expect(adapter.submitVideo).toHaveBeenCalledTimes(1);
    expect((await ledger.openEntryForJob("v1", "video"))?.estUsd).toBeCloseTo(0.126, 6); // 5% reservation headroom
    await tickRun(adapter, "run1");
    expect(statusOf("v1")).toBe("completed");
    const clip = (await ledger.entries({ projectId: "p1" })).find((e) => e.kind === "video")!;
    expect(clip.actualUsd).toBe(0.119);
  });

  it("keeps the QC-rejected keyframe when there is no budget left for the reroll", async () => {
    await paidRun(0.01, { qcAttempts: 1, qcRejectedUrl: "https://cdn/K1-rejected.png" });
    const adapter = fakeAdapter({ engine: "openrouter" });
    await tickRun(adapter, "run1");
    expect(adapter.generateImage).not.toHaveBeenCalled();
    expect(statusOf("k1")).toBe("completed");
    expect(store.jobs.find((j) => j.id === "k1")!.resultUrl).toBe("https://cdn/K1-rejected.png");
  });
});
