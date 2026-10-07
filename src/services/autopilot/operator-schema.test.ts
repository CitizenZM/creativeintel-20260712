import { describe, expect, it } from "vitest";
import { operatorActionSchema } from "@/services/operator";

describe("operator schema: autopilot + creative agent", () => {
  it("autopilot-start needs a url or a projectId and a non-negative budget", () => {
    expect(operatorActionSchema.safeParse({ action: "autopilot-start", url: "https://shop.example/p/1" }).success).toBe(true);
    expect(operatorActionSchema.safeParse({ action: "autopilot-start", projectId: "p1", platforms: ["tiktok"], approvedBudgetUsd: 12.5, cast: "a woman, 30s" }).success).toBe(true);
    expect(operatorActionSchema.safeParse({ action: "autopilot-start" }).success).toBe(false);
    expect(operatorActionSchema.safeParse({ action: "autopilot-start", url: "not a url" }).success).toBe(false);
    expect(operatorActionSchema.safeParse({ action: "autopilot-start", projectId: "p1", approvedBudgetUsd: -1 }).success).toBe(false);
  });

  it("autopilot-approve / autopilot-status", () => {
    expect(operatorActionSchema.safeParse({ action: "autopilot-approve", autopilotId: "a", approvedBudgetUsd: 4 }).success).toBe(true);
    expect(operatorActionSchema.safeParse({ action: "autopilot-approve", autopilotId: "a" }).success).toBe(false);
    expect(operatorActionSchema.safeParse({ action: "autopilot-status", autopilotId: "a", retry: true }).success).toBe(true);
  });

  it("creative-agent / creative-agent-undo", () => {
    expect(operatorActionSchema.safeParse({ action: "creative-agent", projectId: "p", message: "swap the TikTok hook", storyboardId: "s" }).success).toBe(true);
    expect(operatorActionSchema.safeParse({ action: "creative-agent", projectId: "p" }).success).toBe(false);
    expect(operatorActionSchema.safeParse({ action: "creative-agent-undo", projectId: "p" }).success).toBe(true);
  });
});
