import { describe, it, expect, vi, beforeEach } from "vitest";
const m = vi.hoisted(() => ({ send: vi.fn(), find: vi.fn(), update: vi.fn(), job: vi.fn(), tasks: vi.fn(), run: vi.fn(), acquire: vi.fn(), release: vi.fn(), project: vi.fn(), fail: vi.fn() }));
vi.mock("@vercel/queue", () => ({ send: m.send }));
vi.mock("@/lib/db", () => ({ prisma: { researchContinuation: { findUnique: m.find, update: m.update }, researchJob: { findUnique: m.job }, workerTask: { findMany: m.tasks }, project: { updateMany: m.project } } }));
vi.mock("@/services/shared-lease", () => ({ acquireSharedSlot: m.acquire }));
vi.mock("./job-progress", () => ({ failJob: m.fail }));
vi.mock("./runner", () => ({ runResearch: m.run }));
import { processResearch } from "./dispatch";
import { ResearchWaiting } from "./worker-await";
const row = { jobId: "job", projectId: "p", status: "waiting", checkpoint: { phase: "discovery", keywords: {} }, waitingTaskIds: ["task"], createdAt: new Date() };
beforeEach(() => { vi.resetAllMocks(); m.acquire.mockResolvedValue(m.release); m.find.mockResolvedValue(row); m.job.mockResolvedValue({ status: "running" }); m.send.mockResolvedValue({ messageId: "m" }); });
describe("durable research", () => {
  it("leaves queued worker work suspended without invoking the runner", async () => {
    m.tasks.mockResolvedValue([{ status: "queued", payload: { hash: "h" } }]);
    await processResearch({ jobId: "job" });
    expect(m.run).not.toHaveBeenCalled();
    expect(m.send).toHaveBeenCalledWith("creativeintel-research", { jobId: "job" }, expect.objectContaining({ delaySeconds: 30 }));
    expect(m.release).toHaveBeenCalled();
  });
  it("starts waiting expiry from the phase barrier instead of the original job age", async () => {
    m.find.mockResolvedValue({ ...row, createdAt: new Date(Date.now() - 40 * 60_000), checkpoint: { phase: "discovery", waitingSince: new Date().toISOString() } });
    m.tasks.mockResolvedValue([{ status: "queued", payload: { hash: "h" } }]);
    await processResearch({ jobId: "job" });
    expect(m.run).not.toHaveBeenCalled();
    expect(m.send).toHaveBeenCalled();
  });
  it("resumes completed results, carrying failed payload exclusions forward", async () => {
    m.tasks.mockResolvedValue([{ status: "failed", payload: { hash: "bad" } }]);
    m.run.mockImplementation(async (_p, _j, continuation) => { await continuation.save({ phase: "rank", candidates: [] }); });
    await processResearch({ jobId: "job" });
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ checkpoint: expect.objectContaining({ phase: "rank", ignoredWorkerHashes: ["bad"] }) }) }));
  });
  it("persists newly discovered task IDs on suspension", async () => {
    m.tasks.mockResolvedValue([{ status: "completed", payload: { hash: "h" } }]);
    m.run.mockRejectedValue(new ResearchWaiting(["new-task"]));
    await processResearch({ jobId: "job" });
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "waiting", waitingTaskIds: ["new-task"] }) }));
  });
  it("persists attempt count before retrying a phase failure", async () => {
    m.tasks.mockResolvedValue([{ status: "completed", payload: { hash: "h" } }]);
    m.run.mockRejectedValue(new Error("temporary outage"));
    await expect(processResearch({ jobId: "job" })).rejects.toThrow("temporary outage");
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ checkpoint: expect.objectContaining({ phaseAttempts: 1 }), status: "queued" }) }));
    expect(m.release).toHaveBeenCalled();
  });
  it("stops permanently after the third unsuccessful attempt", async () => {
    m.find.mockResolvedValue({ ...row, checkpoint: { phase: "discovery", phaseAttempts: 2 } });
    m.tasks.mockResolvedValue([{ status: "completed", payload: { hash: "h" } }]);
    m.run.mockRejectedValue(new Error("outage"));
    await processResearch({ jobId: "job" });
    expect(m.fail).toHaveBeenCalledWith("job", expect.stringContaining("three attempts"));
    expect(m.update).toHaveBeenCalledWith({ where: { jobId: "job" }, data: { status: "failed" } });
    expect(m.send).not.toHaveBeenCalled();
  });
  it("does not replay terminal jobs", async () => {
    m.job.mockResolvedValue({ status: "complete" });
    await processResearch({ jobId: "job" });
    expect(m.run).not.toHaveBeenCalled();
    expect(m.send).not.toHaveBeenCalled();
  });
});
