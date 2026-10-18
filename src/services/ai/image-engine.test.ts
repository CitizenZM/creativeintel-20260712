import { describe, expect, it, vi } from "vitest";

const uploadBuffer = vi.hoisted(() => vi.fn());
vi.mock("@/services/storage", () => ({ uploadBuffer }));
vi.mock("@/services/settings/ai-settings", () => ({ cachedAiSettings: vi.fn(), cachedProvider: vi.fn(), loadAiSettings: vi.fn() }));

import { imageOrderForRequest, persistDataUrl } from "./image-engine";

describe("reference-guided image routing", () => {
  it("does not fall back to engines that silently drop the product reference", () => {
    const order = ["openai", "bach", "fal", "glm", "pollinations"] as const;
    expect(imageOrderForRequest([...order], ["https://cdn.example/official-product.jpg"])).toEqual(["bach"]);
    expect(imageOrderForRequest([...order], [])).toEqual([...order]);
    expect(imageOrderForRequest(["openai", "fal"], ["https://cdn.example/official-product.jpg"])).toEqual([]);
  });
});

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
