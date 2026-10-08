/**
 * Creative Agent chat for a project (Studio). Auth is the app-wide Cloudflare Access gate in
 * src/proxy.ts, as for every /api/projects route.
 *
 * GET  → { history: [{ at, message, summary }] } — newest first (the undo stack, last 10)
 * POST { message, storyboardId? } → one model call turns the instruction into edit ops (swap hook,
 *      end card, beat copy, retime, platforms, promo, cast, setting); valid ops are applied to the
 *      stored plan (or the storyboard's frames) → { reply, applied, rejected, summary, undo }
 * POST { action: "undo" } → restores the state before the newest edit
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { creativeAgentTurn, creativeEditHistory, undoCreativeEdit } from "@/services/creative/creative-agent.store";

export const maxDuration = 300;

const bodySchema = z.union([
  z.object({ action: z.literal("undo") }),
  z.object({ action: z.literal("message").optional(), message: z.string().trim().min(2).max(2000), storyboardId: z.string().min(1).optional() }),
]);

const reply = (r: { status: number; body: Record<string, unknown> }) => NextResponse.json(r.body, { status: r.status });

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return reply(await creativeEditHistory(projectId));
}

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues.slice(0, 5) }, { status: 400 });
  const body = parsed.data;
  try {
    if (body.action === "undo") return reply(await undoCreativeEdit(projectId));
    return reply(await creativeAgentTurn(projectId, body.message, body.storyboardId));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
