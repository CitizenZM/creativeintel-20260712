import { describe, expect, it, vi } from "vitest";
import { autoFixRender, correctionsFor, fixableIssues, qcScore, type AutoFixDeps, type QcLike } from "./autofix";

const check = (key: string, pass: boolean, value: number | string | null = null) => ({ key, pass, value });

/** The QM7L v10 master as pre-flight saw it: black frame 1, 8/20 layers in TikTok's right rail, loud enough, CTA planned. */
const qm7l: QcLike = {
  passed: 11,
  total: 13,
  checks: [check("loudness_lufs", true, -14.2), check("caption_coverage", true, 96), check("end_card_s", true, 3)],
  layout: { platform: null, inset: 0 },
  preflight: {
    score: 64,
    platform: "tiktok",
    checks: [
      { ...check("first_frame_brightness", false, 0.03), score: 0 },
      { ...check("safe_zone", false, "8/20 outside"), score: 0.5 },
      { ...check("cta_end", true, "planned"), score: 1 },
      { ...check("product_frame1", false, 3), score: 0 },
    ],
  },
};

describe("fixableIssues", () => {
  it("maps QC + pre-flight failures to the re-edit fixes (and leaves the rest — late product — for a re-shoot)", () => {
    expect(fixableIssues(qm7l).map((i) => i.kind)).toEqual(["first-frame", "safe-zone"]);
  });
  it("reads loudness, captions and CTA failures from either report", () => {
    const qc: QcLike = {
      passed: 9,
      total: 13,
      checks: [check("loudness_lufs", false, -18.5), check("caption_coverage", false, 60)],
      preflight: { score: 70, platform: "instagram_reels", checks: [{ ...check("cta_end", false, "none"), score: 0 }, { ...check("captions", false, 60), score: 0.25 }] },
    };
    expect(fixableIssues(qc).map((i) => i.kind)).toEqual(["loudness", "captions", "cta"]);
  });
  it("is empty for a clean render", () => {
    expect(fixableIssues({ passed: 13, total: 13, checks: [check("loudness_lufs", true, -14)] })).toEqual([]);
  });
});

describe("correctionsFor", () => {
  it("turns each issue into a correction", () => {
    const f = correctionsFor([
      { kind: "safe-zone", key: "safe_zone", value: "8/20" },
      { kind: "first-frame", key: "first_frame_brightness", value: 0.03 },
      { kind: "loudness", key: "loudness_lufs", value: -18 },
      { kind: "captions", key: "caption_coverage", value: 60 },
      { kind: "cta", key: "cta_end", value: "none" },
    ]);
    expect(f).toEqual({ layoutInset: 0.01, brightOpen: true, loudnessTarget: -10, allCaptions: true, forceCta: true });
  });
  it("tightens an already platform-laid-out box further and offsets an earlier loudness target", () => {
    const f = correctionsFor([{ kind: "safe-zone", key: "safe_zone", value: "2/20" }, { kind: "loudness", key: "loudness_lufs", value: -12 }], { layoutInset: 0.01, loudnessTarget: -15 }, "tiktok");
    expect(f.layoutInset).toBeCloseTo(0.035, 5);
    expect(f.loudnessTarget).toBe(-17);
  });
});

describe("qcScore", () => {
  it("uses the pre-flight score when there is one, else the QC pass rate", () => {
    expect(qcScore(qm7l)).toBe(64);
    expect(qcScore({ passed: 12, total: 13, checks: [] })).toBe(92);
  });
});

describe("autoFixRender (injected, no ffmpeg)", () => {
  const fixedQc: QcLike = {
    passed: 12,
    total: 13,
    checks: [],
    preflight: { score: 81, platform: "tiktok", checks: [{ ...check("first_frame_brightness", true, 0.41), score: 1 }, { ...check("safe_zone", true, "0/20 outside"), score: 1 }] },
  };
  const deps = (after: QcLike) => {
    const d: AutoFixDeps = {
      load: vi.fn(async () => ({ qc: qm7l, platform: "tiktok" as const, masterUrl: "https://x/old.mp4" })),
      render: vi.fn(async () => ({ qc: after, masterUrl: "https://x/fixed.mp4", previewUrl: "https://x/fixed-p.mp4" })),
      save: vi.fn(async () => undefined),
    };
    return d;
  };

  it("re-renders once with the corrections, records before/after and promotes a better master", async () => {
    const d = deps(fixedQc);
    const r = await autoFixRender("run1", d);
    expect(d.render).toHaveBeenCalledTimes(1);
    expect(d.render).toHaveBeenCalledWith("run1", { platform: "tiktok", fixes: { layoutInset: 0.01, brightOpen: true } });
    expect(r.status).toBe("fixed");
    expect(r.before).toEqual({ score: 64, issues: ["first-frame", "safe-zone"] });
    expect(r.after).toMatchObject({ score: 81, issues: [], masterUrl: "https://x/fixed.mp4" });
    expect(r.promoted).toBe(true);
    expect(r.previousMasterUrl).toBe("https://x/old.mp4");
    expect(d.save).toHaveBeenCalledWith("run1", r, { masterUrl: "https://x/fixed.mp4", previewUrl: "https://x/fixed-p.mp4", qc: fixedQc });
  });

  it("keeps the original master when the re-render scores no better", async () => {
    const d = deps({ ...qm7l });
    const r = await autoFixRender("run1", d);
    expect(r.status).toBe("no-better");
    expect(r.promoted).toBe(false);
    expect(d.save).toHaveBeenCalledWith("run1", r, null);
  });

  it("does nothing on a clean render", async () => {
    const d = deps(fixedQc);
    (d.load as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ qc: fixedQc, platform: "tiktok", masterUrl: "u" });
    const r = await autoFixRender("run1", d);
    expect(r.status).toBe("clean");
    expect(d.render).not.toHaveBeenCalled();
  });
});
