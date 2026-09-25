/**
 * Per-shot image-conditioned (image-to-video) generation.
 *
 * For each requested storyboard shot, looks up the shot's keyframe image
 * (persisted by studio/storyboard-keyframes as a PreviewAsset with
 * style = "keyframe-{shotNumber}-script-{scriptId}", shotNumber being
 * 1-based and shotIndex = shotNumber - 1) and, when the target model has an
 * i2v endpoint, submits fal.ai image-to-video conditioned on that frame.
 * Falls back to text-to-video when no keyframe exists or the model has no
 * i2v path (e.g. Veo).
 *
 * Prompts are built via prompt-compiler.ts (toShotSpec + compileForModel) —
 * the same model-aware compiler generate-from-script/route.ts is migrating
 * to — rather than calling cinematic-prompt-builder.ts directly.
 *
 * One FalVideoJob row is persisted per shot with shotIndex set so fal-status
 * can poll it individually.
 */
import { NextResponse } from "next/server";
import { isStrictFree, PaidFeatureDisabledError } from "@/lib/cost-mode";
import { prisma } from "@/lib/db";
import { pMap } from "@/lib/parallel";
import {
  toShotSpec,
  compileForModel,
  type BrandContext,
  type ScriptSceneLike,
} from "@/services/video-gen/prompt-compiler";
import { getVideoModel } from "@/services/video-gen/models";

export const maxDuration = 300;

interface ShotJobResult {
  shotIndex: number;
  jobId?: string;
  mode?: "i2v" | "t2v";
  error?: string;
  skipped?: boolean;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  if (isStrictFree()) {
    return NextResponse.json({ error: new PaidFeatureDisabledError("fal / Veo video generation").message }, { status: 402 });
  }
  try {
    return await handlePost(request, params);
  } catch (err) {
    console.error("generate-shots failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error generating shots" },
      { status: 500 }
    );
  }
}

async function handlePost(
  request: Request,
  paramsPromise: Promise<{ projectId: string }>
) {
  const { projectId } = await paramsPromise;
  const body = await request.json().catch(() => ({}));
  const {
    scriptId,
    model = "grok-imagine-video",
    shots,
    useKeyframes = true,
    force = false,
    aspectRatio = "9:16",
    resolution = "720p",
  } = body as {
    scriptId?: string;
    model?: string;
    shots?: number[];
    useKeyframes?: boolean;
    force?: boolean;
    aspectRatio?: string;
    resolution?: string;
  };

  if (!scriptId) {
    return NextResponse.json({ error: "scriptId required" }, { status: 400 });
  }

  const falKey = process.env.FAL_KEY;
  if (!falKey) return NextResponse.json({ error: "FAL_KEY not configured" }, { status: 500 });

  const modelDef = getVideoModel(model);
  if (!modelDef || modelDef.provider !== "fal") {
    return NextResponse.json(
      { error: `Model "${model}" is not a known fal.ai video model` },
      { status: 422 }
    );
  }

  const [project, script, campaignSel, sellingPoints] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, include: { brand: true } }),
    prisma.script.findUnique({ where: { id: scriptId } }),
    prisma.campaignSelection.findUnique({ where: { projectId } }).catch(() => null),
    prisma.sellingPoint.findMany({
      where: { projectId },
      orderBy: { strength: "desc" },
      take: 5,
    }),
  ]);

  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (!script) return NextResponse.json({ error: "Script not found" }, { status: 404 });

  const scenes = (Array.isArray(script.scenes) ? script.scenes : []) as ScriptSceneLike[];
  if (scenes.length === 0) {
    return NextResponse.json({ error: "Script has no scenes/shots to generate" }, { status: 400 });
  }

  const requestedShots =
    Array.isArray(shots) && shots.length > 0 ? shots : scenes.map((_, i) => i);

  // Keyframes are persisted as PreviewAsset rows by storyboard-keyframes,
  // tagged style = "keyframe-{shotNumber}-script-{scriptId}" (shotNumber is
  // 1-based; shotIndex = shotNumber - 1). Storyboard.frames also carries an
  // imagePrompt per frame but no persisted image URL, so PreviewAsset is the
  // source of truth for the actual generated image.
  const keyframesByShotIndex = new Map<number, string>();
  if (useKeyframes) {
    const previewAssets = await prisma.previewAsset.findMany({
      where: {
        projectId,
        style: { startsWith: "keyframe-" },
        imageUrl: { not: null },
      },
      orderBy: { createdAt: "desc" },
    });

    for (const asset of previewAssets) {
      const match = /^keyframe-(\d+)(?:-script-(.+))?$/.exec(asset.style || "");
      if (!match) continue;
      const shotNumber = Number(match[1]);
      const taggedScriptId = match[2];
      if (taggedScriptId && taggedScriptId !== scriptId) continue;
      const shotIndex = shotNumber - 1;
      if (!asset.imageUrl) continue;
      // Rows are ordered desc by createdAt — first hit per shotIndex wins,
      // and a scriptId-tagged hit always overrides an untagged one.
      const alreadyTagged = keyframesByShotIndex.has(shotIndex) && taggedScriptId === scriptId;
      if (!keyframesByShotIndex.has(shotIndex) || alreadyTagged) {
        keyframesByShotIndex.set(shotIndex, asset.imageUrl);
      }
    }
  }

  const productName =
    project.productPageTitle || project.productName || project.brand?.valueProposition || project.brandName;
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

  const results = await pMap(
    requestedShots,
    async (shotIndex): Promise<ShotJobResult> => {
      try {
        const scene = scenes[shotIndex];
        if (!scene) {
          return { shotIndex, error: `No scene found at shotIndex ${shotIndex}` };
        }

        // Idempotency: skip shots that already have a non-failed job for the
        // same scriptId + shotIndex + promptVersion, unless force = true.
        if (!force) {
          const existing = await prisma.falVideoJob.findFirst({
            where: {
              projectId,
              scriptId,
              shotIndex,
              promptVersion: 1,
              status: { not: "failed" },
            },
          });
          if (existing) {
            return { shotIndex, jobId: existing.id, skipped: true };
          }
        }

        const shotSpec = toShotSpec(scene, script, brandContext, shotIndex);
        const [compiled] = compileForModel([shotSpec], brandContext, model, {
          aspectRatio,
          resolution,
        });

        const keyframeUrl = keyframesByShotIndex.get(shotIndex);
        const useI2v = Boolean(keyframeUrl && modelDef.i2vEndpoint);
        const submitEndpoint = useI2v ? modelDef.i2vEndpoint! : modelDef.submitEndpoint;
        const mode: "i2v" | "t2v" = useI2v ? "i2v" : "t2v";

        const payload: Record<string, unknown> = {
          prompt: compiled.prompt,
          ...compiled.params,
        };
        if (compiled.negativePrompt) payload.negative_prompt = compiled.negativePrompt;
        if (compiled.audioPrompt) payload.enable_audio = true;
        if (useI2v) {
          payload[modelDef.imageParamName || "image_url"] = keyframeUrl;
        }

        const falRes = await fetch(`https://queue.fal.run/${submitEndpoint}`, {
          method: "POST",
          headers: {
            Authorization: `Key ${falKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(20000),
        });

        if (!falRes.ok) {
          const err = await falRes.text().catch(() => "unknown");
          return { shotIndex, error: `fal.ai ${falRes.status}: ${err.slice(0, 200)}` };
        }

        const falData = await falRes.json();
        const falRequestId = falData.request_id;
        if (!falRequestId) {
          return { shotIndex, error: "fal.ai response missing request_id" };
        }

        const shotDurationSec = (compiled.params.duration as number | undefined) ?? shotSpec.durationSec;

        const job = await prisma.falVideoJob.create({
          data: {
            projectId,
            falRequestId,
            model,
            // Store the submit endpoint as a recoverable marker so fal-status
            // can resolve the correct status endpoint for i2v jobs — FalVideoJob
            // has no dedicated "mode"/"submitEndpoint" column (see fal-status
            // route.ts, which strips this marker before displaying the prompt).
            prompt: `[[endpoint:${submitEndpoint}]]${compiled.prompt}`.slice(0, 10000),
            aspectRatio,
            resolution,
            duration: shotDurationSec,
            scriptId,
            shotIndex,
            promptVersion: 1,
            costUsd: modelDef.costPerSecond * shotDurationSec,
            status: "queued",
          },
        });

        return { shotIndex, jobId: job.id, mode };
      } catch (err) {
        return {
          shotIndex,
          error: err instanceof Error ? err.message : "Unknown error generating shot",
        };
      }
    },
    { concurrency: 3 }
  );

  return NextResponse.json({ jobs: results });
}
