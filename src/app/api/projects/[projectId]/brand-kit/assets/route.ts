import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { brandAssetMetaSchema } from "@/lib/validations";
import { ensureBrandKit, refreshCompleteness } from "@/services/brand-kit";
import { readImageMeta, uploadBuffer } from "@/services/storage";

export const maxDuration = 60;

const MAX_BYTES = 15 * 1024 * 1024;

const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
]);

function mimeAllowed(type: string): boolean {
  const t = type.split(";")[0].trim().toLowerCase();
  return ALLOWED_MIME.has(t) || t.startsWith("font/") || t === "application/font-woff" || t === "application/x-font-ttf";
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const kit = await ensureBrandKit(projectId);
  return NextResponse.json({ assets: kit.assets });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a multipart/form-data upload" }, { status: 400 });
  }

  const file = form.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const meta = brandAssetMetaSchema.safeParse({
    kind: (form.get("kind") as string | null) || "OTHER",
    variant: (form.get("variant") as string | null) || undefined,
    caption: (form.get("caption") as string | null) || undefined,
  });
  if (!meta.success) {
    return NextResponse.json({ error: "Invalid asset metadata", issues: meta.error.issues }, { status: 400 });
  }

  const contentType = (file.type || "application/octet-stream").split(";")[0].toLowerCase();
  if (!mimeAllowed(contentType)) {
    return NextResponse.json(
      { error: `Unsupported file type: ${contentType || "unknown"}. Allowed: PNG, JPEG, WebP, SVG, PDF, fonts.` },
      { status: 415 }
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File is larger than 15MB" }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length === 0) return NextResponse.json({ error: "File is empty" }, { status: 400 });
  if (buffer.length > MAX_BYTES) {
    return NextResponse.json({ error: "File is larger than 15MB" }, { status: 413 });
  }

  const kit = await ensureBrandKit(projectId);

  let upload;
  try {
    upload = await uploadBuffer({
      buffer,
      filename: file.name || `${meta.data.kind.toLowerCase()}-asset`,
      contentType,
      folder: `creativeintel/brand-kit/${projectId}`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 502 }
    );
  }

  const imageMeta = contentType.startsWith("image/") ? readImageMeta(buffer) : {};

  const asset = await prisma.brandAsset.create({
    data: {
      brandKitId: kit.id,
      kind: meta.data.kind,
      variant: meta.data.variant || null,
      caption: meta.data.caption || null,
      url: upload.url,
      publicId: upload.publicId,
      provider: upload.provider,
      width: upload.width ?? imageMeta.width ?? null,
      height: upload.height ?? imageMeta.height ?? null,
      format: upload.format ?? imageMeta.format ?? contentType.split("/")[1] ?? null,
      bytes: upload.bytes,
      verified: true,
    },
  });

  const completeness = await refreshCompleteness(projectId);

  return NextResponse.json(
    { asset, completeness, provider: upload.provider, warning: upload.warning },
    { status: 201 }
  );
}
