/**
 * Storage provider — one upload surface for brand assets.
 *
 * Provider is auto-detected from env at call time:
 *   1. Cloudinary      — CLOUDINARY_URL, or CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET
 *   2. Vercel Blob     — BLOB_READ_WRITE_TOKEN
 *   3. inline          — last resort, returns a data: URL so the app still works
 *                        with zero credentials (flagged with a warning).
 */
import { safeFetchBuffer } from "@/lib/safe-fetch";

export type StorageProviderName = "cloudinary" | "vercel-blob" | "inline";

export interface UploadBufferInput {
  buffer: Buffer;
  filename: string;
  contentType: string;
  folder?: string;
}

export interface UploadResult {
  url: string;
  publicId: string;
  provider: StorageProviderName;
  bytes: number;
  width?: number;
  height?: number;
  format?: string;
  warning?: string;
}

export interface StorageStatus {
  provider: StorageProviderName;
  configured: boolean;
}

const INLINE_MAX_BYTES = 2 * 1024 * 1024;

function cloudinaryConfigured(): boolean {
  if (process.env.CLOUDINARY_URL) return true;
  return (
    !!process.env.CLOUDINARY_CLOUD_NAME &&
    !!process.env.CLOUDINARY_API_KEY &&
    !!process.env.CLOUDINARY_API_SECRET
  );
}

function blobConfigured(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

export function getStorageStatus(): StorageStatus {
  if (cloudinaryConfigured()) return { provider: "cloudinary", configured: true };
  if (blobConfigured()) return { provider: "vercel-blob", configured: true };
  return { provider: "inline", configured: false };
}

// ─── Cheap image header parsing (no native deps) ─────────────────────────────

export interface ImageMeta {
  width?: number;
  height?: number;
  format?: string;
}

export function readImageMeta(buffer: Buffer): ImageMeta {
  if (buffer.length < 16) return {};

  // PNG — IHDR is always the first chunk
  if (buffer.readUInt32BE(0) === 0x89504e47) {
    return { format: "png", width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }

  // GIF
  if (buffer.toString("ascii", 0, 3) === "GIF") {
    return { format: "gif", width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }

  // WEBP (RIFF container)
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    const chunk = buffer.toString("ascii", 12, 16);
    try {
      if (chunk === "VP8X") {
        const w = 1 + (buffer.readUIntLE(24, 3) & 0xffffff);
        const h = 1 + (buffer.readUIntLE(27, 3) & 0xffffff);
        return { format: "webp", width: w, height: h };
      }
      if (chunk === "VP8 ") {
        return {
          format: "webp",
          width: buffer.readUInt16LE(26) & 0x3fff,
          height: buffer.readUInt16LE(28) & 0x3fff,
        };
      }
      if (chunk === "VP8L") {
        const bits = buffer.readUInt32LE(21);
        return { format: "webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
    } catch {
      return { format: "webp" };
    }
    return { format: "webp" };
  }

  // JPEG — walk markers to the first SOF segment
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = buffer[offset + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const len = buffer.readUInt16BE(offset + 2);
      const isSof =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        return {
          format: "jpeg",
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
        };
      }
      offset += 2 + len;
    }
    return { format: "jpeg" };
  }

  if (buffer.toString("ascii", 0, 5).trim().startsWith("<svg") || buffer.toString("utf8", 0, 300).includes("<svg")) {
    return { format: "svg" };
  }

  return {};
}

// ─── Providers ───────────────────────────────────────────────────────────────

function sanitizeName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80) || "asset";
}

function resourceTypeFor(contentType: string): "image" | "raw" | "video" {
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  return "raw";
}

async function uploadToCloudinary(input: UploadBufferInput, meta: ImageMeta): Promise<UploadResult> {
  const { v2: cloudinary } = await import("cloudinary");

  if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
  } else {
    cloudinary.config({ secure: true });
  }

  const resourceType = resourceTypeFor(input.contentType);
  const res = await new Promise<{
    public_id: string;
    secure_url: string;
    bytes?: number;
    width?: number;
    height?: number;
    format?: string;
  }>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: resourceType,
        folder: input.folder || "creativeintel/brand-kit",
        public_id: sanitizeName(input.filename.replace(/\.[^.]+$/, "")) + "-" + Date.now().toString(36),
        overwrite: false,
      },
      (err, result) => {
        if (err || !result) return reject(err || new Error("Cloudinary upload failed"));
        resolve(result as never);
      }
    );
    stream.end(input.buffer);
  });

  return {
    url: res.secure_url,
    publicId: res.public_id,
    provider: "cloudinary",
    bytes: res.bytes ?? input.buffer.length,
    width: res.width ?? meta.width,
    height: res.height ?? meta.height,
    format: res.format ?? meta.format,
  };
}

async function uploadToVercelBlob(input: UploadBufferInput, meta: ImageMeta): Promise<UploadResult> {
  const { put } = await import("@vercel/blob");
  const folder = (input.folder || "creativeintel/brand-kit").replace(/^\/+|\/+$/g, "");
  const key = `${folder}/${Date.now().toString(36)}-${sanitizeName(input.filename)}`;

  const res = await put(key, input.buffer, {
    access: "public",
    contentType: input.contentType,
    token: process.env.BLOB_READ_WRITE_TOKEN,
    addRandomSuffix: true,
  });

  return {
    url: res.url,
    publicId: res.pathname,
    provider: "vercel-blob",
    bytes: input.buffer.length,
    width: meta.width,
    height: meta.height,
    format: meta.format,
  };
}

function uploadInline(input: UploadBufferInput, meta: ImageMeta): UploadResult {
  if (input.buffer.length > INLINE_MAX_BYTES) {
    throw new Error(
      `No storage provider configured and the file is larger than ${Math.round(
        INLINE_MAX_BYTES / 1024 / 1024
      )}MB. Set CLOUDINARY_URL or BLOB_READ_WRITE_TOKEN, or upload a smaller file.`
    );
  }
  const url = `data:${input.contentType};base64,${input.buffer.toString("base64")}`;
  return {
    url,
    publicId: `inline/${sanitizeName(input.filename)}`,
    provider: "inline",
    bytes: input.buffer.length,
    width: meta.width,
    height: meta.height,
    format: meta.format,
    warning:
      "No storage provider is configured — this asset is stored inline in the database as a data URL. Set CLOUDINARY_URL or BLOB_READ_WRITE_TOKEN for durable hosted assets.",
  };
}

export async function uploadBuffer(input: UploadBufferInput): Promise<UploadResult> {
  const meta = input.contentType.startsWith("image/") ? readImageMeta(input.buffer) : {};

  if (cloudinaryConfigured()) {
    try {
      return await uploadToCloudinary(input, meta);
    } catch (err) {
      console.warn("Cloudinary upload failed, falling back:", err);
    }
  }

  if (blobConfigured()) {
    try {
      return await uploadToVercelBlob(input, meta);
    } catch (err) {
      console.warn("Vercel Blob upload failed, falling back:", err);
    }
  }

  return uploadInline(input, meta);
}

export async function uploadFromUrl(
  url: string,
  opts?: { filename?: string; folder?: string; contentType?: string }
): Promise<UploadResult> {
  const fetched = await safeFetchBuffer(url);
  if (!fetched.ok || !fetched.buffer) {
    throw new Error(fetched.error || `Failed to fetch ${url}`);
  }

  let filename = opts?.filename;
  if (!filename) {
    try {
      filename = new URL(url).pathname.split("/").pop() || "remote-asset";
    } catch {
      filename = "remote-asset";
    }
  }

  return uploadBuffer({
    buffer: fetched.buffer,
    filename,
    contentType: opts?.contentType || fetched.contentType.split(";")[0] || "application/octet-stream",
    folder: opts?.folder,
  });
}
