import { describe, expect, it, vi } from "vitest";
const getRunWithJobs = vi.hoisted(() => vi.fn());
vi.mock("@/services/video-gen/libtv-queue", () => ({ getRunWithJobs }));
vi.mock("@/lib/auth/route-guard", () => ({ withAccess: (handler: unknown) => handler }));
import { GET } from "./route";
import { PUBLIC_ERROR_MESSAGE } from "@/lib/public-error";

describe("run status public errors", () => {
  it("redacts both run and clip errors without dropping progress fields", async () => {
    getRunWithJobs.mockResolvedValue({ id: "r", projectId: "p", status: "failed", error: "postgres://secret", jobs: [{ id: "j", status: "failed", error: "private provider details" }, { id: "ok", status: "completed", error: null, resultUrl: "https://example.com/clip.mp4" }] });
    const response = await GET(new Request("https://example.com"), { params: Promise.resolve({ projectId: "p", runId: "r" }) });
    const { run } = await response.json();
    expect(run.error).toBe(PUBLIC_ERROR_MESSAGE);
    expect(run.jobs[0].error).toBe(PUBLIC_ERROR_MESSAGE);
    expect(run.jobs[1]).toMatchObject({ error: null, resultUrl: "https://example.com/clip.mp4" });
    expect(run.status).toBe("failed");
  });
  it("still denies runs outside the requested project", async () => {
    getRunWithJobs.mockResolvedValue({ projectId: "other" });
    expect((await GET(new Request("https://example.com"), { params: Promise.resolve({ projectId: "p", runId: "r" }) })).status).toBe(404);
  });
});
