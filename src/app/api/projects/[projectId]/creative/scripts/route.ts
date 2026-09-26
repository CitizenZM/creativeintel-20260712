import { COMPLIANCE_FLAG } from "@/lib/script-pick";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { analyzeWithClaude } from "@/services/ai/claude-client";
import { buildScriptWritingPrompt } from "@/services/ai/prompts/script-writing";
import {
  getScriptTemplate,
  isVideoType,
  defaultTemplateBatch,
} from "@/services/ai/prompts/script-templates";
import { auditScriptClaims, scriptV2Schema, type ScriptV2 } from "@/lib/script-schema";
import { withIdempotency } from "@/lib/idempotency";
import {
  loadScriptContext,
  buildScriptInput,
  persistScript,
  auditContext,
  formatComplianceViolations,
  type ScriptAngle,
} from "../_script-context";
import { LIVE, isSelectionStatus } from "@/services/creative-library";

export const maxDuration = 300;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const scripts = await prisma.script.findMany({
    where: { projectId, ...LIVE },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(scripts);
}

/** Bulk pick / unpick — backs "Select all" and "Clear" on the Creative page. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const body = (await request.json().catch(() => ({}))) as { ids?: unknown; status?: unknown };
  if (!isSelectionStatus(body.status)) {
    return NextResponse.json({ error: "status must be draft or selected" }, { status: 400 });
  }
  const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string") : null;

  const { count } = await prisma.script.updateMany({
    where: { projectId, ...LIVE, ...(ids ? { id: { in: ids } } : {}) },
    data: { status: body.status },
  });
  return NextResponse.json({ ok: true, count });
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
      getScriptTemplate(body.templateId) ?? defaultTemplateBatch(ctx.platformId, 1, ctx.goalType)[0];
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

    let generated: ScriptV2 = await analyzeWithClaude({
      systemPrompt: prompt.system,
      userPrompt: prompt.user,
      responseSchema: scriptV2Schema,
      maxTokens: 8000,
    });

    const claimsAudit = auditContext(ctx);
    let audit = auditScriptClaims(generated, claimsAudit);

    if (!audit.ok) {
      const retryUserPrompt = `${prompt.user}\n\nCOMPLIANCE FAILURE — the previous draft violated brand rules. Fix these lines:\n${formatComplianceViolations(
        audit.violations
      )}`;
      generated = await analyzeWithClaude({
        systemPrompt: prompt.system,
        userPrompt: retryUserPrompt,
        responseSchema: scriptV2Schema,
        maxTokens: 8000,
      });
      audit = auditScriptClaims(generated, claimsAudit);
    }

    if (!audit.ok) {
      console.warn(
        `[scripts] compliance violations persisted for project ${projectId}, template ${template.id}:`,
        audit.violations
      );
      generated = { ...generated, title: `${COMPLIANCE_FLAG}${generated.title}` };
    }

    const script = await persistScript(projectId, generated, {
      template,
      complianceNotes: audit.ok ? undefined : audit.violations.map((v) => v.reason),
      videoType,
      totalDurationSec,
      angleTitle: angle?.title,
    });

    const payload = audit.ok ? script : { ...script, complianceWarnings: audit.violations };

    await idem.commit?.(payload, 200);
    return NextResponse.json(payload);
  } catch (err) {
    console.error("Script generation failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate script" },
      { status: 500 }
    );
  }
}
