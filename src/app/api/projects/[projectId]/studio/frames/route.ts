import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import OpenAI from "openai";

export const maxDuration = 30;

// fal.ai caps the account at 10 concurrent requests and answers the eleventh
// with a 429 — 23 frame generations were lost that way. Hold a slot instead of
// relying on their limiter to say no.
const FAL_MAX_CONCURRENT = 9;
let falActive = 0;
const falWaiting: Array<() => void> = [];

async function acquireFalSlot(): Promise<() => void> {
  if (falActive >= FAL_MAX_CONCURRENT) {
    await new Promise<void>((resolve) => falWaiting.push(resolve));
  }
  falActive++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    falActive--;
    falWaiting.shift()?.();
  };
}

/**
 * Image generation priority:
 * 1. OpenAI gpt-image-1 (GPT Image 2 in the API) — highest quality, uses subscription plan
 * 2. fal.ai flux/schnell — fast fallback if OPENAI_API_KEY not set/invalid
 * 3. Pollinations — last resort, rate-limited
 */
async function generateFrameImage(prompt: string, aspectRatio: "landscape_16_9" | "square" = "landscape_16_9"): Promise<string> {
  const openaiKey = process.env.OPENAI_API_KEY;
  const falKey = process.env.FAL_KEY;

  // ── Option 1: OpenAI GPT Image (gpt-image-1 = GPT Image 2 in the API) ──
  if (openaiKey) {
    try {
      const openai = new OpenAI({ apiKey: openaiKey });
      const size = aspectRatio === "landscape_16_9" ? "1536x1024" : "1024x1024";

      const response = await openai.images.generate({
        model: "gpt-image-1",   // GPT Image 2 — latest model
        prompt,
        n: 1,
        size: size as "1024x1024" | "1536x1024",
        quality: "medium",      // "low" | "medium" | "high" — medium balances cost/quality
      });

      const b64 = response.data?.[0]?.b64_json;
      if (b64) return `data:image/png;base64,${b64}`;

      const url = response.data?.[0]?.url;
      if (url) return url;

      throw new Error("OpenAI returned no image data");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("OpenAI image generation failed, falling back to fal.ai:", msg);
      // Fall through to fal.ai
    }
  }

  // ── Option 2: fal.ai Flux Schnell ──
  if (falKey) {
    const release = await acquireFalSlot();
    try {
    const res = await fetch("https://fal.run/fal-ai/flux/schnell", {
      method: "POST",
      headers: {
        "Authorization": `Key ${falKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        image_size: aspectRatio,
        num_inference_steps: 4,
        num_images: 1,
        enable_safety_checker: false,
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`fal.ai flux error ${res.status}: ${err.slice(0, 100)}`);
    }

    const data = await res.json();
    const url = data?.images?.[0]?.url;
    if (!url) throw new Error("fal.ai returned no image URL");
    return url;
    } finally {
      release();
    }
  }

  // ── Option 3: Pollinations (last resort) ──
  const encoded = encodeURIComponent(prompt);
  const seed = Math.floor(Math.random() * 999999);
  const width = aspectRatio === "landscape_16_9" ? 1024 : 512;
  const height = aspectRatio === "landscape_16_9" ? 576 : 512;
  const url = `https://image.pollinations.ai/prompt/${encoded}?width=${width}&height=${height}&seed=${seed}&nologo=true&model=flux&nofeed=true`;
  const pollRes = await fetch(url, { signal: AbortSignal.timeout(25000) });
  if (!pollRes.ok) throw new Error(`Pollinations error: ${pollRes.status}`);
  return url;
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
      const imageUrl = await generateFrameImage(fullPrompt, aspectRatio);

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
