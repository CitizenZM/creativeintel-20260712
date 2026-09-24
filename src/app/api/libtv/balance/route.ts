/**
 * GET  — estimated LibTV credits left (latest reading minus spend since).
 * POST {balance} — record the balance shown in LibTV's top bar right now.
 */
import { NextResponse } from "next/server";
import { getBalanceEstimate, recordBalance } from "@/services/video-gen/libtv-balance";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getBalanceEstimate());
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { balance?: unknown; note?: unknown };
  const balance = Number(body.balance);
  if (!Number.isInteger(balance) || balance < 0 || balance > 100_000_000) {
    return NextResponse.json({ error: "balance must be a whole number of credits" }, { status: 400 });
  }
  const note = typeof body.note === "string" ? body.note.slice(0, 200) : null;
  return NextResponse.json(await recordBalance(balance, note), { status: 201 });
}
