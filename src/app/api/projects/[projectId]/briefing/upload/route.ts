import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAccess } from "@/lib/auth/route-guard";

export const maxDuration = 30;

async function unguardedPOST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const fileName = file.name.toLowerCase();
    let extractedText = "";

    if (fileName.endsWith(".txt")) {
      extractedText = await file.text();
    } else if (fileName.endsWith(".pdf")) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const pdfParseModule = await import("pdf-parse");
      const pdfParse = (pdfParseModule as unknown as { default: (buf: Buffer) => Promise<{ text: string }> }).default || pdfParseModule;
      const data = await (pdfParse as (buf: Buffer) => Promise<{ text: string }>)(buffer);
      extractedText = data.text;
    } else if (fileName.endsWith(".docx") || fileName.endsWith(".doc")) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      extractedText = result.value;
    } else {
      return NextResponse.json(
        { error: "Unsupported file type. Use PDF, DOCX, or TXT." },
        { status: 400 }
      );
    }

    // Clean and truncate (keep first 10K chars to avoid DB bloat)
    extractedText = extractedText.replace(/\s+/g, " ").trim().slice(0, 10000);

    await prisma.project.update({
      where: { id: projectId },
      data: { briefingParsed: extractedText },
    });

    return NextResponse.json({
      success: true,
      fileName: file.name,
      fileSize: file.size,
      extractedLength: extractedText.length,
      preview: extractedText.slice(0, 200),
    });
  } catch (err) {
    console.error("Briefing upload failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500 }
    );
  }
}

export const POST = withAccess(unguardedPOST);
