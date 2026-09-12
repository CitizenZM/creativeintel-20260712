/**
 * Client-upload token issuer for local workers (libtv-worker, research-worker).
 *
 * Vercel Blob's `BLOB_READ_WRITE_TOKEN` is write-only in the Vercel product —
 * it cannot be read back from the dashboard, `vercel env pull`, or credential
 * rotation once the store is connected. Local Mac workers therefore cannot
 * hold the raw token. Instead they call this route (authenticated the same
 * way as `/api/worker/libtv`) to get a short-lived, path-scoped client token
 * via `@vercel/blob/client`'s `handleUpload`, then PUT the file bytes
 * directly to Vercel Blob's storage endpoint — the raw token never leaves
 * this server's runtime, and file bytes never pass through this route or
 * count against its request body limit.
 *
 * Auth: header `x-worker-token` vs env WORKER_TOKEN, constant-time — same
 * check as `/api/worker/libtv`.
 *
 * No `onUploadCompleted` callback is configured (see @vercel/blob/client
 * source: omitting it means no `callbackUrl` is ever set, so Vercel Blob
 * never calls this route back), which conveniently sidesteps Vercel
 * Deployment Protection blocking an unauthenticated inbound webhook.
 */
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

export const maxDuration = 30;

function isAuthorized(request: Request): boolean {
  const expected = process.env.WORKER_TOKEN;
  if (!expected) return false;

  const provided = request.headers.get("x-worker-token");
  if (!provided) return false;

  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) return false;

  return timingSafeEqual(expectedBuf, providedBuf);
}

const ALLOWED_PREFIXES = ["creativeintel/libtv/", "creativeintel/brand-kit/", "creativeintel/research/"];

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as HandleUploadBody | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!ALLOWED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
          throw new Error(`pathname must start with one of: ${ALLOWED_PREFIXES.join(", ")}`);
        }
        return {
          allowedContentTypes: ["image/*", "video/*"],
          addRandomSuffix: true,
          maximumSizeInBytes: 500 * 1024 * 1024,
        };
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (err) {
    console.error("worker/blob-upload failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error issuing blob upload token" },
      { status: 400 }
    );
  }
}
