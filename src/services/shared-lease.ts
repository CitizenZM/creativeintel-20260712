import { sqlTable } from "@/lib/sql-table";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";

/** Atomic, account-wide leases. A crashed function's slot expires automatically. */
export async function acquireSharedSlot(
  scope: string, capacity: number, leaseMs: number, waitMs: number, pollMs = 250,
): Promise<(() => Promise<void>) | null> {
  const owner = randomUUID();
  const deadline = Date.now() + waitMs;
  do {
    for (let slot = 0; slot < capacity; slot++) {
      const key = `${scope}:${slot}`;
      const rows = await prisma.$queryRaw<Array<{ key: string }>>`
        INSERT INTO ${sqlTable("SharedLease")} AS lease ("key", "owner", "expiresAt")
        VALUES (${key}, ${owner}, clock_timestamp() + ${leaseMs} * interval '1 millisecond')
        ON CONFLICT ("key") DO UPDATE SET "owner" = EXCLUDED."owner", "expiresAt" = EXCLUDED."expiresAt"
        WHERE lease."expiresAt" <= clock_timestamp()
        RETURNING "key"`;
      if (rows.length) {
        let released = false;
        const heartbeat = setInterval(() => {
          if (released) return;
          void prisma.$executeRaw`UPDATE ${sqlTable("SharedLease")}
            SET "expiresAt" = clock_timestamp() + ${leaseMs} * interval '1 millisecond'
            WHERE "key" = ${key} AND "owner" = ${owner}`.catch((error: unknown) => {
              console.error("[lease] renewal failed", error);
            });
        }, Math.max(1000, Math.floor(leaseMs / 3)));
        heartbeat.unref();
        return async () => {
          if (released) return;
          released = true;
          clearInterval(heartbeat);
          await prisma.$executeRaw`DELETE FROM ${sqlTable("SharedLease")} WHERE "key" = ${key} AND "owner" = ${owner}`;
        };
      }
    }
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, deadline - Date.now())));
  } while (Date.now() < deadline);
  return null;
}
