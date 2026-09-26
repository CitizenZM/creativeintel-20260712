import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateImageByEngine } from "@/services/ai/image-engine";

export const maxDuration = 30;

/**
 * Image engine order (Settings → AI engines can put any engine first):
 * 1. OpenAI gpt-image-1 — highest quality
 * 2. fal.ai flux/schnell — fast fallback
 * 3. Pollinations — last resort, rate-limited
 * Strict free mode: Zhipu CogView-3-Flash (free), then Pollinations (free).
 */
function generateFrameImage(
  prompt: string,
  aspectRatio: "landscape_16_9" | "square",
  projectId: string
): Promise<string> {
  const square = aspectRatio === "square";
  return generateImageByEngine({
    prompt,
    shape: square ? "square" : "landscape",
    openaiQuality: "medium",
    pollinations: { width: square ? 512 : 1024, height: square ? 512 : 576, as: "url" },
    folder: "frames",
    projectId,
    defaults: { free: ["glm", "pollinations"], paid: ["openai", "fal", "pollinations"] },
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const body = await request.json().catch(() => ({}));
  const { prompt, style, dimensions } = body;

  const isSquare = dimensions === "256x256" || dimensions === "512x512";
  const aspectRatio = isSquare ? "square" as const : "landscape_16_9" as const;

  const noText = "No text overlays, no typography, no logos, no watermarks. Pure visual scene only.";
  const fullPrompt = `Cinematic storyboard frame for a video ad: ${prompt}. ${style || "Commercial photography, natural lighting, photorealistic"}. ${noText}`;

  try {
    const asset = await prisma.previewAsset.create({
      data: {
        projectId,
        prompt: fullPrompt,
        style: style || "cinematic",
        dimensions: dimensions || "landscape_16_9",
        status: "generating",
      },
    });

    try {
      const imageUrl = await generateFrameImage(fullPrompt, aspectRatio, projectId);

      await prisma.previewAsset.update({
        where: { id: asset.id },
        data: { imageUrl, status: "complete" },
      });
      return NextResponse.json({ ...asset, imageUrl, status: "complete" });
    } catch (err) {
      console.error("Frame image generation failed:", err);
      await prisma.previewAsset.update({
        where: { id: asset.id },
        data: { status: "error" },
      });
      return NextResponse.json({
        ...asset,
        status: "error",
        error: err instanceof Error ? err.message : "Generation failed",
      });
    }
  } catch (err) {
    console.error("Frame DB create failed:", err);
    return NextResponse.json({ error: "Failed to generate frame" }, { status: 500 });
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const assets = await prisma.previewAsset.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(assets);
}
