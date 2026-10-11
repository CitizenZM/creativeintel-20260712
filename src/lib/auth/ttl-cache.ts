/**
 * A tiny in-process cache with a fixed time-to-live per entry and a size cap (oldest evicted first).
 * Used by the proxy's approval lookup (src/lib/auth/approval.ts) so a page load doesn't hit the DB
 * on every request. Per process only: another instance may serve a stale value for up to `ttlMs`.
 */
export interface TtlCache<V> {
  get(key: string): V | undefined;
  /**
   * The last value stored for `key` even if its TTL has passed, as long as it was stored within
   * `maxAgeMs` — a fallback for when the source of truth is briefly unreachable.
   */
  getStale(key: string, maxAgeMs: number): V | undefined;
  set(key: string, value: V): void;
  delete(key: string): void;
  clear(): void;
  readonly size: number;
}

export function createTtlCache<V>({
  ttlMs,
  maxEntries = 1000,
  now = Date.now,
}: {
  ttlMs: number;
  maxEntries?: number;
  now?: () => number;
}): TtlCache<V> {
  const entries = new Map<string, { value: V; expiresAt: number; storedAt: number }>();
  return {
    get(key) {
      const hit = entries.get(key);
      if (!hit) return undefined;
      // Expired entries stay until evicted or overwritten, so getStale() can still serve them.
      return now() >= hit.expiresAt ? undefined : hit.value;
    },
    getStale(key, maxAgeMs) {
      const hit = entries.get(key);
      return hit && now() - hit.storedAt <= maxAgeMs ? hit.value : undefined;
    },
    set(key, value) {
      entries.delete(key); // re-insert so Map order tracks recency of writes
      entries.set(key, { value, expiresAt: now() + ttlMs, storedAt: now() });
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
    delete(key) {
      entries.delete(key);
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
}
