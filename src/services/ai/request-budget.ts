/** Remaining wall-clock budget shared by provider retries and persistence. */
export function remainingRequestMs(deadlineAt: number, capMs = Number.MAX_SAFE_INTEGER): number {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) throw new Error("Image request deadline exceeded");
  return Math.max(1, Math.min(capMs, remaining));
}
