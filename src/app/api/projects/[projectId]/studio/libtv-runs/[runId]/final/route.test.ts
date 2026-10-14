import { describe, expect, it, vi } from "vitest";

const { getRunWithJobs, setRunFinal } = vi.hoisted(() => ({ getRunWithJobs: vi.fn(), setRunFinal: vi.fn() }));
vi.mock("@/services/video-gen/libtv-queue", () => ({ getRunWithJobs, setRunFinal }));
vi.mock("@/lib/auth/route-guard", () => ({ withAccess: (handler: unknown) => handler }));
import { POST } from "./route";

const context = { params: Promise.resolve({ projectId: "p", runId: "r" }) };
const request = (body: unknown) => new Request("https://example.com/final", { method: "POST", body: JSON.stringify(body) });

describe("final video review", () => {
  it("passes an explicit brand approval to the finalization service", async () => {
    getRunWithJobs.mockResolvedValue({ id: "r", projectId: "p" });
    setRunFinal.mockResolvedValue({ ok: true });
    const response = await POST(request({ final: true, brandApproved: true }), context);
    expect(response.status).toBe(200);
    expect(setRunFinal).toHaveBeenCalledWith("r", true, true);
  });

  it("does not infer approval from a final request", async () => {
    getRunWithJobs.mockResolvedValue({ id: "r", projectId: "p" });
    setRunFinal.mockResolvedValue({ ok: false, status: 400, error: "Brand review required" });
    const response = await POST(request({ final: true }), context);
    expect(response.status).toBe(400);
    expect(setRunFinal).toHaveBeenCalledWith("r", true, false);
  });
});
