import { afterEach, describe, expect, it, vi } from "vitest";
import { createBachToken, generateBachImage, pollBachVideo, submitBachVideo } from "./bach";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Bach API adapter", () => {
  it("signs a short-lived server-side HS256 token", () => {
    vi.stubEnv("BACH_ACCESS_KEY", "test-access");
    vi.stubEnv("BACH_SECRET_KEY", "test-secret");
    const token = createBachToken(1_800_000_000_000);
    const [header, payload, signature] = token.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "HS256", typ: "JWT" });
    expect(JSON.parse(Buffer.from(payload, "base64url").toString())).toMatchObject({ iss: "test-access", nbf: 1_799_999_995, exp: 1_800_000_600 });
    expect(signature).toBeTruthy();
  });

  it("submits first/last frame video tasks with Bach's documented fields", async () => {
    vi.stubEnv("BACH_ACCESS_KEY", "test-access");
    vi.stubEnv("BACH_SECRET_KEY", "test-secret");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 200, data: { task_id: "task-1" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const id = await submitBachVideo({ prompt: "smooth transition", imageUrl: "https://example.com/a.jpg", endImageUrl: "https://example.com/b.jpg", duration: 5, aspectRatio: "16:9", resolution: "720P" });
    expect(id).toBe("task-1");
    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request.input).toMatchObject({ task: "i2v", image_url: "https://example.com/a.jpg", end_image_url: "https://example.com/b.jpg", aspect_ratio: "auto", resolution: "720p" });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toMatch(/^Bearer ey/);
  });

  it("polls image tasks to a generated image URL and maps video success", async () => {
    vi.stubEnv("BACH_ACCESS_KEY", "test-access");
    vi.stubEnv("BACH_SECRET_KEY", "test-secret");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 200, data: { task_id: "img-1" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 200, data: { status: "TASK_SUCCEEDED", image_urls: ["https://example.com/image.png"] } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 200, data: { status: "TASK_SUCCEEDED", video_url: "https://example.com/video.mp4" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: TimerHandler) => {
      if (typeof callback === "function") callback();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout);
    await expect(generateBachImage({ prompt: "a product", aspectRatio: "16:9" }, Date.now() + 10_000)).resolves.toBe("https://example.com/image.png");
    await expect(pollBachVideo("video-1")).resolves.toMatchObject({ status: "completed", videoUrl: "https://example.com/video.mp4" });
  });

  it("does not silently treat an unknown or incomplete terminal state as processing", async () => {
    vi.stubEnv("BACH_ACCESS_KEY", "test-access");
    vi.stubEnv("BACH_SECRET_KEY", "test-secret");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ code: 200, data: { status: "TASK_SUCCEEDED" } }), { status: 200 })));
    await expect(pollBachVideo("missing-url")).rejects.toThrow(/without a video URL/);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ code: 200, data: { status: "TASK_REVIEW" } }), { status: 200 })));
    await expect(pollBachVideo("unknown")).rejects.toThrow(/unknown status: TASK_REVIEW/);
  });
});
