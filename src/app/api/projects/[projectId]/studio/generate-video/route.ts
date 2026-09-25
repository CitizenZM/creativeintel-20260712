import { NextResponse } from "next/server";
import { isStrictFree, PaidFeatureDisabledError } from "@/lib/cost-mode";
import { prisma } from "@/lib/db";
import { getVideoModel, VIDEO_MODELS } from "@/services/video-gen/models";

export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  if (isStrictFree()) {
    return NextResponse.json({ error: new PaidFeatureDisabledError("fal / Veo video generation").message }, { status: 402 });
  }
  const { projectId } = await params;
  const body = await request.json().catch(() => ({}));
  const {
    prompt,
    model = "grok-imagine-video",
    aspectRatio = "9:16",
    resolution = "720p",
    duration = 5,
    scriptId,
    shotIndex,
  } = body as {
    prompt: string;
    model?: string;
    aspectRatio?: string;
    resolution?: string;
    duration?: number;
    scriptId?: string;
    shotIndex?: number;
  };

  if (!prompt) return NextResponse.json({ error: "prompt required" }, { status: 400 });

  const falKey = process.env.FAL_KEY;
  const modelDef = getVideoModel(model);
  const falModel = modelDef?.provider === "fal" ? modelDef : undefined;

  // Use fal.ai if key present and model known
  if (falKey && falModel) {
    try {
      const payload: Record<string, unknown> = {
        prompt,
        aspect_ratio: aspectRatio,
        resolution,
        duration,
      };
      if (falModel.supportsAudio) payload.enable_audio = true;

      const res = await fetch(`https://queue.fal.run/${falModel.submitEndpoint}`, {
        method: "POST",
        headers: {
          Authorization: `Key ${falKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`fal.ai ${res.status}: ${err.slice(0, 200)}`);
      }

      const data = await res.json();
      const falRequestId = data.request_id;
      if (!falRequestId) {
        // falRequestId is a required @unique column — never persist undefined.
        throw new Error("fal.ai response missing request_id");
      }

      // Persist to DB
      const job = await prisma.falVideoJob.create({
        data: {
          projectId,
          falRequestId,
          model,
          prompt,
          aspectRatio,
          resolution,
          duration,
          scriptId,
          shotIndex,
          costUsd: falModel.costPerSecond * duration,
          status: "queued",
        },
      });

      return NextResponse.json({
        jobId: job.id,
        falRequestId,
        model,
        engine: "fal",
        statusUrl: data.status_url,
        status: "queued",
      });
    } catch (err) {
      console.error("fal.ai generation failed:", err);
      // Fall through to Veo fallback
    }
  }

  // Fallback: Veo
  const googleKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!googleKey) {
    return NextResponse.json({ error: "No video generation API key configured (FAL_KEY or GOOGLE_API_KEY)" }, { status: 500 });
  }

  const veoModelKey = modelDef?.provider === "veo" ? modelDef.key : "veo-3.1-fast";
  const veoModel = VIDEO_MODELS[veoModelKey];
  const veoModelId = veoModel.submitEndpoint;
  const veoRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${veoModelId}:predictLongRunning`,
    {
      method: "POST",
      headers: { "x-goog-api-key": googleKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: { aspectRatio, resolution, durationSeconds: duration },
      }),
    }
  );

  if (!veoRes.ok) {
    const err = await veoRes.text();
    return NextResponse.json({ error: `Veo error: ${veoRes.status}`, details: err }, { status: veoRes.status });
  }

  const veoData = await veoRes.json();
  const operationId = veoData.name as string | undefined;

  if (operationId) {
    // Persist a FalVideoJob row so video-status can later record the completed
    // video URL. There is no dedicated "provider" field on FalVideoJob, so we
    // reuse falRequestId (required + unique) to store the Veo operation id,
    // and `model` to store the veo model key (e.g. "veo-3.1-fast") so status
    // lookups can resolve provider/endpoint via the shared registry.
    try {
      await prisma.falVideoJob.create({
        data: {
          projectId,
          falRequestId: operationId,
          model: veoModelKey,
          prompt,
          aspectRatio,
          resolution,
          duration,
          scriptId,
          shotIndex,
          costUsd: veoModel.costPerSecond * duration,
          status: "generating",
        },
      });
    } catch (err) {
      // Non-fatal: if persistence fails (e.g. duplicate operationId), still
      // return the operationId to the client so polling can proceed.
      console.error("Failed to persist Veo FalVideoJob row:", err);
    }
  }

  return NextResponse.json({
    operationId,
    model: veoModelId,
    engine: "veo",
    projectId,
    status: "generating",
  });
}
