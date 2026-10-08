import { describe, expect, it } from "vitest";
import { collectProjectFields, collectRun, collectSnapshot, collectStoryboard, collectScript, collectBrandAsset, collectCatalogRun, collectReportDelivery, fileUrlsIn, type ProjectSnapshot } from "./collect";
import { artifactFileName, contentTypeFromUrl, mediaCategory } from "./kinds";

const P = "cproj000000000000000000001";
const at = (d: number) => new Date(Date.UTC(2026, 8, d));

function run(over: Record<string, unknown> = {}) {
  return {
    id: "run1",
    projectId: P,
    storyboardId: "sb1",
    status: "completed",
    masterMp4Url: "https://x.public.blob.vercel-storage.com/master-v2.mp4",
    voiceoverUrl: "https://x.public.blob.vercel-storage.com/vo.mp3",
    subtitlesUrl: "https://x.public.blob.vercel-storage.com/subs.srt",
    previewMp4Url: "https://x.public.blob.vercel-storage.com/preview.mp4",
    contactSheetUrl: "https://x.public.blob.vercel-storage.com/sheet.jpg",
    directorPlan: { frames: [{ vo: "hi" }] },
    qcReport: {
      checks: [{ key: "loudness" }],
      autofix: { status: "fixed", previousMasterUrl: "https://x.public.blob.vercel-storage.com/master-v1.mp4", after: { masterUrl: "https://x.public.blob.vercel-storage.com/master-v2.mp4" } },
      variants: [{ hookStyle: "q", masterUrl: "https://x.public.blob.vercel-storage.com/var-q.mp4", previewUrl: null }],
      exports: [
        { format: "4:5", masterUrl: "https://x.public.blob.vercel-storage.com/exp-45.mp4", covers: { items: [{ aspect: "1:1", url: "https://res.cloudinary.com/demo/image/upload/cover.jpg" }] } },
        { format: "15s", masterUrl: "https://x.public.blob.vercel-storage.com/exp-15s.mp4" },
      ],
      locales: [{ locale: "de", masterUrl: "https://x.public.blob.vercel-storage.com/de.mp4", subtitlesUrl: "https://x.public.blob.vercel-storage.com/de.srt" }],
      exportPack: { zipUrl: "https://x.public.blob.vercel-storage.com/pack.zip", landingUrl: "https://brand.example.com/product" },
    },
    createdAt: at(1),
    completedAt: at(2),
    jobs: [
      { id: "j1", runId: "run1", projectId: P, kind: "image", nodeName: "K1", shotIndex: 0, status: "completed", resultUrl: "https://x.public.blob.vercel-storage.com/k1.png", settings: { qcRejectedUrl: "https://x.public.blob.vercel-storage.com/k1-rejected.png" }, completedAt: at(1) },
      { id: "j2", runId: "run1", projectId: P, kind: "video", nodeName: "V1", shotIndex: 0, status: "completed", resultUrl: "https://x.public.blob.vercel-storage.com/v1.mp4", settings: null, completedAt: at(1) },
      { id: "j3", runId: "run1", projectId: P, kind: "upload", nodeName: "PROD-1", shotIndex: -1, status: "completed", resultUrl: "https://x.public.blob.vercel-storage.com/pack.png", settings: null, completedAt: at(1) },
    ],
    ...over,
  };
}

describe("collectRun", () => {
  const c = collectRun(run());
  const byUrl = new Map(c.filter((x) => x.url).map((x) => [x.url!, x]));

  it("puts the auto-fixed master's predecessor in the master slot before the current master", () => {
    const masters = c.filter((x) => x.sourceKey === "run:run1:master");
    expect(masters.map((m) => m.url)).toEqual([
      "https://x.public.blob.vercel-storage.com/master-v1.mp4",
      "https://x.public.blob.vercel-storage.com/master-v2.mp4",
    ]);
    expect(masters[0].sourceField).toBe("LibtvRun.qcReport.autofix.previousMasterUrl");
    expect(masters.every((m) => m.kind === "master" && m.runId === "run1")).toBe(true);
  });

  it("registers every run output with its kind", () => {
    expect(byUrl.get("https://x.public.blob.vercel-storage.com/vo.mp3")?.kind).toBe("voiceover");
    expect(byUrl.get("https://x.public.blob.vercel-storage.com/subs.srt")?.kind).toBe("subtitles");
    expect(byUrl.get("https://x.public.blob.vercel-storage.com/preview.mp4")?.kind).toBe("preview");
    expect(byUrl.get("https://x.public.blob.vercel-storage.com/sheet.jpg")?.kind).toBe("contact-sheet");
    expect(byUrl.get("https://x.public.blob.vercel-storage.com/var-q.mp4")?.kind).toBe("variant");
    expect(byUrl.get("https://x.public.blob.vercel-storage.com/exp-45.mp4")?.kind).toBe("export");
    expect(byUrl.get("https://x.public.blob.vercel-storage.com/exp-15s.mp4")?.kind).toBe("cutdown");
    expect(byUrl.get("https://res.cloudinary.com/demo/image/upload/cover.jpg")?.kind).toBe("cover");
    expect(byUrl.get("https://x.public.blob.vercel-storage.com/de.mp4")?.kind).toBe("locale");
    expect(byUrl.get("https://x.public.blob.vercel-storage.com/de.srt")?.kind).toBe("subtitles");
    expect(byUrl.get("https://x.public.blob.vercel-storage.com/pack.zip")?.kind).toBe("export");
  });

  it("archives keyframes, clips and rejected candidates but not uploaded inputs", () => {
    expect(byUrl.get("https://x.public.blob.vercel-storage.com/k1.png")).toMatchObject({ kind: "keyframe", jobId: "j1", sourceKey: "job:j1:result" });
    expect(byUrl.get("https://x.public.blob.vercel-storage.com/v1.mp4")).toMatchObject({ kind: "clip", jobId: "j2" });
    expect(byUrl.get("https://x.public.blob.vercel-storage.com/k1-rejected.png")?.kind).toBe("keyframe");
    expect(byUrl.has("https://x.public.blob.vercel-storage.com/pack.png")).toBe(false);
  });

  it("skips web pages and lists each URL once", () => {
    expect(byUrl.has("https://brand.example.com/product")).toBe(false);
    const urls = c.filter((x) => x.url).map((x) => x.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("keeps the director plan and the QC report as JSON content", () => {
    expect(c.find((x) => x.sourceKey === "run:run1:directorPlan")).toMatchObject({ kind: "plan", content: { frames: [{ vo: "hi" }] } });
    expect(c.find((x) => x.sourceKey === "run:run1:qcReport")?.content).toMatchObject({ checks: [{ key: "loudness" }] });
  });
});

describe("collectProjectFields", () => {
  const project = {
    id: P,
    name: "Acme",
    brandName: "Acme",
    productBrief: { sellingPoints: ["a"] },
    productBriefAt: at(1),
    campaignPlan: { v: 2 },
    campaignPlanAt: at(3),
    testPlan: { phases: [] },
    testPlanAt: at(4),
    mediaPlan: { channels: [] },
    mediaPlanAt: at(4),
    nextRound: { keep: [] },
    nextRoundAt: at(5),
    creativeEditHistory: [{ at: at(2).toISOString(), message: "make it punchier", plan: { v: 1 }, storyboard: { id: "sb1", frames: [{ frameNumber: 1, scene: "old" }] } }],
    imageAdSets: [{ createdAt: at(6).toISOString(), items: [{ template: "promo", format: "1:1", w: 1080, h: 1080, url: "https://x.public.blob.vercel-storage.com/ad.png" }] }],
  };
  const c = collectProjectFields(project);

  it("archives brief, plans and proposals as JSON", () => {
    expect(c.find((x) => x.kind === "brief")).toMatchObject({ sourceKey: `project:${P}:productBrief`, content: { sellingPoints: ["a"] } });
    expect(c.find((x) => x.kind === "test-plan")?.content).toEqual({ phases: [] });
    expect(c.find((x) => x.kind === "media-plan")?.content).toEqual({ channels: [] });
    expect(c.find((x) => x.sourceKey === `project:${P}:nextRound`)?.kind).toBe("plan");
  });

  it("orders the plan's pre-edit snapshots before the current plan in one slot", () => {
    const plans = c.filter((x) => x.sourceKey === `project:${P}:campaignPlan`);
    expect(plans.map((p) => p.content)).toEqual([{ v: 1 }, { v: 2 }]);
  });

  it("keeps a pre-edit storyboard state in that storyboard's slot", () => {
    expect(c.find((x) => x.sourceKey === "storyboard:sb1")).toMatchObject({ kind: "storyboard", storyboardId: "sb1" });
  });

  it("registers every image ad", () => {
    expect(c.find((x) => x.kind === "image-ad")).toMatchObject({ url: "https://x.public.blob.vercel-storage.com/ad.png", title: expect.stringContaining("promo") });
  });
});

describe("other producers", () => {
  it("scripts and storyboards are JSON artifacts keyed by row", () => {
    const s = collectScript({ id: "s1", projectId: P, title: "Hook A", body: "text", createdAt: at(1) });
    expect(s).toMatchObject([{ kind: "script", sourceKey: "script:s1", content: expect.objectContaining({ body: "text" }) }]);
    const b = collectStoryboard({ id: "sb1", projectId: P, title: "Board", frames: [{ frameNumber: 1 }], version: 2, createdAt: at(1) });
    expect(b[0]).toMatchObject({ kind: "storyboard", sourceKey: "storyboard:sb1", storyboardId: "sb1", title: expect.stringContaining("v2") });
  });

  it("brand assets map to packshot / logo", () => {
    expect(collectBrandAsset(P, { id: "a1", kind: "PACKSHOT", url: "https://res.cloudinary.com/x/p.png", bytes: 10, format: "png", createdAt: at(1) })[0].kind).toBe("packshot");
    expect(collectBrandAsset(P, { id: "a2", kind: "LOGO", url: "https://res.cloudinary.com/x/l.png", createdAt: at(1) })[0].kind).toBe("logo");
  });

  it("catalog runs register the plan and rendered images", () => {
    const c = collectCatalogRun({ id: "c1", projectId: P, results: { plan: { skus: [] }, images: { SKU1: { items: [{ template: "t", format: "1:1", url: "https://x.public.blob.vercel-storage.com/c.png" }] } } }, createdAt: at(1) });
    expect(c.map((x) => x.kind).sort()).toEqual(["image-ad", "plan"]);
  });

  it("report deliveries keep the payload as a report", () => {
    expect(collectReportDelivery({ id: "r1", projectId: P, status: "sent", payload: { subject: "Weekly", html: "<p/>" }, createdAt: at(1) })[0]).toMatchObject({ kind: "report", content: { subject: "Weekly", html: "<p/>" } });
  });
});

describe("collectSnapshot", () => {
  it("collects everything once, deduplicating URLs across producers", () => {
    const snap: ProjectSnapshot = {
      project: { id: P, name: "Acme", brandName: "Acme", productBrief: { a: 1 } },
      scripts: [{ id: "s1", projectId: P, title: "S", createdAt: at(1) }],
      storyboards: [{ id: "sb1", projectId: P, title: "B", frames: [], createdAt: at(1) }],
      runs: [run(), run({ id: "run2", qcReport: null, masterMp4Url: "https://x.public.blob.vercel-storage.com/master-v2.mp4", jobs: [] })],
      brandAssets: [],
      catalogRuns: [],
      reportDeliveries: [],
      autopilotRuns: [],
    };
    const c = collectSnapshot(snap);
    expect(c.filter((x) => x.kind === "brief")).toHaveLength(1);
    expect(c.filter((x) => x.url === "https://x.public.blob.vercel-storage.com/master-v2.mp4")).toHaveLength(1);
  });
});

describe("fileUrlsIn", () => {
  it("finds storage and file URLs with their JSON paths", () => {
    expect(fileUrlsIn({ a: [{ u: "https://x.public.blob.vercel-storage.com/a" }], b: "https://example.com/page", c: "https://cdn.example.com/f.mp4" })).toEqual([
      { path: ["a", 0, "u"], url: "https://x.public.blob.vercel-storage.com/a" },
      { path: ["c"], url: "https://cdn.example.com/f.mp4" },
    ]);
  });
});

describe("kinds helpers", () => {
  it("names downloads by kind, title, version and type", () => {
    expect(artifactFileName({ kind: "master", title: "Run ab12 / final", version: 2, contentType: "video/mp4" })).toBe("master-Run-ab12-final-v2.mp4");
    expect(artifactFileName({ kind: "brief", title: "Product brief", version: 1, json: true })).toBe("brief-Product-brief-v1.json");
    expect(artifactFileName({ kind: "subtitles", title: "SRT", version: 1, url: "https://x/y/subs.srt" })).toBe("subtitles-SRT-v1.srt");
  });
  it("guesses types from URLs", () => {
    expect(contentTypeFromUrl("https://x/a.MP4?x=1")).toBe("video/mp4");
    expect(mediaCategory(null, "https://x/a.webp")).toBe("image");
  });
});
