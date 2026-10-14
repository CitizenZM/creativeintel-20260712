/**
 * fetchWithRetry — a small retry/backoff/concurrency wrapper around fetch()
 * for external HTTP calls made from the research services (scrapers, search,
 * third-party APIs). Keeps each call site simple while centralizing:
 *  - retries with exponential backoff + jitter
 *  - Retry-After honoring on 429/503
 *  - a default request timeout
 *  - a small per-host concurrency limiter
 *
 * Caller cancellation and the per-attempt timeout are composed together.
 */

const DEFAULT_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_CONCURRENT_PER_HOST = 2;
const BASE_BACKOFF_MS = 500;

export interface FetchWithRetryOptions {
  retries?: number;
  timeoutMs?: number;
  maxConcurrentPerHost?: number;
}

// ─── Per-host concurrency limiter ──────────────────────────────────────────
// Each host gets a small semaphore implemented as a chained "tail" promise
// queue: acquire() awaits the current tail (bounded by the host's active
// count), then release() lets the next waiter proceed.

interface HostQueueState {
  active: number;
  waiters: Array<() => void>;
}

const hostQueues = new Map<string, HostQueueState>();

function getHostState(host: string): HostQueueState {
  let state = hostQueues.get(host);
  if (!state) {
    state = { active: 0, waiters: [] };
    hostQueues.set(host, state);
  }
  return state;
}

async function acquireHostSlot(host: string, maxConcurrent: number): Promise<() => void> {
  const state = getHostState(host);

  if (state.active < maxConcurrent) {
    state.active++;
    return () => releaseHostSlot(host);
  }

  await new Promise<void>((resolve) => {
    state.waiters.push(resolve);
  });
  state.active++;
  return () => releaseHostSlot(host);
}

function releaseHostSlot(host: string): void {
  const state = hostQueues.get(host);
  if (!state) return;
  state.active--;
  const next = state.waiters.shift();
  if (next) next();
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "unknown-host";
  }
}

// ─── Backoff / Retry-After helpers ─────────────────────────────────────────

function computeBackoffMs(attempt: number): number {
  const exp = BASE_BACKOFF_MS * 2 ** attempt;
  const jitter = Math.random() * BASE_BACKOFF_MS;
  return exp + jitter;
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const asSeconds = Number(value);
  if (!Number.isNaN(asSeconds)) return Math.max(0, asSeconds * 1000);
  const asDate = Date.parse(value);
  if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timeoutSignal(timeoutMs: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * fetch() with retries, exponential backoff + jitter, Retry-After honoring,
 * a default timeout, and a per-host concurrency limiter.
 */
export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  opts?: FetchWithRetryOptions
): Promise<Response> {
  const retries = opts?.retries ?? DEFAULT_RETRIES;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxConcurrentPerHost = opts?.maxConcurrentPerHost ?? DEFAULT_MAX_CONCURRENT_PER_HOST;
  const host = hostOf(url);

  let lastError: unknown;

  for (let attempt = 0; attempt < retries; attempt++) {
    const release = await acquireHostSlot(host, maxConcurrentPerHost);
    let pendingDelay: number | null = null;
    let result: Response | undefined;
    try {
      const requestInit: RequestInit = { ...init };
      requestInit.signal = requestInit.signal
        ? AbortSignal.any([requestInit.signal, timeoutSignal(timeoutMs)])
        : timeoutSignal(timeoutMs);

      const response = await fetch(url, requestInit);

      if (response.ok) {
        result = response;
      } else if (isRetryableStatus(response.status) && attempt < retries - 1) {
        const retryAfterMs = parseRetryAfterMs(response.headers.get("Retry-After"));
        pendingDelay = retryAfterMs ?? computeBackoffMs(attempt);
      } else {
        // Not retryable (or out of attempts) — return the response as-is so
        // callers can inspect status/body themselves.
        result = response;
      }
    } catch (err) {
      lastError = err;
      if (attempt < retries - 1) {
        pendingDelay = computeBackoffMs(attempt);
      } else {
        release();
        throw err;
      }
    }

    release();

    if (result) return result;
    if (pendingDelay !== null) {
      await sleep(pendingDelay);
      continue;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("fetchWithRetry: exhausted retries");
}
