import type OpenAI from "openai";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/services/settings/ai-settings", () => ({ cachedAiSettings: vi.fn(), cachedProvider: vi.fn(), loadAiSettings: vi.fn() }));
import { createOnRoute } from "./claude-client";
afterEach(() => vi.useRealTimers());

describe("LLM fallback deadline", () => {
  it("a response-format retry gets only the remaining budget", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T00:00:00Z"));
    const deadline = Date.now() + 150_000;
    const create = vi.fn().mockImplementationOnce(async () => {
      vi.setSystemTime(Date.now() + 100_000);
      throw Object.assign(new Error("unsupported format"), { status: 400 });
    }).mockResolvedValueOnce({ choices: [] });
    const client = { chat: { completions: { create } } } as unknown as OpenAI;
    await createOnRoute(client, "openai", [], "slow-model", 10_000, deadline);
    expect(create.mock.calls[0][1].timeout).toBe(140_000);
    expect(create.mock.calls[1][1].timeout).toBe(50_000);
    expect(create.mock.calls[1][1].maxRetries).toBe(0);
  });
  it("does not submit another request after the budget expires", async () => {
    const create = vi.fn();
    const client = { chat: { completions: { create } } } as unknown as OpenAI;
    await expect(createOnRoute(client, "openai", [], "gpt-4o", 1000, Date.now() - 1)).rejects.toThrow("deadline");
    expect(create).not.toHaveBeenCalled();
  });
});
