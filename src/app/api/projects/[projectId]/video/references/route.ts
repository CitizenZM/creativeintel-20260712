import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAccess } from "@/lib/auth/route-guard";

async function unguardedGET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const refs = await prisma.videoReference.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      sourceUrl: true,
      platform: true,
      durationSec: true,
      width: true,
      height: true,
      transcript: true,
      language: true,
      createdAt: true,
      contentAssetId: true,
      metadata: true,
    },
  });
  // Surface title from the embedded metadata for nicer display
  const cleaned = refs.map((r) => {
    const md = r.metadata as { title?: string; thumbnail?: string } | null;
    return {
      ...r,
      title: md?.title ?? r.sourceUrl,
      thumbnail: md?.thumbnail ?? null,
      transcriptPreview: r.transcript ? r.transcript.slice(0, 140) : null,
      transcript: undefined,
      metadata: undefined,
    };
  });
  return NextResponse.json({ references: cleaned });
}

export const GET = withAccess(unguardedGET);
