/**
 * The production spend ledger: SpendEntry rows, Project.budgetUsd / spentUsd and
 * LibtvRun.approvedBudgetUsd. Reservation is one transaction under a per-project advisory lock,
 * so overlapping ticks (approve request, status poll, cron) can never reserve past the budget.
 */
import { prisma } from "@/lib/db";
import { budgetCheck, BudgetExceededError, type BudgetState, type SpendKind, type SpendLedger, type SpendReservation, type SpendScope } from "./budget-guard";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
const round = (n: number) => Math.round(n * 1e6) / 1e6;

async function lockProject(tx: Tx, projectId: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`spend:${projectId}`}))::text AS locked`;
}

async function spentSum(tx: Tx, where: { projectId: string; runId?: string }): Promise<number> {
  const [open, settled] = await Promise.all([
    tx.spendEntry.aggregate({ where: { ...where, actualUsd: null }, _sum: { estUsd: true } }),
    tx.spendEntry.aggregate({ where: { ...where, actualUsd: { not: null } }, _sum: { actualUsd: true } }),
  ]);
  return round((open._sum.estUsd ?? 0) + (settled._sum.actualUsd ?? 0));
}

async function state(tx: Tx, projectId: string, runId?: string | null): Promise<{ project: BudgetState; run: BudgetState | null }> {
  const [project, run, projectSpent, runSpent] = await Promise.all([
    tx.project.findUnique({ where: { id: projectId }, select: { budgetUsd: true } }),
    runId ? tx.libtvRun.findUnique({ where: { id: runId }, select: { approvedBudgetUsd: true } }) : null,
    spentSum(tx, { projectId }),
    runId ? spentSum(tx, { projectId, runId }) : 0,
  ]);
  return {
    project: { budgetUsd: project?.budgetUsd ?? null, spentUsd: projectSpent },
    run: runId ? { budgetUsd: run?.approvedBudgetUsd ?? null, spentUsd: runSpent } : null,
  };
}

export class PrismaSpendLedger implements SpendLedger {
  async reserve(scope: SpendScope, estUsd: number): Promise<SpendReservation> {
    return prisma.$transaction(
      async (tx) => {
        await lockProject(tx, scope.projectId);
        const s = await state(tx, scope.projectId, scope.runId);
        const refusal = budgetCheck(estUsd, s.project, s.run);
        if (refusal) throw new BudgetExceededError(scope, estUsd, refusal);
        const row = await tx.spendEntry.create({
          data: { projectId: scope.projectId, runId: scope.runId ?? null, jobId: scope.jobId ?? null, kind: scope.kind, model: scope.model.slice(0, 120), estUsd },
          select: { id: true },
        });
        await tx.project.updateMany({ where: { id: scope.projectId }, data: { spentUsd: round(s.project.spentUsd + estUsd) } });
        return { id: row.id, estUsd };
      },
      { timeout: 20_000, maxWait: 20_000 }
    );
  }

  async settle(entryId: string, actualUsd: number): Promise<void> {
    await prisma.$transaction(
      async (tx) => {
        const row = await tx.spendEntry.findUnique({ where: { id: entryId }, select: { projectId: true } });
        if (!row) return;
        await lockProject(tx, row.projectId);
        await tx.spendEntry.update({ where: { id: entryId }, data: { actualUsd: round(actualUsd) } });
        await tx.project.updateMany({ where: { id: row.projectId }, data: { spentUsd: await spentSum(tx, { projectId: row.projectId }) } });
      },
      { timeout: 20_000, maxWait: 20_000 }
    );
  }

  async openEntryForJob(jobId: string, kind: SpendKind): Promise<SpendReservation | null> {
    const row = await prisma.spendEntry.findFirst({ where: { jobId, kind, actualUsd: null }, orderBy: { createdAt: "desc" }, select: { id: true, estUsd: true } });
    return row ? { id: row.id, estUsd: row.estUsd } : null;
  }

  async setBudget(target: { projectId: string; runId?: string | null }, usd: number | null): Promise<void> {
    if (target.runId) {
      const { count } = await prisma.libtvRun.updateMany({ where: { id: target.runId, projectId: target.projectId }, data: { approvedBudgetUsd: usd } });
      if (!count) throw new Error("Run not found");
    } else {
      await prisma.project.update({ where: { id: target.projectId }, data: { budgetUsd: usd } });
    }
  }

  async budgets(projectId: string, runId?: string | null) {
    return prisma.$transaction((tx) => state(tx, projectId, runId));
  }

  async entries(filter: { projectId: string; runId?: string | null; since?: Date }) {
    return prisma.spendEntry.findMany({
      where: { projectId: filter.projectId, ...(filter.runId ? { runId: filter.runId } : {}), ...(filter.since ? { createdAt: { gte: filter.since } } : {}) },
      orderBy: { createdAt: "asc" },
      take: 5000,
    });
  }
}
