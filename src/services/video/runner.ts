import path from "node:path";
import { promises as fs } from "node:fs";
import os from "node:os";
import { prisma } from "@/lib/db";
import { downloadVideo, ensureWorkDir, detectPlatform } from "./downloader";
import { cloudDownload } from "./cloud-downloader";
import { transcribeAudio } from "./transcribe";
import { selectHighlights } from "./highlight";
import { shortsifyClip } from "./shortsify";
import { checkBinaries } from "./binaries";
import {
  isCloudinaryConfigured,
  uploadVideo,
  shortsifyURL,
} from "./cloudinary-render";

type Updater = (patch: { status?: string; progress?: number; step?: string; error?: string; output?: unknown; outputPath?: string }) => Promise<void>;

function makeUpdater(jobId: string): Updater {
  return async (patch) => {
    await prisma.renderJob
      .update({
        where: { id: jobId },
        data: {
          status: patch.status,
          progress: patch.progress,
          currentStep: patch.step,
          error: patch.error,
          output: patch.output as never,
          outputPath: patch.outputPath,
        },
      })
      .catch(() => {});
  };
}

async function downloadEither(url: string, jobId: string) {
  const bin = await checkBinaries();
  if (bin.ytdlp.available && bin.ffmpeg.available) {
    // Local-binary path
    const dl = await downloadVideo(url, jobId);
    const wavPath = dl.localPath; // for transcribe step
    return {
      localPath: dl.localPath,
      wavPath,
      cloudPublicId: null as string | null,
      cloudUrl: null as string | null,
      metadata: dl.metadata,
    };
  }
  if (!isCloudinaryConfigured()) {
    throw new Error(
      "No rendering backend available. Either install yt-dlp + ffmpeg locally, or set CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET to enable cloud rendering."
    );
  }
  // Cloud path: pure-JS download → Cloudinary upload
  const cd = await cloudDownload(url);
  // Write to a temp file so transcribe + later steps can stream from it
  const dir = path.join(os.tmpdir(), "creativeintel-video", jobId);
  await fs.mkdir(dir, { recursive: true });
  const localPath = path.join(dir, cd.contentType === "video/webm" ? "video.webm" : "video.mp4");
  await fs.writeFile(localPath, cd.buffer);
  const upload = await uploadVideo(cd.buffer);
  return {
    localPath,
    wavPath: localPath,
    cloudPublicId: upload.publicId,
    cloudUrl: upload.url,
    metadata: { ...cd.metadata, duration: upload.durationSec ?? cd.metadata.duration },
  };
}

export async function runImport(jobId: string, projectId: string, input: { url: string }) {
  const update = makeUpdater(jobId);
  await update({ status: "running", progress: 5, step: "Downloading" });
  try {
    const dl = await downloadEither(input.url, jobId);
    await update({ progress: 50, step: "Transcribing" });
    const tx = await transcribeAudio(dl.localPath);

    await update({ progress: 85, step: "Persisting" });
    const refData = {
      platform: dl.metadata.platform || detectPlatform(input.url),
      localPath: dl.localPath,
      durationSec: dl.metadata.duration ?? null,
      width: dl.metadata.width ?? null,
      height: dl.metadata.height ?? null,
      transcript: tx.text || null,
      language: tx.language ?? null,
      metadata: {
        ...dl.metadata,
        cloudPublicId: dl.cloudPublicId,
        cloudUrl: dl.cloudUrl,
      } as never,
    };
    const vr = await prisma.videoReference.upsert({
      where: { projectId_sourceUrl: { projectId, sourceUrl: input.url } },
      create: { projectId, sourceUrl: input.url, ...refData },
      update: refData,
    });

    const ca = await prisma.contentAsset.upsert({
      where: { projectId_url: { projectId, url: input.url } },
      create: {
        projectId,
        type: vr.platform === "youtube" ? "YOUTUBE_VIDEO" : vr.platform === "tiktok" ? "TIKTOK_VIDEO" : "WEB_MENTION",
        title: dl.metadata.title,
        url: input.url,
        description: dl.metadata.description?.slice(0, 1000) || null,
        thumbnailUrl: dl.metadata.thumbnail ?? null,
        platform: vr.platform,
        publishedAt: dl.metadata.upload_date ? parseDate(dl.metadata.upload_date) : null,
        viewCount: dl.metadata.view_count ?? null,
        likeCount: dl.metadata.like_count ?? null,
        transcript: tx.text || null,
        dataSource: "PUBLIC_WEB",
        rawData: dl.metadata as never,
      },
      update: {
        title: dl.metadata.title,
        description: dl.metadata.description?.slice(0, 1000) || null,
        thumbnailUrl: dl.metadata.thumbnail ?? null,
        viewCount: dl.metadata.view_count ?? null,
        likeCount: dl.metadata.like_count ?? null,
        transcript: tx.text || null,
        rawData: dl.metadata as never,
      },
    });

    await prisma.videoReference.update({
      where: { id: vr.id },
      data: { contentAssetId: ca.id },
    });

    await update({
      status: "complete",
      progress: 100,
      step: "Done",
      output: {
        videoReferenceId: vr.id,
        contentAssetId: ca.id,
        title: dl.metadata.title,
        durationSec: dl.metadata.duration,
        transcriptLength: tx.text.length,
        language: tx.language,
        platform: vr.platform,
      },
      outputPath: dl.localPath,
    });
  } catch (err) {
    await update({ status: "error", error: err instanceof Error ? err.message : "Import failed" });
  }
}

export async function runShortsify(
  jobId: string,
  projectId: string,
  input: { videoReferenceId?: string; sourceUrl?: string; targetDurationSec?: number; aspectRatio?: "9:16" | "16:9" | "1:1" }
) {
  const update = makeUpdater(jobId);
  try {
    let ref = input.videoReferenceId
      ? await prisma.videoReference.findUnique({ where: { id: input.videoReferenceId } })
      : null;

    // If no existing reference, perform an inline import first.
    if (!ref) {
      if (!input.sourceUrl) throw new Error("sourceUrl or videoReferenceId required");
      await update({ status: "running", progress: 5, step: "Downloading source" });
      const dl = await downloadEither(input.sourceUrl, jobId);
      await update({ progress: 30, step: "Transcribing source" });
      const tx = await transcribeAudio(dl.localPath);
      const refData = {
        platform: dl.metadata.platform || detectPlatform(input.sourceUrl),
        localPath: dl.localPath,
        durationSec: dl.metadata.duration ?? null,
        width: dl.metadata.width ?? null,
        height: dl.metadata.height ?? null,
        transcript: tx.text || null,
        language: tx.language ?? null,
        metadata: dl.metadata as never,
      };
      const fullRefData = {
        ...refData,
        metadata: {
          ...dl.metadata,
          cloudPublicId: dl.cloudPublicId,
          cloudUrl: dl.cloudUrl,
        } as never,
      };
      ref = await prisma.videoReference.upsert({
        where: { projectId_sourceUrl: { projectId, sourceUrl: input.sourceUrl } },
        create: { projectId, sourceUrl: input.sourceUrl, ...fullRefData },
        update: fullRefData,
      });
    }

    const refMeta = ref.metadata as { cloudPublicId?: string; cloudUrl?: string } | null;
    const hasLocalFile = !!ref.localPath && (await fs.access(ref.localPath).then(() => true).catch(() => false));

    if (!hasLocalFile && !refMeta?.cloudPublicId) {
      throw new Error("Reference has no playable source (local file missing and not in Cloudinary). Re-import this reference.");
    }

    await update({ status: "running", progress: 55, step: "Selecting highlight" });
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { brand: true },
    });

    // Transcribe — needs a local file. If we don't have one but the source is in
    // Cloudinary, skip segment-based highlight and fall back to a heuristic.
    const tx = hasLocalFile
      ? await transcribeAudio(ref.localPath!)
      : { text: ref.transcript ?? "", segments: [], language: ref.language ?? undefined, source: "none" as const };
    const highlights = await selectHighlights(tx.segments, {
      targetDurationSec: input.targetDurationSec ?? 30,
      brandContext: project?.brand?.targetAudience || project?.brandName,
      maxHighlights: 1,
      totalDurationSec: ref.durationSec ?? undefined,
    });
    if (highlights.length === 0) throw new Error("No highlight could be selected");
    const h = highlights[0];

    await update({ progress: 75, step: "Rendering clip" });
    const bin = await checkBinaries();
    let outputPath = "";
    let resultWidth = 0;
    let resultHeight = 0;

    if (refMeta?.cloudPublicId && isCloudinaryConfigured()) {
      // Cloud render — synthesize a Cloudinary URL with crop + trim + overlay
      outputPath = shortsifyURL({
        publicId: refMeta.cloudPublicId,
        start: h.start,
        end: h.end,
        hookText: h.hookText,
        aspectRatio: input.aspectRatio ?? "9:16",
      });
      [resultWidth, resultHeight] = ((input.aspectRatio ?? "9:16") === "9:16") ? [1080, 1920] :
        (input.aspectRatio === "16:9") ? [1920, 1080] : [1080, 1080];
    } else if (hasLocalFile && bin.ffmpeg.available) {
      const outDir = await ensureWorkDir(jobId);
      const result = await shortsifyClip({
        videoPath: ref.localPath!,
        start: h.start,
        end: h.end,
        outputDir: outDir,
        outputName: `short-${ref.id}.mp4`,
        segments: tx.segments,
        hookText: h.hookText,
        aspectRatio: input.aspectRatio ?? "9:16",
      });
      outputPath = result.outputPath;
      resultWidth = result.width;
      resultHeight = result.height;
    } else {
      throw new Error("No render backend: install ffmpeg locally OR configure Cloudinary (CLOUDINARY_* env vars).");
    }

    await update({
      status: "complete",
      progress: 100,
      step: "Done",
      output: {
        videoReferenceId: ref.id,
        clipPath: outputPath,
        durationSec: h.end - h.start,
        width: resultWidth,
        height: resultHeight,
        hookText: h.hookText,
        rationale: h.reason,
        score: h.score,
      },
      outputPath,
    });
  } catch (err) {
    await update({ status: "error", error: err instanceof Error ? err.message : "Shortsify failed" });
  }
}

function parseDate(yyyymmdd: string): Date | null {
  if (!/^\d{8}$/.test(yyyymmdd)) return null;
  return new Date(`${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`);
}

export async function createRenderJob(
  projectId: string,
  kind: "import" | "shortsify",
  input: unknown
): Promise<string> {
  const job = await prisma.renderJob.create({
    data: {
      projectId,
      kind,
      status: "pending",
      input: input as never,
      startedAt: new Date(),
    },
  });
  return job.id;
}
