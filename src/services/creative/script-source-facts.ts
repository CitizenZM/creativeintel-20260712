import type { ProductBrief } from "./product-brief";
import type { PromoInput } from "./campaign-planner";
import { auditScriptText } from "@/lib/script-schema";

/** A matched quote must also substantiate every numeric assertion in the point. */
export function isSupportedBriefPoint(point: ProductBrief["sellingPoints"][number]): boolean {
  const quotes = point.sourceEvidence?.filter((evidence) => evidence.verified === true).map((evidence) => evidence.quote) ?? [];
  return quotes.length > 0 && auditScriptText(`${point.claim} ${point.benefit}`, { sourceText: quotes.join("\n") }).ok;
}

/** Selling copy is usable only when its brief point has supported evidence. */
export function verifiedBriefSellingPoints(brief: ProductBrief | null | undefined): string[] {
  return (brief?.sellingPoints ?? [])
    .filter(isSupportedBriefPoint)
    .slice(0, 6)
    .map((point) => `${point.claim} → ${point.benefit}`);
}

/** Facts allowed to substantiate numeric script claims; generated plan copy is never evidence. */
export function scriptSourceFacts(brief: ProductBrief | null | undefined, promo: PromoInput | null | undefined): string {
  const facts = (brief?.sellingPoints ?? []).flatMap((point) =>
    (point.sourceEvidence ?? []).filter((evidence) => evidence.verified === true).map((evidence) => evidence.quote)
  );
  if (promo) {
    for (const value of [promo.price, promo.comparePrice, promo.deadline]) {
      if (value != null && String(value).trim()) facts.push(String(value));
    }
    if (promo.pct != null) facts.push(`${promo.pct}%`);
    if (!promo.pct && promo.price && promo.comparePrice && promo.comparePrice > promo.price) {
      facts.push(`${Math.round((1 - promo.price / promo.comparePrice) * 100)}%`);
    }
  }
  return facts.filter((fact) => fact.trim()).join("\n").slice(0, 6000);
}
