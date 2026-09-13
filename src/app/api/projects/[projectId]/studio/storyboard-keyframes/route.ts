import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import OpenAI from "openai";

export const maxDuration = 300;

async function generateImageFree(prompt: string): Promise<string> {
  const encoded = encodeURIComponent(prompt);
  const seed = Math.floor(Math.random() * 999999);
  const url = `https://image.pollinations.ai/prompt/${encoded}?width=1024&height=1024&seed=${seed}&nologo=true&model=flux`;
  const res = await fetch(url, { signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`Pollinations error: ${res.status}`);
  const buffer = await res.arrayBuffer();
  const b64 = Buffer.from(buffer).toString("base64");
  const mime = res.headers.get("content-type") || "image/jpeg";
  return `data:${mime};base64,${b64}`;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const body = await request.json().catch(() => ({}));
  const { prompts, scriptId } = body as { prompts: string[]; scriptId?: string };

  if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
    return NextResponse.json({ error: "prompts array required" }, { status: 400 });
  }

  const noTextDirective = "CRITICAL: No text, no words, no letters, no typography, no captions, no logos, no signs. Pure cinematic visual only.";

  try {
    // OpenAI client — used only if key is present and valid
    const openai = process.env.OPENAI_API_KEY
      ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
      : null;

    const keyframes = [];
    for (let i = 0; i < Math.min(prompts.length, 8); i++) {
      try {
        const fullPrompt = `Cinematic film still for a video ad: ${prompts[i]}. Photorealistic advertising cinematography, natural lighting, commercial production quality. ${noTextDirective}`;
        let imageUrl: string | null = null;

        // Primary: OpenAI gpt-image-1
        if (openai) {
          try {
            const response = await openai.images.generate({
              model: "gpt-image-1",
              prompt: fullPrompt,
              n: 1,
              size: "1024x1024",
              quality: "low",
            });
            const b64 = response.data?.[0]?.b64_json;
            imageUrl = b64 ? `data:image/png;base64,${b64}` : (response.data?.[0]?.url ?? null);
          } catch (openaiErr) {
            console.warn(`Keyframe ${i}: OpenAI failed, using Pollinations:`, openaiErr instanceof Error ? openaiErr.message : openaiErr);
          }
        }

        // Fallback: Pollinations.ai (free, no key)
        if (!imageUrl) {
          imageUrl = await generateImageFree(fullPrompt);
        }

        if (!imageUrl) { keyframes.push(null); continue; }

        const asset = await prisma.previewAsset.create({
          data: {
            projectId,
            prompt: prompts[i],
            style: `keyframe-${i + 1}${scriptId ? `-script-${scriptId}` : ""}`,
            dimensions: "1024x1024",
            imageUrl,
            status: "complete",
          },
        });
        keyframes.push(asset);
      } catch (err) {
        console.error(`Keyframe ${i} failed:`, err);
        keyframes.push(null);
      }
    }

    return NextResponse.json({ keyframes: keyframes.filter((k) => k !== null) });
  } catch (err) {
    console.error("Keyframes generation failed:", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
