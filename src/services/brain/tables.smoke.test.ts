/**
 * Brain* tables against a real Postgres (lab only). Skipped unless BRAIN_TABLES_SMOKE=1 with DATABASE_URL pointing at a
 * lab database whose schema was pushed from this branch.
 */
import { describe, expect, it } from "vitest";

describe.skipIf(process.env.BRAIN_TABLES_SMOKE !== "1")("Brain tables mirror (lab DB)", () => {
  it("publish writes AppSetting rows and mirrors loops/checks/incidents/learnings/events; re-publish is idempotent", async () => {
    process.env.BRAIN_TABLES = "1";
    const { publish } = await import("./store");
    const { prisma } = await import("@/lib/db");
    const at = new Date().toISOString();
    const snap = {
      v: 1, at, tickMs: 1, host: "t", stageCounts: {}, spend: { todayUsd: 0, capUsd: 20, autoApprovedTodayUsd: 0 }, worker: { lastSeenAt: null, ok: false },
      loops: [{ projectId: "pT", name: "T", brand: null, step: "studio", stage: "project", status: "active", agent: "Director", doing: "d", nextAction: "n", nextCheckpointAt: at, verifyHow: "v", waitingOn: null, idleSince: null, runs: { active: 0, awaiting: 0, done: 0, failed: 0 }, spendUsd7d: 0, lastActivityAt: at }],
      queue: [], executing: [], recovery: [], probes: [], patterns: [],
      checks: [{ runId: "rT", projectId: "pT", at, pass: true, fields: [{ field: "duration", expected: "x", actual: "y", pass: true, source: "ffprobe" }] }],
      incidents: [{ signature: "sig", kind: "platform", count: 2, firstSeen: at, lastSeen: at, status: "open", runbook: "rb", sample: "s", runs: ["a"] }],
      learnings: [{ id: "LT", at, who: "t", scope: "global", rule: "r", evidence: [], status: "candidate" }],
      events: [{ at, agent: "Brain", kind: "think", summary: "smoke" }],
    };
    const r1 = await publish(snap as never);
    const r2 = await publish(snap as never);
    expect(r1.tables).toMatchObject({ loops: 1, checks: 1, incidents: 1, learnings: 1, events: 1 });
    expect(r2.tables).toMatchObject({ events: 0 });
    expect(await prisma.brainLoop.count({ where: { projectId: "pT" } })).toBe(1);
    expect(await prisma.brainEvent.count({ where: { summary: "smoke" } })).toBe(1);
  }, 120_000);
});
