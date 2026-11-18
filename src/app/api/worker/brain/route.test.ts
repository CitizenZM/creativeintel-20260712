import { beforeEach, describe, expect, it, vi } from "vitest";

const getView = vi.fn(async () => ({ snapshot: { v: 1, loops: [{ projectId: "p" }] }, ageSec: 5, stale: false }));
vi.mock("@/lib/db", () => ({ prisma: { adStudioRun: { findUnique: vi.fn(async () => null) } } }));
vi.mock("@/services/brain/observe", () => ({ observe: vi.fn(), pacificDayStart: () => new Date() }));
vi.mock("@/services/brain/store", () => ({ getView, addLearning: vi.fn(), appendEvents: vi.fn(), getPolicy: vi.fn(), getSnapshot: vi.fn(), publish: vi.fn() }));
vi.mock("@/services/video-gen/adstudio-queue", () => ({ AdStudioError: class extends Error { status = 400; }, approveRun: vi.fn(), reserveUsd: (x: number) => x * 1.3, retryRun: vi.fn() }));

const req = (body: unknown, token = "t") => new Request("http://x/api/worker/brain", { method: "POST", headers: { "x-worker-token": token, "content-type": "application/json" }, body: JSON.stringify(body) });

describe("POST /api/worker/brain", () => {
  beforeEach(() => { process.env.WORKER_TOKEN = "t"; });
  it("refuses a wrong token", async () => {
    const { POST } = await import("./route");
    expect((await POST(req({ action: "view" }, "bad"))).status).toBe(401);
  });
  it("view returns exactly the board's payload", async () => {
    const { POST } = await import("./route");
    const r = await POST(req({ action: "view" }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(await getView());
  });
  it("approve/retry of an unknown run answer 404 without touching the queue", async () => {
    const { POST } = await import("./route");
    expect((await POST(req({ action: "approve", runId: "nope" }))).status).toBe(404);
    expect((await POST(req({ action: "retry", runId: "nope" }))).status).toBe(404);
  });
});
