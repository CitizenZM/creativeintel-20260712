import { describe, expect, it } from "vitest";
import { auditScriptText } from "@/lib/script-schema";
import type { ProductBrief } from "./product-brief";
import type { PromoInput } from "./campaign-planner";
import { scriptSourceFacts } from "./script-source-facts";

describe("scriptSourceFacts", () => {
  it("accepts only verified product evidence and user-supplied offer numbers", () => {
    const brief = {
      product: { price: 99 },
      sellingPoints: [{
        claim: "98% effective",
        benefit: "Results in 7 days",
        proofVisual: { overlayText: "98% success" },
        sourceEvidence: [
          { quote: "12 oz can", verified: true },
          { quote: "98% effective", verified: false },
        ],
      }],
    } as unknown as ProductBrief;
    const promo = { price: 20, comparePrice: 25, code: "SAVE20" } as PromoInput;
    const facts = scriptSourceFacts(brief, promo);

    expect(facts).toContain("12 oz can");
    expect(facts).toContain("20");
    expect(facts).toContain("25");
    expect(facts).not.toContain("98");
    expect(facts).not.toContain("99");
    expect(facts).not.toContain("7 days");
    expect(auditScriptText("98% effective", { sourceText: facts }).ok).toBe(false);
    expect(auditScriptText("20% off", { sourceText: facts }).ok).toBe(true);
  });
});
