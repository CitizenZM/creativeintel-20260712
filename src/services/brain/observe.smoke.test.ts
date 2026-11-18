/**
 * Read-only integration smoke of the Video Brain observation against a real DATABASE_URL. Skipped unless BRAIN_SMOKE=1:
 *   set -a; . ./.env.local; set +a; BRAIN_SMOKE=1 BRAIN_SMOKE_OUT=/tmp/obs.json pnpm exec vitest run src/services/brain/observe.smoke.test.ts
 * Prints counts only (no names, no secrets).
 */
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe.skipIf(process.env.BRAIN_SMOKE !== "1")("observe (live DB, read-only)", () => {
  it("gathers projects, stages, runs, spend, health", async () => {
    const { observe } = await import("./observe");
    const out = await observe();
    const byStatus: Record<string, number> = {};
    for (const r of out.runs) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    console.log("__OBSERVE__" + JSON.stringify({ projects: out.projects.length, stageErrors: out.stages.filter((s) => "error" in s).length, runs: out.runs.length, byStatus, perf: out.perf.length, spend: out.spend, heartbeats: out.heartbeats.length, health: { ok: out.health.ok, counts: out.health.counts }, learnings: out.learnings.length, policy: out.policy }));
    if (process.env.BRAIN_SMOKE_OUT) writeFileSync(process.env.BRAIN_SMOKE_OUT, JSON.stringify(out));
    expect(Array.isArray(out.projects)).toBe(true);
    expect(out.stages.length).toBe(out.projects.length);
  }, 300_000);
});
