import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { findActiveStoryboard } from "@/services/creative-library";
import { analyzeWithClaude } from "@/services/ai/claude-client";

export const maxDuration = 60;

const briefSchema = z.object({
  title: z.string(),
  logline: z.string(),
  totalDuration: z.string(),
  visualStyle: z.string(),
  colorPalette: z.string(),
  musicDirection: z.string(),
  castingNotes: z.string(),
  locationNotes: z.string(),
  shotList: z.array(z.object({
    shotNumber: z.number(),
    duration: z.string(),
    shotType: z.string(),
    cameraAngle: z.string(),
    cameraMovement: z.string(),
    sceneDescription: z.string(),
    action: z.string(),
    dialogue: z.string(),
    soundDesign: z.string(),
    lighting: z.string(),
    lensNotes: z.string(),
    aiVideoPrompt: z.string(),
  })),
  callToAction: z.string(),
  brandGuidelines: z.array(z.string()),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const body = await request.json().catch(() => ({}));
  const { scriptId } = body as { scriptId: string };

  if (!scriptId) {
    return NextResponse.json({ error: "scriptId required" }, { status: 400 });
  }

  try {
    // Gather ALL context from the project
    const [project, script, storyboard, audience, deepAnalysis] = await Promise.all([
      prisma.project.findUnique({ where: { id: projectId }, include: { brand: true } }),
      prisma.script.findUnique({ where: { id: scriptId } }),
      findActiveStoryboard(projectId, scriptId),
      prisma.audienceProfile.findUnique({ where: { projectId } }),
      prisma.deepAnalysis.findUnique({ where: { projectId } }),
    ]);

    if (!project || !script) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const brand = project.brand;
    const hooks = script.hookVariants as string[];
    const ctas = script.ctaVariants as string[];
    const segments = (audience?.segments as { name: string; ageRange: string; description: string }[]) || [];
    const vibeAnalysis = deepAnalysis?.vibeAnalysis as { dominantTones?: { tone: string }[]; pacingProfile?: string; visualStyleNotes?: string } | null;
    const videoStructure = deepAnalysis?.videoStructure as { hookDurationRange?: string; averageLength?: string } | null;

    const system = `You are an elite film director translating an ad script into a production-ready video brief.
Generate a detailed shot-by-shot video brief that could be handed to a DP, an AI video model (Runway/Luma/Sora), or a production team.
Respond with valid JSON matching this structure:
{
  "title": "string - video title",
  "logline": "string - one-sentence summary",
  "totalDuration": "string - e.g. 30s",
  "visualStyle": "string - e.g. 'Cinematic handheld with natural light, muted earth tones'",
  "colorPalette": "string - e.g. 'Warm amber highlights against cool slate shadows'",
  "musicDirection": "string - genre, tempo, emotional arc",
  "castingNotes": "string - who appears in the video",
  "locationNotes": "string - where it's shot",
  "shotList": [
    {
      "shotNumber": 1,
      "duration": "0-3s",
      "shotType": "WIDE SHOT|MEDIUM SHOT|CLOSE UP|EXTREME CLOSE UP|AERIAL|POV",
      "cameraAngle": "eye-level|low-angle|high-angle|dutch-tilt|overhead",
      "cameraMovement": "static|dolly-in|dolly-out|pan-left|pan-right|tilt-up|tilt-down|handheld|tracking-shot|crane|orbit",
      "sceneDescription": "string - visual description of the scene",
      "action": "string - what happens / what the subject does",
      "dialogue": "string - VO or spoken lines (or 'none')",
      "soundDesign": "string - sfx, ambient",
      "lighting": "string - natural|golden hour|blue hour|neon|harsh|soft|practical",
      "lensNotes": "string - focal length/aesthetic e.g. 'wide 24mm for drama'",
      "aiVideoPrompt": "string - detailed, visual-only prompt ready to paste into Runway/Luma/Sora. No text/words requested in image."
    }
  ],
  "callToAction": "string - how the video ends / closing frame",
  "brandGuidelines": ["array of must-follow brand rules - tone, what NOT to include, etc."]
}

CRITICAL: Every aiVideoPrompt MUST include the phrase "no text, no words, no typography, no logos in frame" to prevent AI video models from generating text artifacts.
Use the ACTUAL storyboard scenes as the basis for shots.`;

    const user = `Create a production-ready video brief for this ad:

BRAND: ${project.brandName}
Brand promise: ${brand?.brandPromise || "N/A"}
Value prop: ${brand?.valueProposition || "N/A"}
Tone: ${brand?.toneOfVoice || "N/A"}
Category: ${project.category || "N/A"}
Campaign goal: ${project.campaignGoal || "N/A"}

AUDIENCE:
${segments.map((s) => `- ${s.name} (${s.ageRange}): ${s.description}`).join("\n") || "General consumers"}

VIBE CONTEXT (from top-performing content analysis):
- Dominant tones: ${vibeAnalysis?.dominantTones?.map((t) => t.tone).join(", ") || "N/A"}
- Pacing: ${vibeAnalysis?.pacingProfile || "N/A"}
- Visual style: ${vibeAnalysis?.visualStyleNotes || "N/A"}
- Hook duration benchmark: ${videoStructure?.hookDurationRange || "3-5s"}
- Length benchmark: ${videoStructure?.averageLength || "30s"}

SCRIPT:
Title: ${script.title}
Format: ${script.format} · Duration: ${script.duration}
Narrative type: ${script.narrativeType}
Target emotion: ${script.targetEmotion}

Hooks (use the strongest):
${hooks.map((h, i) => `${i + 1}. ${h}`).join("\n")}

Body:
${script.body}

CTAs:
${ctas.map((c, i) => `${i + 1}. ${c}`).join("\n")}

${storyboard ? `EXISTING STORYBOARD (use as basis for shots):
${(storyboard.frames as { frameNumber: number; scene: string; voiceover: string; imagePrompt: string }[]).map((f) => `Frame ${f.frameNumber}: ${f.scene} | VO: ${f.voiceover}`).join("\n")}` : ""}

Generate a complete shot-by-shot brief. 6-8 shots. Each with detailed camera work, lighting, and an aiVideoPrompt ready for Runway/Luma/Sora.`;

    const result = await analyzeWithClaude({
      systemPrompt: system,
      userPrompt: user,
      responseSchema: briefSchema,
      maxTokens: 4096,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("Video brief generation failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate brief" },
      { status: 500 }
    );
  }
}
