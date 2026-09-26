import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { describeMetaError, searchMetaAdLibrary } from "@/services/research/meta-ads";
import { generateImage, getVideoTask, isZhipuConfigured, submitVideo, zhipuKey, ZHIPU_BASE_URL, ZHIPU_FREE } from "@/services/ai/zhipu";
import { persistDataUrl } from "@/services/ai/image-engine";

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

  // ?full=1 also exercises the free vision, image and video models (each call is free);
  // ?task=<id> reports a submitted CogVideoX-Flash task.
  const params = new URL(request.url).searchParams;
  const extra: Record<string, unknown> = {};
  const task = params.get("task");
  if (task) extra.videoTask = await check(() => getVideoTask(task));
  if (params.get("full") === "1" && isZhipuConfigured()) {
    const sample = "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png";
    const [vision, image, video] = await Promise.all([
      check(async () => {
        const res = await fetch(`${ZHIPU_BASE_URL}chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${zhipuKey()}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: ZHIPU_FREE.vision,
            messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: sample } }, { type: "text", text: "In five words, what is in this image?" }] }],
            max_tokens: 40,
            thinking: { type: "disabled" },
          }),
          signal: AbortSignal.timeout(45_000),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string }; choices?: { message?: { content?: string } }[] };
        return { status: res.status, error: body.error?.message, answer: body.choices?.[0]?.message?.content?.slice(0, 120) };
      }),
      check(async () => ({ url: await generateImage("A studio product photo of an emerald green travel duffle bag", { aspectRatio: "9:16" }) })),
      check(async () => ({ taskId: await submitVideo({ prompt: "Slow push-in on an emerald green travel duffle bag on a hotel bed, soft morning light", aspectRatio: "9:16" }) })),
    ]);
    Object.assign(extra, { vision, image, video });
  }

  return NextResponse.json({ db, meta, zhipu, ...extra, costMode: process.env.AI_COST_MODE ?? "default" });
}

/**
 * Maintenance: move base64 frame images out of Storyboard.frames into asset
 * storage (they were saved inline before image-engine persisted them).
 */
export async function POST(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { action?: string };
  if (body.action !== "externalize-frame-images") return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Storyboard" WHERE frames::text LIKE '%"imageUrl": "data:%' OR frames::text LIKE '%"imageUrl":"data:%' LIMIT 20`;
  let images = 0;
  for (const { id } of rows) {
    const board = await prisma.storyboard.findUnique({ where: { id }, select: { frames: true, projectId: true } });
    const frames = Array.isArray(board?.frames) ? (board!.frames as Record<string, unknown>[]) : [];
    const next = [];
    for (const f of frames) {
      const url = typeof f.imageUrl === "string" ? f.imageUrl : null;
      if (url?.startsWith("data:")) {
        const stored = await persistDataUrl(url, `storyboards/${board!.projectId}`);
        if (stored !== url) images++;
        next.push({ ...f, imageUrl: stored });
      } else next.push(f);
    }
    await prisma.storyboard.update({ where: { id }, data: { frames: next as never } });
  }
  return NextResponse.json({ storyboards: rows.length, images });
}
