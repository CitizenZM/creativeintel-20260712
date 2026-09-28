import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { describeMetaError, searchMetaAdLibrary } from "@/services/research/meta-ads";
import { generateImage, getVideoTask, isZhipuConfigured, submitVideo, zhipuKey, ZHIPU_BASE_URL, ZHIPU_FREE } from "@/services/ai/zhipu";
import { persistDataUrl } from "@/services/ai/image-engine";

export const maxDuration = 300;

// Live connectivity checks for the operator's tooling (worker token, not
// Access). Reports status only — never a key or token value.
const VBENCH_FRAMES = [
  "https://i.ytimg.com/vi/sjOKOun4aQo/maxresdefault.jpg",
  "https://i.ytimg.com/vi/sjOKOun4aQo/1.jpg",
  "https://i.ytimg.com/vi/sjOKOun4aQo/2.jpg",
  "https://i.ytimg.com/vi/sjOKOun4aQo/3.jpg",
];

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
    const detail = await fn();
    return { ok: true, ms: Date.now() - started, detail };
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
    const sample = params.get("vimg") || "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png";
    const [vision, image, video] = await Promise.all([
      check(async () => {
        // Zhipu's servers often can't fetch overseas hosts, so the app sends
        // images inline; check both inline forms it could use.
        const img = await fetch(sample, { signal: AbortSignal.timeout(20_000) });
        const b64 = Buffer.from(await img.arrayBuffer()).toString("base64");
        const type = img.headers.get("content-type")?.split(";")[0] || "image/png";
        const ask = async (url: string) => {
          const res = await fetch(`${ZHIPU_BASE_URL}chat/completions`, {
            method: "POST",
            headers: { Authorization: `Bearer ${zhipuKey()}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: ZHIPU_FREE.vision,
              messages: [{ role: "user", content: [{ type: "image_url", image_url: { url } }, { type: "text", text: "In five words, what is in this image?" }] }],
              max_tokens: 40,
              thinking: { type: "disabled" },
            }),
            signal: AbortSignal.timeout(45_000),
          });
          const body = (await res.json().catch(() => ({}))) as { error?: { message?: string }; choices?: { message?: { content?: string } }[] };
          return { status: res.status, error: body.error?.message, answer: body.choices?.[0]?.message?.content?.slice(0, 120) };
        };
        return { dataUrl: await ask(`data:${type};base64,${b64}`), rawBase64: await ask(b64) };
      }),
      check(async () => ({ url: await generateImage("A studio product photo of an emerald green travel duffle bag", { aspectRatio: "9:16" }) })),
      check(async () => ({ taskId: await submitVideo({ prompt: "Slow push-in on an emerald green travel duffle bag on a hotel bed, soft morning light", aspectRatio: "9:16" }) })),
    ]);
    Object.assign(extra, { vision, image, video });
  }

  // ?bench=1 times the same long JSON answer on each text model the ladder uses.
  if (params.get("bench") === "1") {
    const prompt =
      'Return JSON {"items":[...]} with 40 objects {"id":n,"hook":"a 12-word ad hook for a 4K TV","score":0-100,"why":"one sentence"}.';
    const models: [string, string, string][] = [
      ["glm", ZHIPU_BASE_URL, "glm-4.7-flash"],
      ["glm", ZHIPU_BASE_URL, "glm-4-flash-250414"],
      ["glm", ZHIPU_BASE_URL, "glm-4-air-250414"],
      ["openai", "https://api.openai.com/v1/", "gpt-4o-mini"],
    ];
    extra.bench = await Promise.all(
      models.map(async ([provider, base, model]) => {
        const key = provider === "glm" ? zhipuKey() : process.env.OPENAI_API_KEY;
        if (!key) return { model, skipped: "no key" };
        const t0 = Date.now();
        try {
          const res = await fetch(`${base}chat/completions`, {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model,
              max_tokens: 4000,
              response_format: { type: "json_object" },
              messages: [{ role: "user", content: prompt }],
              ...(model.startsWith("glm-4.7") ? { thinking: { type: "disabled" } } : {}),
            }),
            signal: AbortSignal.timeout(150_000),
          });
          const body = (await res.json().catch(() => ({}))) as { usage?: { completion_tokens?: number }; error?: { message?: string } };
          const secs = (Date.now() - t0) / 1000;
          const out = body.usage?.completion_tokens ?? 0;
          return { model, status: res.status, secs, outTokens: out, tokPerSec: out ? Math.round(out / secs) : 0, error: body.error?.message?.slice(0, 80) };
        } catch (err) {
          return { model, secs: (Date.now() - t0) / 1000, error: err instanceof Error ? err.message.slice(0, 80) : String(err) };
        }
      })
    );
  }

  // ?vbench=1 times one ad teardown (keyframes → JSON) on each vision model the
  // picker offers. ?vimgs=url1,url2 sets the frames (default: a TCL ad's).
  if (params.get("vbench") === "1") {
    const urls = (params.get("vimgs") || VBENCH_FRAMES.join(","))
      .split(",")
      .filter((u) => /^https:\/\//.test(u))
      .slice(0, 6);
    const images = (
      await Promise.all(
        urls.map(async (u) => {
          const res = await fetch(u, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
          if (!res?.ok) return null;
          const type = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
          return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
        })
      )
    ).filter((x): x is string => !!x);
    const prompt =
      "You are an ad strategist. These are keyframes of one video ad, in order. Return JSON {hook, beats:[{t, visual, onScreenText}], offer, cta, whyItWorks}. Describe only what you can see; quote on-screen text exactly.";
    const gemKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    const models: [string, string, string | undefined][] = [
      ["glm-4.6v-flash", ZHIPU_BASE_URL, zhipuKey() ?? undefined],
      ["glm-4.6v-flashx", ZHIPU_BASE_URL, zhipuKey() ?? undefined],
      ["gpt-4o-mini", "https://api.openai.com/v1/", process.env.OPENAI_API_KEY],
      ["gpt-4o", "https://api.openai.com/v1/", process.env.OPENAI_API_KEY],
      ["gemini-3.8-flash", "https://generativelanguage.googleapis.com/v1beta/openai/", gemKey],
    ];
    extra.vbench = {
      frames: images.length,
      results: await Promise.all(
        models.map(async ([model, base, key]) => {
          if (!key) return { model, skipped: "no key" };
          const t0 = Date.now();
          try {
            const res = await fetch(`${base}chat/completions`, {
              method: "POST",
              headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                model,
                max_tokens: 1500,
                messages: [
                  {
                    role: "user",
                    content: [{ type: "text", text: prompt }, ...images.map((url) => ({ type: "image_url", image_url: { url } }))],
                  },
                ],
              }),
              signal: AbortSignal.timeout(170_000),
            });
            const body = (await res.json().catch(() => ({}))) as {
              usage?: { prompt_tokens?: number; completion_tokens?: number };
              choices?: { message?: { content?: string } }[];
              error?: { message?: string };
            };
            const text = body.choices?.[0]?.message?.content ?? "";
            return {
              model,
              status: res.status,
              secs: (Date.now() - t0) / 1000,
              inTokens: body.usage?.prompt_tokens,
              outTokens: body.usage?.completion_tokens,
              quotes: (text.match(/onScreenText"\s*:\s*"[^"]{2,}/g) || []).length,
              sample: text.replace(/\s+/g, " ").slice(0, 400),
              error: body.error?.message?.slice(0, 120),
            };
          } catch (err) {
            return { model, secs: (Date.now() - t0) / 1000, error: err instanceof Error ? err.message.slice(0, 80) : String(err) };
          }
        })
      ),
    };
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
