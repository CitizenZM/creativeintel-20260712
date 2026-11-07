import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  claimNext: vi.fn(), reportProgress: vi.fn(), reportGate: vi.fn(), reportDone: vi.fn(), reportFailed: vi.fn(), recordWorkerSeen: vi.fn(),
}));
vi.mock("@/services/worker-tasks", () => ({ recordWorkerSeen: m.recordWorkerSeen }));
vi.mock("@/services/video-gen/adstudio-queue", async () => {
  class AdStudioError extends Error { constructor(msg: string, readonly status = 400) { super(msg); } }
  return { AdStudioError, claimNext: m.claimNext, reportProgress: m.reportProgress, reportGate: m.reportGate, reportDone: m.reportDone, reportFailed: m.reportFailed };
});

import { POST } from "./route";

const call = (body: unknown, token = "t0ken") =>
  POST(new Request("http://localhost/api/worker/adstudio", { method: "POST", headers: { "content-type": "application/json", ...(token ? { "x-worker-token": token } : {}) }, body: JSON.stringify(body) }));

describe("POST /api/worker/adstudio", () => {
  beforeEach(() => vi.stubEnv("WORKER_TOKEN", "t0ken"));
  afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

  it("refuses a missing or wrong token and touches nothing", async () => {
    expect((await call({ action: "claim" }, "")).status).toBe(401);
    expect((await call({ action: "claim" }, "wrong")).status).toBe(401);
    expect(m.claimNext).not.toHaveBeenCalled();
  });
  it("claim records the worker as adstudio:<id> and returns the run", async () => {
    m.claimNext.mockResolvedValue({ runId: "r1", phase: "plan" });
    const res = await call({ action: "claim", workerId: "mac1" });
    expect(await res.json()).toEqual({ run: { runId: "r1", phase: "plan" } });
    expect(m.recordWorkerSeen).toHaveBeenCalledWith("adstudio:mac1");
  });
  it("routes progress / gate / done / failed and validates their required fields", async () => {
    m.reportProgress.mockResolvedValue({ cancel: true });
    expect(await (await call({ action: "progress", runId: "r1", step: "script" })).json()).toEqual({ cancel: true });
    expect((await call({ action: "gate", runId: "r1" })).status).toBe(400);
    m.reportGate.mockResolvedValue({ cancel: false });
    expect((await call({ action: "gate", runId: "r1", estimate: { usd: 0.91 } })).status).toBe(200);
    expect((await call({ action: "done", runId: "r1" })).status).toBe(400);
    expect((await call({ action: "progress" })).status).toBe(400);
    expect((await call({ action: "nope", runId: "r1" })).status).toBe(400);
  });
});
