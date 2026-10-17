import { afterEach, describe, expect, it, vi } from "vitest";
const blob = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn() }));
vi.mock("@vercel/blob", () => blob);
import { durablePreviewUrl, uploadArchive } from "./durable";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

describe("verified media storage", () => {
  it("requires a private archive store instead of publishing internal bytes", async () => {
    vi.stubEnv("ARCHIVE_BLOB_READ_WRITE_TOKEN", "");
    await expect(uploadArchive(new Uint8Array([1]), "text/plain")).rejects.toThrow("not configured");
    expect(blob.put).not.toHaveBeenCalled();
  });
  it("rejects a successful upload with wrong read-back bytes", async () => {
    vi.stubEnv("ARCHIVE_BLOB_READ_WRITE_TOKEN", "test-secret");
    blob.put.mockResolvedValue({ url: "https://store.private.blob.vercel-storage.com/a" });
    blob.get.mockResolvedValue({ statusCode: 200, stream: new Response(new Uint8Array([9])).body });
    await expect(uploadArchive(new Uint8Array([1]), "text/plain")).rejects.toThrow("checksum");
    expect(blob.put.mock.calls[0][2].access).toBe("private");
  });
  it("accepts only a checksum-verified private copy", async () => {
    vi.stubEnv("ARCHIVE_BLOB_READ_WRITE_TOKEN", "test-secret");
    blob.put.mockResolvedValue({ url: "https://store.private.blob.vercel-storage.com/a" });
    blob.get.mockResolvedValue({ statusCode: 200, stream: new Response(new Uint8Array([1])).body });
    await expect(uploadArchive(new Uint8Array([1]), "text/plain")).resolves.toContain(".private.");
  });
  it("never keeps inline preview data when storage is unavailable", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    await expect(durablePreviewUrl("data:image/png;base64,AQ==")).rejects.toThrow("not configured");
    await expect(durablePreviewUrl("https://media.example/frame.png")).resolves.toBe("https://media.example/frame.png");
  });
});
