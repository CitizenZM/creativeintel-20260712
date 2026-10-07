/**
 * Post-deploy smoke test — the FREE checks against a deployed base URL. Read-only GETs plus two pure
 * operator calls; nothing is generated, spent, written or sent anywhere else.
 *
 *   health           GET  /api/health                → 200 {status: "ok"}
 *   health-video     GET  /api/health/video          → 200 {ready}
 *   status-page      GET  /status                    → 200
 *   project-page     GET  /projects/<id>             → 200            (--project / SMOKE_PROJECT_ID)
 *   operator-auth    POST /api/worker/operator, no token → 401
 *   select-creative  POST operator select-creative (pure: hooks + end card)  (token)
 *   estimate-run     POST operator estimate-run for a storyboard (free forecast)  (token + project + storyboard)
 *
 * Pages behind Cloudflare Access (every route but /api/worker|cron on the *.vercel.app alias) answer 401
 * or redirect to the Access host: reported as GATED — the deployment is up and the gate holds — unless
 * --strict, or Access service-token credentials were given (then a gate is a failure).
 *
 * Usage:
 *   npm run smoke -- [--base https://creativeintel.vercel.app] [--project <id>] [--storyboard <id>] [--strict]
 *   npx vite-node scripts/smoke.ts -- …          node --experimental-strip-types scripts/smoke.ts …   (CI: no install)
 * Env: SMOKE_BASE_URL, SMOKE_PROJECT_ID, SMOKE_STORYBOARD_ID, CI_WORKER_TOKEN (or SMOKE_WORKER_TOKEN),
 *      CF_ACCESS_CLIENT_ID + CF_ACCESS_CLIENT_SECRET (Access service token, for the Access host).
 * Exit 1 when any check fails. Self-contained (no imports) so CI can run it without npm ci.
 */

export type Outcome = "pass" | "fail" | "skip" | "gated";
export interface CheckResult {
  name: string;
  outcome: Outcome;
  status: number | null;
  ms: number;
  note: string;
}
export interface SmokeOptions {
  baseUrl: string;
  projectId?: string;
  storyboardId?: string;
  workerToken?: string;
  accessClientId?: string;
  accessClientSecret?: string;
  strict?: boolean;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
}
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const DEFAULT_BASE_URL = "https://creativeintel.vercel.app";

interface Probe {
  res: Response | null;
  status: number | null;
  ms: number;
  error?: string;
  text: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function probe(o: SmokeOptions, fetcher: FetchLike, path: string, init: RequestInit = {}): Promise<Probe> {
  const headers = new Headers(init.headers);
  if (o.accessClientId && o.accessClientSecret) {
    headers.set("CF-Access-Client-Id", o.accessClientId);
    headers.set("CF-Access-Client-Secret", o.accessClientSecret);
  }
  const retries = o.retries ?? 2;
  const started = Date.now();
  let lastError = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await sleep((o.retryDelayMs ?? 1500) * attempt);
    try {
      const res = await fetcher(`${o.baseUrl}${path}`, { ...init, headers, redirect: "manual", signal: AbortSignal.timeout(o.timeoutMs ?? 30_000) });
      // A gateway hiccup is retried like a network error; anything else is the deployment's answer.
      if ([502, 503, 504].includes(res.status) && attempt < retries) {
        lastError = `HTTP ${res.status}`;
        continue;
      }
      const text = await res.text().catch(() => "");
      return { res, status: res.status, ms: Date.now() - started, text };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  return { res: null, status: null, ms: Date.now() - started, error: lastError, text: "" };
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Cloudflare Access answered instead of the app: 401 on a gated route, or a redirect to another host. */
function accessGate(o: SmokeOptions, p: Probe): string | null {
  if (!p.res) return null;
  if (p.status === 401) return "401 from the Access gate";
  if (p.status && p.status >= 300 && p.status < 400) {
    const loc = p.res.headers.get("location") ?? "";
    try {
      const host = new URL(loc, o.baseUrl).host;
      if (host !== new URL(o.baseUrl).host) return `redirected to ${host} (Access)`;
    } catch {
      /* fall through */
    }
  }
  return null;
}

function result(name: string, p: Probe | null, outcome: Outcome, note: string): CheckResult {
  return { name, outcome, status: p?.status ?? null, ms: p?.ms ?? 0, note };
}

/** pass when ok(), gated when Access answered (unless strict / credentials), else fail. */
function judge(o: SmokeOptions, name: string, p: Probe, ok: () => string | null, gatedRoute = true): CheckResult {
  if (!p.res) return result(name, p, "fail", `network: ${p.error}`);
  const passNote = ok();
  if (passNote !== null) return result(name, p, "pass", passNote);
  const gate = gatedRoute ? accessGate(o, p) : null;
  if (gate) {
    const creds = !!(o.accessClientId && o.accessClientSecret);
    return result(name, p, o.strict || creds ? "fail" : "gated", creds ? `${gate} despite the service token` : gate);
  }
  return result(name, p, "fail", `unexpected HTTP ${p.status}: ${p.text.replace(/\s+/g, " ").slice(0, 120)}`);
}

const operatorPost = (o: SmokeOptions, body: Record<string, unknown> | null, token?: string): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json", ...(token ? { "x-worker-token": token } : {}) },
  body: JSON.stringify(body ?? {}),
});

export async function runSmoke(o: SmokeOptions, fetcher: FetchLike = fetch): Promise<CheckResult[]> {
  const out: CheckResult[] = [];

  const health = await probe(o, fetcher, "/api/health");
  out.push(judge(o, "health", health, () => (health.status === 200 && parseJson(health.text)?.status === "ok" ? "ok" : null)));

  const video = await probe(o, fetcher, "/api/health/video");
  out.push(
    judge(o, "health-video", video, () => {
      const j = parseJson(video.text);
      return video.status === 200 && typeof j?.ready === "boolean" ? `ready=${j.ready} mode=${j.mode ?? "?"}` : null;
    })
  );

  const status = await probe(o, fetcher, "/status");
  out.push(judge(o, "status-page", status, () => (status.status === 200 ? "rendered" : null)));

  if (o.projectId) {
    const page = await probe(o, fetcher, `/projects/${encodeURIComponent(o.projectId)}`);
    out.push(judge(o, "project-page", page, () => (page.status === 200 ? "rendered" : null)));
  } else out.push(result("project-page", null, "skip", "no --project / SMOKE_PROJECT_ID"));

  // /api/worker is exempt from Access: a 401 here is the app's own token check.
  const auth = await probe(o, fetcher, "/api/worker/operator", operatorPost(o, null));
  out.push(judge(o, "operator-auth", auth, () => (auth.status === 401 ? "rejected without a token" : null), false));

  if (o.workerToken) {
    const sel = await probe(o, fetcher, "/api/worker/operator", operatorPost(o, { action: "select-creative", category: "electronics", platform: "tiktok", goal: "cold" }, o.workerToken));
    out.push(judge(o, "select-creative", sel, () => (sel.status === 200 && parseJson(sel.text)?.ok === true && parseJson(sel.text)?.choice ? "3 hooks + end card" : null), false));
  } else out.push(result("select-creative", null, "skip", "no CI_WORKER_TOKEN"));

  if (o.workerToken && o.projectId && o.storyboardId) {
    const est = await probe(o, fetcher, "/api/worker/operator", operatorPost(o, { action: "estimate-run", projectId: o.projectId, storyboardId: o.storyboardId }, o.workerToken));
    out.push(
      judge(o, "estimate-run", est, () => {
        const j = parseJson(est.text);
        return est.status === 200 && j?.forecast ? `recommended $${j.recommendedBudgetUsd ?? "?"}` : null;
      }, false)
    );
  } else out.push(result("estimate-run", null, "skip", !o.workerToken ? "no CI_WORKER_TOKEN" : "needs --project and --storyboard"));

  return out;
}

export function exitCode(results: CheckResult[]): number {
  return results.some((r) => r.outcome === "fail") ? 1 : 0;
}

export function formatTable(results: CheckResult[], baseUrl: string): string {
  const rows = [["check", "result", "http", "ms", "note"], ...results.map((r) => [r.name, r.outcome.toUpperCase(), r.status === null ? "-" : String(r.status), String(r.ms), r.note])];
  const widths = rows[0].map((_, i) => Math.max(...rows.map((row) => row[i].length)));
  const line = (row: string[]) => row.map((c, i) => (i === 4 ? c : c.padEnd(widths[i]))).join("  ").trimEnd();
  const n = (o: Outcome) => results.filter((r) => r.outcome === o).length;
  return [`smoke ${baseUrl}`, line(rows[0]), ...rows.slice(1).map(line), `${n("pass")} pass · ${n("gated")} gated · ${n("skip")} skip · ${n("fail")} fail`].join("\n");
}

export function parseSmokeArgs(argv: string[], env: Record<string, string | undefined>): SmokeOptions {
  const flag = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
  };
  const base = flag("base") ?? env.SMOKE_BASE_URL ?? DEFAULT_BASE_URL;
  return {
    baseUrl: base.replace(/\/+$/, ""),
    projectId: flag("project") ?? (env.SMOKE_PROJECT_ID || undefined),
    storyboardId: flag("storyboard") ?? (env.SMOKE_STORYBOARD_ID || undefined),
    workerToken: env.SMOKE_WORKER_TOKEN || env.CI_WORKER_TOKEN || undefined,
    accessClientId: env.CF_ACCESS_CLIENT_ID || undefined,
    accessClientSecret: env.CF_ACCESS_CLIENT_SECRET || undefined,
    strict: argv.includes("--strict"),
  };
}

async function main() {
  const opts = parseSmokeArgs(process.argv.slice(2), process.env);
  const results = await runSmoke(opts);
  console.log(formatTable(results, opts.baseUrl));
  process.exitCode = exitCode(results);
}

if (!process.env.VITEST) {
  main().catch((err) => {
    console.error("smoke crashed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
