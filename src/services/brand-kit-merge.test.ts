import { describe, expect, it } from "vitest";
import { planKitSave, sameKitValue } from "./brand-kit-merge";

const STATUS_KEY = { offerText: "offer", toneGuidelines: "tone", skuName: "skuName" };

describe("sameKitValue", () => {
  it("treats every empty value as the same and compares the rest deeply", () => {
    expect(sameKitValue(null, "")).toBe(true);
    expect(sameKitValue(undefined, [])).toBe(true);
    expect(sameKitValue({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(sameKitValue([{ text: "Buy", priority: 1 }], [{ priority: 1, text: "Buy" }])).toBe(true);
    expect(sameKitValue("a", "b")).toBe(false);
    expect(sameKitValue([1], [])).toBe(false);
  });
});

describe("planKitSave", () => {
  const base = { candidate: { offerText: "10% off", toneGuidelines: "warm", skuName: "" }, columnToStatusKey: STATUS_KEY, suggested: false };

  it("writes only the fields the user changed against what they loaded", () => {
    const plan = planKitSave({
      ...base,
      baseline: { offerText: "", toneGuidelines: "warm", skuName: "" },
      // meanwhile a suggestion filled skuName and somebody else rewrote the tone
      current: { offerText: null, toneGuidelines: "bold", skuName: "Widget" },
      currentStatus: { skuName: "suggested", tone: "suggested" },
    });
    expect(plan.data).toEqual({ offerText: "10% off" });
    // the user never saw those values: their marks stay
    expect(plan.status).toEqual({ skuName: "suggested", tone: "suggested" });
  });

  it("confirms an unchanged field only when the row still holds the value the user saved", () => {
    const plan = planKitSave({
      ...base,
      baseline: { offerText: "10% off", toneGuidelines: "warm", skuName: "" },
      current: { offerText: "10% off", toneGuidelines: "warm", skuName: "" },
      currentStatus: { offer: "suggested", tone: "suggested" },
    });
    expect(plan.data).toEqual({});
    expect(plan.status).toEqual({});
  });

  it("without a baseline writes every field and confirms it (the old behaviour)", () => {
    const plan = planKitSave({ ...base, baseline: null, current: {}, currentStatus: { offer: "suggested", other: "suggested" } });
    expect(plan.data).toEqual(base.candidate);
    expect(plan.status).toEqual({ other: "suggested" });
  });

  it("marks written fields suggested for a suggestion write", () => {
    const plan = planKitSave({ ...base, suggested: true, baseline: null, current: {}, currentStatus: {} });
    expect(plan.status).toEqual({ offer: "suggested", tone: "suggested", skuName: "suggested" });
  });
});
