/**
 * Ad Studio in Studio.
 * GET  ?storyboardId= — this project's Ad Studio runs + the pick lists (hook types, engines) + scripts without a storyboard.
 *      &runsOnly=1 — just {runs, workerOnline} (the panel's poll).
 *      storyboardId may be `script:<scriptId>` (P3: start from a Creative script, adstudio-script-frames.ts).
 * POST {storyboardId, hookTypes[], engines[], workflow?, openingId?, endCardId?, endCardTheme?, format?, branding?, offer?, notes?} — one run per
 *      hook type × engine (max 6). storyboardId may be `ref:<video url>` for the reference workflows.
 *      Nothing is spent here: the Mac worker plans each variant and stops for approval.
 */
import { NextResponse } from "next/server";
import { withAccess } from "@/lib/auth/route-guard";
import { ACTOR_HEADER } from "@/lib/auth/actor";
import { ADSTUDIO_ENGINES, ADSTUDIO_FORMATS, ADSTUDIO_HOOK_TYPES, ADSTUDIO_MAX_VARIANTS, ADSTUDIO_WORKFLOWS, END_CARD_THEMES, OPENING_STYLE, AdStudioPickError } from "@/services/video-gen/adstudio-catalog";
import { END_CARDS, HOOKS } from "@/services/creative/library";
import { REF_SOURCE, planDefaults } from "@/services/video-gen/adstudio-queue";
import { HOOK_CLIPS, END_CLIPS } from "@/services/video-gen/adstudio-clips";
import { AdStudioError, createBatch, listRuns } from "@/services/video-gen/adstudio-queue";
import { isWorkerOnline } from "@/services/video-gen/adstudio-worker-status";
import { loadXarkContext, summarizeContext } from "@/services/video-gen/adstudio-context";
import { prisma } from "@/lib/db";
import { SCRIPT_SOURCE, framesFromScript, scriptIdOf } from "@/services/video-gen/adstudio-script-frames";

export const dynamic = "force-dynamic";

async function unguardedGET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const url = new URL(request.url);
  const storyboardId = url.searchParams.get("storyboardId");
  // the panel's 5 s poll only needs the runs: no catalogs, scripts or research context (was ~75 KB and ~15 queries per tick)
  if (url.searchParams.get("runsOnly") === "1") {
    const [runs, workerOnline] = await Promise.all([listRuns(projectId, storyboardId), isWorkerOnline()]);
    return NextResponse.json({ runs, workerOnline });
  }
  const fromScript = storyboardId ? scriptIdOf(storyboardId) : null;
  const sb = storyboardId && !fromScript ? await prisma.storyboard.findFirst({ where: { id: storyboardId, projectId }, select: { scriptId: true } }) : null;
  const [runs, workerOnline, context, scripts, boards, plan] = await Promise.all([
    listRuns(projectId, storyboardId), isWorkerOnline(),
    loadXarkContext(projectId, fromScript ?? sb?.scriptId ?? null),
    prisma.script.findMany({
      where: { projectId, deletedAt: null },
      orderBy: [{ status: "desc" }, { createdAt: "desc" }],
      take: 30,
      select: { id: true, title: true, status: true, scenes: true, hook: true, bodyBeats: true, cta: true, hookVariants: true, selectedHookIdx: true, body: true, ctaVariants: true, selectedCtaIdx: true },
    }),
    prisma.storyboard.findMany({ where: { projectId, deletedAt: null, scriptId: { not: null } }, select: { scriptId: true } }),
    prisma.project.findUnique({ where: { id: projectId }, select: { campaignPlan: true } }),
  ]);
  const boarded = new Set(boards.map((b) => b.scriptId));
  const scriptSources = scripts
    .filter((x) => !boarded.has(x.id))
    .map((x) => ({ id: `${SCRIPT_SOURCE}${x.id}`, title: x.title.replace(/^⚠\s*/, ""), selected: x.status === "selected", frames: framesFromScript(x) }))
    .filter((x) => x.frames.length);
  // reference videos for "Imitate" / "Imitate + replace": the competitor ads Research found with a video link
  const refs = ((context.research as { rhythmRefs?: { title?: string; score?: number; videoUrl?: string; pageUrl?: string }[] } | undefined)?.rhythmRefs ?? [])
    .map((r) => ({ id: `${REF_SOURCE}${r.pageUrl ?? r.videoUrl}`, title: r.title ?? "Competitor ad", score: r.score ?? null }));
  return NextResponse.json({
    runs, workerOnline, hookTypes: ADSTUDIO_HOOK_TYPES, engines: ADSTUDIO_ENGINES, maxVariants: ADSTUDIO_MAX_VARIANTS,
    carried: storyboardId ? summarizeContext(context) : null, scripts: scriptSources, references: refs,
    workflows: ADSTUDIO_WORKFLOWS, formats: ADSTUDIO_FORMATS,
    openings: HOOKS.map((h) => ({ id: h.id, name: h.name, family: h.family, enforced: OPENING_STYLE[h.id] ?? null, desc: h.desc, motion: h.motion, durationSec: h.durationSec })),
    endCards: END_CARDS.map((e) => ({ id: e.id, name: e.name, useFor: e.useFor })), endCardThemes: END_CARD_THEMES,
    // what "Auto" resolves to (the campaign plan's picks) and the real example clips per hook / end card
    auto: planDefaults(plan?.campaignPlan), hookClips: HOOK_CLIPS, endClips: END_CLIPS,
  });
}

async function unguardedPOST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    storyboardId?: string;
    hookTypes?: string[];
    engines?: string[];
    offer?: { text?: string; was?: number | null; now?: number | null; code?: string };
    notes?: string;
    workflow?: string;
    openingId?: string;
    endCardId?: string;
    endCardTheme?: string;
    format?: string;
    visualMode?: string;
    branding?: unknown;
  };
  if (!body.storyboardId) return NextResponse.json({ error: "storyboardId required" }, { status: 400 });
  try {
    const { batchId, runs } = await createBatch({
      projectId,
      storyboardId: body.storyboardId,
      hookTypes: Array.isArray(body.hookTypes) ? body.hookTypes : [],
      engines: Array.isArray(body.engines) ? body.engines : [],
      offer: body.offer,
      workflow: body.workflow, openingId: body.openingId, endCardId: body.endCardId, endCardTheme: body.endCardTheme, format: body.format, branding: body.branding, visualMode: body.visualMode,
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
