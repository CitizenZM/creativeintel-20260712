import { NextResponse } from "next/server";
import { analyzeWithClaude } from "@/services/ai/claude-client";
import { buildScriptWritingPrompt } from "@/services/ai/prompts/script-writing";
import {
  defaultTemplateBatch,
  getScriptTemplate,
  isVideoType,
  type ScriptTemplate,
  type VideoType,
} from "@/services/ai/prompts/script-templates";
import { scriptV2Schema } from "@/lib/script-schema";
import { withIdempotency } from "@/lib/idempotency";
import { pMapSettled } from "@/lib/parallel";
import {
  loadScriptContext,
  buildScriptInput,
  persistScript,
  type ScriptAngle,
} from "../_script-context";

export const maxDuration = 60;

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

    const settled = await pMapSettled(
      templates,
      async (template, i) => {
        const videoType = overrideType ?? template.videoType;
        const angle = angles.length ? angles[i % angles.length] : undefined;

        const prompt = buildScriptWritingPrompt(
          buildScriptInput(ctx, { template, videoType, angle, totalDurationSec })
        );

        const result = await analyzeWithClaude({
          systemPrompt: prompt.system,
          userPrompt: prompt.user,
          responseSchema: scriptV2Schema,
          maxTokens: 8000,
        });

        return persistScript(projectId, result, {
          template,
          videoType,
          totalDurationSec,
          angleTitle: angle?.title,
        });
      },
      { concurrency: CONCURRENCY }
    );

    const scripts = settled
      .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof persistScript>>> =>
        r.status === "fulfilled"
      )
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
