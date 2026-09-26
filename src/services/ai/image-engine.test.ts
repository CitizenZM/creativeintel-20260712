import { describe, expect, it, vi } from "vitest";

const uploadBuffer = vi.hoisted(() => vi.fn());
vi.mock("@/services/storage", () => ({ uploadBuffer }));
vi.mock("@/services/settings/ai-settings", () => ({ cachedAiSettings: vi.fn(), cachedProvider: vi.fn(), loadAiSettings: vi.fn() }));

import { persistDataUrl } from "./image-engine";

describe("persistDataUrl", () => {
  it("stores a base64 image and returns its URL", async () => {
    uploadBuffer.mockResolvedValueOnce({ provider: "vercel-blob", url: "https://blob.example/x.png" });
    const url = await persistDataUrl(`data:image/png;base64,${Buffer.from("png").toString("base64")}`, "frames");
    expect(url).toBe("https://blob.example/x.png");
    expect(uploadBuffer.mock.calls[0][0]).toMatchObject({ contentType: "image/png", folder: "frames" });
  });
  it("leaves plain URLs alone", async () => {
    expect(await persistDataUrl("https://img.example/a.jpg", "frames")).toBe("https://img.example/a.jpg");
  });
  it("keeps the data URI when only inline storage exists", async () => {
    uploadBuffer.mockResolvedValueOnce({ provider: "inline", url: "data:image/png;base64,AAAA" });
    expect(await persistDataUrl("data:image/png;base64,AAAA", "frames")).toBe("data:image/png;base64,AAAA");
  });
});
