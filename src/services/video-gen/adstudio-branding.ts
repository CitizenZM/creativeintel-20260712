/**
 * What the user types into the Ad Studio panel for the close of the video (and the end-card preview): the logo and
 * product photo to show, the link on screen, the coupon code and text, the headline and the button words.
 * Pure helpers, no database: the panel (client), the preview route and createBatch all use them.
 */
export interface Branding {
  logoUrl?: string;
  productImageUrl?: string;
  linkUrl?: string;
  couponCode?: string;
  couponText?: string;
  headline?: string;
  cta?: string;
}

const url = (v: unknown) => (typeof v === "string" && /^https?:\/\/\S{3,480}$/.test(v.trim()) ? v.trim() : undefined);
const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ").slice(0, max) : undefined);

/** untrusted input -> only valid fields (http(s) URLs, a code of letters / digits / dash, short text) */
export function cleanBranding(raw: unknown): Branding {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const code = typeof r.couponCode === "string" ? r.couponCode.replace(/[^\w-]/g, "").toUpperCase().slice(0, 30) : "";
  const out: Branding = {
    logoUrl: url(r.logoUrl), productImageUrl: url(r.productImageUrl), linkUrl: url(r.linkUrl),
    couponCode: code || undefined, couponText: text(r.couponText, 120), headline: text(r.headline, 80), cta: text(r.cta, 30),
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v)) as Branding;
}

/** the preview route's query string for these fields ("" when nothing is set) */
export function brandingQuery(b: Branding): string {
  const m: Record<string, string | undefined> = { logo: b.logoUrl, photo: b.productImageUrl, url: b.linkUrl, code: b.couponCode, offer: b.couponText, headline: b.headline, cta: b.cta };
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(m)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `&${s}` : "";
}
