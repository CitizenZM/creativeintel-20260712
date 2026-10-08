/**
 * Account allowance — sign-up is open, so a member must never be able to spend the platform's
 * provider credit without limit. Each member account gets a monthly paid-AI allowance (UTC calendar
 * month) across ALL of its projects: AppUser.monthlyAllowanceUsd, else MEMBER_MONTHLY_ALLOWANCE_USD,
 * else $1. The master admin's account (tenant null — src/services/tenancy.ts) is never capped here.
 *
 * Enforced in two places:
 *  - the spend ledger (spend-ledger-prisma.ts): every guarded call reserves against it atomically,
 *    under a per-account advisory lock, so it holds for background runs (autopilot, cron) too;
 *  - assertAccountAllowance() at the paid call sites that don't go through the ledger (direct image
 *    engines, OpenRouter media, Veo / fal submits in the studio routes).
 * "Spent" is the larger of the ledger total and the provider-reported AI usage of the account's
 * projects this month — each alone can miss calls, neither double-counts.
 */
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { tenantOfProject, tenantProjectWhere } from "@/services/tenancy";
import { BudgetExceededError, type SpendKind } from "./budget-guard";

export const DEFAULT_MEMBER_ALLOWANCE_USD = 1;

type Db = Pick<typeof prisma, "appUser" | "project" | "spendEntry" | "aiUsage" | "falVideoJob">;
const round = (n: number) => Math.round(n * 1e6) / 1e6;

export function monthStartUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** MEMBER_MONTHLY_ALLOWANCE_USD when it's a non-negative number, else $1. */
export function defaultMemberAllowance(raw = process.env.MEMBER_MONTHLY_ALLOWANCE_USD): number {
  const n = raw == null || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_MEMBER_ALLOWANCE_USD;
}

export interface AccountLimit {
  /** The member's AppUser.id. */
  tenant: string;
  allowanceUsd: number;
}

/** The member account a project belongs to and its allowance; null for the admin's (uncapped) projects. */
export async function accountLimitOfProject(projectId: string, db: Db = prisma): Promise<AccountLimit | null> {
  const tenant = await tenantOfProject(projectId);
  if (!tenant) return null;
  const user = await db.appUser.findUnique({ where: { id: tenant }, select: { role: true, monthlyAllowanceUsd: true } });
  if (!user || user.role === "owner") return null;
  return { tenant, allowanceUsd: user.monthlyAllowanceUsd ?? defaultMemberAllowance() };
}

async function tenantProjectIds(tenant: string, db: Db): Promise<string[]> {
  const rows = await db.project.findMany({ where: tenantProjectWhere(tenant) as Prisma.ProjectWhereInput, select: { id: true } });
  return rows.map((r) => r.id);
}

/** The account's spend this month in the ledger (open reservations at their estimate). */
export async function ledgerSpentThisMonth(tenant: string, db: Db = prisma, now = new Date()): Promise<number> {
  const ids = await tenantProjectIds(tenant, db);
  if (!ids.length) return 0;
  const where = { projectId: { in: ids }, createdAt: { gte: monthStartUtc(now) } };
  const [open, settled] = await Promise.all([
    db.spendEntry.aggregate({ where: { ...where, actualUsd: null }, _sum: { estUsd: true } }),
    db.spendEntry.aggregate({ where: { ...where, actualUsd: { not: null } }, _sum: { actualUsd: true } }),
  ]);
  return round((open._sum.estUsd ?? 0) + (settled._sum.actualUsd ?? 0));
}

/**
 * max(ledger, provider-reported AI usage + direct video jobs still rendering) for the account this
 * month. A fal / Veo clip from the studio routes is only logged as usage when its poll completes, so
 * until then its recorded cost counts here — parallel submits can't slip past the allowance.
 */
export async function accountSpentThisMonth(tenant: string, db: Db = prisma, now = new Date()): Promise<number> {
  const ids = await tenantProjectIds(tenant, db);
  if (!ids.length) return 0;
  const since = monthStartUtc(now);
  const [ledger, usage, inflight] = await Promise.all([
    ledgerSpentThisMonth(tenant, db, now),
    db.aiUsage.aggregate({ where: { projectId: { in: ids }, createdAt: { gte: since } }, _sum: { costUsd: true } }),
    db.falVideoJob.aggregate({
      where: { projectId: { in: ids }, createdAt: { gte: since }, status: { notIn: ["completed", "failed"] } },
      _sum: { costUsd: true },
    }),
  ]);
  return round(Math.max(ledger, (usage._sum.costUsd ?? 0) + (inflight._sum.costUsd ?? 0)));
}

/**
 * Throw (a BudgetExceededError at level "account") when `estUsd` more would take this project's member
 * account past its monthly allowance. No-op for the admin's projects and when no project is known.
 */
export async function assertAccountAllowance(
  projectId: string | null | undefined,
  estUsd: number,
  what: { kind: SpendKind; model: string },
): Promise<void> {
  if (!projectId || process.env.SPEND_GUARD === "off") return;
  const limit = await accountLimitOfProject(projectId);
  if (!limit) return;
  const spent = await accountSpentThisMonth(limit.tenant);
  if (spent + estUsd > limit.allowanceUsd + 1e-9) {
    throw new BudgetExceededError({ projectId, kind: what.kind, model: what.model }, estUsd, {
      level: "account",
      limitUsd: limit.allowanceUsd,
      spentUsd: spent,
    });
  }
}

/** A refused allowance as an HTTP answer (402, like strict free mode), or null for any other error. */
export function allowanceRefusalBody(err: unknown): { error: string; code: "ACCOUNT_ALLOWANCE" } | null {
  if (err instanceof BudgetExceededError && err.refusal.level === "account") return { error: err.message, code: "ACCOUNT_ALLOWANCE" };
  return null;
}

/** For /settings/users and the member's own spend view: allowance, used, remaining this month. */
export async function accountUsage(tenant: string): Promise<{ allowanceUsd: number; spentUsd: number; remainingUsd: number }> {
  const user = await prisma.appUser.findUnique({ where: { id: tenant }, select: { monthlyAllowanceUsd: true } });
  const allowanceUsd = user?.monthlyAllowanceUsd ?? defaultMemberAllowance();
  const spentUsd = await accountSpentThisMonth(tenant);
  return { allowanceUsd, spentUsd, remainingUsd: round(Math.max(0, allowanceUsd - spentUsd)) };
}
