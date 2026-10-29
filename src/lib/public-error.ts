/** Stable public fallback: provider, database and filesystem exceptions belong in server logs. */
export const PUBLIC_ERROR_MESSAGE = "Unable to complete this request. Please try again.";
export function safePublicError(_error: unknown): string {
  return PUBLIC_ERROR_MESSAGE;
}

/** Scrape/worker results may contain persisted provider errors nested below an otherwise successful response. */
export function redactPublicErrors<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redactPublicErrors) as T;
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    key === "error" && entry ? safePublicError(entry) : redactPublicErrors(entry),
  ])) as T;
}
