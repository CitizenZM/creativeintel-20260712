// Queue state machine against an in-memory run table: approve/cancel races, claim leases, stale cancels, free-run gate,
// and spend booked for a failed plan. Each case failed before the 2026-11-11 audit fixes.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const h = vi.hoisted(() => {
  type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const db = { runs: new Map<string, Row>(), entries: [] as Row[], ledger: { reserve: vi.fn(), settle: vi.fn() }, settings: new Map<string, unknown>() };
const match = (r: Row, where: Row) => Object.entries(where).every(([k, v]) => {
  if (v && typeof v === "object" && "in" in v) return (v.in as unknown[]).includes(r[k]);
  if (v && typeof v === "object" && "lt" in v) return r[k] != null && r[k] < v.lt;
  return r[k] === v;
});
const runs = {
  findUnique: async ({ where }: Row) => db.runs.get(where.id) ?? null,
  findUniqueOrThrow: async ({ where }: Row) => { const r = db.runs.get(where.id); if (!r) throw new Error("missing"); return r; },
  findMany: async ({ where }: Row) => [...db.runs.values()].filter((r) => match(r, where)),
  update: async ({ where, data }: Row) => Object.assign(db.runs.get(where.id)!, data),
  updateMany: async ({ where, data }: Row) => { const hit = [...db.runs.values()].filter((r) => match(r, where)); hit.forEach((r) => Object.assign(r, data)); return { count: hit.length }; },
};
  return { db, runs };
});
const { db, runs } = h;

vi.mock("@/lib/db", () => ({ prisma: { adStudioRun: h.runs, appSetting: { findUnique: async ({ where }: Row) => (h.db.settings.has(where.key) ? { value: h.db.settings.get(where.key) } : null) }, spendEntry: { create: async ({ data }: Row) => { h.db.entries.push(data); return data; } } } }));
vi.mock("@/services/ops/budget-guard", () => ({ spendLedger: async () => h.db.ledger }));
vi.mock("./adstudio-context", () => ({ loadXarkContext: vi.fn() }));
vi.mock("./adstudio-results", () => ({ saveReviewInsight: vi.fn() }));
vi.mock("@/services/creative/library", () => ({ END_CARDS: [], hookById: () => null }));

import { approveRun, cancelRun, claimNext, createBatch, visualModeOf, reportDone, reportFailed, reportGate, reportProgress, requeueStale, retryRun, MAX_RETRIES, STALE_MS } from "./adstudio-queue";

const put = (r: Row) => db.runs.set(r.id, { input: {}, estimate: null, projectId: "p1", engine: "kling3", estUsd: 1, actualUsd: null, spendEntryId: null, cancelRequested: false, workerId: null, heartbeatAt: null, planFromRunId: null, createdAt: new Date(), approvedAt: null, ...r });

beforeEach(() => {
  db.runs.clear(); db.entries.length = 0; db.settings.clear(); vi.clearAllMocks();
  db.ledger.reserve.mockResolvedValue({ id: "sp1" });
});

describe("approve", () => {
  it("reserves first, at estimate x 1.3, and sets status + reservation in one write", async () => {
    put({ id: "r1", status: "awaiting_approval", estUsd: 1 });
    await approveRun("p1", "r1");
    expect(db.ledger.reserve).toHaveBeenCalledWith(expect.objectContaining({ runId: "r1" }), 1.3);
    expect(db.runs.get("r1")).toMatchObject({ status: "approved", spendEntryId: "sp1" });
  });
  it("a refused budget leaves the run untouched (no approved run without a reservation)", async () => {
    put({ id: "r1", status: "awaiting_approval" });
    db.ledger.reserve.mockRejectedValue(new Error("budget"));
    await expect(approveRun("p1", "r1")).rejects.toThrow("budget");
    expect(db.runs.get("r1")).toMatchObject({ status: "awaiting_approval", spendEntryId: null });
  });
  it("losing the race to a cancel releases the reservation", async () => {
    put({ id: "r1", status: "awaiting_approval" });
    db.ledger.reserve.mockImplementation(async () => { db.runs.get("r1")!.status = "cancelled"; return { id: "sp9" }; });
    await expect(approveRun("p1", "r1")).rejects.toThrow(/changed/);
    expect(db.ledger.settle).toHaveBeenCalledWith("sp9", 0);
    expect(db.runs.get("r1")!.spendEntryId).toBeNull();
  });
});

describe("cancel", () => {
  it("is conditional: a run approved after it was read is not cancelled with its reservation left open", async () => {
    put({ id: "r1", status: "awaiting_approval" });
    const orig = runs.findUnique;
    runs.findUnique = async (a: Row) => { const r = { ...(await orig(a))! }; Object.assign(db.runs.get("r1")!, { status: "approved", spendEntryId: "sp1" }); return r; };
    try { await expect(cancelRun("p1", "r1")).rejects.toThrow(/try again/); } finally { runs.findUnique = orig; }
    expect(db.runs.get("r1")!.status).toBe("approved");
  });
});

describe("stale runs", () => {
  it("a cancelled run whose worker died is cancelled and its reservation released, not requeued forever", async () => {
    const old = new Date(Date.now() - STALE_MS - 1000);
    put({ id: "r1", status: "generating", heartbeatAt: old, cancelRequested: true, spendEntryId: "sp1" });
    put({ id: "r2", status: "planning", heartbeatAt: old });
    await requeueStale();
    expect(db.runs.get("r1")!.status).toBe("cancelled");
    expect(db.ledger.settle).toHaveBeenCalledWith("sp1", 0);
    expect(db.runs.get("r2")!.status).toBe("queued");
  });
});

describe("claim lease", () => {
  it("a run reclaimed after a missed heartbeat refuses the first attempt's reports and tells it to stop", async () => {
    put({ id: "r1", status: "approved", approvedAt: new Date(), spendEntryId: "sp1" });
    const first = await claimNext("mac-1");
    expect(first?.claim).toMatch(/^mac-1#/);
    db.runs.get("r1")!.heartbeatAt = new Date(Date.now() - STALE_MS - 1000); // upload took too long
    const second = await claimNext("mac-1");
    expect(second?.claim).not.toBe(first?.claim);
    expect(await reportProgress("r1", { claim: first!.claim! })).toEqual({ cancel: true, status: "reclaimed" });
    await expect(reportDone("r1", { claim: first!.claim!, finalMp4Url: "u" })).rejects.toThrow(/no longer/);
    await expect(reportDone("r1", { claim: second!.claim!, finalMp4Url: "u", actualUsd: 1.1 })).resolves.toMatchObject({ status: "completed" });
  });
});

describe("free runs and failed plans", () => {
  it("only the remix engine may finish from planning; a paid engine with no estimate yet must pass the gate", async () => {
    put({ id: "r1", status: "planning", engine: "kling3", estUsd: 0 });
    await expect(reportDone("r1", { finalMp4Url: "u" })).rejects.toThrow(/done from status/);
    put({ id: "r2", status: "planning", engine: "remix", estUsd: 0 });
    await expect(reportDone("r2", { finalMp4Url: "u", actualUsd: 0 })).resolves.toMatchObject({ status: "completed" });
  });
  it("a plan that failed after paid key frames books what it spent", async () => {
    put({ id: "r1", status: "planning", estUsd: 0 });
    await reportFailed("r1", "OpenRouter 402", { actualUsd: 0.54 });
    expect(db.entries).toEqual([expect.objectContaining({ runId: "r1", kind: "image", actualUsd: 0.54 })]);
    expect(db.runs.get("r1")).toMatchObject({ status: "failed", actualUsd: 0.54 });
  });
  it("gate still books key frames once (no double entry)", async () => {
    put({ id: "r1", status: "planning" });
    await reportGate("r1", { estimate: { usd: 2 }, preUsd: 0.5 });
    expect(db.entries).toHaveLength(1);
  });
});

describe("retry", () => {
  it("a run that failed after its plan goes back to approval with a fresh reservation; one that failed planning is re-queued", async () => {
    put({ id: "r1", status: "failed", estUsd: 1.5, estimate: { usd: 1.5 }, spendEntryId: "old", error: "OpenRouter 402", actualUsd: 0.54 });
    await retryRun("p1", "r1");
    expect(db.runs.get("r1")).toMatchObject({ status: "awaiting_approval", spendEntryId: null, error: null, input: { retries: 1 }, actualUsd: 0.54 });
    await approveRun("p1", "r1"); // books a new reservation
    expect(db.runs.get("r1")).toMatchObject({ status: "approved", spendEntryId: "sp1" });
    put({ id: "r2", status: "failed", estUsd: 0, error: "claude -p failed" });
    await retryRun("p1", "r2");
    expect(db.runs.get("r2")!.status).toBe("queued");
  });
  it("only failed runs, at most MAX_RETRIES times", async () => {
    put({ id: "r1", status: "completed" });
    await expect(retryRun("p1", "r1")).rejects.toThrow(/Only a failed run/);
    put({ id: "r2", status: "failed", input: { retries: MAX_RETRIES } });
    await expect(retryRun("p1", "r2")).rejects.toThrow(/Already retried/);
    put({ id: "r3", status: "failed", projectId: "other" });
    await expect(retryRun("p1", "r3")).rejects.toThrow(/not found/);
  });
});

describe("visual mode", () => {
  it("defaults to video; only known modes pass", () => {
    expect(visualModeOf({})).toBe("video"); expect(visualModeOf(null)).toBe("video");
    expect(visualModeOf({ visualMode: "slides" })).toBe("slides"); expect(visualModeOf({ visualMode: "x" })).toBe("video");
  });
  it("a slides run finishes from planning without a gate and books its key frames", async () => {
    put({ id: "r1", status: "planning", engine: "kling3", estUsd: 0, input: { visualMode: "slides" } });
    await expect(reportDone("r1", { finalMp4Url: "u", actualUsd: 0.36 })).resolves.toMatchObject({ status: "completed" });
    expect(db.entries).toEqual([expect.objectContaining({ runId: "r1", kind: "image", actualUsd: 0.36 })]);
    put({ id: "r2", status: "planning", engine: "kling3", estUsd: 0, input: { visualMode: "video" } });
    await expect(reportDone("r2", { finalMp4Url: "u" })).rejects.toThrow(/done from status/); // video still needs approval
  });
  it("video mode refuses the stock-photo remix engine before anything is created", async () => {
    await expect(createBatch({ projectId: "p1", storyboardId: "sb", hookTypes: ["pain"], engines: ["auto", "remix"], visualMode: "video" })).rejects.toThrow(/Video mode needs an AI video engine/);
  });
});

describe("budget fallback (Barron 2026-11-18: no model budget -> slides; budget back -> video)", () => {
  it("probe reports the cap: a queued video run is planned as $0 slides and marked fallback budget; budget back: video", async () => {
    db.settings.set("brain:budget", { out: true, detail: "key cap $0.50 left", at: new Date().toISOString() });
    put({ id: "q1", status: "queued", engine: "seedance2fast", input: { visualMode: "video" } });
    const c = await claimNext("mac-1");
    expect(c?.input).toMatchObject({ visualMode: "slides", fallback: "budget", zeroCost: true, requestedVisualMode: "video" });
    expect(db.runs.get("q1")!.input).toMatchObject({ visualMode: "slides", fallback: "budget" }); // the record shows why
    db.settings.set("brain:budget", { out: false, at: new Date().toISOString() });
    put({ id: "q2", status: "queued", engine: "seedance2fast", input: { visualMode: "video" }, createdAt: new Date(Date.now() + 1) });
    const d = await claimNext("mac-1");
    expect(d?.runId).toBe("q2");
    expect(d?.input).toMatchObject({ visualMode: "video" });
    expect((d?.input as Row).fallback).toBeUndefined();
  });
  it("is off when brain:policy.budgetFallback is false, ignores a stale state, and leaves the free remix alone", async () => {
    const { applyBudgetMode, budgetOut } = await import("./adstudio-budget");
    expect(budgetOut({ out: true, at: new Date(Date.now() - 7 * 3_600_000).toISOString() })).toBe(false);
    expect(applyBudgetMode({ visualMode: "video" }, true, true, "remix").changed).toBe(false);
    db.settings.set("brain:budget", { out: true, at: new Date().toISOString() });
    db.settings.set("brain:policy", { budgetFallback: false });
    put({ id: "q3", status: "queued", engine: "kling3", input: { visualMode: "video" } });
    expect((await claimNext("mac-1"))?.input).toMatchObject({ visualMode: "video" });
  });
});
