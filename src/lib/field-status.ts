/**
 * One colour language for every input in the pipeline:
 *   green  — confirmed: the user entered or approved it
 *   yellow — suggested: we pre-filled it from research; the user should check it
 *   red    — missing: needs the user to fill it in
 */
export type FieldStatus = "confirmed" | "suggested" | "missing";

/** Per-field review state persisted beside the values (e.g. BrandKit.fieldStatus). */
export type FieldStatusMap = Record<string, "confirmed" | "suggested">;

export function hasValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(hasValue);
  if (typeof value === "object") return Object.values(value as object).some(hasValue);
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  return !!value;
}

/**
 * Status of one field. An empty field is always missing; a filled field is
 * suggested only while it is still marked so, and confirmed otherwise — values
 * typed before this tracking existed were the user's own.
 */
export function fieldStatus(value: unknown, marked?: "confirmed" | "suggested" | null): FieldStatus {
  if (!hasValue(value)) return "missing";
  return marked === "suggested" ? "suggested" : "confirmed";
}

export function readStatusMap(value: unknown): FieldStatusMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: FieldStatusMap = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === "confirmed" || v === "suggested") out[k] = v;
  }
  return out;
}

/** Frame classes for a field or section in each state (theme tokens, both modes). */
export const FIELD_TONE: Record<FieldStatus, string> = {
  confirmed:
    "border-[color-mix(in_oklab,var(--status-healthy)_55%,transparent)] bg-[color-mix(in_oklab,var(--status-healthy-bg)_55%,transparent)]",
  suggested:
    "border-[color-mix(in_oklab,var(--status-attention)_60%,transparent)] bg-[color-mix(in_oklab,var(--status-attention-bg)_60%,transparent)]",
  missing:
    "border-[color-mix(in_oklab,var(--status-urgent)_60%,transparent)] bg-[color-mix(in_oklab,var(--status-urgent-bg)_60%,transparent)]",
};

export const FIELD_LABEL: Record<FieldStatus, string> = {
  confirmed: "Confirmed",
  suggested: "Suggested — please check",
  missing: "Needs your input",
};

export const FIELD_TEXT: Record<FieldStatus, string> = {
  confirmed: "text-[var(--status-healthy-fg)]",
  suggested: "text-[var(--status-attention-fg)]",
  missing: "text-[var(--status-urgent-fg)]",
};
