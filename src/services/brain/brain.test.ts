import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/services/project-stages", () => ({ getProjectStages: vi.fn() }));
vi.mock("@/services/ops/health", () => ({ scanHealth: vi.fn() }));
import { canAutoApprove } from "./policy";
import { mergeEvents, mergeLearnings, viewOf } from "./store";
import { pacificDayStart } from "./observe";
import { overlayRuns } from "./live";
import { DEFAULT_POLICY, type BrainSnapshot } from "./contract";

const reserve = (e: number) => Math.round(e * 1.3 * 10000) / 10000;
const now = Date.parse("2026-11-18T12:00:00Z");
const run = (o: Partial<{ status: string; estUsd: number; updatedAt: string; cancelRequested: boolean }> = {}) => ({ status: "awaiting_approval", estUsd: 1, updatedAt: "2026-11-18T10:00:00Z", ...o });

describe("canAutoApprove", () => {
  it("approves a fresh small run inside both caps", () => {
    expect(canAutoApprove(run(), DEFAULT_POLICY, 0, reserve, now)).toEqual({ ok: true, reserveUsd: 1.3 });
  });
  it("refuses over the per-run cap (reservation, not estimate)", () => {
    const v = canAutoApprove(run({ estUsd: 2.5 }), DEFAULT_POLICY, 0, reserve, now);
    expect(v.ok).toBe(false);
  });
  it("refuses when the day cap would be passed", () => {
    expect(canAutoApprove(run({ estUsd: 2 }), DEFAULT_POLICY, 18, reserve, now).ok).toBe(false);
    expect(canAutoApprove(run({ estUsd: 1 }), DEFAULT_POLICY, 18, reserve, now).ok).toBe(true);
  });
  it("refuses stale estimates, other statuses, cancels, missing estimate and policy off", () => {
    expect(canAutoApprove(run({ updatedAt: "2026-11-16T10:00:00Z" }), DEFAULT_POLICY, 0, reserve, now).ok).toBe(false);
    expect(canAutoApprove(run({ status: "approved" }), DEFAULT_POLICY, 0, reserve, now).ok).toBe(false);
    expect(canAutoApprove(run({ cancelRequested: true }), DEFAULT_POLICY, 0, reserve, now).ok).toBe(false);
    expect(canAutoApprove(run({ estUsd: 0 }), DEFAULT_POLICY, 0, reserve, now).ok).toBe(false);
    expect(canAutoApprove(run(), { ...DEFAULT_POLICY, autoApprove: false }, 0, reserve, now).ok).toBe(false);
  });
});

describe("store merges", () => {
  it("events: newest first, deduped, capped", () => {
    const a = { at: "2026-11-18T10:00:00Z", agent: "brain", kind: "think" as const, summary: "a" };
    const b = { at: "2026-11-18T11:00:00Z", agent: "brain", kind: "think" as const, summary: "b" };
    expect(mergeEvents([a], [b, a]).map((e) => e.summary)).toEqual(["b", "a"]);
    expect(mergeEvents([a], [b], 1)).toHaveLength(1);
  });
  it("learnings: same id replaces (promotion keeps fields)", () => {
    const l = { id: "x", at: "2026-11-18T10:00:00Z", who: "qa", scope: "global", rule: "r", evidence: ["run1"], status: "candidate" as const };
    const m = mergeLearnings([l], [{ ...l, status: "confirmed", evidence: ["run1", "run2"] }]);
    expect(m).toHaveLength(1);
    expect(m[0].status).toBe("confirmed");
  });
  it("view: stale when old or missing", () => {
    expect(viewOf(null).stale).toBe(true);
    const s = { at: new Date(now - 60_000).toISOString() } as BrainSnapshot;
    expect(viewOf(s, now)).toMatchObject({ ageSec: 60, stale: false });
    expect(viewOf({ at: new Date(now - 3_600_000).toISOString() } as BrainSnapshot, now).stale).toBe(true);
  });
});

describe("pacificDayStart", () => {
  it("is Pacific midnight", () => {
    expect(pacificDayStart(new Date("2026-11-18T12:00:00Z")).toISOString()).toBe("2026-11-18T08:00:00.000Z");
    expect(pacificDayStart(new Date("2026-11-18T07:30:00Z")).toISOString()).toBe("2026-11-17T08:00:00.000Z");
  });
});

describe("live overlay", () => {
  const base = { v: 1, at: "2026-11-18T10:00:00Z", queue: [{ id: "local:a", status: "gated" }, { id: "srv1", status: "gated", gates: [{ gate: "estimate", pass: true, detail: "$1" }] }], executing: [{ id: "srvOld", status: "running" }] } as unknown as BrainSnapshot;
  const r = (id: string, status: string) => ({ id, projectId: "p", status, step: "render", progress: 40, estUsd: 1, actualUsd: null, hookType: "pain", engine: "auto", updatedAt: "2026-11-18T10:04:00Z" });
  it("replaces server runs with the fresh DB state, keeps local jobs and gate results", () => {
    const out = overlayRuns(base, [r("srv1", "generating"), r("srv2", "queued")], Date.parse("2026-11-18T10:05:00Z"));
    expect(out.queue.map((t) => t.id)).toEqual(["local:a", "srv2"]);
    expect(out.executing.map((t) => [t.id, t.step, t.progress])).toEqual([["srv1", "render", 40]]);
    expect(out.executing[0].gates[0].gate).toBe("estimate");
    expect(out.liveAt).toBe("2026-11-18T10:05:00.000Z");
  });
});
