/**
 * A tiny in-process cache with a fixed time-to-live per entry and a size cap (oldest evicted first).
 * Used by the proxy's approval lookup (src/lib/auth/approval.ts) so a page load doesn't hit the DB
 * on every request. Per process only: another instance may serve a stale value for up to `ttlMs`.
 */
export interface TtlCache<V> {
  get(key: string): V | undefined;
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
  const entries = new Map<string, { value: V; expiresAt: number }>();
  return {
    get(key) {
      const hit = entries.get(key);
      if (!hit) return undefined;
      if (now() >= hit.expiresAt) {
        entries.delete(key);
        return undefined;
      }
      return hit.value;
    },
    set(key, value) {
      entries.delete(key); // re-insert so Map order tracks recency of writes
      entries.set(key, { value, expiresAt: now() + ttlMs });
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
