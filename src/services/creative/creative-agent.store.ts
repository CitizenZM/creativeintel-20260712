/**
 * Creative Agent persistence: load the project's plan (+ the targeted storyboard), run one agent
 * turn (one spend-guarded model call), store the new plan / frames and push the prior state onto
 * Project.creativeEditHistory (last 10) so `undo` can restore it. Shared by the operator actions
 * creative-agent / creative-agent-undo and POST /api/projects/[projectId]/creative-agent.
 */
import { prisma } from "@/lib/db";
import { appendFrameHistory, LIVE } from "@/services/creative-library";
import { archiveAround, archiveProjectFields, archiveStoryboard, type ArchiveOptions } from "@/services/artifacts/archive";
import type { CampaignPlan, PlatformPlan } from "./campaign-plan.types";
import type { LlmFn } from "./campaign-planner";
import { agentOutputSchema, HISTORY_LIMIT, popHistory, pushHistory, runCreativeAgent, type ApplyDeps, type StoryboardFrameLike } from "./creative-agent";
import type { ProductBrief } from "./product-brief";

type Result = { status: number; body: Record<string, unknown> };
const err = (status: number, error: string): Result => ({ status, body: { error } });

/** The agent's model call, inside the spend guard (refused before the provider when over budget). */
function guardedAgentLlm(projectId: string): LlmFn {
  return async ({ system, user }) => {
    const [{ guardLlm }, { analyzeWithClaude }] = await Promise.all([import("@/services/ops/spend"), import("@/services/ai/claude-client")]);
    return guardLlm({ projectId }, { inTokens: Math.ceil((system.length + user.length) / 4), outTokens: 1500 }, () =>
      analyzeWithClaude({ systemPrompt: system, userPrompt: user, responseSchema: agentOutputSchema, maxTokens: 2500 })
    );
  };
}

/** regenerateCopy: the campaign copywriter's one pass, guarded the same way (scaffold copy on failure). */
function guardedRewrite(projectId: string): NonNullable<ApplyDeps["rewrite"]> {
  return async (scaffold: PlatformPlan, brief: ProductBrief, plan: CampaignPlan) => {
    const [{ guardLlm }, { analyzeWithClaude }, planner] = await Promise.all([import("@/services/ops/spend"), import("@/services/ai/claude-client"), import("./campaign-planner")]);
    const llm: LlmFn = ({ system, user }) =>
      guardLlm({ projectId }, { inTokens: Math.ceil((system.length + user.length) / 4), outTokens: 3000 }, () =>
        analyzeWithClaude({ systemPrompt: system, userPrompt: user, responseSchema: planner.campaignCopySchema, maxTokens: 3500 })
      );
    const res = await planner.writeCampaignScripts(scaffold, brief, { goal: plan.goal, promo: plan.promo, runDate: plan.runDate, strictCompliance: plan.strictCompliance, llm });
    return res.plan;
  };
}

export async function creativeAgentTurn(projectId: string, message: string, storyboardId?: string | null, deps: { llm?: LlmFn; rewrite?: ApplyDeps["rewrite"] } = {}): Promise<Result> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, campaignPlan: true, productBrief: true, creativeEditHistory: true } });
  if (!project) return err(404, "Project not found");
  const plan = project.campaignPlan as CampaignPlan | null;
  if (!plan?.platforms?.length) return err(409, "No campaign plan on this project — run plan-campaign first");
  const board = storyboardId
    ? await prisma.storyboard.findFirst({ where: { id: storyboardId, projectId, ...LIVE }, select: { id: true, frames: true, frameHistory: true } })
    : null;
  if (storyboardId && !board) return err(404, "Storyboard not found");
  const frames = board && Array.isArray(board.frames) ? (board.frames as StoryboardFrameLike[]) : null;

  const out = await runCreativeAgent({ plan, brief: project.productBrief as ProductBrief | null, frames }, message, {
    llm: deps.llm ?? guardedAgentLlm(projectId),
    rewrite: deps.rewrite ?? guardedRewrite(projectId),
  });
  if (out.error) return { status: 502, body: { error: `Creative agent model call failed: ${out.error}` } };

  const summary = out.applied.map((a) => a.summary);
  let history = project.creativeEditHistory;
  if (out.planChanged || out.framesChanged) {
    history = pushHistory(project.creativeEditHistory, {
      at: new Date().toISOString(),
      message: message.slice(0, 500),
      summary,
      ...(out.planChanged ? { plan } : {}),
      ...(out.framesChanged && board && frames ? { storyboard: { id: board.id, frames } } : {}),
    }) as never;
    const writes = [
      prisma.project.update({
        where: { id: projectId },
        data: { ...(out.planChanged ? { campaignPlan: out.plan as object, campaignPlanAt: new Date() } : {}), creativeEditHistory: history as object },
      }),
    ];
    if (out.framesChanged && board && out.frames) {
      let fh: unknown = board.frameHistory;
      const changed = new Set(out.changedFrames);
      for (const [k, f] of (frames ?? []).entries()) if (changed.has(Number(f.frameNumber ?? k + 1))) fh = appendFrameHistory(fh, Number(f.frameNumber ?? k + 1), f);
      writes.push(prisma.storyboard.update({ where: { id: board.id }, data: { frames: out.frames as object[], frameHistory: fh as object } }) as never);
    }
    await archiveAround("creative agent edit", archiveEdit(projectId, board?.id), () => prisma.$transaction(writes));
  }
  const depth = Array.isArray(history) ? history.length : 0;
  return {
    status: 200,
    body: {
      ok: true,
      reply: out.reply,
      applied: out.applied,
      rejected: out.rejected,
      summary,
      changed: { plan: out.planChanged, storyboard: out.framesChanged, frames: out.changedFrames },
      undo: { available: depth, limit: HISTORY_LIMIT },
    },
  };
}

/** Restore the state before the newest creative-agent edit (plan and/or storyboard frames). */
export async function undoCreativeEdit(projectId: string): Promise<Result> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, creativeEditHistory: true } });
  if (!project) return err(404, "Project not found");
  const top = popHistory(project.creativeEditHistory);
  if (!top) return err(409, "Nothing to undo");
  const { entry, rest } = top;
  const writes = [
    prisma.project.update({
      where: { id: projectId },
      data: { ...(entry.plan ? { campaignPlan: entry.plan as object, campaignPlanAt: new Date() } : {}), creativeEditHistory: rest as object },
    }),
  ];
  let restoredFrames = false;
  if (entry.storyboard) {
    const board = await prisma.storyboard.findFirst({ where: { id: entry.storyboard.id, projectId, ...LIVE }, select: { id: true } });
    if (board) {
      writes.push(prisma.storyboard.update({ where: { id: board.id }, data: { frames: entry.storyboard.frames as object[] } }) as never);
      restoredFrames = true;
    }
  }
  await archiveAround("creative agent undo", archiveEdit(projectId, entry.storyboard?.id), () => prisma.$transaction(writes));
  return { status: 200, body: { ok: true, undone: { at: entry.at, message: entry.message, summary: entry.summary }, restored: { plan: !!entry.plan, storyboard: restoredFrames }, undo: { available: rest.length, limit: HISTORY_LIMIT } } };
}

/** Content history of a chat edit / undo: the plan (with its edit snapshots) and the edited storyboard. */
function archiveEdit(projectId: string, storyboardId: string | null | undefined) {
  return async (o: ArchiveOptions) => {
    await archiveProjectFields(projectId, ["creativeEditHistory", "campaignPlan"], o);
    if (storyboardId) await archiveStoryboard(storyboardId, o);
  };
}

export async function creativeEditHistory(projectId: string): Promise<Result> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { creativeEditHistory: true } });
  if (!project) return err(404, "Project not found");
  const h = Array.isArray(project.creativeEditHistory) ? (project.creativeEditHistory as { at: string; message: string; summary: string[] }[]) : [];
  return { status: 200, body: { history: h.map((e) => ({ at: e.at, message: e.message, summary: e.summary })).reverse(), limit: HISTORY_LIMIT } };
}
