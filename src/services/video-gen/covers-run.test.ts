import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { coverTargets, hookHeadlineFromFrames, uploadCovers } from "./covers-run";

describe("uploadCovers", () => {
  it("uploads each cover with the storage helper and returns the qcReport.covers entry", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cv-"));
    try {
      const files = await Promise.all(["9x16", "1x1", "4x5"].map(async (a) => {
        const f = path.join(dir, `c-${a}.jpg`);
        await writeFile(f, Buffer.from([1, 2, 3]));
        return f;
      }));
      const upload = vi.fn(async (i: { filename: string }) => ({ url: `https://cdn/${i.filename}`, provider: "blob" }));
      const set = await uploadCovers(
        { frameSec: 4.2, score: 0.81, candidates: [{ t: 4.2, score: 0.81 }, { t: 6, score: 0.7 }], frameFile: "", headline: "WANT A GIFT?", covers: [
          { aspect: "9:16", file: files[0], w: 1080, h: 1920 },
          { aspect: "1:1", file: files[1], w: 1080, h: 1080 },
          { aspect: "4:5", file: files[2], w: 1080, h: 1350 },
        ] },
        "master-run1",
        upload
      );
      expect(upload).toHaveBeenCalledTimes(3);
      expect(upload.mock.calls[0][0]).toMatchObject({ contentType: "image/jpeg", folder: "glm-covers", filename: "cover-master-run1-9x16.jpg" });
      expect(set.items.map((i) => i.aspect)).toEqual(["9:16", "1:1", "4:5"]);
      expect(set.items[0].url).toBe("https://cdn/cover-master-run1-9x16.jpg");
      expect(set).toMatchObject({ frameSec: 4.2, score: 0.81, headline: "WANT A GIFT?" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("drops covers the storage could only inline", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cv-"));
    try {
      const f = path.join(dir, "a.jpg");
      await writeFile(f, Buffer.from([1]));
      const set = await uploadCovers({ frameSec: 1, score: 0.5, candidates: [], frameFile: "", headline: null, covers: [{ aspect: "1:1", file: f, w: 1080, h: 1080 }] }, "x", async () => ({ url: "data:...", provider: "inline" }));
      expect(set.items).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("coverTargets", () => {
  it("covers the master and every variant / export that lacks covers", () => {
    const t = coverTargets("https://m.mp4", {
      covers: { items: [] },
      variants: [{ hookStyle: "c", masterUrl: "https://c.mp4", hookText: "OLD TV?" }, { hookStyle: "p", masterUrl: "https://p.mp4", covers: { items: [{}] } }],
      exports: [{ format: "4:5", masterUrl: "https://e.mp4" }],
    }, { force: false });
    expect(t.map((x) => x.key)).toEqual(["master", "variant:c", "export:4:5"]);
    expect(t[1].headline).toBe("OLD TV?");
    expect(coverTargets("https://m.mp4", { covers: { items: [{}] } }, { force: false })).toEqual([]);
    expect(coverTargets("https://m.mp4", { covers: { items: [{}] } }, { force: true }).map((x) => x.key)).toEqual(["master"]);
  });
});

describe("hookHeadlineFromFrames", () => {
  it("takes the hook frame's on-screen text as the cover headline", () => {
    expect(hookHeadlineFromFrames([{ segment: "BODY", text: "3,000 NITS" }, { segment: "HOOK", text: "WANT A NEW YEAR GIFT?" }])).toBe("WANT A NEW YEAR GIFT?");
    expect(hookHeadlineFromFrames([{ segment: "BODY", text: "x" }])).toBeNull();
  });
});
