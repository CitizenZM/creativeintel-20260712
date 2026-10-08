import { describe, expect, it } from "vitest";
import { createTtlCache } from "./ttl-cache";

function clock(start = 1_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("createTtlCache", () => {
  it("returns a value until its TTL elapses", () => {
    const c = clock();
    const cache = createTtlCache<string>({ ttlMs: 30_000, now: c.now });
    cache.set("u1", "approved");
    expect(cache.get("u1")).toBe("approved");
    c.advance(29_999);
    expect(cache.get("u1")).toBe("approved");
    c.advance(1);
    expect(cache.get("u1")).toBeUndefined();
  });

  it("misses on unknown keys and after delete / clear", () => {
    const cache = createTtlCache<number>({ ttlMs: 1000 });
    expect(cache.get("nope")).toBeUndefined();
    cache.set("a", 1);
    cache.set("b", 2);
    cache.delete("a");
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    cache.clear();
    expect(cache.get("b")).toBeUndefined();
  });

  it("set refreshes the expiry", () => {
    const c = clock();
    const cache = createTtlCache<string>({ ttlMs: 1000, now: c.now });
    cache.set("u", "pending");
    c.advance(800);
    cache.set("u", "approved");
    c.advance(800);
    expect(cache.get("u")).toBe("approved");
  });

  it("evicts the oldest entry beyond maxEntries", () => {
    const cache = createTtlCache<number>({ ttlMs: 1000, maxEntries: 2 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
    expect(cache.size).toBe(2);
  });
});
