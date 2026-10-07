import { describe, expect, it } from "vitest";
import { auditScriptText } from "./script-schema";

const text = "Guaranteed brightest picture — the #1 best-selling TV, 20% off today";

describe("claims audit strictness", () => {
  it("lets bold wording through by default but still catches brand-forbidden phrases and invented numbers", () => {
    const a = auditScriptText(text, { claimsForbidden: ["brightest"], sourceText: "Black Friday 15% off" });
    const reasons = a.violations.map((v) => v.reason).join(" | ");
    expect(reasons).toMatch(/forbidden claim: "brightest"/);
    expect(reasons).toMatch(/unsourced numeric claim: "20%/);
    expect(reasons).not.toMatch(/absolute|social proof/);
  });

  it("restores the absolute-word check under strictCompliance", () => {
    const a = auditScriptText(text, { sourceText: "20% off", strictCompliance: true });
    expect(a.violations.map((v) => v.reason).join(" ")).toMatch(/absolute\/curative claim: "Guaranteed"/i);
  });
});
