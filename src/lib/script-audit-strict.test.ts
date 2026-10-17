import { describe, expect, it } from "vitest";
import { auditScriptClaims, auditScriptText, repairScriptCta, scriptV2Schema } from "./script-schema";

const text = "Guaranteed brightest picture — the #1 best-selling TV, 20% off today";

describe("claims audit strictness", () => {
  it("rejects numeric claims when no approved source facts exist", () => {
    expect(auditScriptText("99% effective", {}).violations).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: expect.stringContaining("unsourced numeric claim") })])
    );
    const script = scriptV2Schema.parse({ title: "No source", hook: { text: "99% effective" } });
    expect(auditScriptClaims(script, {}).violations).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "hook.text", reason: expect.stringContaining("unsourced numeric claim") })])
    );
  });

  it("does not treat a price or a code number as evidence for a percentage", () => {
    expect(auditScriptText("20% off", { sourceText: "$20; code SAVE20" }).ok).toBe(false);
    expect(auditScriptText("20% off", { sourceText: "Save twenty percent" }).ok).toBe(true);
  });

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

describe("deterministic CTA repair", () => {
  it("removes unsourced urgency and selects an approved CTA without a second model call", () => {
    const script = scriptV2Schema.parse({ title: "CTA test", cta: { text: "Buy now", urgency: "Only today" } });
    const opts = { ctaOptions: ["Explore Moneta PACKS"], offerText: "" };
    expect(auditScriptClaims(script, opts).ok).toBe(false);
    const repaired = repairScriptCta(script, opts);
    expect(repaired.cta).toMatchObject({ text: "Explore Moneta PACKS", urgency: "" });
    expect(auditScriptClaims(repaired, opts).ok).toBe(true);
  });

  it("keeps a legitimate dated offer and leaves unrelated violations for review", () => {
    const script = scriptV2Schema.parse({ title: "Dated offer", hook: { text: "25% off" }, cta: { text: "Shop now", urgency: "Offer ends tonight" } });
    const opts = { ctaOptions: ["Shop now"], offerText: "Offer ends tonight", sourceText: "10% off" };
    const repaired = repairScriptCta(script, opts);
    expect(repaired.cta.urgency).toBe("Offer ends tonight");
    expect(auditScriptClaims(repaired, opts).violations.some((v) => v.reason.includes("unsourced numeric"))).toBe(true);
  });
});
