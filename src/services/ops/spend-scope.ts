import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Which project (and acting person) the current request or job is working for, so a paid model call
 * deep inside shared code (analyzeWithClaude has no projectId parameter) can reserve its cost in the
 * spend ledger and count against the right budget and monthly allowance.
 *
 * Established at the edges: every /api/projects/[projectId]/** handler (src/lib/auth/route-guard.ts)
 * and every operator action that names a project. Background work started from there (after(),
 * waitUntil) keeps the scope. `guarded` marks code already inside a spend guard, so a nested call
 * isn't reserved twice.
 */
export interface SpendScopeContext {
  projectId: string;
  /** AppUser.id of whoever triggered the work, when the proxy identified them. */
  actorId?: string | null;
  guarded?: boolean;
}

const store = new AsyncLocalStorage<SpendScopeContext>();

export function withSpendScope<T>(ctx: Omit<SpendScopeContext, "guarded">, fn: () => T): T {
  return store.run({ ...ctx, guarded: false }, fn);
}

export function currentSpendScope(): SpendScopeContext | undefined {
  return store.getStore();
}

/** Run `fn` as already-guarded: nested paid calls inside it are covered by the caller's reservation. */
export function runGuarded<T>(fn: () => T): T {
  const cur = store.getStore();
  return cur ? store.run({ ...cur, guarded: true }, fn) : fn();
}
