import { NextResponse, after } from "next/server";
import { createJob, failJob, runJobItems, runningJob } from "@/services/jobs";
import { analyzeWithClaude } from "@/services/ai/claude-client";
import { buildScriptWritingPrompt } from "@/services/ai/prompts/script-writing";
import {
  defaultTemplateBatch,
  getScriptTemplate,
  isVideoType,
  type ScriptTemplate,
  type VideoType,
} from "@/services/ai/prompts/script-templates";
import { auditScriptClaims, scriptV2Schema, type ScriptClaimsViolation, type ScriptV2 } from "@/lib/script-schema";
import { withIdempotency } from "@/lib/idempotency";
import { pMapSettled } from "@/lib/parallel";
import {
  loadScriptContext,
  buildScriptInput,
  persistScript,
  auditContext,
  formatComplianceViolations,
  type ScriptAngle,
} from "../_script-context";

export const maxDuration = 300;

const DEFAULT_COUNT = 10;
const MAX_COUNT = 20;
const CONCURRENCY = 4;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const idem = await withIdempotency<unknown>(request, {
    route: "creative/scripts-batch",
    projectId,
  });
  if (idem.replay && idem.response) return idem.response;

  const body = (await request.json().catch(() => ({}))) as {
    templateIds?: string[];
    count?: number;
    angles?: ScriptAngle[];
    videoType?: string;
    totalDurationSec?: number;
    customBrief?: string;
    /** Return a job id at once and write the scripts in the background. */
    background?: boolean;
  };

  try {
    const ctx = await loadScriptContext(projectId);
    if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const count = Math.min(MAX_COUNT, Math.max(1, Number(body.count) || DEFAULT_COUNT));

    let templates: ScriptTemplate[];
    if (Array.isArray(body.templateIds) && body.templateIds.length) {
      templates = body.templateIds
        .map((id) => getScriptTemplate(id))
        .filter((t): t is ScriptTemplate => t !== null)
        .slice(0, MAX_COUNT);
      if (!templates.length) {
        return NextResponse.json({ error: "No valid templateIds" }, { status: 400 });
      }
    } else {
      templates = defaultTemplateBatch(ctx.platformId, count);
    }

    const angles = Array.isArray(body.angles) ? body.angles : [];
    const requestedType = typeof body.videoType === "string" ? body.videoType.toUpperCase() : "";
    const overrideType: VideoType | null = isVideoType(requestedType) ? requestedType : null;
    const totalDurationSec = Number(body.totalDurationSec) || ctx.totalDurationSec;

    const claimsAudit = auditContext(ctx);

    const writeOne = async (template: ScriptTemplate, i: number) => {
        const videoType = overrideType ?? template.videoType;
        const angle = angles.length ? angles[i % angles.length] : undefined;

        const prompt = buildScriptWritingPrompt(
          buildScriptInput(ctx, {
            template,
            videoType,
            angle,
            totalDurationSec,
            customBrief: body.customBrief?.trim() || undefined,
          })
        );

        let generated: ScriptV2 = await analyzeWithClaude({
          systemPrompt: prompt.system,
          userPrompt: prompt.user,
          responseSchema: scriptV2Schema,
          maxTokens: 8000,
        });

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
            `[scripts-batch] compliance violations persisted for project ${projectId}, template ${template.id}:`,
            audit.violations
          );
          generated = { ...generated, title: `⚠ ${generated.title}` };
        }

        const script = await persistScript(projectId, generated, {
          template,
          videoType,
          totalDurationSec,
          angleTitle: angle?.title,
        });

        return audit.ok ? script : { ...script, complianceWarnings: audit.violations };
    };

    if (body.background) {
      const running = await runningJob(projectId, "scripts");
      if (running) return NextResponse.json({ jobId: running.id, reused: true }, { status: 202 });
      const job = await createJob(
        projectId,
        "scripts",
        templates.map((t) => ({ key: t.id, label: t.name })),
        { templateIds: templates.map((t) => t.id), customBrief: body.customBrief ?? null }
      );
      after(() =>
        runJobItems(
          job.id,
          templates,
          (t) => ({ key: t.id, label: t.name }),
          (t, i) => writeOne(t, i),
          { concurrency: CONCURRENCY }
        ).catch((err) => failJob(job.id, err))
      );
      const payload = { jobId: job.id, requested: templates.length };
      await idem.commit?.(payload, 202);
      return NextResponse.json(payload, { status: 202 });
    }

    const settled = await pMapSettled(templates, writeOne, { concurrency: CONCURRENCY });

    type PersistedScript = Awaited<ReturnType<typeof persistScript>>;
    type ScriptWithWarnings = PersistedScript & { complianceWarnings?: ScriptClaimsViolation[] };

    const scripts = settled
      .filter((r): r is PromiseFulfilledResult<ScriptWithWarnings> => r.status === "fulfilled")
      .map((r) => r.value);

    const failures = settled
      .map((r, i) =>
        r.status === "rejected"
          ? {
              templateId: templates[i].id,
              error: r.reason instanceof Error ? r.reason.message : String(r.reason),
            }
          : null
      )
      .filter((f): f is { templateId: string; error: string } => f !== null);

    for (const f of failures) {
      console.error("Script generation failed for template:", f.templateId, f.error);
    }

    if (!scripts.length) {
      const payload = {
        error: "Every script in this batch failed",
        failures,
      };
      return NextResponse.json(payload, { status: 500 });
    }

    const payload = {
      scripts,
      requested: templates.length,
      failures,
    };
    await idem.commit?.(payload, 200);
    return NextResponse.json(payload);
  } catch (err) {
    console.error("Scripts batch failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate scripts" },
      { status: 500 }
    );
  }
}
