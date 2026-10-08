/**
 * Content-history backfill (services/artifacts/backfill.ts) from a workstation.
 *
 *   npx vite-node --config vitest.config.ts scripts/backfill-artifacts.ts -- --all                 # dry run (default)
 *   npx vite-node --config vitest.config.ts scripts/backfill-artifacts.ts -- --project <id> --apply
 *   … --all --head 200 --json out.json          # review: HEAD-check up to 200 file URLs, per-project JSON
 *   … --all --apply --resume                     # continue from the checkpoint file after an interruption
 *
 * Flags: --project <id> | --all · --apply (write; default is a dry run) · --after <projectId> · --resume
 *        --max <projects> · --head <n> (HEAD sample, ≤ 200) · --interval <ms> (download spacing, default 250)
 *        --checkpoint <file> (default .artifacts-backfill.checkpoint.json) · --json <file> · --env <file>
 *
 * A dry run writes nothing anywhere: it records into an in-memory store and its DB session is opened
 * read-only (default_transaction_read_only=on), so even a bug could not write. Env: DATABASE_URL
 * (or APP_DATABASE_URL) from --env, .env.local or .env.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { splitSchema } from "../src/lib/db";
import { runBackfill, type BackfillResult, type ProjectBackfillSummary } from "../src/services/artifacts/backfill";
import { MemoryArtifactStore } from "../src/services/artifacts/record";
import { prismaBackfillDeps } from "../src/services/artifacts/prisma-store";
import { formatBytes } from "../src/services/artifacts/history-view";

function args(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[a.slice(2)] = next;
      i++;
    } else out[a.slice(2)] = true;
  }
  return out;
}

function line(p: ProjectBackfillSummary): string {
  const kinds = Object.entries(p.byKind)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${n}`)
    .join(", ");
  const bytes = p.bytesEstimated !== null ? `~${formatBytes(p.bytesEstimated)} files (measured ${formatBytes(p.bytesMeasured)} over ${p.filesMeasured})` : "files not measured";
  return `${p.name} [${p.projectId}] — ${p.artifacts} artifacts (${p.files} files, ${p.documents} docs ${formatBytes(p.documentBytes)}); ${kinds}; ${bytes}; HEAD ${p.headChecked}, broken ${p.broken.length}${p.errors.length ? `; errors ${p.errors.length}` : ""}`;
}

async function main() {
  const a = args(process.argv.slice(2));
  for (const f of [a.env, ".env.local", ".env"]) if (typeof f === "string" && existsSync(f)) loadEnv({ path: f, quiet: true });
  const dryRun = a.apply !== true;
  const url = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL (or APP_DATABASE_URL) is not set — pass --env <file>");
  if (!a.project && !a.all) throw new Error("Pass --project <id> or --all");

  const { connectionString, schema, ssl } = splitSchema(url);
  // Dry run: a read-only session, so nothing can be written whatever the code does.
  const adapter = new PrismaPg({ connectionString, ssl, ...(dryRun ? { options: "-c default_transaction_read_only=on" } : {}) }, schema ? { schema } : undefined);
  const db = new PrismaClient({ adapter });

  const checkpoint = typeof a.checkpoint === "string" ? a.checkpoint : ".artifacts-backfill.checkpoint.json";
  let after = typeof a.after === "string" ? a.after : null;
  if (a.resume === true && existsSync(checkpoint)) after = (JSON.parse(readFileSync(checkpoint, "utf8")) as { after?: string }).after ?? after;

  const deps = await prismaBackfillDeps(db, dryRun ? { store: new MemoryArtifactStore() } : {});
  console.log(`${dryRun ? "DRY RUN (read-only, nothing written)" : "APPLY"} — ${a.project ? `project ${a.project}` : `all projects${after ? ` after ${after}` : ""}`}`);
  let result: BackfillResult;
  try {
    result = await runBackfill(deps, {
      projectId: typeof a.project === "string" ? a.project : undefined,
      all: a.all === true,
      dryRun,
      after,
      maxProjects: typeof a.max === "string" ? Number(a.max) : undefined,
      headSample: typeof a.head === "string" ? Math.min(200, Number(a.head)) : 0,
      downloadIntervalMs: typeof a.interval === "string" ? Number(a.interval) : 250,
      onProject(p) {
        console.log(line(p));
        if (!dryRun) writeFileSync(checkpoint, JSON.stringify({ after: p.projectId, at: new Date().toISOString() }));
      },
    });
  } finally {
    await db.$disconnect();
  }
  const t = result.totals;
  console.log(
    `\n${t.projects} projects · ${t.artifacts} artifacts (${t.files} files, ${t.documents} docs ${formatBytes(t.documentBytes)}) · ${dryRun ? `would create ${t.wouldCreate}` : `created ${t.created}, existing ${t.exists}, completed ${t.enriched}`} · failed ${t.failed} · HEAD ${t.headChecked}, broken ${t.broken} · files ~${formatBytes(t.bytesEstimated)} (measured ${formatBytes(t.bytesMeasured)})`
  );
  if (!result.done) console.log(`Stopped early — continue with --after ${result.nextCursor} (or --resume)`);
  if (typeof a.json === "string") writeFileSync(a.json, JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
