import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { analyzeWithClaude } from "@/services/ai/claude-client";
import { buildScriptWritingPrompt } from "@/services/ai/prompts/script-writing";
import {
  getScriptTemplate,
  isVideoType,
  defaultTemplateBatch,
} from "@/services/ai/prompts/script-templates";
import { scriptV2Schema } from "@/lib/script-schema";
import { withIdempotency } from "@/lib/idempotency";
import {
  loadScriptContext,
  buildScriptInput,
  persistScript,
  type ScriptAngle,
} from "../_script-context";

export const maxDuration = 60;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const scripts = await prisma.script.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(scripts);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const idem = await withIdempotency<unknown>(request, {
    route: "creative/scripts",
    projectId,
  });
  if (idem.replay && idem.response) return idem.response;

  const body = (await request.json().catch(() => ({}))) as {
    angle?: ScriptAngle | string;
    templateId?: string;
    videoType?: string;
    totalDurationSec?: number;
  };

  try {
    const ctx = await loadScriptContext(projectId);
    if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const template =
      getScriptTemplate(body.templateId) ?? defaultTemplateBatch(ctx.platformId, 1)[0];
    if (!template) {
      return NextResponse.json({ error: "Unknown templateId" }, { status: 400 });
    }

    const requestedType = typeof body.videoType === "string" ? body.videoType.toUpperCase() : "";
    const videoType = isVideoType(requestedType) ? requestedType : template.videoType;
    const totalDurationSec = Number(body.totalDurationSec) || ctx.totalDurationSec;

    const angle: ScriptAngle | undefined =
      typeof body.angle === "string"
        ? {
            title: body.angle.slice(0, 80),
            description: body.angle,
            targetEmotion: "",
            narrativeType: "DEMONSTRATION",
          }
        : body.angle;

    const prompt = buildScriptWritingPrompt(
      buildScriptInput(ctx, { template, videoType, angle, totalDurationSec })
    );

    const result = await analyzeWithClaude({
      systemPrompt: prompt.system,
      userPrompt: prompt.user,
      responseSchema: scriptV2Schema,
      maxTokens: 8000,
    });

    const script = await persistScript(projectId, result, {
      template,
      videoType,
      totalDurationSec,
      angleTitle: angle?.title,
    });

    await idem.commit?.(script, 200);
    return NextResponse.json(script);
  } catch (err) {
    console.error("Script generation failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate script" },
      { status: 500 }
    );
  }
}
