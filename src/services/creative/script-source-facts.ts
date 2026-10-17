import type { ProductBrief } from "./product-brief";
import type { PromoInput } from "./campaign-planner";

/** Facts allowed to substantiate numeric script claims; generated plan copy is never evidence. */
export function scriptSourceFacts(brief: ProductBrief | null | undefined, promo: PromoInput | null | undefined): string {
  const facts = (brief?.sellingPoints ?? []).flatMap((point) =>
    (point.sourceEvidence ?? []).filter((evidence) => evidence.verified === true).map((evidence) => evidence.quote)
  );
  if (promo) {
    for (const value of [promo.pct, promo.price, promo.comparePrice, promo.code, promo.deadline]) {
      if (value != null && String(value).trim()) facts.push(String(value));
    }
    if (!promo.pct && promo.price && promo.comparePrice && promo.comparePrice > promo.price) {
      facts.push(String(Math.round((1 - promo.price / promo.comparePrice) * 100)));
    }
  }
  return facts.filter((fact) => fact.trim()).join("\n").slice(0, 6000);
}
