/**
 * Enqueue / list BrowserGenJob rows for a project.
 *
 * POST supports two request shapes:
 *   { mode: "single", kind, site, prompt, negativePrompt?, inputImageUrl?,
 *     aspectRatio?, durationSec?, model? }
 *   { mode: "from-script", scriptId, site, kind, shots?: number[], force?: boolean }
 *
 * "from-script" compiles one job per requested shot via toShotSpec +
 * compileForModel (the same model-aware compiler studio/generate-shots and
 * studio/generate-from-script use), reusing the small keyframe lookup
 * reimplemented in services/video-gen/browser-queue.ts (NOT imported from
 * studio/generate-shots/route.ts, which is off-limits to edit/import).
 *
 * GET ?scriptId=... lists jobs for that script with status counts.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { findActiveStoryboard } from "@/services/creative-library";
import {
  enqueueBrowserJob,
  findExistingShotJob,
  getJobsWithStatusCounts,
  lookupKeyframesByShotIndex,
} from "@/services/video-gen/browser-queue";
import {
  toShotSpec,
  compileForModel,
  type BrandContext,
  type ScriptSceneLike,
} from "@/services/video-gen/prompt-compiler";

export const maxDuration = 60;

type BrowserSite = "ai_studio" | "flow" | "kling";
type BrowserKind = "image_keyframe" | "video";

/**
 * Model-key mapping used for from-script compilation. AI Studio (Nano
 * Banana) is an image tool, not registered in models.ts's video model
 * registry — image jobs skip compileForModel entirely and use the shot's
 * storyboard imagePrompt directly (or a compiled fallback, see below).
 * Video sites map to a fixed default model per site; the request body may
 * still override via top-level `model`.
 */
const DEFAULT_VIDEO_MODEL_BY_SITE: Record<Extract<BrowserSite, "flow" | "kling">, string> = {
  flow: "veo-3.1-fast",
  kling: "kling-v3-pro",
};

interface SingleBody {
  mode: "single";
  kind: BrowserKind;
  site: BrowserSite;
  prompt: string;
  negativePrompt?: string;
  inputImageUrl?: string;
  aspectRatio?: string;
  durationSec?: number;
  model?: string;
}

interface FromScriptBody {
  mode: "from-script";
  scriptId: string;
  site: BrowserSite;
  kind: BrowserKind;
  shots?: number[];
  model?: string;
  force?: boolean;
  aspectRatio?: string;
  resolution?: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    return await handlePost(request, params);
  } catch (err) {
    console.error("browser-jobs POST failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error creating browser job(s)" },
      { status: 500 }
    );
  }
}

async function handlePost(
  request: Request,
  paramsPromise: Promise<{ projectId: string }>
) {
  const { projectId } = await paramsPromise;
  const body = (await request.json().catch(() => ({}))) as
    | SingleBody
    | FromScriptBody
    | Record<string, never>;

  if (!("mode" in body) || (body.mode !== "single" && body.mode !== "from-script")) {
    return NextResponse.json(
      { error: 'body.mode must be "single" or "from-script"' },
      { status: 400 }
    );
  }

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  if (body.mode === "single") {
    return handleSingle(projectId, body);
  }

  return handleFromScript(projectId, body);
}

async function handleSingle(projectId: string, body: SingleBody) {
  const { kind, site, prompt } = body;

  if (!kind || !site || !prompt) {
    return NextResponse.json(
      { error: "kind, site, and prompt are required for mode: single" },
      { status: 400 }
    );
  }

  const job = await enqueueBrowserJob({
    projectId,
    kind,
    site,
    prompt,
    negativePrompt: body.negativePrompt,
    inputImageUrl: body.inputImageUrl,
    aspectRatio: body.aspectRatio,
    durationSec: body.durationSec,
    model: body.model,
  });

  return NextResponse.json({ created: [job], skipped: [] });
}

async function handleFromScript(projectId: string, body: FromScriptBody) {
  const { scriptId, site, kind, force = false } = body;

  if (!scriptId || !site || !kind) {
    return NextResponse.json(
      { error: "scriptId, site, and kind are required for mode: from-script" },
      { status: 400 }
    );
  }

  const [project, script, campaignSel, sellingPoints, storyboard] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, include: { brand: true } }),
    prisma.script.findUnique({ where: { id: scriptId } }),
    prisma.campaignSelection.findUnique({ where: { projectId } }).catch(() => null),
    prisma.sellingPoint.findMany({
      where: { projectId },
      orderBy: { strength: "desc" },
      take: 5,
    }),
    findActiveStoryboard(projectId, scriptId),
  ]);

  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (!script) return NextResponse.json({ error: "Script not found" }, { status: 404 });

  const scenes = (Array.isArray(script.scenes) ? script.scenes : []) as ScriptSceneLike[];
  if (scenes.length === 0) {
    return NextResponse.json({ error: "Script has no scenes/shots to generate" }, { status: 400 });
  }

  const requestedShots =
    Array.isArray(body.shots) && body.shots.length > 0
      ? body.shots
      : scenes.map((_, i) => i);

  // Storyboard.frames carries a persisted imagePrompt per frame (1-based
  // frameNumber; shotIndex = frameNumber - 1) — see storyboard-grid.ts
  // GridFrame. Used as the preferred prompt source for image_keyframe jobs.
  const frames = (Array.isArray(storyboard?.frames) ? storyboard!.frames : []) as {
    frameNumber?: number;
    imagePrompt?: string;
  }[];
  const imagePromptByShotIndex = new Map<number, string>();
  for (const f of frames) {
    if (typeof f.frameNumber === "number" && f.imagePrompt) {
      imagePromptByShotIndex.set(f.frameNumber - 1, f.imagePrompt);
    }
  }

  const keyframesByShotIndex = await lookupKeyframesByShotIndex(projectId, scriptId);

  const productName =
    project.productName || project.productPageTitle || project.brand?.valueProposition || project.brandName;
  const brandContext: BrandContext = {
    brandName: project.brandName,
    productName: productName || project.brandName,
    productCategory: project.category || project.brand?.productCategory || "",
    keySellingPoints: [
      ...sellingPoints.map((sp) => sp.point),
      ...(Array.isArray(campaignSel?.selectedSellingPoints)
        ? (campaignSel.selectedSellingPoints as { point: string }[]).map((s) => s.point)
        : []),
    ].slice(0, 5),
    mustNotAppear: [],
  };

  const aspectRatio = body.aspectRatio ?? "9:16";
  const resolution = body.resolution ?? "720p";

  // modelKey mapping:
  //  - site ai_studio -> kind image_keyframe: no video model needed; uses the
  //    storyboard frame's imagePrompt when present, else falls back to the
  //    compiled prompt from a generic model (used only for text assembly,
  //    never submitted to a video provider).
  //  - site flow -> veo-3.1-fast
  //  - site kling -> kling-v3-pro
  // Request body `model` overrides these defaults when provided.
  const videoModelKey =
    body.model ??
    (site === "flow" || site === "kling" ? DEFAULT_VIDEO_MODEL_BY_SITE[site] : "veo-3.1-fast");

  const created: unknown[] = [];
  const skipped: unknown[] = [];

  for (const shotIndex of requestedShots) {
    const scene = scenes[shotIndex];
    if (!scene) {
      skipped.push({ shotIndex, reason: "No scene found at this shotIndex" });
      continue;
    }

    if (!force) {
      const existing = await findExistingShotJob({ projectId, scriptId, shotIndex, kind, site });
      if (existing) {
        skipped.push({ shotIndex, jobId: existing.id, reason: "already exists (non-failed)" });
        continue;
      }
    }

    const shotSpec = toShotSpec(scene, script, brandContext, shotIndex);
    const keyframeUrl = keyframesByShotIndex.get(shotIndex);

    if (kind === "image_keyframe") {
      // Prefer the storyboard's own imagePrompt (already restates the full
      // style bible per storyboard.ts's prompt contract); fall back to the
      // compiler's assembled prompt (positive only — image gen has no
      // negative-prompt/model-param plumbing here).
      const storyboardPrompt = imagePromptByShotIndex.get(shotIndex);
      const prompt =
        storyboardPrompt ||
        compileForModel([shotSpec], brandContext, videoModelKey, { aspectRatio, resolution })[0]
          .prompt;

      const job = await enqueueBrowserJob({
        projectId,
        kind: "image_keyframe",
        site,
        model: body.model ?? null,
        prompt,
        aspectRatio,
        scriptId,
        shotIndex,
        promptVersion: 1,
      });
      created.push(job);
      continue;
    }

    // kind === "video"
    const [compiled] = compileForModel([shotSpec], brandContext, videoModelKey, {
      aspectRatio,
      resolution,
    });

    const job = await enqueueBrowserJob({
      projectId,
      kind: "video",
      site,
      model: videoModelKey,
      prompt: compiled.prompt,
      negativePrompt: compiled.negativePrompt,
      // Set inputImageUrl for video jobs when a keyframe exists for this shot.
      inputImageUrl: keyframeUrl,
      aspectRatio,
      durationSec: (compiled.params.duration as number | undefined) ?? shotSpec.durationSec,
      scriptId,
      shotIndex,
      promptVersion: 1,
    });
    created.push(job);
  }

  return NextResponse.json({ created, skipped });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    await params; // ensure route shape validated even though unused directly
    const { searchParams } = new URL(request.url);
    const scriptId = searchParams.get("scriptId");

    if (!scriptId) {
      return NextResponse.json({ error: "scriptId query param required" }, { status: 400 });
    }

    const { jobs, statusCounts } = await getJobsWithStatusCounts(scriptId);
    return NextResponse.json({ jobs, statusCounts });
  } catch (err) {
    console.error("browser-jobs GET failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error listing browser jobs" },
      { status: 500 }
    );
  }
}
