import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BUNDLED_WORKFLOWS,
  comfyImageSize,
  comfyVideoSize,
  fillWorkflow,
  findOutputs,
  loadWorkflow,
  parseHistory,
  placeholdersIn,
  wanFrameCount,
  type ComfyWorkflow,
} from "./index";

const template: ComfyWorkflow = {
  "1": { class_type: "CLIPTextEncode", inputs: { text: "{{prompt}}", clip: ["2", 1] } },
  "2": { class_type: "EmptyLatentImage", inputs: { width: "{{width}}", height: "{{height}}", batch_size: 1 } },
  "3": { class_type: "SaveImage", inputs: { filename_prefix: "run-{{seed}}/kf" } },
};

describe("fillWorkflow", () => {
  it("replaces whole-value placeholders with the value's own type", () => {
    const out = fillWorkflow(template, { prompt: 'a "quoted" {bottle}', width: 768, height: 1344, seed: 7 });
    expect(out["1"].inputs.text).toBe('a "quoted" {bottle}');
    expect(out["2"].inputs.width).toBe(768);
    expect(out["2"].inputs.height).toBe(1344);
    expect(typeof out["2"].inputs.width).toBe("number");
  });

  it("interpolates placeholders embedded in a longer string as text", () => {
    const out = fillWorkflow(template, { prompt: "x", width: 1, height: 1, seed: 42 });
    expect(out["3"].inputs.filename_prefix).toBe("run-42/kf");
  });

  it("leaves links, numbers and booleans alone and never mutates the template", () => {
    const out = fillWorkflow(template, { prompt: "x", width: 1, height: 1, seed: 1 });
    expect(out["1"].inputs.clip).toEqual(["2", 1]);
    expect(out["2"].inputs.batch_size).toBe(1);
    expect(template["2"].inputs.width).toBe("{{width}}");
  });

  it("throws on a placeholder with no value", () => {
    expect(() => fillWorkflow(template, { prompt: "x", width: 1 })).toThrow(/height.*seed|seed.*height/);
  });

  it("rejects non-finite numbers", () => {
    expect(() => fillWorkflow(template, { prompt: "x", width: Number.NaN, height: 1, seed: 1 })).toThrow(/width/);
  });

  it("does not re-expand placeholders that appear inside a substituted value", () => {
    const out = fillWorkflow(template, { prompt: "{{width}}", width: 5, height: 1, seed: 1 });
    expect(out["1"].inputs.text).toBe("{{width}}");
  });
});

describe("placeholdersIn", () => {
  it("lists every placeholder once", () => {
    expect(placeholdersIn(template).sort()).toEqual(["height", "prompt", "seed", "width"]);
  });
});

describe("findOutputs", () => {
  it("reads SaveImage images", () => {
    const res = findOutputs({
      "9": { images: [{ filename: "kf_00001_.png", subfolder: "creativeintel", type: "output" }] },
    });
    expect(res.images).toEqual([{ filename: "kf_00001_.png", subfolder: "creativeintel", type: "output", nodeId: "9" }]);
    expect(res.videos).toEqual([]);
  });

  it("reads core SaveVideo (reported under images with animated=true)", () => {
    const res = findOutputs({
      "58": { images: [{ filename: "clip_00001_.mp4", subfolder: "creativeintel", type: "output" }], animated: [true] },
    });
    expect(res.videos.map((v) => v.filename)).toEqual(["clip_00001_.mp4"]);
    expect(res.images).toEqual([]);
  });

  it("reads VHS_VideoCombine gifs entries and a videos key", () => {
    const res = findOutputs({
      "8": { gifs: [{ filename: "th_00001.mp4", subfolder: "", type: "output", format: "video/h264-mp4", frame_rate: 25 }] },
      "10": { videos: [{ filename: "other.webm", subfolder: "", type: "output" }] },
    });
    expect(res.videos.map((v) => v.filename)).toEqual(["th_00001.mp4", "other.webm"]);
  });

  it("treats SaveAnimatedWEBP as an animated result, ranked after real video files", () => {
    const res = findOutputs({
      "1": { images: [{ filename: "anim.webp", subfolder: "", type: "output" }], animated: [true] },
      "2": { images: [{ filename: "clip.mp4", subfolder: "", type: "output" }], animated: [true] },
    });
    expect(res.videos.map((v) => v.filename)).toEqual(["clip.mp4", "anim.webp"]);
  });

  it("ranks saved outputs before temp previews", () => {
    const res = findOutputs({
      "1": { images: [{ filename: "preview.png", subfolder: "", type: "temp" }] },
      "2": { images: [{ filename: "final.png", subfolder: "", type: "output" }] },
    });
    expect(res.images.map((i) => i.filename)).toEqual(["final.png", "preview.png"]);
  });

  it("tolerates empty or malformed history", () => {
    expect(findOutputs(undefined)).toEqual({ images: [], videos: [] });
    expect(findOutputs({ "1": { text: ["hello"] }, "2": null } as never)).toEqual({ images: [], videos: [] });
  });
});

describe("parseHistory", () => {
  it("is pending while the prompt id is absent", () => {
    expect(parseHistory({}, "abc")).toEqual({ state: "pending" });
  });

  it("returns outputs on success", () => {
    const res = parseHistory(
      {
        abc: {
          outputs: { "7": { images: [{ filename: "a.png", subfolder: "", type: "output" }] } },
          status: { status_str: "success", completed: true, messages: [] },
        },
      },
      "abc"
    );
    expect(res.state).toBe("success");
    expect(res.state === "success" && res.outputs.images[0].filename).toBe("a.png");
  });

  it("surfaces the execution error message", () => {
    const res = parseHistory(
      {
        abc: {
          outputs: {},
          status: {
            status_str: "error",
            completed: false,
            messages: [["execution_error", { node_type: "UNETLoader", exception_message: "model not found" }]],
          },
        },
      },
      "abc"
    );
    expect(res).toEqual({ state: "error", error: "UNETLoader: model not found" });
  });
});

describe("sizes and frames", () => {
  it("maps aspect ratios to SDXL keyframe sizes", () => {
    expect(comfyImageSize("9:16")).toEqual({ width: 768, height: 1344 });
    expect(comfyImageSize("16:9")).toEqual({ width: 1344, height: 768 });
    expect(comfyImageSize("1:1")).toEqual({ width: 1024, height: 1024 });
  });

  it("maps aspect ratios to Wan 2.2 5B sizes (multiples of 32)", () => {
    expect(comfyVideoSize("9:16")).toEqual({ width: 704, height: 1280 });
    expect(comfyVideoSize("16:9")).toEqual({ width: 1280, height: 704 });
    for (const r of ["9:16", "16:9", "1:1", "4:3"]) {
      const { width, height } = comfyVideoSize(r);
      expect(width % 32).toBe(0);
      expect(height % 32).toBe(0);
    }
  });

  it("gives Wan a 4n+1 frame count", () => {
    expect(wanFrameCount(5, 24)).toBe(121);
    expect(wanFrameCount(4, 24)).toBe(97);
    expect((wanFrameCount(3.3, 24) - 1) % 4).toBe(0);
    expect(wanFrameCount(0, 24)).toBe(5);
  });
});

describe("bundled templates", () => {
  const vars = {
    prompt: "p",
    negative: "n",
    image: "ci/k1.png",
    driving_video: "ci/drive.mp4",
    width: 704,
    height: 1280,
    frames: 121,
    fps: 24,
    seed: 1,
    checkpoint: "sd_xl_base_1.0.safetensors",
  };

  it.each(Object.keys(BUNDLED_WORKFLOWS))("%s is API format and fills completely", async (name) => {
    const wf = await loadWorkflow(name as keyof typeof BUNDLED_WORKFLOWS, { dir: undefined });
    for (const node of Object.values(wf)) {
      expect(typeof node.class_type).toBe("string");
      expect(typeof node.inputs).toBe("object");
    }
    const filled = fillWorkflow(wf, vars);
    expect(JSON.stringify(filled)).not.toMatch(/\{\{/);
  });

  it("the i2v template feeds the keyframe into Wan22ImageToVideoLatent", async () => {
    const wf = await loadWorkflow("i2v", { dir: undefined });
    expect(placeholdersIn(wf).sort()).toEqual(["fps", "frames", "height", "image", "negative", "prompt", "seed", "width"]);
    expect(Object.values(wf).some((n) => n.class_type === "Wan22ImageToVideoLatent")).toBe(true);
  });
});

describe("COMFYUI_WORKFLOW_DIR override", () => {
  let dir: string | null = null;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = null;
  });

  it("prefers a file in the override directory and falls back to the bundled one", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "comfy-wf-"));
    const custom: ComfyWorkflow = { "1": { class_type: "Custom", inputs: { text: "{{prompt}}" } } };
    await writeFile(path.join(dir, "t2i-keyframe.json"), JSON.stringify(custom));
    expect(await loadWorkflow("t2i", { dir })).toEqual(custom);
    const i2v = await loadWorkflow("i2v", { dir });
    expect(Object.values(i2v).some((n) => n.class_type === "SaveVideo")).toBe(true);
  });

  it("rejects an override that is not API format", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "comfy-wf-"));
    await writeFile(path.join(dir, "t2i-keyframe.json"), JSON.stringify({ nodes: [], links: [] }));
    await expect(loadWorkflow("t2i", { dir })).rejects.toThrow(/API format/);
  });
});
