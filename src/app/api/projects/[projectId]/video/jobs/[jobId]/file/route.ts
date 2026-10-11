import { NextResponse } from "next/server";
import { createReadStream, statSync } from "node:fs";
import { ReadableStream } from "node:stream/web";
import { prisma } from "@/lib/db";
import { withAccess } from "@/lib/auth/route-guard";

async function unguardedGET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; jobId: string }> }
) {
  const { projectId, jobId } = await params;
  const job = await prisma.renderJob.findUnique({ where: { id: jobId } });
  if (!job || job.projectId !== projectId || !job.outputPath) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Cloud-hosted output (Cloudinary HTTPS URL): just redirect
  if (/^https?:\/\//i.test(job.outputPath)) {
    return NextResponse.redirect(job.outputPath, 302);
  }

  // Local file: stream
  try {
    const stat = statSync(job.outputPath);
    const stream = createReadStream(job.outputPath);
    const webStream = new ReadableStream({
      start(controller) {
        stream.on("data", (chunk) => controller.enqueue(chunk));
        stream.on("end", () => controller.close());
        stream.on("error", (err) => controller.error(err));
      },
    });
    return new NextResponse(webStream as unknown as BodyInit, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(stat.size),
        "Content-Disposition": `inline; filename="${job.id}.mp4"`,
      },
    });
  } catch {
    return NextResponse.json(
      {
        error:
          "Output file is not accessible from this server (it was rendered locally and the file no longer exists, or this is a Vercel deployment with no access to /tmp). Re-run the job.",
      },
      { status: 410 }
    );
  }
}

export const GET = withAccess(unguardedGET);
