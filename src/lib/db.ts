import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { attachDatabasePool } from "@vercel/functions";

const globalForPrisma = globalThis as unknown as { prisma: InstanceType<typeof PrismaClient> };

/**
 * `?schema=` in DATABASE_URL picks the Postgres schema (the app lives in its own
 * schema inside a shared Supabase database). The Prisma CLI reads it from the
 * URL; node-postgres doesn't understand it, so strip it and hand it to the adapter.
 */
export function splitSchema(url: string | undefined): {
  connectionString: string | undefined;
  schema?: string;
  ssl?: { rejectUnauthorized: false };
} {
  if (!url) return { connectionString: url };
  try {
    const u = new URL(url);
    const schema = u.searchParams.get("schema") || undefined;
    u.searchParams.delete("schema");
    // libpq's sslmode=require means "encrypt, don't verify"; node-postgres reads
    // it as verify-full and rejects Supabase's pooler chain. Keep libpq semantics.
    const ssl = u.searchParams.get("sslmode") === "require" ? ({ rejectUnauthorized: false } as const) : undefined;
    if (ssl) u.searchParams.delete("sslmode");
    return { connectionString: u.toString(), schema, ssl };
  } catch {
    return { connectionString: url };
  }
}

/**
 * Connection pool sizing for Vercel Fluid Compute. One function instance serves many concurrent
 * requests through this one pool, and every instance opens its own pool against Supabase's
 * Supavisor (transaction mode, :6543), whose client-connection cap is shared with the other apps on
 * that database. node-postgres' defaults (10 connections, wait forever for one, 10 s idle) let a
 * busy instance hoard connections and hang requests when the cap is reached. Instead:
 * - DB_POOL_MAX (default 5) connections per instance;
 * - fail fast after 5 s waiting for a connection (DB_POOL_ACQUIRE_TIMEOUT_MS) rather than hang;
 * - release idle connections after 5 s, and attachDatabasePool() closes them before the instance
 *   is suspended so they don't linger as dead clients on the pooler.
 */
export function poolOptions(env: NodeJS.ProcessEnv = process.env) {
  const int = (raw: string | undefined, fallback: number, min: number, max: number) => {
    const n = Number(raw);
    return Number.isFinite(n) && n >= min && n <= max ? Math.floor(n) : fallback;
  };
  return {
    max: int(env.DB_POOL_MAX, 5, 1, 50),
    connectionTimeoutMillis: int(env.DB_POOL_ACQUIRE_TIMEOUT_MS, 5_000, 500, 60_000),
    idleTimeoutMillis: int(env.DB_POOL_IDLE_TIMEOUT_MS, 5_000, 1_000, 60_000),
  };
}

function createPrismaClient() {
  const url = process.env.VERCEL_ENV === "preview" ? process.env.PREVIEW_DATABASE_URL : process.env.APP_DATABASE_URL || process.env.DATABASE_URL;
  if (process.env.VERCEL_ENV === "preview" && !url) throw new Error("Preview database is not configured");
  const { connectionString, schema, ssl } = splitSchema(url);
  const pool = new Pool({ connectionString, ssl, ...poolOptions() });
  // Idle clients are closed before Fluid suspends the instance (no-op outside Vercel).
  attachDatabasePool(pool);
  const adapter = new PrismaPg(pool, schema ? { schema } : undefined);
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma || createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
