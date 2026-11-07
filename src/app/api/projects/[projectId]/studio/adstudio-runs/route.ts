/**
 * Ad Studio in Studio.
 * GET  ?storyboardId= — this project's Ad Studio runs + the pick lists (hook types, engines).
 * POST {storyboardId, hookTypes[], engines[], offer?, notes?} — one run per hook type × engine (max 6).
 *      Nothing is spent here: the Mac worker plans each variant and stops for approval.
 */
import { NextResponse } from "next/server";
import { withAccess } from "@/lib/auth/route-guard";
import { ACTOR_HEADER } from "@/lib/auth/actor";
import { ADSTUDIO_ENGINES, ADSTUDIO_HOOK_TYPES, ADSTUDIO_MAX_VARIANTS, AdStudioPickError } from "@/services/video-gen/adstudio-catalog";
import { AdStudioError, createBatch, listRuns } from "@/services/video-gen/adstudio-queue";
import { isWorkerOnline } from "@/services/video-gen/adstudio-worker-status";

export const dynamic = "force-dynamic";

async function unguardedGET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const storyboardId = new URL(request.url).searchParams.get("storyboardId");
  const [runs, workerOnline] = await Promise.all([listRuns(projectId, storyboardId), isWorkerOnline()]);
  return NextResponse.json({ runs, workerOnline, hookTypes: ADSTUDIO_HOOK_TYPES, engines: ADSTUDIO_ENGINES, maxVariants: ADSTUDIO_MAX_VARIANTS });
}

async function unguardedPOST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    storyboardId?: string;
    hookTypes?: string[];
    engines?: string[];
    offer?: { text?: string; was?: number | null; now?: number | null; code?: string };
    notes?: string;
  };
  if (!body.storyboardId) return NextResponse.json({ error: "storyboardId required" }, { status: 400 });
  try {
    const { batchId, runs } = await createBatch({
      projectId,
      storyboardId: body.storyboardId,
      hookTypes: Array.isArray(body.hookTypes) ? body.hookTypes : [],
      engines: Array.isArray(body.engines) ? body.engines : [],
      offer: body.offer,
      notes: typeof body.notes === "string" ? body.notes.slice(0, 2000) : undefined,
      createdById: request.headers.get(ACTOR_HEADER),
    });
    return NextResponse.json({ batchId, runIds: runs.map((r) => r.id) }, { status: 201 });
  } catch (err) {
    if (err instanceof AdStudioPickError) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof AdStudioError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

export const GET = withAccess(unguardedGET);
export const POST = withAccess(unguardedPOST);
