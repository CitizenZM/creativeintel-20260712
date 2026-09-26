import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { describeMetaError, searchMetaAdLibrary } from "@/services/research/meta-ads";
import { isZhipuConfigured, zhipuKey, ZHIPU_BASE_URL, ZHIPU_FREE } from "@/services/ai/zhipu";

export const maxDuration = 60;

// Live connectivity checks for the operator's tooling (worker token, not
// Access). Reports status only — never a key or token value.
function isAuthorized(request: Request): boolean {
  const expected = process.env.WORKER_TOKEN;
  const provided = request.headers.get("x-worker-token");
  if (!expected || !provided) return false;
  const a = createHash("sha256").update(expected).digest();
  const b = createHash("sha256").update(provided).digest();
  return timingSafeEqual(a, b);
}

async function check(fn: () => Promise<unknown>) {
  const started = Date.now();
  try {
    return { ok: true, ms: Date.now() - started, detail: await fn() };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [db, meta, zhipu] = await Promise.all([
    check(async () => ({ projects: await prisma.project.count() })),
    check(async () => {
      if (!process.env.META_ACCESS_TOKEN) return { configured: false };
      try {
        const ads = await searchMetaAdLibrary({ brand: "Rockbros", countries: ["GB", "DE"], limit: 3 });
        return { configured: true, connected: true, ads: ads.length };
      } catch (err) {
        return { configured: true, connected: false, ...describeMetaError(err) };
      }
    }),
    check(async () => {
      if (!isZhipuConfigured()) return { configured: false };
      const res = await fetch(`${ZHIPU_BASE_URL}chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${zhipuKey()}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: ZHIPU_FREE.text,
          messages: [{ role: "user", content: "Reply with OK" }],
          max_tokens: 8,
          thinking: { type: "disabled" },
        }),
        signal: AbortSignal.timeout(30_000),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string }; usage?: unknown };
      return { configured: true, status: res.status, error: body.error?.message, usage: body.usage };
    }),
  ]);

  return NextResponse.json({ db, meta, zhipu, costMode: process.env.AI_COST_MODE ?? "default" });
}
