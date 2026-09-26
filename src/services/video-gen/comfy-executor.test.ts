import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

const client = vi.hoisted(() => ({
  isComfyConfigured: vi.fn(() => true),
  queuePrompt: vi.fn(),
  getHistory: vi.fn(),
  isPromptQueued: vi.fn(),
  fetchOutput: vi.fn(),
  uploadImage: vi.fn(),
}));
vi.mock("@/services/ai/comfyui", () => client);

const storage = vi.hoisted(() => ({ uploadBuffer: vi.fn() }));
vi.mock("@/services/storage", () => storage);

import { comfyAdapter } from "./comfy-executor";
import type { ComfyWorkflow } from "./comfy-workflows";

const ctx = { runId: "r1", nodeName: "V1", aspectRatio: "9:16", durationSec: 5 };
const fetchMock = vi.fn();

function doneHistory(id: string, outputs: Record<string, unknown>) {
  return { [id]: { outputs, status: { status_str: "success", completed: true, messages: [] } } };
}

/** Run past the keyframe poll interval without waiting in real time. */
async function withFakeTimers<T>(fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  try {
    const p = fn();
    p.catch(() => {}); // observed below; avoid an unhandled rejection while timers advance
    await vi.advanceTimersByTimeAsync(10_000);
    return await p;
  } finally {
    vi.useRealTimers();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("COMFYUI_WORKFLOW_DIR", "");
  vi.stubEnv("COMFYUI_IMAGE_CHECKPOINT", "");
  storage.uploadBuffer.mockImplementation(async (input: { filename: string; folder: string }) => ({
    url: `https://cdn/${input.folder}/${input.filename}`,
    provider: "vercel-blob",
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("comfyAdapter identity", () => {
  it("is the comfyui engine and polls keyframes asynchronously", () => {
    expect(comfyAdapter.engine).toBe("comfyui");
    expect(comfyAdapter.notConfiguredError).toMatch(/COMFYUI_URL/);
    expect(typeof comfyAdapter.pollImage).toBe("function");
  });
});

describe("generateImage", () => {
  it("queues the keyframe at the front with the prompt, size and checkpoint, and returns the stored image when it finishes quickly", async () => {
    vi.stubEnv("COMFYUI_IMAGE_CHECKPOINT", "juggernautXL.safetensors");
    client.queuePrompt.mockResolvedValue("img-1");
    client.getHistory.mockResolvedValue(doneHistory("img-1", { "7": { images: [{ filename: "kf.png", subfolder: "creativeintel", type: "output" }] } }));
    client.fetchOutput.mockResolvedValue({ buffer: Buffer.from("png"), contentType: "image/png" });

    const out = await withFakeTimers(() => comfyAdapter.generateImage("a red bottle on marble", { ...ctx, nodeName: "K1" }));
    expect(out).toEqual({ url: "https://cdn/comfy-runs/r1/K1.png" });

    const [wf, opts] = client.queuePrompt.mock.calls[0] as [ComfyWorkflow, { front?: boolean }];
    expect(opts.front).toBe(true);
    const nodes = Object.values(wf);
    expect(nodes.find((n) => n.class_type === "CheckpointLoaderSimple")!.inputs.ckpt_name).toBe("juggernautXL.safetensors");
    expect(nodes.find((n) => n.class_type === "EmptyLatentImage")!.inputs).toMatchObject({ width: 768, height: 1344 });
    expect(nodes.some((n) => n.inputs.text === "a red bottle on marble")).toBe(true);
    expect(typeof nodes.find((n) => n.class_type === "KSampler")!.inputs.seed).toBe("number");
    expect(client.fetchOutput).toHaveBeenCalledWith(expect.objectContaining({ filename: "kf.png", subfolder: "creativeintel", type: "output" }));
    expect(storage.uploadBuffer).toHaveBeenCalledWith(expect.objectContaining({ filename: "K1.png", contentType: "image/png", folder: "comfy-runs/r1" }));
  });

  it("hands back the prompt id when the GPU is busy", async () => {
    vi.useFakeTimers();
    try {
      client.queuePrompt.mockResolvedValue("img-2");
      client.getHistory.mockResolvedValue({});
      client.isPromptQueued.mockResolvedValue(true);
      const pending = comfyAdapter.generateImage("x", { ...ctx, nodeName: "K2" });
      await vi.advanceTimersByTimeAsync(120_000);
      expect(await pending).toEqual({ taskId: "img-2" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses to store results inline", async () => {
    storage.uploadBuffer.mockResolvedValue({ url: "data:image/png;base64,xx", provider: "inline" });
    client.queuePrompt.mockResolvedValue("img-3");
    client.getHistory.mockResolvedValue(doneHistory("img-3", { "7": { images: [{ filename: "kf.png", subfolder: "", type: "output" }] } }));
    client.fetchOutput.mockResolvedValue({ buffer: Buffer.from("png"), contentType: "image/png" });
    await expect(withFakeTimers(() => comfyAdapter.generateImage("x", ctx))).rejects.toThrow(/storage/i);
  });
});

describe("submitVideo", () => {
  it("uploads the keyframe and queues Wan i2v with the right size, frames and fps", async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array([1, 2]), { headers: { "content-type": "image/jpeg" } }));
    client.uploadImage.mockResolvedValue({ name: "r1-V1.jpg", subfolder: "creativeintel", type: "input", loadImageName: "creativeintel/r1-V1.jpg" });
    client.queuePrompt.mockResolvedValue("vid-1");

    const id = await comfyAdapter.submitVideo({ prompt: "slow push-in", imageUrl: "https://cdn/K1.jpg" }, { ...ctx, durationSec: 4 });
    expect(id).toBe("vid-1");
    expect(fetchMock).toHaveBeenCalledWith("https://cdn/K1.jpg", expect.anything());
    expect(client.uploadImage).toHaveBeenCalledWith(Buffer.from([1, 2]), "r1-V1.jpg", expect.objectContaining({ subfolder: "creativeintel", contentType: "image/jpeg" }));

    const [wf, opts] = client.queuePrompt.mock.calls[0] as [ComfyWorkflow, { front?: boolean }];
    expect(opts.front).toBeFalsy();
    const nodes = Object.values(wf);
    expect(nodes.find((n) => n.class_type === "LoadImage")!.inputs.image).toBe("creativeintel/r1-V1.jpg");
    expect(nodes.find((n) => n.class_type === "Wan22ImageToVideoLatent")!.inputs).toMatchObject({ width: 704, height: 1280, length: 97 });
    expect(nodes.find((n) => n.class_type === "CreateVideo")!.inputs.fps).toBe(24);
    expect(nodes.some((n) => n.inputs.text === "slow push-in")).toBe(true);
  });

  it("needs a keyframe", async () => {
    await expect(comfyAdapter.submitVideo({ prompt: "x" }, ctx)).rejects.toThrow(/keyframe/);
  });
});

describe("pollVideo", () => {
  it("is PROCESSING while the prompt is queued", async () => {
    client.getHistory.mockResolvedValue({});
    client.isPromptQueued.mockResolvedValue(true);
    expect(await comfyAdapter.pollVideo("vid-1", ctx)).toEqual({ status: "PROCESSING" });
  });

  it("fails a prompt the box has forgotten (restart)", async () => {
    client.getHistory.mockResolvedValue({});
    client.isPromptQueued.mockResolvedValue(false);
    expect(await comfyAdapter.pollVideo("vid-1", ctx)).toEqual({ status: "FAIL", error: expect.stringMatching(/lost/) });
  });

  it("stores the finished mp4", async () => {
    client.getHistory.mockResolvedValue(
      doneHistory("vid-1", { "58": { images: [{ filename: "clip_00001_.mp4", subfolder: "creativeintel", type: "output" }], animated: [true] } })
    );
    client.fetchOutput.mockResolvedValue({ buffer: Buffer.from("mp4"), contentType: "video/mp4" });
    expect(await comfyAdapter.pollVideo("vid-1", ctx)).toEqual({ status: "SUCCESS", url: "https://cdn/comfy-runs/r1/V1.mp4" });
    expect(storage.uploadBuffer).toHaveBeenCalledWith(expect.objectContaining({ filename: "V1.mp4", contentType: "video/mp4" }));
  });

  it("reports execution errors and output-less successes", async () => {
    client.getHistory.mockResolvedValueOnce({
      "vid-1": { outputs: {}, status: { status_str: "error", completed: false, messages: [["execution_error", { node_type: "KSampler", exception_message: "CUDA out of memory" }]] } },
    });
    expect(await comfyAdapter.pollVideo("vid-1", ctx)).toEqual({ status: "FAIL", error: "ComfyUI: KSampler: CUDA out of memory" });
    client.getHistory.mockResolvedValueOnce(doneHistory("vid-1", { "7": { images: [{ filename: "a.png", subfolder: "", type: "output" }] } }));
    expect(await comfyAdapter.pollVideo("vid-1", ctx)).toEqual({ status: "FAIL", error: expect.stringMatching(/no video/) });
  });
});
