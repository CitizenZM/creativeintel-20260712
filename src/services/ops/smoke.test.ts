import { describe, expect, it } from "vitest";
import { exitCode, formatTable, parseSmokeArgs, runSmoke, type FetchLike } from "../../../scripts/smoke";

const BASE = "https://ci.example.app";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const html = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/html" } });

/** A healthy deployment; `over` replaces a route's response. */
function fakeSite(over: Record<string, (init: RequestInit) => Response | Promise<Response>> = {}) {
  const seen: { method: string; path: string; headers: Record<string, string>; body?: { action?: string } }[] = [];
  const fetcher: FetchLike = async (input, init = {}) => {
    const url = new URL(String(input));
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    seen.push({ method: init.method ?? "GET", path: url.pathname, headers, body });
    const key = `${init.method ?? "GET"} ${url.pathname}${body?.action ? `#${body.action}` : ""}`;
    if (over[key]) return over[key](init);
    if (key === "GET /api/health") return json({ status: "ok", timestamp: "now" });
    if (key === "GET /api/health/video") return json({ ready: true, mode: "cloud" });
    if (key === "GET /status") return html("<h1>System status</h1>");
    if (key === "GET /projects/proj1") return html("<html>project</html>");
    if (url.pathname === "/api/worker/operator") {
      if (headers["x-worker-token"] !== "tok") return json({ error: "Unauthorized" }, 401);
      if (body?.action === "select-creative") return json({ ok: true, category: "electronics", choice: { hooks: [1, 2, 3] } });
      if (body?.action === "estimate-run") return json({ ok: true, forecast: { totals: { expected: 1.2 } }, recommendedBudgetUsd: 1.5 });
    }
    return json({ error: "not found" }, 404);
  };
  return { fetcher, seen };
}

const outcomes = (r: { name: string; outcome: string }[]) => Object.fromEntries(r.map((c) => [c.name, c.outcome]));

describe("runSmoke", () => {
  it("passes every check on a healthy deployment with a token and ids", async () => {
    const { fetcher, seen } = fakeSite();
    const results = await runSmoke({ baseUrl: BASE, projectId: "proj1", storyboardId: "sb1", workerToken: "tok" }, fetcher);
    expect(outcomes(results)).toEqual({
      health: "pass",
      "health-video": "pass",
      "status-page": "pass",
      "project-page": "pass",
      "operator-auth": "pass",
      "select-creative": "pass",
      "estimate-run": "pass",
    });
    expect(exitCode(results)).toBe(0);
    // Only read-only GETs and the two free, pure operator calls — nothing else is sent.
    expect(seen.filter((s) => s.method === "POST").map((s) => s.body?.action ?? "(none)")).toEqual(["(none)", "select-creative", "estimate-run"]);
    expect(seen.every((s) => s.path.startsWith("/"))).toBe(true);
    // The unauthenticated probe carries no token.
    expect(seen.find((s) => s.method === "POST" && !s.body?.action)?.headers["x-worker-token"]).toBeUndefined();
  });

  it("skips the token / id checks when they are not given", async () => {
    const { fetcher, seen } = fakeSite();
    const results = await runSmoke({ baseUrl: BASE }, fetcher);
    expect(outcomes(results)).toMatchObject({ "project-page": "skip", "select-creative": "skip", "estimate-run": "skip", "operator-auth": "pass" });
    expect(exitCode(results)).toBe(0);
    expect(seen.some((s) => s.headers["x-worker-token"])).toBe(false);
  });

  it("fails when the operator endpoint accepts a request without a token", async () => {
    const { fetcher } = fakeSite({ "POST /api/worker/operator": () => json({ ok: true }) });
    const results = await runSmoke({ baseUrl: BASE }, fetcher);
    expect(outcomes(results)["operator-auth"]).toBe("fail");
    expect(exitCode(results)).toBe(1);
  });

  it("reports pages behind the Access gate as gated (strict: failed)", async () => {
    const gate = {
      "GET /api/health": () => json({ error: "Unauthorized" }, 401),
      "GET /api/health/video": () => json({ error: "Unauthorized" }, 401),
      "GET /status": () => new Response(null, { status: 307, headers: { location: "https://creative.example.io/status" } }),
    };
    const { fetcher } = fakeSite(gate);
    const results = await runSmoke({ baseUrl: BASE }, fetcher);
    expect(outcomes(results)).toMatchObject({ health: "gated", "health-video": "gated", "status-page": "gated" });
    expect(exitCode(results)).toBe(0);
    const strict = await runSmoke({ baseUrl: BASE, strict: true }, fakeSite(gate).fetcher);
    expect(outcomes(strict).health).toBe("fail");
    expect(exitCode(strict)).toBe(1);
  });

  it("sends Access service-token headers when given, and then a gate is a failure", async () => {
    const { fetcher, seen } = fakeSite({ "GET /api/health": () => json({ error: "Unauthorized" }, 401) });
    const results = await runSmoke({ baseUrl: BASE, accessClientId: "id", accessClientSecret: "secret" }, fetcher);
    expect(seen[0].headers["cf-access-client-id"]).toBe("id");
    expect(outcomes(results).health).toBe("fail");
  });

  it("fails a broken check: 500 health, missing project", async () => {
    const { fetcher } = fakeSite({ "GET /api/health": () => json({ error: "boom" }, 500), "GET /projects/proj1": () => html("not found", 404) });
    const results = await runSmoke({ baseUrl: BASE, projectId: "proj1", retries: 0 }, fetcher);
    expect(outcomes(results)).toMatchObject({ health: "fail", "project-page": "fail" });
  });

  it("retries a flaky network before failing", async () => {
    let n = 0;
    const { fetcher } = fakeSite({
      "GET /api/health": () => {
        if (++n < 3) throw new TypeError("fetch failed");
        return json({ status: "ok" });
      },
    });
    const results = await runSmoke({ baseUrl: BASE, retries: 2, retryDelayMs: 0 }, fetcher);
    expect(outcomes(results).health).toBe("pass");
    expect(n).toBe(3);
  });

  it("prints a compact table with a summary line", async () => {
    const results = await runSmoke({ baseUrl: BASE }, fakeSite().fetcher);
    const table = formatTable(results, BASE);
    expect(table).toMatch(/check\s+result\s+http\s+ms\s+note/);
    expect(table).toMatch(/operator-auth\s+PASS\s+401/);
    expect(table).toMatch(/4 pass · 0 gated · 3 skip · 0 fail/);
    expect(table).not.toMatch(/\btok\b/);
  });
});

describe("parseSmokeArgs", () => {
  it("reads flags, then env, then the production default", () => {
    expect(parseSmokeArgs(["--base", "https://x.app/", "--project", "p", "--storyboard", "s", "--strict"], {})).toMatchObject({ baseUrl: "https://x.app", projectId: "p", storyboardId: "s", strict: true });
    expect(parseSmokeArgs([], { SMOKE_BASE_URL: "https://y.app", SMOKE_PROJECT_ID: "p2", CI_WORKER_TOKEN: "t" })).toMatchObject({ baseUrl: "https://y.app", projectId: "p2", workerToken: "t" });
    expect(parseSmokeArgs([], {}).baseUrl).toBe("https://creativeintel.vercel.app");
    // WORKER_TOKEN alone is not picked up: the smoke never borrows the app's own secret by accident.
    expect(parseSmokeArgs([], { WORKER_TOKEN: "x" }).workerToken).toBeUndefined();
  });
});
