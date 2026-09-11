/**
 * safeFetch — outbound HTTP with an SSRF guard.
 *
 * Every external URL the app fetches on the server (product pages, brand sites,
 * remote assets) must go through here: the scheme is restricted to http(s) and
 * the resolved address is checked against private / loopback / link-local ranges
 * so a user-supplied URL cannot reach internal services.
 */

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "instance-data",
]);

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

function ipv4ToParts(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;
  return nums;
}

function isPrivateIpv4(ip: string): boolean {
  const p = ipv4ToParts(ip);
  if (!p) return false;
  const [a, b] = p;
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 + 192.0.2.0/24
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51) return true; // TEST-NET-2
  if (a === 203 && b === 0) return true; // TEST-NET-3
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (v === "::" || v === "::1") return true;
  if (v.startsWith("fe80") || v.startsWith("fec0")) return true; // link-local / site-local
  if (/^f[cd]/.test(v)) return true; // unique local
  if (v.startsWith("ff")) return true; // multicast
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  return false;
}

export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return true;
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (ipv4ToParts(host)) return isPrivateIpv4(host);
  if (host.includes(":")) return isPrivateIpv6(host);
  return false;
}

/** Validate scheme + host, then resolve DNS and re-check every returned address. */
export async function assertSafeUrl(raw: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new UnsafeUrlError("Invalid URL");
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new UnsafeUrlError(`Blocked URL scheme: ${parsed.protocol}`);
  }
  if (isBlockedHost(parsed.hostname)) {
    throw new UnsafeUrlError(`Blocked host: ${parsed.hostname}`);
  }

  try {
    const { lookup } = await import("node:dns/promises");
    const addresses = await lookup(parsed.hostname, { all: true });
    for (const a of addresses) {
      const blocked = a.family === 6 ? isPrivateIpv6(a.address) : isPrivateIpv4(a.address);
      if (blocked) throw new UnsafeUrlError(`Blocked host: ${parsed.hostname} resolves to ${a.address}`);
    }
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw err;
    // DNS unavailable (edge runtime / offline) — scheme + literal host checks still applied.
  }

  return parsed;
}

export interface SafeFetchResult {
  ok: boolean;
  status: number;
  data: Record<string, unknown> | null;
  text?: string;
  error?: string;
}

export async function safeFetch(
  url: string,
  options?: RequestInit
): Promise<SafeFetchResult> {
  try {
    await assertSafeUrl(url);
  } catch (err) {
    return { ok: false, status: 0, data: null, error: err instanceof Error ? err.message : "Unsafe URL" };
  }

  try {
    const res = await fetch(url, options);
    const text = await res.text();
    let data: Record<string, unknown> | null = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    return { ok: res.ok && data !== null, status: res.status, data, text };
  } catch (err) {
    return { ok: false, status: 0, data: null, error: err instanceof Error ? err.message : "Request failed" };
  }
}

export interface SafeFetchTextResult {
  ok: boolean;
  status: number;
  text: string;
  contentType: string;
  finalUrl: string;
  error?: string;
}

/** Guarded fetch that returns the raw body — for HTML scraping. */
export async function safeFetchText(
  url: string,
  init?: RequestInit,
  opts?: { timeoutMs?: number; maxBytes?: number }
): Promise<SafeFetchTextResult> {
  const empty = { text: "", contentType: "", finalUrl: url };
  try {
    await assertSafeUrl(url);
  } catch (err) {
    return { ok: false, status: 0, ...empty, error: err instanceof Error ? err.message : "Unsafe URL" };
  }

  const timeoutMs = opts?.timeoutMs ?? 15_000;
  try {
    const res = await fetch(url, {
      redirect: "follow",
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(timeoutMs),
    });

    // A redirect may have landed somewhere internal.
    if (res.url && res.url !== url) {
      try {
        await assertSafeUrl(res.url);
      } catch (err) {
        return { ok: false, status: res.status, ...empty, error: err instanceof Error ? err.message : "Unsafe redirect" };
      }
    }

    const text = await res.text();
    const maxBytes = opts?.maxBytes ?? 3_000_000;
    return {
      ok: res.ok,
      status: res.status,
      text: text.length > maxBytes ? text.slice(0, maxBytes) : text,
      contentType: res.headers.get("content-type") || "",
      finalUrl: res.url || url,
      error: res.ok ? undefined : `HTTP ${res.status}`,
    };
  } catch (err) {
    return { ok: false, status: 0, ...empty, error: err instanceof Error ? err.message : "Request failed" };
  }
}

/** Guarded binary fetch — for pulling a remote asset into storage. */
export async function safeFetchBuffer(
  url: string,
  opts?: { timeoutMs?: number; maxBytes?: number }
): Promise<{ ok: boolean; status: number; buffer: Buffer | null; contentType: string; error?: string }> {
  try {
    await assertSafeUrl(url);
  } catch (err) {
    return { ok: false, status: 0, buffer: null, contentType: "", error: err instanceof Error ? err.message : "Unsafe URL" };
  }

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(opts?.timeoutMs ?? 20_000) });
    if (!res.ok) return { ok: false, status: res.status, buffer: null, contentType: "", error: `HTTP ${res.status}` };
    const arr = await res.arrayBuffer();
    const maxBytes = opts?.maxBytes ?? 15 * 1024 * 1024;
    if (arr.byteLength > maxBytes) {
      return { ok: false, status: res.status, buffer: null, contentType: "", error: "Remote file too large" };
    }
    return {
      ok: true,
      status: res.status,
      buffer: Buffer.from(arr),
      contentType: res.headers.get("content-type") || "application/octet-stream",
    };
  } catch (err) {
    return { ok: false, status: 0, buffer: null, contentType: "", error: err instanceof Error ? err.message : "Request failed" };
  }
}
