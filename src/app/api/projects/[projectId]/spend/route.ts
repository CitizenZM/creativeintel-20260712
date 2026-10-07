/**
 * GET  ?since=ISO — the project's budget, spent amount and the SpendEntry ledger by kind / model / run.
 * POST { usd: number | null, runId?, confirm: true } — set (or with null remove) the owner-approved USD
 *      cap for the project or one run. `confirm` is the UI's explicit confirm step; without it nothing changes.
 * Same services as the operator's spend-report / set-budget actions.
 */
import { NextResponse } from "next/server";
import { parseOperatorAction } from "@/services/operator";
import { setBudgetAction, spendReportAction } from "@/services/ops/operator-ops";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const since = new URL(request.url).searchParams.get("since") ?? undefined;
  const r = await spendReportAction({ projectId, since });
  return NextResponse.json(r.body, { status: r.status });
}

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || body.confirm !== true) return NextResponse.json({ error: "Confirm the new budget (confirm: true)" }, { status: 400 });
  const parsed = parseOperatorAction("set-budget", { projectId, runId: body.runId ?? undefined, usd: body.usd });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const r = await setBudgetAction(parsed.data);
  return NextResponse.json(r.body, { status: r.status });
}
