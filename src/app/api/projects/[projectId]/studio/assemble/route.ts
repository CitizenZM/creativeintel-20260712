import { safePublicError } from "@/lib/public-error";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { assembleScriptVideo, getAssemblyReadiness } from "@/services/video-gen/assemble";
import { withAccess } from "@/lib/auth/route-guard";

// Cloudinary concatenation itself is URL-based and fast, but uploading each
// remote clip URL into Cloudinary (cloudinary.uploader.upload) happens
// synchronously per clip and can take several seconds each. For a typical
// script (a handful of shots) this stays well under 60s, so we run inline
// rather than adding a RenderJob/waitUntil hop — but we set maxDuration to
// 300 (the largest per-route ceiling in this codebase is 60s; assembly can
// involve multiple sequential video uploads so we give it more headroom)
// to avoid truncating on scripts with many shots.
export const maxDuration = 300;

const bodySchema = z.object({
  scriptId: z.string().min(1, "scriptId required"),
  transition: z.enum(["cut", "crossfade"]).optional(),
  musicUrl: z.string().optional(),
});

async function unguardedPOST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const { scriptId, transition, musicUrl } = parsed.data;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const script = await prisma.script.findUnique({
    where: { id: scriptId },
    select: { id: true, projectId: true, title: true },
  });
  if (!script || script.projectId !== projectId) {
    return NextResponse.json({ error: "Script not found for this project" }, { status: 404 });
  }

  try {
    const result = await assembleScriptVideo(scriptId, { transition, musicUrl });

    // Persist the final stitched video. ContentAsset is the most natural home:
    // Script has no video-URL field of its own (its `scenes` Json is script
    // structure, not a render output), and ContentAsset already models
    // "a video artifact belonging to this project" with a unique
    // (projectId, url) constraint, a `type` enum, and a `rawData` Json bucket
    // for metadata — exactly the shape of a finished assembled ad. PreviewAsset
    // was considered but is scoped to still-image previews (imageUrl, style,
    // dimensions), not video.
    const asset = await prisma.contentAsset.upsert({
      where: { projectId_url: { projectId, url: result.finalUrl } },
      create: {
        projectId,
        type: "WEB_MENTION",
        title: script.title ? `${script.title} — Final Assembly` : "Assembled Final Video",
        url: result.finalUrl,
        isBrandOwned: true,
        dataSource: "AI_INFERRED",
        rawData: {
          kind: "assembled_final_video",
          scriptId,
          clipCount: result.clipCount,
          durationSec: result.durationSec,
          transition: transition ?? "cut",
        } as never,
      },
      update: {
        rawData: {
          kind: "assembled_final_video",
          scriptId,
          clipCount: result.clipCount,
          durationSec: result.durationSec,
          transition: transition ?? "cut",
        } as never,
      },
    });

    return NextResponse.json({
      finalUrl: result.finalUrl,
      durationSec: result.durationSec,
      clipCount: result.clipCount,
      contentAssetId: asset.id,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safePublicError(err) },
      { status: 422 }
    );
  }
}

async function unguardedGET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const url = new URL(request.url);
  const scriptId = url.searchParams.get("scriptId");
  if (!scriptId) {
    return NextResponse.json({ error: "scriptId query param required" }, { status: 400 });
  }

  const script = await prisma.script.findUnique({
    where: { id: scriptId },
    select: { id: true, projectId: true },
  });
  if (!script || script.projectId !== projectId) {
    return NextResponse.json({ error: "Script not found for this project" }, { status: 404 });
  }

  try {
    const readiness = await getAssemblyReadiness(scriptId);
    return NextResponse.json(readiness);
  } catch (err) {
    return NextResponse.json(
      { error: safePublicError(err) },
      { status: 500 }
    );
  }
}

export const POST = withAccess(unguardedPOST);
export const GET = withAccess(unguardedGET);
