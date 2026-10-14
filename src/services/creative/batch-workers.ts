import { COMPLIANCE_FLAG } from "@/lib/script-pick";
import { auditScriptClaims, repairScriptCta, scriptV2Schema, type ScriptV2 } from "@/lib/script-schema";
import { analyzeWithClaude } from "@/services/ai/claude-client";
import { buildScriptWritingPrompt } from "@/services/ai/prompts/script-writing";
import type { ScriptTemplate, VideoType } from "@/services/ai/prompts/script-templates";
import { buildStoryboardCreateData } from "@/services/ai/storyboard-generator";
import { createStoryboardVersion } from "@/services/creative-library";
import {
  buildScriptInput,
  persistScript,
  formatComplianceViolations,
  type ScriptAngle,
  type ScriptContext,
} from "@/app/api/projects/[projectId]/creative/_script-context";

export async function writeBatchScript(
  projectId: string,
  ctx: ScriptContext,
  claimsAudit: ReturnType<typeof import("@/app/api/projects/[projectId]/creative/_script-context").auditContext>,
  template: ScriptTemplate,
  index: number,
  options: {
    angles: ScriptAngle[];
    overrideType: VideoType | null;
    totalDurationSec: number;
    customBrief?: string;
  }
) {
  const videoType = options.overrideType ?? template.videoType;
  const angle = options.angles.length ? options.angles[index % options.angles.length] : undefined;
  const prompt = buildScriptWritingPrompt(buildScriptInput(ctx, {
    template,
    videoType,
    angle,
    totalDurationSec: options.totalDurationSec,
    customBrief: options.customBrief?.trim() || undefined,
  }));

  let generated: ScriptV2 = await analyzeWithClaude({
    systemPrompt: prompt.system, userPrompt: prompt.user,
    responseSchema: scriptV2Schema, maxTokens: 8000,
  });
  generated = repairScriptCta(generated, claimsAudit);
  let audit = auditScriptClaims(generated, claimsAudit);
  if (!audit.ok) {
    generated = await analyzeWithClaude({
      systemPrompt: prompt.system,
      userPrompt: `${prompt.user}\n\nCOMPLIANCE FAILURE — the previous draft violated brand rules. Fix these lines:\n${formatComplianceViolations(audit.violations)}`,
      responseSchema: scriptV2Schema,
      maxTokens: 8000,
    });
    generated = repairScriptCta(generated, claimsAudit);
    audit = auditScriptClaims(generated, claimsAudit);
  }
  if (!audit.ok) {
    console.warn(`[scripts-batch] compliance violations persisted for project ${projectId}, template ${template.id}:`, audit.violations);
    generated = { ...generated, title: `${COMPLIANCE_FLAG}${generated.title}` };
  }
  const script = await persistScript(projectId, generated, {
    template,
    complianceNotes: audit.ok ? undefined : audit.violations.map((v) => v.reason),
    videoType,
    totalDurationSec: options.totalDurationSec,
    angleTitle: angle?.title,
  });
  return audit.ok ? script : { ...script, complianceWarnings: audit.violations };
}

export async function writeBatchStoryboard(
  projectId: string,
  script: Parameters<typeof buildStoryboardCreateData>[1],
  project: Parameters<typeof buildStoryboardCreateData>[2],
  campaignSel: Parameters<typeof buildStoryboardCreateData>[3],
  extras: Parameters<typeof buildStoryboardCreateData>[4]
) {
  const data = await buildStoryboardCreateData(projectId, script, project, campaignSel, extras);
  return createStoryboardVersion(data);
}
