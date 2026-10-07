import { describe, expect, it, vi } from "vitest";
import { CORRECTIONS_MARKER, applyCorrections } from "./corrections";
import { bestCandidate, consistencyRecord, decideKeyframe, generateConsistentKeyframe } from "./gate";
import { scoreFrame, type ConsistencyScore } from "./score";
import { deviceBox, deviceImage, type DeviceOpts } from "./test-images";
import { visionReportSchema, type VisionScorer } from "./vision";

// sharp + ffmpeg work is CPU-bound and the full suite runs files in parallel.
vi.setConfig({ testTimeout: 60_000 });

const THIN: DeviceOpts = { bezel: 0.025 };

/** A vision model that sees the product but misses geometry (the real failure mode). */
const lenientVision: VisionScorer = vi.fn(async () =>
  visionReportSchema.parse({ product: { expected: true, present: true, bbox: deviceBox(THIN), view: "front", score: 0.88, checks: {} }, cast: [], defects: [] })
);

const dataUrl = (b: Buffer) => `data:image/png;base64,${b.toString("base64")}`;

function fakeScore(score: number, pass: boolean, defects: string[] = []): ConsistencyScore {
  return { score, pass, reviewed: true, shotType: "product", product: null, cast: [], defects, reasons: pass ? [] : [`score ${score} < 0.72`], majorDefects: 0, sceneConsistent: null };
}

describe("decideKeyframe", () => {
  it("accepts a pass, re-rolls a fail with corrections, keeps the best after the last re-roll", () => {
    expect(decideKeyframe("u0", fakeScore(0.9, true), { attempts: 0 })).toMatchObject({ action: "accept", url: "u0", bestOf: false });
    const r = decideKeyframe("u0", fakeScore(0.5, false, ["bezel thicker: 9% vs 2%"]), { attempts: 0 }, { maxRerolls: 2 });
    expect(r.action).toBe("reroll");
    expect(r.action === "reroll" && r.corrections[0]).toMatch(/bezel must be thin/);
    const prev = [
      { url: "u0", score: 0.5, pass: false, defects: [] },
      { url: "u1", score: 0.66, pass: false, defects: [] },
    ];
    const last = decideKeyframe("u2", fakeScore(0.55, false), { attempts: 2, previous: prev }, { maxRerolls: 2 });
    expect(last).toMatchObject({ action: "accept", url: "u1", bestOf: true });
  });

  it("never re-rolls an unreviewed frame; a passing candidate beats a higher failing one", () => {
    expect(decideKeyframe("u", { ...fakeScore(0.5, true), reviewed: false }, { attempts: 0 }).action).toBe("accept");
    expect(bestCandidate([{ url: "a", score: 0.7, pass: true, defects: [] }, { url: "b", score: 0.8, pass: false, defects: [] }]).url).toBe("a");
  });
});

describe("generateConsistentKeyframe — re-roll loop", () => {
  it("feeds the pixel-detected defects into the next prompt and stops at the first passing frame", async () => {
    const refs = { product: [{ image: await deviceImage(THIN) }] };
    const bezels = [0.1, 0.08, 0.02];
    const prompts: string[] = [];
    const generate = vi.fn(async (corrections: string[], attempt: number) => {
      prompts.push(applyCorrections("Close-up of the tablet on a walnut desk.", corrections));
      return dataUrl(await deviceImage({ bezel: bezels[attempt] }));
    });
    const out = await generateConsistentKeyframe({
      generate,
      score: (url) => scoreFrame(url, refs, { shot: "Close-up of the tablet", deps: { vision: lenientVision } }),
      maxRerolls: 2,
      productSpec: "6.6 mm thick, hair-thin bezel",
    });
    expect(generate).toHaveBeenCalledTimes(3);
    expect(prompts[0]).not.toContain(CORRECTIONS_MARKER);
    expect(prompts[1]).toContain(CORRECTIONS_MARKER);
    expect(prompts[1]).toMatch(/bezel must be thin and uniform/);
    expect(out.attempts).toBe(2);
    expect(out.result.pass).toBe(true);
    expect(out.decision.bestOf).toBe(false); // the last attempt passed on its own
    const rec = consistencyRecord(out.result, out.decision, out.attempts);
    expect(rec).toMatchObject({ pass: true, attempts: 3 });
    expect(rec.tries.map((t) => t.pass)).toEqual([false, false, true]);
  });

  it("keeps the best-scoring attempt when every attempt fails", async () => {
    const refs = { product: [{ image: await deviceImage(THIN) }] };
    const bezels = [0.12, 0.06, 0.1];
    const urls: string[] = [];
    const out = await generateConsistentKeyframe({
      generate: async (_c, attempt) => {
        const u = dataUrl(await deviceImage({ bezel: bezels[attempt] }));
        urls.push(u);
        return u;
      },
      score: (url) => scoreFrame(url, refs, { shot: "Close-up of the tablet", deps: { vision: lenientVision } }),
      maxRerolls: 2,
    });
    expect(urls).toHaveLength(3);
    expect(out.result.pass).toBe(false);
    // The 6 % bezel is closest to the reference: it is kept.
    expect(out.url).toBe(urls[1]);
    expect(out.decision.chosen.score).toBe(Math.max(...out.decision.candidates.map((c) => c.score)));
  });
});
