import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { describe, expect, it } from "vitest";
import { kenBurnsFilter, stillSize } from "./animatic-executor";
import { videoDefaults } from "@/services/settings/ai-settings-core";
import { ANIMATIC_IMAGE_MODEL, ANIMATIC_VIDEO_MODEL, engineFor, modelOptions } from "./libtv-pricing";

const run = promisify(execFile);

describe("animatic engine", () => {
  it("sizes stills to the run's aspect", () => {
    expect(stillSize("9:16")).toEqual({ width: 768, height: 1344 });
    expect(stillSize("16:9")).toEqual({ width: 1344, height: 768 });
  });

  it("is always offered, including strict free mode with no keys", () => {
    const names = (o: ReturnType<typeof modelOptions>) => [...o.image, ...o.video].map((m) => m.name);
    const free = names(modelOptions(true, false, {}, false));
    expect(free).toEqual([ANIMATIC_IMAGE_MODEL, ANIMATIC_VIDEO_MODEL]);
    expect(engineFor(ANIMATIC_VIDEO_MODEL)).toBe("animatic");
  });

  it("is the free compile default when GLM has no key", () => {
    expect(videoDefaults("glm", true, [], { glmAvailable: false })).toEqual({ imageModel: ANIMATIC_IMAGE_MODEL, videoModel: ANIMATIC_VIDEO_MODEL });
    expect(videoDefaults("animatic", false, [])).toEqual({ imageModel: ANIMATIC_IMAGE_MODEL, videoModel: ANIMATIC_VIDEO_MODEL });
  });

  it("renders a real 2 s 9:16 clip with the zoom/pan filter", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "animatic-test-"));
    try {
      const still = path.join(dir, "still.png");
      const out = path.join(dir, "clip.mp4");
      await run(ffmpegPath!, ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=768x1344:rate=1", "-frames:v", "1", still]);
      await run(ffmpegPath!, ["-y", "-v", "error", "-loop", "1", "-i", still, "-t", "2", "-vf", kenBurnsFilter("9:16", 2, 1), "-an", "-c:v", "libx264", "-preset", "veryfast", out]);
      const { stderr } = await run(ffmpegPath!, ["-i", out], { encoding: "utf8" }).catch((e) => e as { stderr: string });
      expect(stderr).toMatch(/1080x1920/);
      expect(stderr).toMatch(/Duration: 00:00:02/);
      expect((await readFile(out)).length).toBeGreaterThan(1000);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("pollinationsBackoffMs", () => {
  it("honours Retry-After on 429 and backs off harder than on other errors", async () => {
    const { pollinationsBackoffMs } = await import("./animatic-executor");
    expect(pollinationsBackoffMs(429, "7", 0)).toBe(7000);
    expect(pollinationsBackoffMs(429, "600", 0)).toBe(60_000);
    expect(pollinationsBackoffMs(429, null, 1)).toBe(20_000);
    expect(pollinationsBackoffMs(500, null, 1)).toBe(6000);
  });
});
