/**
 * Upload a reference video for Ad Studio's "Imitate" workflows. The browser uploads straight to Vercel Blob with a
 * short-lived client token from here (same pattern as /api/worker/blob-upload); the resulting public URL becomes the
 * batch source `ref:<url>` and the Mac worker downloads it like any reference link.
 * No onUploadCompleted callback, so Vercel never calls back into this protected route.
 */
import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { withAccess } from "@/lib/auth/route-guard";

export const maxDuration = 30;
const MAX_BYTES = 200 * 1024 * 1024;

async function unguardedPOST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const body = (await request.json().catch(() => null)) as HandleUploadBody | null;
  if (!body) return NextResponse.json({ error: "upload body required" }, { status: 400 });
  try {
    const res = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith(`creativeintel/adstudio/refs/${projectId}/`)) throw new Error("wrong upload path");
        return { allowedContentTypes: ["video/mp4", "video/quicktime", "video/webm"], maximumSizeInBytes: MAX_BYTES, addRandomSuffix: true };
      },
    });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export const POST = withAccess(unguardedPOST);
