/**
 * Budget fallback (Barron 2026-11-18): "在openrouter等外部视频模型没有预算时候，全部生成自动转成用图片和图片模仿视频的幻灯片slider
 * 模型做合成视频，不影响你的项目进度。额度回复后再进行纯视频".
 * The Video Brain's balance probe (key cap + account credit) writes AppSetting `brain:budget`. While it says "out", every new
 * run and every queued run is planned as `visualMode: slides` with `zeroCost` (key frames from storyboard frames and product
 * photos, camera moves by ffmpeg: no video or image model spend) and marked `fallback: budget`. When budget is back, new runs
 * are video again; fallback runs are NOT regenerated automatically - they are listed as "can upgrade to video" for approval.
 * Setting: AppSetting `brain:policy.budgetFallback` (default on).
 */
import { prisma } from "@/lib/db";

export const BUDGET_KEY = "brain:budget";
export const BUDGET_STALE_MS = 6 * 3_600_000;

export interface BudgetState { out: boolean; detail?: string; at: string }
export interface BudgetInput { visualMode?: string; fallback?: string; zeroCost?: boolean; requestedVisualMode?: string; [k: string]: unknown }

/** pure: "out" only when the state is fresh (a stopped brain must not pin every run to slides) */
export function budgetOut(state: BudgetState | null | undefined, now = Date.now()): boolean {
  return !!state?.out && now - Date.parse(state.at) < BUDGET_STALE_MS;
}

/** pure: the run input with the budget fallback applied (or unchanged). Stock remix is already $0 and is left alone. */
export function applyBudgetMode<T extends BudgetInput>(input: T, out: boolean, enabled: boolean, engine: string): { input: T; changed: boolean } {
  if (!enabled || !out || engine === "remix" || (input.visualMode === "slides" && input.zeroCost)) return { input, changed: false };
  // a paid slides run (AI key frames) is made $0 too; requestedVisualMode keeps the upgrade path (an existing one wins)
  if (input.visualMode === "slides") return { input: { ...input, zeroCost: true, fallback: "budget", requestedVisualMode: input.requestedVisualMode ?? "slides" }, changed: true };
  return { input: { ...input, visualMode: "slides", fallback: "budget", zeroCost: true, requestedVisualMode: input.visualMode ?? "video" }, changed: true };
}

export async function budgetContext(now = Date.now()) {
  const [b, p] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: BUDGET_KEY } }),
    prisma.appSetting.findUnique({ where: { key: "brain:policy" } }),
  ]);
  const enabled = (p?.value as { budgetFallback?: boolean } | null)?.budgetFallback !== false;
  return { out: budgetOut(b?.value as BudgetState | null, now), enabled, state: (b?.value as BudgetState | null) ?? null };
}

export async function setBudget(state: BudgetState) {
  const v = state as never;
  await prisma.appSetting.upsert({ where: { key: BUDGET_KEY }, create: { key: BUDGET_KEY, value: v }, update: { value: v } });
}
