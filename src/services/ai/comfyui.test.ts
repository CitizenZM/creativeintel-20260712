import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ComfyError,
  comfyHeaders,
  comfyUrl,
  fetchOutput,
  getHistory,
  getSystemStats,
  isComfyConfigured,
  queuePrompt,
  summariseSystemStats,
  uploadImage,
} from "./comfyui";

const fetchMock = vi.fn();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("COMFYUI_URL", "https://comfy.example.com/");
  vi.stubEnv("COMFYUI_TOKEN", "");
  vi.stubEnv("COMFYUI_CF_ACCESS_CLIENT_ID", "");
  vi.stubEnv("COMFYUI_CF_ACCESS_CLIENT_SECRET", "");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("configuration", () => {
  it("trims the trailing slash and reports configured", () => {
    expect(comfyUrl()).toBe("https://comfy.example.com");
    expect(isComfyConfigured()).toBe(true);
  });

  it("is not configured without COMFYUI_URL", () => {
    vi.stubEnv("COMFYUI_URL", "");
    expect(isComfyConfigured()).toBe(false);
  });

  it("sends a bearer token and Cloudflare Access service-token headers when set", () => {
    vi.stubEnv("COMFYUI_TOKEN", "sekret");
    vi.stubEnv("COMFYUI_CF_ACCESS_CLIENT_ID", "id.access");
    vi.stubEnv("COMFYUI_CF_ACCESS_CLIENT_SECRET", "cf-secret");
    expect(comfyHeaders()).toEqual({
      Authorization: "Bearer sekret",
      "CF-Access-Client-Id": "id.access",
      "CF-Access-Client-Secret": "cf-secret",
    });
  });
});

describe("queuePrompt", () => {
  it("POSTs the workflow and client_id to /prompt and returns prompt_id", async () => {
    vi.stubEnv("COMFYUI_TOKEN", "sekret");
    fetchMock.mockResolvedValueOnce(json({ prompt_id: "p-1", number: 3, node_errors: {} }));
    const id = await queuePrompt({ "1": { class_type: "X", inputs: {} } }, { clientId: "ci-test" });
    expect(id).toBe("p-1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://comfy.example.com/prompt");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer sekret");
    expect(JSON.parse(init.body)).toEqual({ prompt: { "1": { class_type: "X", inputs: {} } }, client_id: "ci-test" });
  });

  it("can jump the queue", async () => {
    fetchMock.mockResolvedValueOnce(json({ prompt_id: "p-2", number: -4, node_errors: {} }));
    await queuePrompt({}, { front: true });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).front).toBe(true);
  });

  it("does not retry a validation error and reports the node errors", async () => {
    fetchMock.mockResolvedValue(
      json(
        {
          error: { type: "prompt_outputs_failed_validation", message: "Prompt outputs failed validation" },
          node_errors: { "37": { class_type: "UNETLoader", errors: [{ message: "Value not in list", details: "unet_name: 'x' not in []" }] } },
        },
        400
      )
    );
    const err = await queuePrompt({}).catch((e) => e);
    expect(err).toBeInstanceOf(ComfyError);
    expect(err.status).toBe(400);
    expect(err.message).toMatch(/UNETLoader.*not in/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries 5xx and network errors, then succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("bad gateway", { status: 502 }))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(json({ prompt_id: "p-3", number: 1, node_errors: {} }));
    expect(await queuePrompt({}, { retryDelayMs: 1 })).toBe("p-3");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("gives up after the retry budget", async () => {
    fetchMock.mockResolvedValue(new Response("down", { status: 503 }));
    await expect(queuePrompt({}, { retryDelayMs: 1 })).rejects.toThrow(/503/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("refuses to run without COMFYUI_URL", async () => {
    vi.stubEnv("COMFYUI_URL", "");
    await expect(queuePrompt({})).rejects.toThrow(/COMFYUI_URL/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("history, outputs and uploads", () => {
  it("GETs /history/{id}", async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    expect(await getHistory("abc 1")).toEqual({});
    expect(fetchMock.mock.calls[0][0]).toBe("https://comfy.example.com/history/abc%201");
  });

  it("fetches an output through /view with filename, subfolder and type", async () => {
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "video/mp4" } }));
    const out = await fetchOutput({ filename: "clip 1.mp4", subfolder: "creativeintel", type: "output" });
    expect(out.buffer).toEqual(Buffer.from([1, 2, 3]));
    expect(out.contentType).toBe("video/mp4");
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe("/view");
    expect(Object.fromEntries(url.searchParams)).toEqual({ filename: "clip 1.mp4", subfolder: "creativeintel", type: "output" });
  });

  it("uploads a keyframe as multipart and returns the LoadImage name", async () => {
    fetchMock.mockResolvedValueOnce(json({ name: "k1.png", subfolder: "creativeintel", type: "input" }));
    const ref = await uploadImage(Buffer.from([9, 9]), "k1.png", { subfolder: "creativeintel" });
    expect(ref).toEqual({ name: "k1.png", subfolder: "creativeintel", type: "input", loadImageName: "creativeintel/k1.png" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://comfy.example.com/upload/image");
    const form = init.body as FormData;
    expect(form.get("subfolder")).toBe("creativeintel");
    expect(form.get("overwrite")).toBe("true");
    expect(form.get("type")).toBe("input");
    expect((form.get("image") as File).name).toBe("k1.png");
  });
});

describe("system stats", () => {
  const stats = {
    system: { os: "posix", comfyui_version: "0.3.60", ram_total: 1, ram_free: 1 },
    devices: [{ name: "cuda:0 NVIDIA GeForce RTX 4090 : cudaMallocAsync", type: "cuda", index: 0, vram_total: 25_386_352_640, vram_free: 20_000_000_000 }],
  };

  it("reads /system_stats", async () => {
    fetchMock.mockResolvedValueOnce(json(stats));
    const s = await getSystemStats();
    expect(fetchMock.mock.calls[0][0]).toBe("https://comfy.example.com/system_stats");
    expect(s.devices?.[0].type).toBe("cuda");
  });

  it("summarises the GPU for the status page", () => {
    expect(summariseSystemStats(stats)).toEqual({
      version: "0.3.60",
      gpu: "NVIDIA GeForce RTX 4090",
      vramTotalGb: 23.6,
      vramFreeGb: 18.6,
    });
    expect(summariseSystemStats({ devices: [{ name: "cpu", type: "cpu" }] })).toEqual({ version: null, gpu: null, vramTotalGb: null, vramFreeGb: null });
  });
});
