/**
 * Fetch a URL through the operator's local browser when this server's own
 * fetch is refused.
 *
 * Confirmed from production on 2026-09-13: DuckDuckGo answers a Vercel IP with
 * HTTP 202 and a JS challenge, and DTC storefronts like ridge.com answer 403,
 * while both serve the same URLs normally from the Mac's residential IP. The
 * research worker already runs there driving ego-browser, so the page is
 * fetched there and read back through the existing WorkerTask queue.
 *
 * This blocks the caller, so only use it from background work (the research
 * runner) — never from a request a person is waiting on.
 */
import { prisma } from "@/lib/db";
import {
  enqueueWorkerTask,
  findRecentCompletedTask,
  payloadHash,
  type BrowserFetchResult,
} from "@/services/worker-tasks";

const DEFAULT_TIMEOUT_MS = 75_000;
const POLL_INTERVAL_MS = 2_000;
/** A page fetched this recently is reused rather than re-queued. */
const REUSE_WINDOW_MS = 30 * 60 * 1000;

function asResult(value: unknown): BrowserFetchResult | null {
  const r = (value ?? {}) as Partial<BrowserFetchResult>;
  if (typeof r.html !== "string" && typeof r.text !== "string") return null;
  return {
    finalUrl: r.finalUrl ?? "",
    status: typeof r.status === "number" ? r.status : 0,
    title: r.title ?? "",
    html: r.html ?? "",
    text: r.text ?? "",
  };
}

export async function fetchViaWorker(
  url: string,
  opts: { projectId?: string | null; waitMs?: number; timeoutMs?: number } = {}
): Promise<BrowserFetchResult | null> {
  const payload = { url, waitMs: opts.waitMs };
  const hash = payloadHash(payload);

  const reusable = await findRecentCompletedTask("browser_fetch", hash, REUSE_WINDOW_MS);
  if (reusable) {
    const hit = asResult(reusable.result);
    if (hit) return hit;
  }

  const { taskId } = await enqueueWorkerTask({
    projectId: opts.projectId ?? null,
    kind: "browser_fetch",
    payload,
    // Ahead of ad-library work: something is blocked waiting on this one.
    priority: 10,
  });
  if (!taskId) return null;

  const deadline = Date.now() + (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const task = await prisma.workerTask.findUnique({
      where: { id: taskId },
      select: { status: true, result: true },
    });
    if (!task) return null;
    if (task.status === "completed") return asResult(task.result);
    if (task.status === "failed") return null;
  }
  return null;
}
