import { safePublicError } from "@/lib/public-error";
import { NextResponse } from "next/server";
import { createJob, runningJob } from "@/services/jobs";
import {
  defaultTemplateBatch,
  getScriptTemplate,
  isVideoType,
  type ScriptTemplate,
  type VideoType,
} from "@/services/ai/prompts/script-templates";
import type { ScriptClaimsViolation } from "@/lib/script-schema";
import { withIdempotency } from "@/lib/idempotency";
import { pMapSettled } from "@/lib/parallel";
import {
  loadScriptContext,
  persistScript,
  auditContext,
  type ScriptAngle,
} from "../_script-context";
import { withAccess } from "@/lib/auth/route-guard";
import { writeBatchScript } from "@/services/creative/batch-workers";
import { enqueueCreativeBatch } from "@/services/creative/batch-dispatch";

export const maxDuration = 300;

const DEFAULT_COUNT = 10;
const MAX_COUNT = 20;
const CONCURRENCY = 4;

async function unguardedPOST(
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
      templates = [...new Map(body.templateIds
        .map((id) => getScriptTemplate(id))
        .filter((t): t is ScriptTemplate => t !== null)
        .map((template) => [template.id, template] as const)).values()]
        .slice(0, MAX_COUNT);
      if (!templates.length) {
        return NextResponse.json({ error: "No valid templateIds" }, { status: 400 });
      }
    } else {
      templates = defaultTemplateBatch(ctx.platformId, count, ctx.goalType);
    }

    const angles = Array.isArray(body.angles) ? body.angles : [];
    const requestedType = typeof body.videoType === "string" ? body.videoType.toUpperCase() : "";
    const overrideType: VideoType | null = isVideoType(requestedType) ? requestedType : null;
    const totalDurationSec = Number(body.totalDurationSec) || ctx.totalDurationSec;

    const claimsAudit = auditContext(ctx);

    const writeOne = (template: ScriptTemplate, i: number) =>
      writeBatchScript(projectId, ctx, claimsAudit, template, i, {
        angles,
        overrideType,
        totalDurationSec,
        customBrief: body.customBrief,
      });

    if (body.background) {
      const running = await runningJob(projectId, "scripts");
      if (running) return NextResponse.json({ jobId: running.id, reused: true }, { status: 202 });
      const job = await createJob(
        projectId,
        "scripts",
        templates.map((t) => ({ key: t.id, label: t.name })),
        { templateIds: templates.map((t) => t.id), angles, videoType: overrideType, totalDurationSec, customBrief: body.customBrief ?? null }
      );
      await enqueueCreativeBatch(job.id);
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
              error: safePublicError(r.reason),
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
      { error: safePublicError(err) },
      { status: 500 }
    );
  }
}

export const POST = withAccess(unguardedPOST);
