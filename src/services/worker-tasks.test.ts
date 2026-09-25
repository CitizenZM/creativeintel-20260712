import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  workerHeartbeat: { findFirst: vi.fn(), upsert: vi.fn() },
  workerTask: { findFirst: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));

async function load() {
  vi.resetModules();
  return import("./worker-tasks");
}

describe("isWorkerOnline", () => {
  beforeEach(() => {
    db.workerHeartbeat.findFirst.mockReset();
    db.workerTask.findFirst.mockReset();
  });

  it("is offline when no heartbeat and no recent task activity", async () => {
    db.workerHeartbeat.findFirst.mockResolvedValue(null);
    db.workerTask.findFirst.mockResolvedValue(null);
    const { isWorkerOnline } = await load();
    expect(await isWorkerOnline()).toBe(false);
  });

  it("is online after a recent poll", async () => {
    db.workerHeartbeat.findFirst.mockResolvedValue({ workerId: "mac" });
    db.workerTask.findFirst.mockResolvedValue(null);
    const { isWorkerOnline } = await load();
    expect(await isWorkerOnline()).toBe(true);
  });

  it("is online when a task was touched recently even without a heartbeat row", async () => {
    db.workerHeartbeat.findFirst.mockResolvedValue(null);
    db.workerTask.findFirst.mockResolvedValue({ id: "t1" });
    const { isWorkerOnline } = await load();
    expect(await isWorkerOnline()).toBe(true);
  });

  it("treats a database error as offline instead of throwing", async () => {
    db.workerHeartbeat.findFirst.mockRejectedValue(new Error("db down"));
    db.workerTask.findFirst.mockResolvedValue(null);
    const { isWorkerOnline } = await load();
    expect(await isWorkerOnline()).toBe(false);
  });
});
