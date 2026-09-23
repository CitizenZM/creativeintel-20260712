import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { analyzeWithClaude } from "@/services/ai/claude-client";
import { buildStoryboardPrompt } from "@/services/ai/prompts/storyboard";
import { getScriptTemplate, DEFAULT_BEATS } from "@/services/ai/prompts/script-templates";
import {
  computeWindows,
  repairFrames,
  scenesFromScript,
  FRAME_SECONDS,
} from "@/lib/storyboard-grid";

// Lenient schema — the LLM may omit or rename fields. Frames are then stamped
// onto the exact 2-second grid by repairFrames().
const frameSchema = z.object({
  frameNumber: z.coerce.number().optional(),
  duration: z.string().optional().default(""),
  segment: z.string().optional().default(""),
  scene: z.string().optional().default(""),
  visualDirection: z.string().optional().default(""),
  voiceover: z.string().optional().default(""),
  textOverlay: z.string().optional().default(""),
  cameraNotes: z.string().optional().default(""),
  imagePrompt: z.string().optional().default(""),
  videoPrompt: z.string().optional().default(""),
  shotType: z.string().optional().default(""),
  cameraMove: z.string().optional().default(""),
  subject: z.string().optional().default(""),
  productAction: z.string().optional().default(""),
  sfx: z.string().optional().default(""),
  sellingPoint: z.string().optional().default(""),
  howExpressed: z.string().optional().default(""),
  startSec: z.coerce.number().optional(),
  endSec: z.coerce.number().optional(),
});

const storyboardSchema = z.object({
  title: z.string(),
  style: z.string(),
  totalDuration: z.string().optional().default(""),
  frames: z.array(frameSchema),
});

interface ScriptLike {
  id: string;
  title: string;
  body: string;
  hookVariants: unknown;
  ctaVariants: unknown;
  scenes?: unknown;
  totalDurationSec?: number | null;
  template?: string | null;
  videoType?: string | null;
  hook?: unknown;
  bodyBeats?: unknown;
  cta?: unknown;
  selectedHookIdx?: number | null;
  selectedCtaIdx?: number | null;
  roleName?: string | null;
  environmentName?: string | null;
}

/** The chosen option first, so every consumer that reads [0] gets the user's pick. */
function pickFirst(options: string[], idx: number | null | undefined): string[] {
  if (idx == null || idx < 0 || idx >= options.length) return options;
  return [options[idx], ...options.filter((_, i) => i !== idx)];
}

/** "Cast / Setting" lines for the script's chosen role and environment. */
async function castingDirection(projectId: string, script: ScriptLike): Promise<string | undefined> {
  if (!script.roleName && !script.environmentName) return undefined;
  const brand = await prisma.brand
    .findUnique({ where: { projectId }, select: { actorSettings: true, useEnvironments: true } })
    .catch(() => null);
  const actors = (Array.isArray(brand?.actorSettings) ? brand.actorSettings : []) as {
    role?: string;
    ageRange?: string;
    visualDescription?: string;
  }[];
  const envs = (Array.isArray(brand?.useEnvironments) ? brand.useEnvironments : []) as {
    name?: string;
    description?: string;
  }[];
  const lines: string[] = [];
  if (script.roleName) {
    const a = actors.find((x) => x.role === script.roleName);
    lines.push(
      `Cast: ${script.roleName}${a?.ageRange ? ` (${a.ageRange})` : ""}${a?.visualDescription ? ` — ${a.visualDescription}` : ""}`
    );
  }
  if (script.environmentName) {
    const e = envs.find((x) => x.name === script.environmentName);
    lines.push(`Setting: ${script.environmentName}${e?.description ? ` — ${e.description}` : ""}`);
  }
  return lines.join("\n");
}

interface ProjectLike {
  brandName: string;
  productPageTitle?: string | null;
  productName?: string | null;
}

interface CampaignLike {
  platform?: string | null;
  totalDurationSec?: number | null;
}

export interface StoryboardBuildExtras {
  brandTruth?: string;
  approvedCtaText?: string;
  approvedOffer?: string;
  /**
   * Operator-chosen look (lighting + style + their own notes), already
   * rendered to one clause. It drives the prompt's style bible, which every
   * frame restates and the studio later reads back out of the board.
   */
  visualDirection?: string;
}

/**
 * Generate a 2-second-grid storyboard for one script and return Prisma create
 * data. The window plan comes from the script's structured hook/body/CTA, the
 * segment split from its template's beats, and the token budget scales with
 * the frame count.
 */
export async function buildStoryboardCreateData(
  projectId: string,
  script: ScriptLike,
  project: ProjectLike,
  campaignSel: CampaignLike | null,
  extras: StoryboardBuildExtras = {}
): Promise<Prisma.StoryboardUncheckedCreateInput> {
  const hooks = pickFirst(
    (Array.isArray(script.hookVariants) ? script.hookVariants : []) as string[],
    script.selectedHookIdx
  );
  const ctas = pickFirst(
    (Array.isArray(script.ctaVariants) ? script.ctaVariants : []) as string[],
    script.selectedCtaIdx
  );
  const casting = await castingDirection(projectId, script);

  const totalDurationSec = script.totalDurationSec || campaignSel?.totalDurationSec || 30;

  const template = getScriptTemplate(script.template);
  const beats = template?.beats ?? DEFAULT_BEATS;

  const scenes = scenesFromScript({
    scenes: script.scenes,
    hook: script.hook,
    bodyBeats: script.bodyBeats,
    cta: script.cta,
    totalDurationSec,
  });

  const structuredCta = (script.cta ?? null) as { text?: string; offer?: string } | null;

  const windows = computeWindows(totalDurationSec, beats);
  const frameCount = windows.length;

  const prompt = buildStoryboardPrompt({
    brandName: project.brandName,
    productName: project.productPageTitle || project.productName || undefined,
    scriptTitle: script.title,
    scriptBody: script.body,
    hooks,
    ctas,
    // An explicitly picked CTA option beats the structured one.
    approvedCtaText:
      extras.approvedCtaText ||
      (script.selectedCtaIdx != null ? ctas[0] : undefined) ||
      structuredCta?.text ||
      ctas[0] ||
      undefined,
    approvedOffer: extras.approvedOffer || structuredCta?.offer || undefined,
    platform: campaignSel?.platform || "TikTok",
    totalDurationSec,
    templateName: template?.name,
    videoType: script.videoType || template?.videoType,
    beats,
    scenes,
    brandTruth: extras.brandTruth,
    style: [extras.visualDirection, casting].filter(Boolean).join("\n") || undefined,
  });

  // Each rich frame (imagePrompt + videoPrompt + 9 short fields) costs ~780
  // tokens: 15s → ~8.7k, 30s → ~14.2k. The ceiling is the 16k output limit of
  // the default gpt-4o route; longer boards are padded by repairFrames.
  const maxTokens = Math.min(16000, 2500 + frameCount * 780);

  const result = await analyzeWithClaude({
    systemPrompt: prompt.system,
    userPrompt: prompt.user,
    responseSchema: storyboardSchema,
    maxTokens,
  });

  const frames = repairFrames(result.frames, windows, scenes);

  return {
    projectId,
    scriptId: script.id,
    title: result.title,
    frames: frames as unknown as Prisma.InputJsonValue,
    totalDuration: `${totalDurationSec}s`,
    style: result.style,
    frameSeconds: FRAME_SECONDS,
  };
}
