import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/services/ai/claude-client", () => ({ analyzeWithClaude: vi.fn() }));
import { candidateAdvertisers } from "./competitor-suggest";

describe("candidateAdvertisers", () => {
  it("ranks by frequency and drops the brand, existing competitors and junk", () => {
    const out = candidateAdvertisers(
      ["Otter.ai", "PLAUD", "Plaud Official", "otter.ai", "Heypocket", "Limitless", "Otter.ai", null, "", "x".repeat(90)],
      "Plaud",
      ["heypocket"]
    );
    expect(out).toEqual(["Otter.ai", "Limitless"]);
  });
});
