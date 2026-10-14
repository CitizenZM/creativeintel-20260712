import { Prisma } from "@/generated/prisma/client";
import { splitSchema } from "@/lib/db";

/** Raw SQL must qualify tables: the pg adapter's schema setting only applies to Prisma-generated queries. */
export function sqlTable(name: string) {
  const url = process.env.VERCEL_ENV === "preview" ? process.env.PREVIEW_DATABASE_URL : process.env.APP_DATABASE_URL || process.env.DATABASE_URL;
  const { schema = "public" } = splitSchema(url);
  const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;
  return Prisma.raw(`${quote(schema)}.${quote(name)}`);
}
