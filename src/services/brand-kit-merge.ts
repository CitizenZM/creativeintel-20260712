/**
 * Pure helpers for the conflict-safe Brand Kit writers (PUT /brand-kit, /brand-kit/suggest): decide per
 * field, against the CURRENT row, what a save or a suggestion may change. See lib/optimistic-json.ts.
 */

/** Deep equality where every "empty" value (null, undefined, "", [], {}) is the same value. */
export function sameKitValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}

function canon(v: unknown): unknown {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() === "" ? null : v;
  if (Array.isArray(v)) return v.length === 0 ? null : v.map(canon);
  if (typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => [k, canon(x)] as const)
      .filter(([, x]) => x !== null)
      .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
    return entries.length === 0 ? null : Object.fromEntries(entries);
  }
  return v;
}

/** UI field key (BrandKit.fieldStatus / emptyFieldKeys) → the column that holds its value. */
export const KIT_COLUMN_OF: Record<string, string> = {
  colors: "colorsHex",
  fonts: "fonts",
  cta: "ctaOptions",
  offer: "offerText",
  landingUrl: "landingUrl",
  claimsAllowed: "claimsAllowed",
  claimsForbidden: "claimsForbidden",
  tone: "toneGuidelines",
  doNotShow: "doNotShow",
  skuName: "skuName",
  skuDimensions: "skuDimensionsCm",
  productSummary: "productSummary",
};

/**
 * What a user save may do to the kit. `candidate` is every field the request carries (column → new
 * value); `baseline` is what the client had loaded (same shape). With a baseline only the fields the
 * user actually changed are written — the rest keep whatever is in the row NOW, so two people (or a
 * save and an AI suggestion) editing different fields don't undo each other. Without one every
 * candidate is written, as before.
 *
 * Status: a written field is the user's own now ("absent = confirmed"); an unchanged field is
 * confirmed too only when the row still holds what the user saw and saved.
 */
export function planKitSave(opts: {
  candidate: Record<string, unknown>;
  baseline: Record<string, unknown> | null;
  current: Record<string, unknown>;
  currentStatus: Record<string, string>;
  columnToStatusKey: Record<string, string>;
  suggested: boolean;
}): { data: Record<string, unknown>; status: Record<string, string> } {
  const data: Record<string, unknown> = {};
  const status = { ...opts.currentStatus };
  for (const [col, value] of Object.entries(opts.candidate)) {
    const statusKey = opts.columnToStatusKey[col];
    const changed = !opts.baseline || !sameKitValue(value, opts.baseline[col]);
    if (changed) {
      data[col] = value;
      if (statusKey) {
        if (opts.suggested) status[statusKey] = "suggested";
        else delete status[statusKey];
      }
    } else if (statusKey && !opts.suggested && sameKitValue(opts.current[col], value)) {
      delete status[statusKey];
    }
  }
  return { data, status };
}
