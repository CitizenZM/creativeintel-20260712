/**
 * Request header the proxy sets to the signed-in person's AppUser.id (src/proxy.ts). Route handlers
 * and the spend ledger read it (src/services/ops/actor.ts) to bill a coworker's work on a shared
 * project to their own allowance. The proxy deletes any incoming copy, so it can't be spoofed.
 */
export const ACTOR_HEADER = "x-ci-actor";
