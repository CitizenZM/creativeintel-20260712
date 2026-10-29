import { describe, it, expect, vi, beforeEach } from "vitest";
const m = vi.hoisted(() => ({ send: vi.fn(), run: vi.fn(), job: vi.fn(), tick: vi.fn(), poll: vi.fn(), acquire: vi.fn(), release: vi.fn() }));
vi.mock("@/services/settings/ai-settings", () => ({ loadAiSettings: vi.fn() }));
vi.mock("@vercel/queue", () => ({ send: m.send }));
vi.mock("@/lib/db", () => ({ prisma: { libtvRun: { findUnique: m.run }, falVideoJob: { findUnique: m.job } } }));
vi.mock("@/services/shared-lease", () => ({ acquireSharedSlot: m.acquire }));
vi.mock("./server-engines", () => ({ adapterFor: () => ({ engine: "glm" }) }));
vi.mock("./server-executor", () => ({ tickRun: m.tick }));
vi.mock("./poll", () => ({ pollJob: m.poll }));
import { processRender } from "./render-dispatch";
beforeEach(() => { vi.resetAllMocks(); m.acquire.mockResolvedValue(m.release); m.send.mockResolvedValue({}); });
describe("render queue", () => {
 it("reschedules an active run after one tick", async () => {
   m.run.mockResolvedValue({ executor: "glm", status: "running" }); m.tick.mockResolvedValue("running");
   await processRender({ kind: "run", id: "r", generation: 1 });
   expect(m.send).toHaveBeenCalledWith("creativeintel-render", expect.objectContaining({ kind: "run", id: "r" }), expect.objectContaining({ delaySeconds: 20 }));
   expect(m.release).toHaveBeenCalled();
 });
 it("ignores redelivery after a job completed", async () => {
   m.job.mockResolvedValue({ status: "completed" });
   await processRender({ kind: "video", id: "v", generation: 1 });
   expect(m.poll).not.toHaveBeenCalled(); expect(m.send).not.toHaveBeenCalled();
 });
 it("keeps failed ticks retryable and releases the claim", async () => {
   m.run.mockResolvedValue({ executor: "glm", status: "running" }); m.tick.mockRejectedValue(new Error("provider unavailable"));
   await expect(processRender({ kind: "run", id: "r", generation: 1 })).rejects.toThrow("provider unavailable");
   expect(m.release).toHaveBeenCalled();
 });
});
