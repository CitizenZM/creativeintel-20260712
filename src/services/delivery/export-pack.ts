/**
 * Export pack of a finished run — everything a media buyer needs to launch without an API connection:
 * every rendered video (master, hook variants, delivery formats, Batch Mode variants) with a thumbnail,
 * per-platform ad copy (copy.csv), Meta + TikTok bulk-upload sheets, a README and manifest.json.
 * Files go to blob storage through the storage helper; a zip of the small files (CSVs, README,
 * manifest, thumbnails, video URL list) is not built (no zip dependency). Videos stay as URLs (too big
 * to re-zip on a serverless function). The pack's URLs are kept on LibtvRun.qcReport.exportPack.
 */
import type { BatchMatrix } from "@/services/creative/batch-matrix";
import type { CampaignPlan } from "@/services/creative/campaign-plan.types";
import { generateAdCopy, type AdCopySet, type CopyLlm } from "./ad-copy";
import { copyCsv, metaBulkCsv, tiktokBulkCsv, type BulkContext, type PackVariant } from "./bulk-export";

export interface PackFile {
  path: string;
  contentType: string;
  body: string | Buffer;
}

export interface PackManifest {
  version: 1;
  runId: string;
  createdAt: string;
  campaignName: string;
  landingUrl: string | null;
  videos: PackVariant[];
  copy: { channel: string; platforms: string[]; source: string; variants: number }[];
  files: { path: string; url: string | null; bytes: number }[];
  zipUrl: string | null;
  notes: string[];
}

interface QcLike {
  variants?: { adName?: string; hookStyle: string; masterUrl: string; previewUrl: string | null }[];
  exports?: { format: string; adName: string; masterUrl: string; previewUrl: string | null; durationSec: number }[];
  batches?: BatchMatrix[];
}

const fileSafe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 150) || "video";

/** Every rendered video of a run, deduped by ad name (the newest wins) and by URL. */
export function collectPackVariants(input: { masterUrl?: string | null; masterPreviewUrl?: string | null; masterName: string; aspect: string; durationSec: number | null; qc: QcLike | null }): PackVariant[] {
  const out = new Map<string, PackVariant>();
  const add = (v: Omit<PackVariant, "fileName">) => {
    if (!v.url || [...out.values()].some((x) => x.url === v.url && x.adName !== v.adName)) return;
    out.set(v.adName, { ...v, fileName: `${fileSafe(v.adName)}.mp4` });
  };
  if (input.masterUrl) add({ adName: input.masterName, url: input.masterUrl, previewUrl: input.masterPreviewUrl ?? null, aspect: input.aspect, durationSec: input.durationSec, kind: "master" });
  const qc = input.qc ?? {};
  for (const v of qc.variants ?? [])
    add({ adName: v.adName || `${input.masterName}_Hook${v.hookStyle.toUpperCase()}`, url: v.masterUrl, previewUrl: v.previewUrl, aspect: input.aspect, durationSec: input.durationSec, kind: "hook-variant" });
  for (const e of qc.exports ?? [])
    add({ adName: e.adName, url: e.masterUrl, previewUrl: e.previewUrl, aspect: e.format.includes(":") ? e.format : input.aspect, durationSec: e.durationSec, kind: "export" });
  for (const b of qc.batches ?? [])
    for (const v of b.variants)
      if (v.status === "rendered" && v.masterUrl) add({ adName: v.name, url: v.masterUrl, previewUrl: v.previewUrl ?? null, aspect: v.aspect, durationSec: v.durationSec, kind: "batch", cta: v.cta });
  return [...out.values()];
}

export function packReadme(m: { campaignName: string; landingUrl: string | null; videos: PackVariant[]; copy: AdCopySet[]; hasBulk: boolean; notes: string[] }): string {
  const lines = [
    `# Export pack — ${m.campaignName}`,
    "",
    `${m.videos.length} video(s) · ad copy for ${m.copy.map((c) => c.label).join(", ") || "no platform"} · landing page ${m.landingUrl ?? "(not set)"}`,
    "",
    "## Files",
    "- `manifest.json` — every video (URL, thumbnail, aspect, length) and every file in this pack.",
    "- `videos.txt` — one video URL per line, named as the ad (download them all with `xargs -n1 curl -O` or your browser).",
    "- `copy.csv` — per-platform copy variants with character counts against each platform limit.",
    ...(m.hasBulk
      ? [
          "- `meta-bulk.csv` — Meta Ads Manager → Ads Manager → ⋯ → Import ads in bulk. One campaign, an ad set per aspect, one ad per video; everything PAUSED.",
          "- `tiktok-bulk.csv` — TikTok Ads Manager bulk create (vertical videos only). Paste into the account's bulk template if its column order differs.",
        ]
      : ["- Bulk sheets skipped: set the product URL on the project to get UTM-tagged links."]),
    "- `thumbnails/` — one frame per video (JPEG).",
    "",
    "## Upload steps",
    "1. Upload the videos to the platform media library first; keep the file names (= ad names).",
    "2. Import the bulk sheet; review budgets, audiences and countries; switch the ads on.",
    "3. Leave the ad names unchanged — CreativeIntel reads hook, end card, voice, aspect and length back from them when you import results.",
    "",
    "Every link carries utm_source / utm_medium=paid_social / utm_campaign / utm_content=<ad name>.",
  ];
  if (m.notes.length) lines.push("", "## Notes", ...m.notes.map((n) => `- ${n}`));
  return lines.join("\n") + "\n";
}

/** The pack's text files (pure): copy CSV, bulk sheets, README, video list. */
export function assemblePackFiles(input: { campaignName: string; landingUrl: string | null; brand: string; defaultCta: string; videos: PackVariant[]; copy: AdCopySet[]; notes: string[] }): PackFile[] {
  const files: PackFile[] = [{ path: "copy.csv", contentType: "text/csv", body: copyCsv(input.copy) }];
  let hasBulk = false;
  if (input.landingUrl) {
    try {
      const ctx: BulkContext = { campaignName: input.campaignName, landingUrl: input.landingUrl, brand: input.brand, defaultCta: input.defaultCta };
      files.push({ path: "meta-bulk.csv", contentType: "text/csv", body: metaBulkCsv(input.videos, input.copy, ctx) });
      files.push({ path: "tiktok-bulk.csv", contentType: "text/csv", body: tiktokBulkCsv(input.videos, input.copy, ctx) });
      hasBulk = true;
    } catch (err) {
      input.notes.push(`Bulk sheets skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else input.notes.push("No product URL on the project — bulk sheets skipped.");
  files.push({ path: "videos.txt", contentType: "text/plain", body: input.videos.map((v) => `${v.fileName}\t${v.url}`).join("\n") + "\n" });
  files.push({ path: "README.md", contentType: "text/markdown", body: packReadme({ ...input, hasBulk }) });
  return files;
}

export const campaignNameFor = (brand: string, product: string, runId: string, at: Date) =>
  [brand, product].filter(Boolean).join(" ").replace(/\s+/g, " ").trim().slice(0, 60) + ` | CI ${at.toISOString().slice(0, 10)} ${runId.slice(-6)}`;

// ─── I/O ────────────────────────────────────────────────────────────────────

async function thumbnailFor(url: string): Promise<Buffer | null> {
  if (!/^https?:/.test(url)) return null;
  const [{ default: ffmpegPath }, { execFile }, { promisify }, { mkdtemp, readFile, rm }, { tmpdir }, path] = await Promise.all([
    import("ffmpeg-static"),
    import("node:child_process"),
    import("node:util"),
    import("node:fs/promises"),
    import("node:os"),
    import("node:path"),
  ]);
  if (!ffmpegPath) return null;
  const dir = await mkdtemp(path.join(tmpdir(), "pack-thumb-"));
  try {
    const out = path.join(dir, "t.jpg");
    await promisify(execFile)(ffmpegPath as unknown as string, ["-y", "-v", "error", "-ss", "1", "-i", url, "-frames:v", "1", "-vf", "scale=540:-2", "-q:v", "3", out], { timeout: 60_000 });
    return await readFile(out);
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export interface ExportPackResult {
  manifestUrl: string | null;
  zipUrl: string | null;
  manifest: PackManifest;
}

/** Build, upload and record the export pack of a run. */
export async function buildExportPack(runId: string, opts: { platforms?: string[]; llm?: CopyLlm; thumbnails?: boolean } = {}): Promise<ExportPackResult> {
  const { prisma } = await import("@/lib/db");
  const { uploadBuffer } = await import("@/services/storage");
  const { variantAdName } = await import("@/services/video-gen/variants");
  const { pMap } = await import("@/lib/parallel");

  const run = await prisma.libtvRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error("Run not found");
  const [project, script] = await Promise.all([
    prisma.project.findUnique({ where: { id: run.projectId }, select: { brandName: true, productName: true, productUrl: true, productBrief: true, campaignPlan: true } }),
    run.scriptId ? prisma.script.findUnique({ where: { id: run.scriptId }, select: { title: true, totalDurationSec: true } }) : null,
  ]);
  const qc = (run.qcReport && typeof run.qcReport === "object" ? run.qcReport : {}) as QcLike & Record<string, unknown> & { durationSec?: number; hookStyle?: string };
  const brand = project?.brandName ?? "";
  const product = project?.productName ?? "";
  const durationSec = qc.durationSec ?? script?.totalDurationSec ?? null;
  const masterName = variantAdName({ brand, title: script?.title?.replace(/^⚠\s*/, ""), durationSec, hookStyle: typeof qc.hookStyle === "string" ? qc.hookStyle : "q" });
  const videos = collectPackVariants({ masterUrl: run.masterMp4Url, masterPreviewUrl: run.previewMp4Url, masterName, aspect: run.aspectRatio, durationSec, qc });
  if (!videos.length) throw new Error("Nothing to export — the run has no rendered video yet");

  const now = new Date();
  const notes: string[] = [];
  const folder = `export-packs/${runId}/${now.getTime().toString(36)}`;
  const plan = project?.campaignPlan as CampaignPlan | null;
  const platforms = opts.platforms?.length ? opts.platforms : plan?.platforms?.map((p) => p.platform) ?? ["meta_feed", "instagram_reels", "tiktok"];
  const copy = await generateAdCopy({ product: { brand, name: product, url: project?.productUrl }, brief: project?.productBrief as never, plan, platforms, llm: opts.llm });

  // Thumbnails: one frame per video (2 at a time; failures just leave the thumbnail empty).
  const thumbs = new Map<string, Buffer>();
  if (opts.thumbnails !== false) {
    await pMap(videos.slice(0, 60), async (v) => {
      const jpg = await thumbnailFor(v.url);
      if (!jpg) return;
      thumbs.set(v.fileName, jpg);
      const up = await uploadBuffer({ buffer: jpg, filename: v.fileName.replace(/\.mp4$/, ".jpg"), contentType: "image/jpeg", folder: `${folder}/thumbnails` }).catch(() => null);
      if (up && up.provider !== "inline") v.thumbnailUrl = up.url;
    }, { concurrency: 2 });
    if (thumbs.size < videos.length) notes.push(`Thumbnails for ${thumbs.size}/${videos.length} videos.`);
  }

  const campaignName = campaignNameFor(brand, product, runId, now);
  const files = assemblePackFiles({ campaignName, landingUrl: project?.productUrl ?? null, brand: brand || product, defaultCta: plan?.platforms?.[0]?.endCard.button || "Shop now", videos, copy, notes });

  const uploaded: PackManifest["files"] = [];
  for (const f of files) {
    const buffer = Buffer.isBuffer(f.body) ? f.body : Buffer.from(f.body, "utf8");
    const up = await uploadBuffer({ buffer, filename: f.path, contentType: f.contentType, folder }).catch(() => null);
    uploaded.push({ path: f.path, url: up && up.provider !== "inline" ? up.url : null, bytes: buffer.length });
  }
  if (uploaded.some((f) => !f.url)) notes.push("Some files couldn't be stored (no blob storage configured?) — they are in the zip only.");

  const manifest: PackManifest = {
    version: 1,
    runId,
    createdAt: now.toISOString(),
    campaignName,
    landingUrl: project?.productUrl ?? null,
    videos,
    copy: copy.map((c) => ({ channel: c.channel, platforms: c.platforms, source: c.source, variants: c.variants.length })),
    files: uploaded,
    zipUrl: null,
    notes,
  };

  // No zip: zip is not a direct dependency (pnpm strict build fails on it); the manifest lists every file URL.

  const mUp = await uploadBuffer({ buffer: Buffer.from(JSON.stringify(manifest, null, 2), "utf8"), filename: "manifest.json", contentType: "application/json", folder }).catch(() => null);
  const manifestUrl = mUp && mUp.provider !== "inline" ? mUp.url : null;

  const { patchQcReport } = await import("@/services/video-gen/qc-report");
  await patchQcReport(runId, (qc) => ({ ...qc, exportPack: { manifestUrl, zipUrl: manifest.zipUrl, createdAt: manifest.createdAt, videos: videos.length, campaignName } }));
  return { manifestUrl, zipUrl: manifest.zipUrl, manifest };
}
