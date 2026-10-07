/**
 * Operator actions for the URL-to-Video Autopilot (route: /api/worker/operator):
 *   autopilot-start    create the autopilot and tick it after the response (202 + id)
 *   autopilot-approve  the owner's USD budget for a run waiting at the budget gate; resumes it
 *   autopilot-status   where it is (+ retry: true re-opens a failed one at the failed step)
 * The cron route /api/cron/autopilot keeps every running autopilot moving between calls.
 */
import { approveAutopilot, autopilotView, retryAutopilot, startAutopilot, tickAutopilot, advanceAutopilots, DEFAULT_TICK_MS } from "./engine";
import { prismaAutopilotStore } from "./store-prisma";
import { defaultAutopilotSteps } from "./steps";
import type { AutopilotInput } from "./types";

type Result = { status: number; body: Record<string, unknown> };
type Schedule = (task: () => Promise<unknown>) => void;

const deps = (budgetMs = DEFAULT_TICK_MS) => ({ store: prismaAutopilotStore, steps: defaultAutopilotSteps, budgetMs });
const tickLater = (schedule: Schedule, id: string) =>
  schedule(() => tickAutopilot(id, deps()).catch((err) => console.warn(`[autopilot] tick ${id}:`, err instanceof Error ? err.message : err)));

export type AutopilotOperatorInput =
  | ({ action: "autopilot-start" } & AutopilotInput)
  | { action: "autopilot-approve"; autopilotId: string; approvedBudgetUsd: number }
  | { action: "autopilot-status"; autopilotId: string; retry?: boolean };

export async function autopilotAction(input: AutopilotOperatorInput, schedule: Schedule): Promise<Result> {
  const store = prismaAutopilotStore;
  if (input.action === "autopilot-start") {
    const { action: _a, ...req } = input;
    try {
      const rec = await startAutopilot(req, store);
      tickLater(schedule, rec.id);
      return { status: 202, body: { ok: true, autopilotId: rec.id, autopilot: autopilotView(rec), note: "Ticking now; poll autopilot-status. It stops at awaiting_approval when the forecast is above approvedBudgetUsd." } };
    } catch (err) {
      return { status: 400, body: { error: err instanceof Error ? err.message : String(err) } };
    }
  }
  if (input.action === "autopilot-approve") {
    const r = await approveAutopilot(input.autopilotId, input.approvedBudgetUsd, store);
    if (!r.ok) return { status: r.status, body: { error: r.error } };
    tickLater(schedule, r.record.id);
    return { status: 202, body: { ok: true, autopilot: autopilotView(r.record) } };
  }
  if (input.retry) {
    const r = await retryAutopilot(input.autopilotId, store);
    if (!r.ok) return { status: r.status, body: { error: r.error } };
    tickLater(schedule, r.record.id);
    return { status: 202, body: { ok: true, autopilot: autopilotView(r.record) } };
  }
  const rec = await store.get(input.autopilotId);
  if (!rec) return { status: 404, body: { error: "Autopilot not found" } };
  return { status: 200, body: { ok: true, autopilot: autopilotView(rec) } };
}

/** Cron entry: advance every running autopilot within the budget. */
export function advanceAllAutopilots(budgetMs = 270_000) {
  return advanceAutopilots({ ...deps(budgetMs), limit: 10 });
}
