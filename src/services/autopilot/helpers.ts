/** Pure helpers for the autopilot steps (no DB). */
import { randomBytes } from "node:crypto";

/** cuid-shaped id ("c" + 24 base36) — matches the project-slug rewrite id pattern (src/lib/auth/paths.ts). */
export function newRowId(): string {
  const bytes = randomBytes(24);
  let s = "c";
  for (const b of bytes) s += (b % 36).toString(36);
  return s;
}

/** "$1,299.99" / "1.299,99 €" / "USD 49" → number (null when there is none). */
export function parsePrice(raw: string | number | null | undefined): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? raw : null;
  if (!raw) return null;
  const m = String(raw).match(/\d[\d.,\s]*/);
  if (!m) return null;
  let s = m[0].replace(/\s/g, "");
  if (/,\d{2}$/.test(s) && !/\.\d{2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number.parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Brand name from the scraped page, else the site's name ("www.anker.com" → "Anker"). */
export function brandFromUrl(url: string, scraped?: string | null): string {
  if (scraped?.trim()) return scraped.trim().slice(0, 80);
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").split(".");
    const label = host.length > 2 && host[host.length - 2].length <= 3 ? host[host.length - 3] : host[host.length - 2] ?? host[0];
    return label.charAt(0).toUpperCase() + label.slice(1);
  } catch {
    return "Brand";
  }
}
