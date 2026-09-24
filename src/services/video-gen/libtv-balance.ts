/**
 * Estimated LibTV credit balance. LibTV has no balance API (and its CLI no
 * balance command), so a person records the number from LibTV's top bar and
 * the app subtracts what every run has spent since.
 */
import { prisma } from "@/lib/db";

export interface BalanceEstimate {
  /** Last reading entered by a person, or null if never recorded. */
  recorded: number | null;
  recordedAt: string | null;
  /** Credits spent by runs that finished after the reading. */
  spentSince: number;
  runsSince: number;
  /** recorded - spentSince, or null when there is no reading. */
  estimate: number | null;
}

export async function getBalanceEstimate(): Promise<BalanceEstimate> {
  const latest = await prisma.libtvBalance.findFirst({ orderBy: { recordedAt: "desc" } });
  if (!latest) return { recorded: null, recordedAt: null, spentSince: 0, runsSince: 0, estimate: null };
  const spent = await prisma.libtvRun.aggregate({
    where: { completedAt: { gt: latest.recordedAt }, creditsSpent: { gt: 0 } },
    _sum: { creditsSpent: true },
    _count: { _all: true },
  });
  const spentSince = spent._sum.creditsSpent ?? 0;
  return {
    recorded: latest.balance,
    recordedAt: latest.recordedAt.toISOString(),
    spentSince,
    runsSince: spent._count._all,
    estimate: latest.balance - spentSince,
  };
}

export async function recordBalance(balance: number, note?: string | null) {
  await prisma.libtvBalance.create({ data: { balance, note: note ?? null } });
  return getBalanceEstimate();
}
