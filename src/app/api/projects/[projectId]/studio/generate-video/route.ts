import { enqueueRender } from "@/services/video-gen/render-dispatch";
import { NextResponse } from "next/server";
import { allowanceRefusalBody, assertAccountAllowance } from "@/services/ops/account-allowance";
import { isStrictFree, PaidFeatureDisabledError } from "@/lib/cost-mode";
import { loadAiSettings } from "@/services/settings/ai-settings";
import { prisma } from "@/lib/db";
import { getVideoModel, VIDEO_MODELS } from "@/services/video-gen/models";
import { withAccess } from "@/lib/auth/route-guard";
import { bachConfigured, submitBachVideo } from "@/services/video-gen/bach";
import { createHash, randomUUID } from "node:crypto";
import { videoRequestSchema } from "@/services/video-gen/video-request";

export const maxDuration = 60;

async function unguardedPOST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  await loadAiSettings();
  if (isStrictFree()) {
    return NextResponse.json({ error: new PaidFeatureDisabledError("fal / Veo video generation").message }, { status: 402 });
  }
  const { projectId } = await params;
  const parsed = videoRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid video generation request", issues: parsed.error.issues }, { status: 400 });
  const { prompt, aspectRatio, resolution, duration, scriptId, shotIndex, imageUrl, endImageUrl } = parsed.data;
  const model = parsed.data.model ?? (process.env.BACH_ACCESS_KEY && process.env.BACH_SECRET_KEY ? "bach-chrome" : "grok-imagine-video");

  const falKey = process.env.FAL_KEY;
  const modelDef = getVideoModel(model);
  if (!modelDef) return NextResponse.json({ error: "Unknown video model" }, { status: 400 });
  if (prompt.length > modelDef.maxPromptChars) return NextResponse.json({ error: "Prompt exceeds model limit" }, { status: 400 });
  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (idempotencyKey && idempotencyKey.length > 128) return NextResponse.json({ error: "Idempotency-Key is too long" }, { status: 400 });
  const submissionKey = idempotencyKey
    ? createHash("sha256").update(`${projectId}\0${idempotencyKey}`).digest("hex")
    : undefined;
  const submissionInputHash = createHash("sha256").update(JSON.stringify({ prompt, model, aspectRatio, resolution, duration, scriptId, shotIndex, imageUrl, endImageUrl })).digest("hex");
  const replayJob = (existing: { id: string; falRequestId: string; submissionInputHash: string | null; status: string }) => {
    if (existing.submissionInputHash !== submissionInputHash) {
      return NextResponse.json({ error: "Idempotency-Key was already used for different video input" }, { status: 409 });
    }
    return NextResponse.json({ jobId: existing.id, operationId: existing.falRequestId.startsWith("pending:") ? undefined : existing.falRequestId, model, status: existing.status }, { status: 200, headers: { "Idempotency-Replay": "true" } });
  };
  if (submissionKey) {
    const existing = await prisma.falVideoJob.findUnique({ where: { submissionKey } });
    if (existing) return replayJob(existing);
  }

  // fal / Veo are called directly here (no spend ledger): check the member account's allowance first.
  try {
    await assertAccountAllowance(projectId, (modelDef?.costPerSecond ?? 0.5) * (Number(duration) || 5), { kind: "video", model });
  } catch (err) {
    const refusal = allowanceRefusalBody(err);
    if (refusal) return NextResponse.json(refusal, { status: 402 });
    throw err;
  }
  const falModel = modelDef?.provider === "fal" ? modelDef : undefined;

  // Persist the intent before calling a paid provider. The temporary unique ID is
  // replaced with the provider task ID as soon as submission succeeds.
  let created = true;
  const pendingJob = await prisma.falVideoJob.create({
    data: {
      projectId, submissionKey, submissionInputHash, falRequestId: `pending:${randomUUID()}`, model, prompt,
      aspectRatio, resolution, duration, scriptId, shotIndex,
      costUsd: (modelDef.costPerSecond ?? 0.5) * duration,
      status: "submitting",
    },
  }).catch(async (error) => {
    if (!submissionKey) throw error;
    const existing = await prisma.falVideoJob.findUnique({ where: { submissionKey } });
    if (!existing) throw error;
    created = false;
    return existing;
  });
  if (!created) return replayJob(pendingJob);

  if (modelDef?.provider === "bach") {
    if (!bachConfigured()) {
      await prisma.falVideoJob.update({ where: { id: pendingJob.id }, data: { status: "failed", error: "Bach API is not configured" } });
      return NextResponse.json({ error: "Bach API is not configured" }, { status: 503 });
    }
    try {
      const taskId = await submitBachVideo({ prompt, duration, aspectRatio, resolution, imageUrl, endImageUrl });
      await prisma.falVideoJob.update({ where: { id: pendingJob.id }, data: { falRequestId: taskId, status: "generating" } });
      await enqueueRender("video", pendingJob.id).catch((error) => console.error("Bach render dispatch failed", error));
      return NextResponse.json({ jobId: pendingJob.id, operationId: taskId, model, engine: "bach", status: "queued" });
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 500) : "Submission failed";
      await prisma.falVideoJob.update({ where: { id: pendingJob.id }, data: { status: "submission_unknown", error: reason } }).catch(console.error);
      return NextResponse.json({ error: "Video submission could not be confirmed", jobId: pendingJob.id }, { status: 502 });
    }
  }

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
        signal: AbortSignal.timeout(30_000),
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

      await prisma.falVideoJob.update({ where: { id: pendingJob.id }, data: { falRequestId, status: "queued" } });
      await enqueueRender("video", pendingJob.id).catch((error) => console.error("Render dispatch failed", error));
      return NextResponse.json({
        jobId: pendingJob.id,
        falRequestId,
        model,
        engine: "fal",
        statusUrl: data.status_url,
        status: "queued",
      });
    } catch (err) {
      console.error("fal.ai generation failed:", err);
      // A timed-out submit may already have created a paid task. Never submit a
      // second provider task automatically without knowing the first outcome.
      const reason = err instanceof Error ? err.message.slice(0, 500) : "Submission failed";
      await prisma.falVideoJob.update({ where: { id: pendingJob.id }, data: { status: "submission_unknown", error: reason } }).catch(console.error);
      return NextResponse.json({ error: "Video submission could not be confirmed", jobId: pendingJob.id }, { status: 502 });
    }
  }

  // Fallback: Veo
  const googleKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!googleKey) {
    await prisma.falVideoJob.update({ where: { id: pendingJob.id }, data: { status: "failed", error: "Veo API key is not configured" } });
    return NextResponse.json({ error: "No video generation API key configured (FAL_KEY or GOOGLE_API_KEY)" }, { status: 500 });
  }

  const veoModelKey = modelDef?.provider === "veo" ? modelDef.key : "veo-3.1-fast";
  const veoModel = VIDEO_MODELS[veoModelKey];
  const veoModelId = veoModel.submitEndpoint;
  let veoRes: Response;
  try {
    veoRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${veoModelId}:predictLongRunning`,
    {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
      headers: { "x-goog-api-key": googleKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: { aspectRatio, resolution, durationSeconds: duration },
      }),
    }
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 500) : "Veo submission failed";
    await prisma.falVideoJob.update({ where: { id: pendingJob.id }, data: { status: "submission_unknown", error: reason } });
    return NextResponse.json({ error: "Video submission could not be confirmed", jobId: pendingJob.id }, { status: 502 });
  }

  if (!veoRes.ok) {
    const err = await veoRes.text();
    await prisma.falVideoJob.update({ where: { id: pendingJob.id }, data: { status: "failed", error: `Veo ${veoRes.status}: ${err.slice(0, 300)}` } });
    return NextResponse.json({ error: `Veo error: ${veoRes.status}` }, { status: veoRes.status });
  }

  const veoData = await veoRes.json().catch(() => ({}));
  const operationId = veoData.name as string | undefined;

  if (operationId) {
    // Reuse falRequestId for the Veo operation ID; model identifies its provider.
    try {
      await prisma.falVideoJob.update({ where: { id: pendingJob.id }, data: { falRequestId: operationId, model: veoModelKey, status: "generating" } });
      await enqueueRender("video", pendingJob.id).catch((error) => console.error("Veo render dispatch failed", error));
    } catch (err) {
      console.error("Failed to persist Veo FalVideoJob row:", err);
      await prisma.falVideoJob.update({ where: { id: pendingJob.id }, data: { status: "submission_unknown", error: `Veo operation ${operationId} could not be linked` } }).catch(console.error);
      return NextResponse.json({ error: "Video task needs operator reconciliation", jobId: pendingJob.id, operationId }, { status: 502 });
    }
  }
  if (!operationId) {
    await prisma.falVideoJob.update({ where: { id: pendingJob.id }, data: { status: "submission_unknown", error: "Veo response missing operation ID" } });
    return NextResponse.json({ error: "Veo response missing operation ID", jobId: pendingJob.id }, { status: 502 });
  }

  return NextResponse.json({
    operationId,
    jobId: pendingJob.id,
    model: veoModelId,
    engine: "veo",
    projectId,
    status: "generating",
  });
}

export const POST = withAccess(unguardedPOST);
