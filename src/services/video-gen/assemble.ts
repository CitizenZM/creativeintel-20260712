import { v2 as cloudinary } from "cloudinary";
import { prisma } from "@/lib/db";
import { isCloudinaryConfigured } from "@/services/video/cloudinary-render";

export interface AssembleOptions {
  transition?: "cut";
  musicUrl?: string;
}

export interface AssembleResult {
  finalUrl: string;
  durationSec: number;
  clipCount: number;
}

// Cloudinary encodes each spliced-in clip as a chained transformation segment
// in the delivery URL. Every segment adds ~40-80 chars (public_id + splice
// flags), and Cloudinary/most CDNs+browsers cap request/transformation URLs
// around 4,000-8,000 chars in practice (Cloudinary's own docs recommend
// staying under ~10 chained transformations for reliability). Past that,
// either the URL gets rejected or renders become slow/unreliable. We guard
// with a conservative practical ceiling rather than the theoretical max.
const MAX_PRACTICAL_CLIPS = 20;

/**
 * Fetches all completed per-shot FalVideoJob clips for a script (ordered by
 * shotIndex), uploads each to Cloudinary as a video asset, and stitches them
 * into a single final video using Cloudinary's fl_splice chained-transformation
 * concatenation. Returns the delivery URL for the stitched result.
 */
export async function assembleScriptVideo(
  scriptId: string,
  opts: AssembleOptions = {}
): Promise<AssembleResult> {
  if (!isCloudinaryConfigured()) {
    throw new Error(
      "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET."
    );
  }

  const jobs = await prisma.falVideoJob.findMany({
    where: { scriptId },
    orderBy: { shotIndex: "asc" },
  });

  if (jobs.length === 0) {
    throw new Error(`No FalVideoJob records found for scriptId "${scriptId}"`);
  }

  // Determine the full set of expected shot indices (max index + 1 slots,
  // 0-indexed) so we can call out any gaps explicitly rather than silently
  // stitching a partial sequence.
  const shotIndices = jobs
    .map((j) => j.shotIndex)
    .filter((i): i is number => i !== null && i !== undefined);
  const maxShot = shotIndices.length > 0 ? Math.max(...shotIndices) : -1;
  const byShot = new Map(jobs.filter((j) => j.shotIndex !== null).map((j) => [j.shotIndex as number, j]));

  const missing: string[] = [];
  const failed: string[] = [];
  const completedInOrder: typeof jobs = [];

  for (let i = 0; i <= maxShot; i++) {
    const job = byShot.get(i);
    if (!job) {
      missing.push(`shot ${i}: no job found`);
      continue;
    }
    if (job.status === "failed") {
      failed.push(`shot ${i}: failed${job.error ? ` (${job.error})` : ""}`);
      continue;
    }
    if (job.status !== "completed" || !job.videoUrl) {
      missing.push(`shot ${i}: status=${job.status}, no videoUrl`);
      continue;
    }
    completedInOrder.push(job);
  }

  if (missing.length > 0 || failed.length > 0) {
    const problems = [...failed, ...missing];
    throw new Error(
      `Cannot assemble script "${scriptId}": ${problems.length} shot(s) not ready — ${problems.join("; ")}`
    );
  }

  if (completedInOrder.length === 0) {
    throw new Error(`No completed shots found for scriptId "${scriptId}"`);
  }

  if (completedInOrder.length > MAX_PRACTICAL_CLIPS) {
    throw new Error(
      `Too many clips to assemble in one Cloudinary transformation chain (${completedInOrder.length} > practical max ${MAX_PRACTICAL_CLIPS}). ` +
        `Cloudinary chained fl_splice transformation URLs grow ~40-80 chars per clip and become unreliable past this point — split into multiple assemblies and concatenate the results, or use a dedicated video-editing backend for long sequences.`
    );
  }

  // 1. Upload each clip URL to Cloudinary as a video asset (remote-URL upload
  //    avoids downloading the bytes through our server).
  const uploads: { publicId: string; durationSec: number }[] = [];
  for (const job of completedInOrder) {
    const res = await cloudinary.uploader.upload(job.videoUrl as string, {
      resource_type: "video",
      folder: "creativeintel/assembled-shots",
    });
    uploads.push({
      publicId: res.public_id,
      durationSec: res.duration ?? job.durationSec ?? 0,
    });
  }

  // 2. Concatenate via chained fl_splice transformations on top of the first
  //    clip as the base video. Each subsequent clip is layered in with
  //    l_video:<public_id> + fl_splice (append after current timeline) +
  //    fl_layer_apply (commit the layer before the next chain link).
  //
  // This endpoint supports cut concatenation. Unsupported transitions are
  // rejected by the route instead of silently changing the requested edit.
  const [base, ...rest] = uploads;
  const transformation: Record<string, unknown>[] = [];

  for (const clip of rest) {
    transformation.push({
      overlay: { resource_type: "video", public_id: clip.publicId },
      flags: "splice",
    });
    transformation.push({ flags: "layer_apply" });
  }

  if (opts.musicUrl) {
    // Overlay a background audio track across the whole spliced timeline.
    // musicUrl is expected to already be a Cloudinary public_id or a URL we
    // can reference the same way other Cloudinary overlays do; if it's a
    // remote URL, it should be uploaded first (left to the caller for now —
    // simple pass-through comment since we don't have an audio-upload helper
    // in this codebase yet).
    transformation.push({
      overlay: { resource_type: "video", public_id: opts.musicUrl },
      flags: "splice,layer_apply",
    });
  }

  const finalUrl = cloudinary.url(base.publicId, {
    resource_type: "video",
    format: "mp4",
    transformation,
    secure: true,
  });

  const durationSec = uploads.reduce((sum, u) => sum + u.durationSec, 0);

  return {
    finalUrl,
    durationSec,
    clipCount: uploads.length,
  };
}

export interface AssemblyReadiness {
  totalShots: number;
  completedCount: number;
  failedCount: number;
  canAssemble: boolean;
}

/**
 * Reports readiness to assemble a script's shots into a final video without
 * performing any Cloudinary work — used by the GET endpoint for polling.
 */
export async function getAssemblyReadiness(scriptId: string): Promise<AssemblyReadiness> {
  const jobs = await prisma.falVideoJob.findMany({
    where: { scriptId },
    orderBy: { shotIndex: "asc" },
  });

  const shotIndices = new Set(
    jobs.map((j) => j.shotIndex).filter((i): i is number => i !== null && i !== undefined)
  );
  const totalShots = shotIndices.size;
  const completedCount = jobs.filter((j) => j.status === "completed" && !!j.videoUrl).length;
  const failedCount = jobs.filter((j) => j.status === "failed").length;

  const maxShot = shotIndices.size > 0 ? Math.max(...shotIndices) : -1;
  const byShot = new Map(jobs.filter((j) => j.shotIndex !== null).map((j) => [j.shotIndex as number, j]));
  let allPresentAndCompleted = maxShot >= 0;
  for (let i = 0; i <= maxShot; i++) {
    const job = byShot.get(i);
    if (!job || job.status !== "completed" || !job.videoUrl) {
      allPresentAndCompleted = false;
      break;
    }
  }

  return {
    totalShots,
    completedCount,
    failedCount,
    canAssemble: allPresentAndCompleted,
  };
}
