import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { findActiveStoryboard } from "@/services/creative-library";
import { analyzeWithClaude } from "@/services/ai/claude-client";

export const maxDuration = 60;

function buildVeoPrompt(shot: Record<string, unknown>, charDesc: string, flat: Record<string, unknown>): string {
  const parts = [
    `Shot on ${shot.shot_type || "medium shot"} with ${shot.camera_angle || "eye-level"} angle using a ${shot.camera_movement || "steady"} camera movement.`,
    shot.scene_description,
    `The character — ${charDesc} — ${shot.character_action || "stands naturally"}.`,
    shot.product_action ? `The product ${shot.product_action}.` : "",
    `Lighting: ${shot.lighting || flat.lighting_source + " " + flat.lighting_direction}, creating a ${flat.lighting_mood || "natural"} mood.`,
    `Environment: ${flat.location}, ${flat.time_of_day}, ${flat.weather}. Props include ${(flat.props as string[])?.join(", ") || "minimal set dressing"}.`,
    shot.motion_effect ? `Motion details: ${shot.motion_effect}.` : "",
    `Color palette: warm natural tones with ${flat.lighting_quality || "soft"} quality.`,
    `Depth of field: shallow f/2.0, subject sharp with smooth background bokeh.`,
    `No text, no typography, no logos, no signs, no distorted anatomy, no extra fingers, no warped products, no inconsistent lighting.`,
  ].filter(Boolean);
  return parts.join(" ");
}

// Simplified flat schema that gpt-4o-mini can reliably produce
// Minimal schema — only fields the UI actually uses. Everything else optional.
// Keeps JSON output small enough for free-tier OpenRouter models to handle reliably.
const veoResultSchema = z.object({
  creative_type: z.string().optional().default("TVC"),
  tone: z.string().optional().default("cinematic"),
  location: z.string().optional().default("modern interior"),
  time_of_day: z.string().optional().default("morning"),
  weather: z.string().optional().default("clear"),
  lighting_source: z.string().optional().default("natural window"),
  lighting_direction: z.string().optional().default("45 degrees camera-left"),
  lighting_quality: z.string().optional().default("soft diffused"),
  lighting_mood: z.string().optional().default("warm"),
  props: z.array(z.string()).optional().default([]),
  character_role: z.string().optional().default("consumer"),
  character_age: z.string().optional().default("30s"),
  character_gender: z.string().optional().default("female"),
  character_appearance: z.string().optional().default("natural, casual"),
  character_wardrobe: z.string().optional().default("casual home clothing"),
  character_personality: z.string().optional().default("relatable, authentic"),
  character_emotion_start: z.string().optional().default("neutral"),
  character_emotion_end: z.string().optional().default("satisfied"),
  character_speech_style: z.string().optional().default("natural"),
  hook_style: z.string().optional().default("problem reveal"),
  hook_technique: z.string().optional().default("macro close-up"),
  cta_technique: z.string().optional().default("product hero"),
  story_hook: z.string().optional().default(""),
  story_problem: z.string().optional().default(""),
  story_discovery: z.string().optional().default(""),
  story_product_use: z.string().optional().default(""),
  story_benefit: z.string().optional().default(""),
  story_cta: z.string().optional().default(""),
  shots: z.array(z.object({
    shot_id: z.string().optional().default("shot_1"),
    duration_seconds: z.coerce.number().optional().default(5),
    purpose: z.string().optional().default(""),
    scene_description: z.string().optional().default(""),
    character_action: z.string().optional().default(""),
    product_action: z.string().optional().default(""),
    camera_angle: z.string().optional().default("eye-level"),
    camera_movement: z.string().optional().default("slow push-in"),
    shot_type: z.string().optional().default("medium close-up"),
    lighting: z.string().optional().default("natural window light"),
    motion_effect: z.string().optional().default(""),
    dialogue_or_vo: z.string().optional().default(""),
    text_overlay: z.string().optional().default(""),
    cta: z.string().optional().default(""),
    negative_prompt: z.string().optional().default("No text, no logos, no distorted anatomy"),
    veo_prompt: z.string().optional().default(""),
    test_prompt: z.string().optional().default(""),
    transition_to_next: z.string().optional().default("cut"),
  })).optional().default([]),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const body = await request.json().catch(() => ({}));
  const { scriptId } = body;

  if (!scriptId) {
    return NextResponse.json({ error: "scriptId required" }, { status: 400 });
  }

  try {
    const [project, script, storyboard, audience, deepAnalysis, campaignSel] = await Promise.all([
      prisma.project.findUnique({ where: { id: projectId }, include: { brand: true } }),
      prisma.script.findUnique({ where: { id: scriptId } }),
      findActiveStoryboard(projectId, scriptId),
      prisma.audienceProfile.findUnique({ where: { projectId } }),
      prisma.deepAnalysis.findUnique({ where: { projectId } }),
      prisma.campaignSelection.findUnique({ where: { projectId } }).catch(() => null),
    ]);

    if (!project || !script) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const brand = project.brand;
    const hooks = script.hookVariants as string[];
    const ctas = script.ctaVariants as string[];
    const segments = (audience?.segments as { name: string; ageRange: string; description: string }[]) || [];
    const vibeData = deepAnalysis?.vibeAnalysis as { dominantTones?: { tone: string }[]; pacingProfile?: string; visualStyleNotes?: string } | null;
    const ctaData = deepAnalysis?.ctaAnalysis as { commonCTAs?: { cta: string }[]; placement?: string } | null;

    // Read campaign context — determines shot count and duration
    const platform = (campaignSel?.platform as string | null) || "tiktok";
    const totalDurationSec = (campaignSel?.totalDurationSec as number | null) || 5;
    const isTikTok = platform === "tiktok" || platform === "instagram";
    // TikTok 5s = 1 single focused shot. TVC 30s+ = 3 shots.
    const shotCount = totalDurationSec <= 10 ? 1 : totalDurationSec <= 20 ? 2 : 3;
    const shotDurationSec = Math.floor(totalDurationSec / shotCount);

    // Product-specific safeguard — use the most precise product identifier available
    const productRef = project.productPageTitle || project.productName || brand?.valueProposition || project.brandName;
    const productText = project.productPageText?.slice(0, 300) || brand?.productDescription?.slice(0, 300) || "";
    // Anti-animal / anti-wrong-product clause
    const antiConfusion = `CRITICAL BRAND SAFETY: The product is "${productRef}". ${productText ? `It is described as: ${productText}` : ""} This is NOT a shark animal, NOT a fish, NOT any creature. It is a physical consumer product. Generate footage showing the ACTUAL product only.`;

    const system = `You are a senior director of photography and prompt engineer for top-tier TVC and short-form video ad production. Your prompts are used to direct AI video models (Kling 3.0, Wan 2.6, Grok Imagine) to produce cinematic, photorealistic footage indistinguishable from real camera work.

CRITICAL PHILOSOPHY — read before writing anything:
- NEVER use the word "realistic" or "real". Instead describe HOW the footage was shot: "Shot on ARRI ALEXA Mini LF, 75mm Cooke S7, T2.0" forces the model into a photographic latent space.
- Actors NEVER look at camera. They look at objects, windows, each other, their hands — anything except the lens. Describe their eyeline explicitly every time.
- Eliminate all "AI tells": plastic skin (use translucent skin rendering — describe warm luminance quality and how light passes through thin skin areas), floaty movement (describe specific footfalls/weight shifts), uniform lighting (name exact practical light sources with Kelvin temperatures).
- Every surface must have a specific material with two precise descriptors: "anodized matte aluminum" not "shiny metal". "22-momme mulberry silk" not "silky fabric".
- Prompts must be 400–600 words each. Brevity kills quality. The model needs density to activate photographic rather than illustrative rendering.

## MANDATORY 14-ELEMENT STRUCTURE (every veo_prompt must contain all 14, in this order):

1. ACQUISITION: Camera body + lens focal length + aperture + frame rate + format
   Example: "Shot on ARRI ALEXA Mini LF, 75mm Cooke S7/i T2.0, 24fps, 16:9 spherical reframed to 9:16 vertical, 800 ISO, natural grain structure"

2. SHOT SIZE + CAMERA MOVEMENT: Named shot type + precise movement verb + duration + speed
   Example: "Medium close-up executing a slow imperceptible dolly push-in over 7 seconds — camera advances approximately 18cm, ending at tight close-up on subject's cheekbone. Movement begins at frame 1, never stops, viewer should feel pulled rather than see movement."

3. SUBJECT ANATOMY: Age range + ethnicity + specific facial structure + skin quality (use SSS terms) + hair (fiber weight, length, movement)
   Example: "Woman, late 30s, South Asian descent, oval face with high cheekbones, warm medium-brown complexion with translucent skin quality in light — warm amber luminance at ear rim where thin skin catches the key source. Fine skin texture on upper lip glowing in sidelight. Natural expression lines at eye corners when her expression shifts. Dark chestnut hair, thick, pulled loosely back, a few strands escaping at temple."

4. WARDROBE MATERIAL: Specific garment + fiber content + weight + fit + surface behavior in light
   Example: "Oversized ribbed merino wool crewneck, ecru, approximately 12-gauge knit, soft fuzzy nap catching key light as a directional sheen. Fabric falls from shoulders with natural gravity, no stiffness. A small pull in the knit visible near left cuff."

5. EYELINE + EXPRESSION: Where subject looks (never camera) + micro-expression sequence
   Example: "Subject's gaze directed 15 degrees left of lens toward a point on the countertop — she is NOT looking at camera. Eyes tracking the product as her hand moves it. At second 4, a single slow blink. At second 6, the corners of her mouth soften into a private, unperformed satisfaction."

6. ACTION CHOREOGRAPHY: Second-by-second physical sequence with anatomical precision
   Example: "0–1s: right hand rests on counter, fingers loosely curled. 1–2s: hand slides toward product, index finger makes first contact at base. 2–4s: fingers wrap around product body, thumb locates power button by tactile memory. 4–5s: slight inward wrist rotation brings product label toward camera. 5–7s: product lifts 3cm off surface, held at chest height. 7–8s: elbow drops fractionally, settling into casual holding position."

7. PRODUCT SPECIFICS: Frame position (rule of thirds) + orientation + surface material + light interaction
   Example: "Product occupies right third of frame, 3/4 angle facing camera-left. Brushed aluminum casing catches the key light as a horizontal anisotropic streak — not a hotspot, a directional glint. Product label tack-sharp and legible. Shadow of product falls left onto marble at 45 degrees."

8. ENVIRONMENT ARCHITECTURE: Named surfaces + named objects + spatial depth + atmospheric particles
   Example: "Modern open-plan kitchen. Honed Calacatta marble island (cream base, charcoal vein branching). Matte black Gaggenau induction cooktop visible in soft background bokeh at left edge. East-facing floor-to-ceiling windows — morning light entering at 25-degree angle. Thin steam from unseen mug in far background catching the light. Air shows faint dust particle drift in light beam."

9. LIGHTING PHYSICS: Named source + Kelvin temperature + direction + surface behavior + shadow quality
   Example: "PRIMARY: Natural window light, approximately 5200K neutral daylight, entering from camera-left at 45 degrees, striking subject as a large softbox equivalent. Specular roll-off across cheekbone — satin finish, not glossy. SECONDARY: Warm practical floor lamp at 2700K camera-right providing gentle fill, lifting shadow side to 3:1 ratio. HAIR LIGHT: Rim from window edge behind subject at 5600K creating Fresnel edge glow on hair strands. Shadows are feathered soft, no hard edges anywhere. Ambient occlusion visible where collar meets neck."

10. COLOR PALETTE: 4 specific colors by name and hex-adjacent description
    Example: "DOMINANT: warm ivory (approximately #F4EDE4) — walls, countertop, sweater. ACCENT: dusty eucalyptus (approximately #7A9E8E) — a small plant on windowsill. SHADOW TONE: deep espresso (approximately #1C0F0A) — cast shadows and depth areas. LIGHT FILL: soft apricot (approximately #F2C4A0) — warm window bounce on shadow side."

11. DEPTH FIELD MAP: Foreground, subject plane, mid-ground, background — each with sharpness description
    Example: "FOREGROUND: Counter edge at bottom frame, 15% defocus, renders as smooth horizontal blur. SUBJECT PLANE: Face and hands tack sharp, eyelashes individually resolved. MIDGROUND (0.5m behind): product packaging on counter, 30% defocus, shape readable, text illegible. BACKGROUND (2m+): kitchen environment full bokeh, colored shapes only, no detail."

12. ATMOSPHERIC + PARTICLE DETAIL: Any airborne elements, temperature indicators, secondary motion
    Example: "Fine dust particles visible as golden specks in the primary light beam — slow Brownian drift, not rushing. No breath condensation (interior warm environment). Very subtle heat shimmer above cooktop in far background."

13. TIMING + TRANSITION: Second-by-second cut description + what happens at edit point
    Example: "0s: shot begins mid-motion (in media res, not from static). 4s: camera movement reaches closest point, then holds for 2 seconds. 6s: slight rack focus shift pulls attention from product to face. 8s: shot ends — cut will transition on motion to next shot for visual continuity."

14. NEGATIVE TECHNICAL: Explicit list of what must NOT appear
    Example: "NO text overlays. NO visible brand logos except product itself. NO distorted facial anatomy. NO extra fingers or hand morphing. NO inconsistent lighting direction between frames. NO plastic or poreless skin — skin must show natural translucency and warmth in light. NO floating or weightless movement — every action has gravity and friction. NO actor eye contact with camera lens. NO artificial smile held for camera."

## SHOT STRUCTURE RULES:
- Shot 1: Wide-to-medium establishing with environment, subject not yet aware of product. Camera movement: lateral track or low-angle reveal. Actor behavior: natural domestic/professional activity, completely unaware of camera.
- Shot 2: Product interaction moment. Medium close-up to close-up push. Actor discovers or uses product — eyes on product, not camera. Camera: slow deliberate dolly. This is the narrative pivot.
- Shot 3: Emotional resolution + product hero. Actor profile or 3/4 angle, slight smile private and unperformed. Product in frame as part of composition. Camera: slow orbit or lock-off with subject moving. Ends on product as camera drifts off actor.

## test_prompt (≤120 words): Same shot but condensed to 3-second single camera position. Include acquisition line, one action beat, one lighting description, negative prompts. Use this for iteration testing.

## JSON OUTPUT — output ONLY this JSON structure, nothing else:
{
  "creative_type": "string",
  "tone": "string",
  "location": "string",
  "time_of_day": "string",
  "lighting_source": "string",
  "character_role": "string",
  "character_age": "string",
  "character_gender": "string",
  "character_appearance": "string",
  "character_wardrobe": "string",
  "props": ["string"],
  "shots": [
    {
      "shot_id": "shot_1",
      "duration_seconds": 8,
      "purpose": "Hook — scroll-stopping opener",
      "scene_description": "one sentence summary",
      "camera_movement": "dolly push-in",
      "shot_type": "medium close-up",
      "dialogue_or_vo": "optional VO line",
      "veo_prompt": "THE FULL 400-600 WORD CINEMATIC PROMPT — this is the most important field",
      "test_prompt": "condensed 3-second version under 120 words",
      "transition_to_next": "cut on motion"
    }
  ]
}

THE veo_prompt FIELD IS THE MOST IMPORTANT OUTPUT. Make it 400-600 words using all 14 elements. Every other field is secondary.`;

    const user = `Generate VEO3 campaign prompts for:

BRAND: ${project.brandName}
Product: ${brand?.valueProposition || project.brandName}
Brand promise: ${brand?.brandPromise || "N/A"}
Tone: ${brand?.toneOfVoice || "professional"}
Category: ${project.category || "N/A"}
Campaign goal: ${project.campaignGoal || "conversion"}
Platform: TikTok / Instagram Reels / YouTube Shorts

AUDIENCE:
${segments.map(s => `- ${s.name} (${s.ageRange}): ${s.description}`).join("\n") || "General US consumers"}

VIBE (from content analysis):
- Tones: ${vibeData?.dominantTones?.map(t => t.tone).join(", ") || "professional, dynamic"}
- Pacing: ${vibeData?.pacingProfile || "fast-paced"}
- Visual: ${vibeData?.visualStyleNotes || "clean, modern"}
- CTA style: ${ctaData?.commonCTAs?.map(c => c.cta).join(", ") || "Shop now"}

SCRIPT:
Title: ${script.title}
Format: ${script.format} · ${script.duration}
Emotion: ${script.targetEmotion}

Hook options:
${hooks.map((h, i) => `${i + 1}. ${h}`).join("\n")}

Body:
${script.body}

CTA options:
${ctas.map((c, i) => `${i + 1}. ${c}`).join("\n")}

${storyboard ? `STORYBOARD REFERENCE:
${(storyboard.frames as { frameNumber: number; scene: string; voiceover: string; cameraNotes: string }[]).map(f => `Frame ${f.frameNumber}: ${f.scene} | Camera: ${f.cameraNotes} | VO: ${f.voiceover}`).join("\n")}` : ""}

PRODUCT IDENTITY (read carefully):
${antiConfusion}

CAMPAIGN CONSTRAINTS:
- Platform: ${platform.toUpperCase()} — ${isTikTok ? "vertical 9:16, fast hook, scroll-stop" : "cinematic, longer narrative"}
- Total duration: ${totalDurationSec} seconds
- Shot count: ${shotCount} shot(s) of ${shotDurationSec}s each
- Duration is NON-NEGOTIABLE — every scene must fit within ${shotDurationSec}s

Generate exactly ${shotCount} VEO3 shot(s). Each shot is ${shotDurationSec} seconds.
${shotCount === 1 ? `Single shot structure for ${totalDurationSec}s TikTok:\n- 0–${Math.round(totalDurationSec * 0.3)}s: Immediate hook (product visible instantly)\n- ${Math.round(totalDurationSec * 0.3)}–${Math.round(totalDurationSec * 0.7)}s: Key action / product moment\n- ${Math.round(totalDurationSec * 0.7)}–${totalDurationSec}s: Payoff / result` : ""}
Format: vertical 9:16, 720p minimum, 24fps.`;

    const flat = await analyzeWithClaude({
      systemPrompt: system,
      userPrompt: user,
      responseSchema: veoResultSchema,
      maxTokens: shotCount <= 1 ? 2500 : shotCount <= 2 ? 3500 : 4500,
    });

    // Restructure into nested format for the UI
    const result = {
      project_meta: {
        project_name: `${project.brandName}_VEO3_Campaign`,
        brand: project.brandName,
        product_name: brand?.valueProposition || project.brandName,
        campaign_goal: project.campaignGoal || "conversion",
        platform: platform,
        video_format: { aspect_ratio: "9:16", resolution: "720p", fps: 24, total_duration_seconds: totalDurationSec, clip_duration_seconds: shotDurationSec },
      },
      character_system: {
        main_character: {
          role: flat.character_role,
          age: flat.character_age,
          gender: flat.character_gender,
          appearance: flat.character_appearance,
          wardrobe: flat.character_wardrobe,
          personality: flat.character_personality,
          emotional_state_start: flat.character_emotion_start,
          emotional_state_end: flat.character_emotion_end,
          speech_style: flat.character_speech_style,
        },
      },
      environment_system: {
        location: flat.location,
        time_of_day: flat.time_of_day,
        weather: flat.weather,
        lighting: { source: flat.lighting_source, direction: flat.lighting_direction, quality: flat.lighting_quality, mood: flat.lighting_mood },
        props: flat.props,
      },
      creative_strategy: {
        creative_type: flat.creative_type,
        tone: flat.tone,
        hook_style: flat.hook_style,
        hook_technique: flat.hook_technique,
        cta_technique: flat.cta_technique,
        story_arc: {
          hook: flat.story_hook,
          problem: flat.story_problem,
          discovery: flat.story_discovery,
          product_use: flat.story_product_use,
          benefit_reveal: flat.story_benefit,
          cta: flat.story_cta,
        },
      },
      shot_list: flat.shots.map((shot) => {
        // Construct detailed veo_prompt server-side from shot fields + character if AI left it empty
        const charDesc = `${flat.character_gender}, ${flat.character_age}, ${flat.character_appearance}, wearing ${flat.character_wardrobe}`;
        const builtPrompt = shot.veo_prompt || buildVeoPrompt(shot, charDesc, flat);
        return { ...shot, veo_prompt: builtPrompt, test_prompt: shot.test_prompt || "" };
      }),
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error("VEO prompt generation failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate VEO prompts" },
      { status: 500 }
    );
  }
}
