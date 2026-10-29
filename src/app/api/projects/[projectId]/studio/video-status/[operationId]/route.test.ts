import { describe, expect, it, vi } from "vitest";
const findFirst = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ prisma: { falVideoJob: { findFirst } } }));
vi.mock("@/lib/auth/route-guard", () => ({ withAccess: (handler: unknown) => handler }));
import { GET } from "./route";
import { PUBLIC_ERROR_MESSAGE } from "@/lib/public-error";

describe("video status public errors", () => {
  it("keeps status and output but redacts persisted provider errors", async () => {
    findFirst.mockResolvedValue({ status: "failed", videoUrl: null, error: "provider token sk-secret failed at /private/path" });
    const response = await GET(new Request("https://example.com"), { params: Promise.resolve({ projectId: "p", operationId: "op" }) });
    expect(await response.json()).toEqual({ done: true, videoUrl: null, error: PUBLIC_ERROR_MESSAGE, operationId: "op" });
  });
  it("keeps successful status free of fabricated errors", async () => {
    findFirst.mockResolvedValue({ status: "completed", videoUrl: "https://example.com/video.mp4", error: null });
    const response = await GET(new Request("https://example.com"), { params: Promise.resolve({ projectId: "p", operationId: "op" }) });
    expect(await response.json()).toMatchObject({ done: true, error: null, videoUrl: "https://example.com/video.mp4" });
  });
});
