import { describe, expect, it, vi } from "vitest";
import { CORRECTIONS_MARKER, applyCorrections } from "./corrections";
import { bestCandidate, consistencyRecord, consistencyRepairEnabled, decideKeyframe, generateConsistentKeyframe, repairReason } from "./gate";
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

describe("consistencyRecord product box", () => {
  const withBox = (score: number, pass: boolean, bbox: [number, number, number, number] | null, present = true): ConsistencyScore => ({
    ...fakeScore(score, pass),
    product: { expected: true, present, bbox, view: "front", visionScore: score, pixel: null, score },
  });
  it("records the kept keyframe's product box (the edit reframes and judges the CTA hero from it)", () => {
    const d = decideKeyframe("u0", withBox(0.9, true, [0.6, 0.6, 0.9, 0.9]), { attempts: 0 });
    if (d.action !== "accept") throw new Error("expected accept");
    expect(consistencyRecord(withBox(0.9, true, [0.6, 0.6, 0.9, 0.9]), d, 0)).toMatchObject({ productBox: [0.6, 0.6, 0.9, 0.9], productPresent: true });
  });
  it("takes the box of an earlier attempt when that attempt is the one kept", () => {
    const prev = [{ url: "u0", score: 0.7, pass: false, defects: [], bbox: [0.2, 0.2, 0.8, 0.8] as [number, number, number, number], present: true }];
    const cur = withBox(0.5, false, [0.7, 0.7, 0.9, 0.9]);
    const d = decideKeyframe("u1", cur, { attempts: 2, previous: prev }, { maxRerolls: 2 });
    if (d.action !== "accept") throw new Error("expected accept");
    expect(d.url).toBe("u0");
    expect(consistencyRecord(cur, d, 2).productBox).toEqual([0.2, 0.2, 0.8, 0.8]);
  });
  it("records an absent product as such", () => {
    const r = withBox(0.9, true, null, false);
    const d = decideKeyframe("u0", r, { attempts: 0 });
    if (d.action !== "accept") throw new Error("expected accept");
    expect(consistencyRecord(r, d, 0)).toMatchObject({ productBox: null, productPresent: false });
  });
});

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

describe("packshot repair of a defective best attempt", () => {
  const box = [0.2, 0.5, 0.55, 0.8] as [number, number, number, number];
  /** A failing score whose vision report named `major` and boxed the product. */
  const majorScore = (score: number, major: string[]): ConsistencyScore => ({
    ...fakeScore(score, false, major),
    majorDefects: major.length,
    majorIssues: major,
    product: { expected: true, present: true, bbox: box, view: "front", visionScore: 0.3, pixel: null, score: 0.3 },
  });

  it("names the major product defect; people, scene and passing frames are not repaired", () => {
    const c = { url: "u", score: 0.3, pass: false, defects: [], bbox: box };
    expect(repairReason({ ...c, major: ["colour wrong: white body instead of dark"] })).toBe("colour wrong: white body instead of dark");
    expect(repairReason({ ...c, major: ["body too thin (stick-like): proportions 6:1", "bezel thicker: 9%"] })).toMatch(/stick-like.*; bezel thicker/);
    expect(repairReason({ ...c, major: ["face differs: jaw", "hair colour differs"] })).toBeNull();
    expect(repairReason({ ...c, major: ["collage: two panels"] })).toBeNull();
    expect(repairReason({ ...c, major: ["colour wrong"], pass: true })).toBeNull();
    expect(repairReason({ ...c, major: ["colour wrong"], bbox: null })).toBeNull();
    expect(repairReason({ ...c, major: [] })).toBeNull();
  });

  it("a failing attempt carries its product box and major defects for the repair", () => {
    const d = decideKeyframe("u0", majorScore(0.3, ["colour wrong: white body"]), { attempts: 2 }, { maxRerolls: 2 });
    expect(d).toMatchObject({ action: "accept", chosen: { bbox: box, major: ["colour wrong: white body"] } });
  });

  it("repairs the kept best attempt once, records it, and respects CONSISTENCY_REPAIR=off", async () => {
    const repair = vi.fn(async () => ({ url: "repaired.jpg", result: { ...fakeScore(0.7, true), reviewed: true } }));
    const run = () =>
      generateConsistentKeyframe({
        generate: async (_c, attempt) => `u${attempt}`,
        score: async (url) => majorScore(url === "u1" ? 0.33 : 0.3, ["colour wrong: white body instead of dark"]),
        maxRerolls: 2,
        repair,
      });
    const out = await run();
    expect(repair).toHaveBeenCalledTimes(1);
    expect(repair).toHaveBeenCalledWith(expect.objectContaining({ url: "u1", bbox: box }), "colour wrong: white body instead of dark");
    expect(out.url).toBe("repaired.jpg");
    expect(out.repair).toMatchObject({ reason: "colour wrong: white body instead of dark", url: "repaired.jpg" });
    const rec = consistencyRecord(out.result, out.decision, out.attempts, { method: "packshot-composite", reason: out.repair!.reason, score: 0.7, pass: true, url: "repaired.jpg" });
    expect(rec).toMatchObject({ chosenUrl: "u1", bestOf: true, repair: { method: "packshot-composite", url: "repaired.jpg" } });

    process.env.CONSISTENCY_REPAIR = "off";
    try {
      expect(consistencyRepairEnabled()).toBe(false);
      const off = await run();
      expect(off.url).toBe("u1");
      expect(off.repair).toBeUndefined();
      expect(repair).toHaveBeenCalledTimes(1);
    } finally {
      delete process.env.CONSISTENCY_REPAIR;
    }
    expect(consistencyRepairEnabled()).toBe(true);
  });

  it("ships the best attempt when the repair is not possible", async () => {
    const out = await generateConsistentKeyframe({
      generate: async (_c, attempt) => `u${attempt}`,
      score: async () => majorScore(0.3, ["bezel thicker: 9% vs 4%"]),
      maxRerolls: 1,
      repair: async () => null,
    });
    expect(out.url).toBe("u1");
    expect(out.repair).toBeUndefined();
  });
});
