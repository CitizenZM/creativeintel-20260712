/**
 * Competitors are typed by hand, and people paste domains ("WWW.hoka.com")
 * where a brand name belongs. Research searches ad libraries and YouTube by
 * that name, so a domain finds nothing — split it into a searchable brand
 * name and a crawlable URL.
 */

// Second-level labels that sit under a country TLD (brand.co.uk, brand.com.au).
const SECOND_LEVEL = new Set(["co", "com", "net", "org", "gov", "ac", "edu"]);

const DOMAIN_LIKE = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i;

function toUrl(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  try {
    return new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`).toString();
  } catch {
    return null;
  }
}

function brandFromHost(host: string): string {
  const labels = host.toLowerCase().replace(/^www\./, "").split(".");
  let i = labels.length - 2;
  if (i > 0 && SECOND_LEVEL.has(labels[i]) && labels[labels.length - 1].length === 2) i -= 1;
  const label = labels[Math.max(0, i)];
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function normalizeCompetitor(
  rawName: string,
  rawUrl?: string | null
): { name: string; url: string | null } {
  const name = rawName.trim().replace(/\s+/g, " ");
  const givenUrl = rawUrl ? toUrl(rawUrl) : null;

  if (!name.includes(" ") && DOMAIN_LIKE.test(name)) {
    const url = toUrl(name);
    if (url) {
      // "Booking.com" / "Amazon.com" are brand names styled as domains; only a
      // scheme, a www. prefix or an all-lowercase host reads as a paste.
      const pasted = /^(https?:\/\/|www\.)/i.test(name) || name === name.toLowerCase();
      return {
        name: pasted ? brandFromHost(new URL(url).hostname) : name,
        url: givenUrl ?? url,
      };
    }
  }
  return { name, url: givenUrl };
}
