import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateImageByEngine } from "@/services/ai/image-engine";

export const maxDuration = 300;

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
    const keyframes = [];
    for (let i = 0; i < Math.min(prompts.length, 8); i++) {
      try {
        const fullPrompt = `Cinematic film still for a video ad: ${prompts[i]}. Photorealistic advertising cinematography, natural lighting, commercial production quality. ${noTextDirective}`;
        // OpenAI gpt-image-1 → Pollinations; strict free: CogView-3-Flash → Pollinations.
        // Settings → AI engines can put any engine first.
        const imageUrl: string | null = await generateImageByEngine({
          prompt: fullPrompt,
          shape: "square",
          openaiQuality: "low",
          pollinations: { width: 1024, height: 1024, as: "dataUrl" },
          folder: "keyframes",
          projectId,
          defaults: { free: ["glm", "pollinations"], paid: ["openai", "pollinations"] },
        }).catch(() => null);

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
