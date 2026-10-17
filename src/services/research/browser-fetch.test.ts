import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ enqueue: vi.fn(), recent: vi.fn(), online: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { workerTask: { findUnique: vi.fn() } } }));
vi.mock("@/services/worker-tasks", () => ({ enqueueWorkerTask: m.enqueue, findRecentCompletedTask: m.recent, isWorkerOnline: m.online, payloadHash: () => "hash" }));
import { fetchViaWorker } from "./browser-fetch";
import { ResearchWaiting, suspendForWorkers, withWorkerDeferral } from "./worker-await";
beforeEach(() => { vi.resetAllMocks(); m.online.mockResolvedValue(false); m.recent.mockResolvedValue(null); m.enqueue.mockResolvedValue({ taskId: "task", deduped: false }); });
describe("offline browser worker", () => {
 it("durably queues offline tasks and returns without polling", async () => {
   await expect(withWorkerDeferral(async () => { expect(await fetchViaWorker("https://example.com", { projectId: "project" })).toBeNull(); suspendForWorkers(); })).rejects.toEqual(new ResearchWaiting(["task"]));
   expect(m.enqueue).toHaveBeenCalledWith(expect.objectContaining({ projectId: "project", kind: "browser_fetch" }));
   expect(m.online).not.toHaveBeenCalled();
 });
 it("still skips unavailable workers outside durable research", async () => {
   expect(await fetchViaWorker("https://example.com")).toBeNull();
   expect(m.enqueue).not.toHaveBeenCalled();
 });
});
