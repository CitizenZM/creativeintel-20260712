import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

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

function createPrismaClient() {
  const { connectionString, schema, ssl } = splitSchema(process.env.APP_DATABASE_URL || process.env.DATABASE_URL);
  const adapter = new PrismaPg({ connectionString, ssl }, schema ? { schema } : undefined);
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma || createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
