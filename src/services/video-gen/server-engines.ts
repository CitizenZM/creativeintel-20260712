/**
 * Registry of the engines the Next.js server renders itself (GLM, ComfyUI, animatic).
 * Routes and the cron sweep dispatch through here by `LibtvRun.executor`.
 */
import { isServerEngine, type ServerEngine } from "./libtv-pricing";
import { advanceActiveRuns, driveRun, type EngineAdapter, type TickResult } from "./server-executor";
import { glmAdapter } from "./glm-executor";
import { comfyAdapter } from "./comfy-executor";
import { animaticAdapter } from "./animatic-executor";

const ADAPTERS: Record<ServerEngine, EngineAdapter> = {
  glm: glmAdapter,
  comfyui: comfyAdapter,
  animatic: animaticAdapter,
};

export function adapterFor(executor: string | null | undefined): EngineAdapter | null {
  return isServerEngine(executor) ? ADAPTERS[executor] : null;
}

/** Tick a server-rendered run until it settles or the budget runs out; "idle" for LibTV runs. */
export async function driveServerRun(executor: string | null | undefined, runId: string, budgetMs: number): Promise<TickResult> {
  const adapter = adapterFor(executor);
  return adapter ? driveRun(adapter, runId, budgetMs) : "idle";
}

/** Cron sweep: advance active runs of every server engine in parallel (they use different backends). */
export async function advanceActiveServerRuns(budgetMs: number): Promise<Record<ServerEngine, number>> {
  const entries = await Promise.all(
    (Object.keys(ADAPTERS) as ServerEngine[]).map(async (engine) => {
      const count = await advanceActiveRuns(ADAPTERS[engine], budgetMs).catch((err) => {
        console.warn(`[${engine}] sweep failed:`, err instanceof Error ? err.message : err);
        return 0;
      });
      return [engine, count] as const;
    })
  );
  return Object.fromEntries(entries) as Record<ServerEngine, number>;
}
