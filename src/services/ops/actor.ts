import { ACTOR_HEADER } from "@/lib/auth/actor";
import { currentSpendScope } from "./spend-scope";

/**
 * The AppUser.id of whoever is making the current request (set by the proxy), or null outside a
 * request (cron, worker) or in non-Clerk modes. Background work started by a request (after(),
 * waitUntil) no longer has the request headers, so the spend scope carries the actor along.
 */
export async function currentActorId(): Promise<string | null> {
  const scoped = currentSpendScope()?.actorId;
  if (scoped) return scoped;
  try {
    const { headers } = await import("next/headers");
    const value = (await headers()).get(ACTOR_HEADER);
    return value && /^[a-z0-9]{10,40}$/i.test(value) ? value : null;
  } catch {
    return null;
  }
}
