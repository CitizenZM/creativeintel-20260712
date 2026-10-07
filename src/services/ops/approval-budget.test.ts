import { describe, expect, it } from "vitest";
import { minBudgetUsd, serverApprovalBudget } from "./approval-budget";

describe("serverApprovalBudget (creditCap → LibtvRun.approvedBudgetUsd)", () => {
  const paid = { executor: "openrouter", creditsEstimated: 120 };

  it("turns a paid server run's credit cap (US cents) into its USD budget", () => {
    expect(serverApprovalBudget(paid, 150)).toEqual({ ok: true, capBudgetUsd: 1.5 });
  });

  it("refuses a paid server approval without a cap, or with a cap below the estimate", () => {
    const none = serverApprovalBudget(paid, null);
    expect(none.ok).toBe(false);
    expect(!none.ok && none.error).toMatch(/creditCap/);
    expect(serverApprovalBudget(paid, 0).ok).toBe(false);
    expect(serverApprovalBudget(paid, 100).ok).toBe(false);
  });

  it("leaves free server runs and LibTV runs without a USD budget", () => {
    expect(serverApprovalBudget({ executor: "glm", creditsEstimated: 0 }, null)).toEqual({ ok: true });
    expect(serverApprovalBudget({ executor: "libtv", creditsEstimated: 900 }, null)).toEqual({ ok: true });
    expect(serverApprovalBudget({ executor: "libtv", creditsEstimated: 900 }, 1000)).toEqual({ ok: true });
  });
});

describe("minBudgetUsd", () => {
  it("never raises an existing lower budget", () => {
    expect(minBudgetUsd(null, 2)).toBe(2);
    expect(minBudgetUsd(undefined, 2)).toBe(2);
    expect(minBudgetUsd(1, 2)).toBe(1);
    expect(minBudgetUsd(5, 2)).toBe(2);
    expect(minBudgetUsd(0, 2)).toBe(0);
  });
});
