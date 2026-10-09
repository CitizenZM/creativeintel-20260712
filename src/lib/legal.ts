/**
 * Legal documents for creative.xark.io: /terms and /privacy (public pages, src/app/terms|privacy).
 * Bump LEGAL_VERSION whenever either document changes materially — AppUser.legalVersion records
 * which version an account accepted at sign-up (Clerk "require express consent" checkbox).
 */
export const LEGAL_VERSION = "2026-10-09";
export const LEGAL_EFFECTIVE_DATE = "October 9, 2026";

export const LEGAL = {
  company: "Cell Digital Technology Inc.",
  product: "CreativeIntel",
  site: "creative.xark.io",
  /** Where legal / privacy requests go. Override with LEGAL_CONTACT_EMAIL. */
  contactEmail: process.env.LEGAL_CONTACT_EMAIL?.trim() || "legal@xark.io",
  governingLaw: "the State of California, USA",
  venue: "the state and federal courts located in California",
  minimumAge: 18,
} as const;

export const TERMS_PATH = "/terms";
export const PRIVACY_PATH = "/privacy";
