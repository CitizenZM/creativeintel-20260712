/**
 * Read-only reconciliation of provider invoices against submitted video tasks.
 * Input CSV columns: task_id,actual_cost_usd. Never changes app data.
 *
 * APP_DATABASE_URL=... pnpm tsx scripts/reconcile-video-billing.ts invoice.csv
 */
import { readFile } from "node:fs/promises";
import { prisma } from "../src/lib/db";

function csvRow(line: string): string[] {
  const fields: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && quoted && line[i + 1] === '"') { value += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) { fields.push(value.trim()); value = ""; }
    else value += ch;
  }
  fields.push(value.trim());
  return fields;
}

async function main() {
  const filename = process.argv[2];
  if (!filename) throw new Error("Usage: reconcile-video-billing.ts invoice.csv");
  const lines = (await readFile(filename, "utf8")).trim().split(/\r?\n/).filter(Boolean);
  const header = csvRow(lines.shift() ?? "");
  const idCol = header.indexOf("task_id");
  const costCol = header.indexOf("actual_cost_usd");
  if (idCol < 0 || costCol < 0) throw new Error("CSV requires task_id,actual_cost_usd columns");
  const invoice = lines.map(csvRow).map((row) => ({ taskId: row[idCol], actual: Number(row[costCol]) }));
  if (invoice.some((row) => !row.taskId || !Number.isFinite(row.actual) || row.actual < 0)) throw new Error("Invoice contains an invalid task ID or cost");

  const ids = invoice.map((row) => row.taskId);
  const [direct, runs, usage] = await Promise.all([
    prisma.falVideoJob.findMany({ where: { falRequestId: { in: ids } }, select: { id: true, falRequestId: true, model: true, costUsd: true, status: true } }),
    prisma.libtvJob.findMany({ where: { nodeId: { in: ids } }, select: { id: true, nodeId: true, status: true } }),
    prisma.aiUsage.findMany({ where: { requestId: { in: ids }, capability: "video" }, select: { requestId: true, costUsd: true } }),
  ]);
  const byDirect = new Map(direct.map((row) => [row.falRequestId, row]));
  const byRun = new Map(runs.map((row) => [row.nodeId, row]));
  const byUsage = new Map(usage.map((row) => [row.requestId, row]));
  for (const item of invoice) {
    const task = byDirect.get(item.taskId) ?? byRun.get(item.taskId);
    const logged = byUsage.get(item.taskId)?.costUsd ?? byDirect.get(item.taskId)?.costUsd ?? null;
    const delta = logged == null ? null : Math.round((item.actual - logged) * 100) / 100;
    console.log(JSON.stringify({ taskId: item.taskId, found: !!task, status: task?.status ?? null, estimateUsd: logged, actualUsd: item.actual, deltaUsd: delta, needsReview: !task || delta == null || Math.abs(delta) > 0.01 }));
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }).finally(() => prisma.$disconnect());
