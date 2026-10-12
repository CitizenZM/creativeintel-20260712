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
  /**
   * Shared by every copy of this scope: the first budget / allowance refusal raised under it. A route
   * that catches the error and answers a generic 500 would hide it, so withAccess reads it back and
   * answers 402 instead.
   */
  state: { refusal?: unknown };
}

const store = new AsyncLocalStorage<SpendScopeContext>();

export function withSpendScope<T>(
  ctx: { projectId: string; actorId?: string | null; state?: SpendScopeContext["state"] },
  fn: () => T,
): T {
  return store.run({ projectId: ctx.projectId, actorId: ctx.actorId, guarded: false, state: ctx.state ?? {} }, fn);
}

/** Remember a refusal on the current scope (no-op outside one) so the request can still answer 402. */
export function noteRefusal(err: unknown): void {
  const scope = store.getStore();
  if (scope && scope.state.refusal === undefined) scope.state.refusal = err;
}

export function currentSpendScope(): SpendScopeContext | undefined {
  return store.getStore();
}

/** Run `fn` as already-guarded: nested paid calls inside it are covered by the caller's reservation. */
export function runGuarded<T>(fn: () => T): T {
  const cur = store.getStore();
  return cur ? store.run({ ...cur, guarded: true }, fn) : fn();
}
