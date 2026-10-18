import { AsyncLocalStorage } from "node:async_hooks";

export interface AiTraceContext {
  traceId: string;
  stage?: string;
  runId?: string;
}

const traceStore = new AsyncLocalStorage<AiTraceContext>();

/** Carry one stable operation id across nested model calls and background steps. */
export function withAiTrace<T>(context: AiTraceContext, fn: () => T): T {
  return traceStore.run({ ...traceStore.getStore(), ...context }, fn);
}

export function currentAiTrace(): AiTraceContext | undefined {
  return traceStore.getStore();
}
