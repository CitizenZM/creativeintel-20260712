import { describe, expect, it, vi } from "vitest";
import { applyCorrections, correctionsFor, CORRECTIONS_MARKER } from "./corrections";
import type { FaceEmbedder } from "./face";
import { inferShotType, scoreFrame, SHOT_THRESHOLDS } from "./score";
import { deviceBox, deviceImage, type DeviceOpts } from "./test-images";
import { bboxSchema, visionReportSchema, type VisionReport, type VisionScorer } from "./vision";

// sharp + ffmpeg work is CPU-bound and the full suite runs files in parallel.
vi.setConfig({ testTimeout: 60_000 });

const THIN: DeviceOpts = { bezel: 0.025 };

function report(p: Partial<VisionReport> = {}): VisionReport {
  return visionReportSchema.parse({
    product: { expected: true, present: true, bbox: deviceBox(THIN), view: "front", score: 0.9, checks: {} },
    cast: [],
    sceneConsistent: null,
    defects: [],
    ...p,
  });
}
const vision = (r: VisionReport | null): VisionScorer => vi.fn(async () => r);

describe("vision report schema", () => {
  it("normalises boxes (0–1000 → 0–1, malformed → null) and clamps scores", () => {
    expect(bboxSchema.parse([100, 200, 500, 900])).toEqual([0.1, 0.2, 0.5, 0.9]);
    expect(bboxSchema.parse([0.1, 0.2, 0.5, 0.9])).toEqual([0.1, 0.2, 0.5, 0.9]);
    expect(bboxSchema.parse("x")).toBeNull();
    const r = visionReportSchema.parse({ product: { present: true, score: 85, view: "weird" }, cast: [{ ref: "lead", present: true, identityScore: "0.7" }], defects: [{ issue: "bezel thicker", severity: "huge" }] });
    expect(r.product!.score).toBe(0.85);
    expect(r.product!.view).toBe("none");
    expect(r.cast[0].identityScore).toBe(0.7);
    expect(r.defects[0].severity).toBe("minor");
  });
});

describe("inferShotType", () => {
  it("classifies product close-ups, people shots and wide family shots", () => {
    expect(inferShotType("Tight close-up of the TV's top-right corner", { cast: false, product: true })).toBe("product-closeup");
    expect(inferShotType("The tablet on a walnut desk", { cast: false, product: true })).toBe("product");
    expect(inferShotType("The mother reads on the tablet", { cast: true, product: true })).toBe("people-product");
    expect(inferShotType("Wide shot, 28mm: the family on the sofa", { cast: true, product: true })).toBe("people-wide");
  });

  it("is stricter on the product for close-ups and on faces for wide shots", () => {
    expect(SHOT_THRESHOLDS["product-closeup"].productMin).toBeGreaterThan(SHOT_THRESHOLDS["people-wide"].productMin);
    expect(SHOT_THRESHOLDS["people-wide"].castMin).toBeGreaterThan(SHOT_THRESHOLDS["product-closeup"].castMin);
  });
});

describe("scoreFrame", () => {
  const refs = async () => ({ product: [{ image: await deviceImage(THIN) }] });

  it("passes a faithful product close-up (vision + pixels agree)", async () => {
    const s = await scoreFrame(await deviceImage(THIN, "jpeg"), await refs(), { shot: "Close-up of the tablet", deps: { vision: vision(report()) } });
    expect(s.shotType).toBe("product-closeup");
    expect(s.reviewed).toBe(true);
    expect(s.product!.pixel!.score).toBeGreaterThan(0.95);
    expect(s.product!.score).toBeGreaterThan(0.9);
    expect(s.pass).toBe(true);
    expect(s.defects).toEqual([]);
  });

  it("fails a thick bezel the vision model missed — the pixels name it", async () => {
    const frame = await deviceImage({ bezel: 0.1 }, "jpeg");
    const s = await scoreFrame(frame, await refs(), { shot: "Close-up of the tablet", deps: { vision: vision(report()) } });
    expect(s.pass).toBe(false);
    expect(s.defects.some((d) => d.startsWith("bezel thicker"))).toBe(true);
    expect(s.score).toBeLessThan(0.65);
  });

  it("applies per-shot thresholds: the same product score fails a close-up, passes a wide family shot", async () => {
    const r = report({ product: { ...report().product!, score: 0.6 }, cast: [{ ref: "casting sheet", present: true, bbox: null, identityScore: 0.9, checks: {} }] });
    const frame = await deviceImage(THIN, "jpeg");
    const base = { product: [{ image: await deviceImage(THIN) }], cast: [{ image: await deviceImage(THIN) }] };
    const close = await scoreFrame(frame, base, { shot: "x", shotType: "product-closeup", deps: { vision: vision(r), pixels: false } });
    const wide = await scoreFrame(frame, base, { shot: "x", shotType: "people-wide", deps: { vision: vision(r), pixels: false } });
    expect(close.pass).toBe(false);
    expect(close.reasons.join(" ")).toMatch(/product 0\.6 < 0\.78/);
    expect(wide.pass).toBe(true);
    // ...and a drifted face fails the wide shot.
    const drifted = report({ product: report().product, cast: [{ ref: "casting sheet", present: true, bbox: null, identityScore: 0.6, checks: {} }] });
    const wideDrift = await scoreFrame(frame, base, { shot: "x", shotType: "people-wide", deps: { vision: vision(drifted), pixels: false } });
    expect(wideDrift.pass).toBe(false);
    expect(wideDrift.reasons.join(" ")).toMatch(/identity 0\.6 < 0\.75/);
  });

  it("fails on a major vision defect and on a missing cast member", async () => {
    const frame = await deviceImage(THIN, "jpeg");
    const major = await scoreFrame(frame, await refs(), {
      shot: "The tablet on a desk",
      deps: { vision: vision(report({ defects: [{ subject: "product", issue: "logo misspelled: 'TLC'", severity: "major" }] })) },
    });
    expect(major.pass).toBe(false);
    expect(major.majorDefects).toBe(1);
    const missing = await scoreFrame(frame, { ...(await refs()), cast: [{ image: frame }] }, { shot: "The mother holds the tablet", deps: { vision: vision(report({ cast: [] })), pixels: false } });
    expect(missing.pass).toBe(false);
    expect(missing.defects.join(" ")).toMatch(/cast missing/);
  });

  it("passes unreviewed when the vision model is down (QC never blocks a render)", async () => {
    const s = await scoreFrame(await deviceImage(THIN), await refs(), { shot: "x", deps: { vision: vision(null) } });
    expect(s).toMatchObject({ reviewed: false, pass: true });
  });

  it("runs pixel-only with a known box", async () => {
    const s = await scoreFrame(await deviceImage({ bezel: 0.1 }), await refs(), { shot: "Close-up", productBbox: deviceBox(THIN), deps: { vision: vision(null) } });
    expect(s.reviewed).toBe(true);
    expect(s.product!.visionScore).toBeNull();
    expect(s.pass).toBe(false);
  });

  it("blends a face embedding into identity when an embedder is configured", async () => {
    const frame = await deviceImage(THIN, "jpeg");
    const embedder: FaceEmbedder = { name: "fake", embed: vi.fn(async (b: Buffer) => (b.length > 0 ? [1, 0, 0] : null)) };
    const far: FaceEmbedder = { name: "fake", embed: vi.fn().mockResolvedValueOnce([1, 0, 0]).mockResolvedValueOnce([0, 1, 0]) };
    const r = report({ product: null, cast: [{ ref: "casting sheet", present: true, bbox: [0.2, 0.2, 0.6, 0.8], identityScore: 0.8, checks: {} }] });
    const same = await scoreFrame(frame, { cast: [{ image: frame }] }, { shot: "The lead smiles", deps: { vision: vision(r), faceEmbedder: embedder } });
    expect(same.cast[0].embeddingCos).toBe(1);
    expect(same.cast[0].score).toBeCloseTo(0.9, 2);
    const other = await scoreFrame(frame, { cast: [{ image: frame }] }, { shot: "The lead smiles", deps: { vision: vision(r), faceEmbedder: far } });
    expect(other.cast[0].embeddingCos).toBe(0);
    expect(other.pass).toBe(false);
  });
});

describe("corrections", () => {
  it("turns named defects into explicit fixes, with the product spec", () => {
    const c = correctionsFor(["bezel thicker: 9% vs 2%", "body too thin (stick-like): proportions 9:1", "face differs from casting sheet", "something odd"], { productSpec: "6.6 mm thick side profile" });
    expect(c[0]).toMatch(/bezel must be thin and uniform/);
    expect(c[1]).toMatch(/6\.6 mm thick side profile/);
    expect(c[2]).toMatch(/exact same face/);
    expect(c[3]).toBe("Fix: something odd.");
  });

  it("appends one corrections block, replacing an earlier one", () => {
    const once = applyCorrections("Shot.", ["A."]);
    expect(once).toBe(`Shot. ${CORRECTIONS_MARKER} A.`);
    expect(applyCorrections(once, ["B."])).toBe(`Shot. ${CORRECTIONS_MARKER} B.`);
    expect(applyCorrections(once, [])).toBe("Shot.");
  });
});
