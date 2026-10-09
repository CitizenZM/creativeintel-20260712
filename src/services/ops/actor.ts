import { ACTOR_HEADER } from "@/lib/auth/actor";

/**
 * The AppUser.id of whoever is making the current request (set by the proxy), or null outside a
 * request (cron, worker, background work after the response) or in non-Clerk modes.
 */
export async function currentActorId(): Promise<string | null> {
  try {
    const { headers } = await import("next/headers");
    const value = (await headers()).get(ACTOR_HEADER);
    return value && /^[a-z0-9]{10,40}$/i.test(value) ? value : null;
  } catch {
    return null;
  }
}
