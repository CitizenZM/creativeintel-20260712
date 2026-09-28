import { createHash, timingSafeEqual } from "node:crypto";

/** Header `x-worker-token` vs env WORKER_TOKEN, constant-time. False when either is missing. */
export function hasWorkerToken(request: Request): boolean {
  const expected = process.env.WORKER_TOKEN;
  const provided = request.headers.get("x-worker-token");
  if (!expected || !provided) return false;
  const a = createHash("sha256").update(expected).digest();
  const b = createHash("sha256").update(provided).digest();
  return timingSafeEqual(a, b);
}
