/**
 * Artifact kinds of the content-history archive (ProjectArtifact.kind) and the pure helpers around them:
 * labels, display order, file extensions and download filenames.
 */

export const ARTIFACT_KINDS = [
  "brief",
  "plan",
  "test-plan",
  "media-plan",
  "script",
  "storyboard",
  "keyframe",
  "clip",
  "master",
  "preview",
  "voiceover",
  "subtitles",
  "contact-sheet",
  "variant",
  "cutdown",
  "locale",
  "export",
  "cover",
  "image-ad",
  "report",
  "packshot",
  "logo",
  "other",
] as const;

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export const ARTIFACT_KIND_LABELS: Record<ArtifactKind, string> = {
  brief: "Product briefs",
  plan: "Plans",
  "test-plan": "Test plans",
  "media-plan": "Media plans",
  script: "Scripts",
  storyboard: "Storyboards",
  keyframe: "Keyframes",
  clip: "Clips",
  master: "Masters",
  preview: "Previews",
  voiceover: "Voiceovers",
  subtitles: "Subtitles",
  "contact-sheet": "Contact sheets",
  variant: "Variants",
  cutdown: "Cut-downs",
  locale: "Localized versions",
  export: "Exports",
  cover: "Covers",
  "image-ad": "Image ads",
  report: "Reports",
  packshot: "Packshots",
  logo: "Logos",
  other: "Other",
};

export function isArtifactKind(v: unknown): v is ArtifactKind {
  return typeof v === "string" && (ARTIFACT_KINDS as readonly string[]).includes(v);
}

const EXT_BY_TYPE: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "application/json": "json",
  "text/html": "html",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/x-subrip": "srt",
  "text/vtt": "vtt",
  "application/zip": "zip",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

const TYPE_BY_EXT: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  json: "application/json",
  html: "text/html",
  txt: "text/plain",
  csv: "text/csv",
  srt: "application/x-subrip",
  vtt: "text/vtt",
  zip: "application/zip",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  md: "text/markdown",
};

/** The file extension of a URL's path ("" when none / a data: URL without a known type). */
export function urlExtension(url: string): string {
  if (url.startsWith("data:")) {
    const type = url.slice(5).split(/[;,]/)[0];
    return EXT_BY_TYPE[type] ?? "";
  }
  try {
    const m = new URL(url).pathname.match(/\.([a-z0-9]{2,5})$/i);
    return m ? m[1].toLowerCase() : "";
  } catch {
    return "";
  }
}

/** Content type guessed from a URL's extension. */
export function contentTypeFromUrl(url: string): string | undefined {
  if (url.startsWith("data:")) return url.slice(5).split(/[;,]/)[0] || undefined;
  return TYPE_BY_EXT[urlExtension(url)];
}

export function extensionFor(contentType: string | null | undefined, url?: string | null): string {
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
  return EXT_BY_TYPE[type] ?? (url ? urlExtension(url) : "") ?? "";
}

/** A safe file name (no path separators, no quotes) of at most `max` characters. */
export function safeFileName(name: string, max = 80): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return cleaned.slice(0, max) || "artifact";
}

export interface FileNameInput {
  kind: string;
  title: string;
  version: number;
  contentType?: string | null;
  url?: string | null;
  /** True when the artifact is downloaded as its JSON content. */
  json?: boolean;
}

/** "master-Run-ab12-v2.mp4": kind, title and version, with the extension of what is downloaded. */
export function artifactFileName(a: FileNameInput): string {
  const ext = a.json ? "json" : extensionFor(a.contentType, a.url) || "bin";
  const base = safeFileName(`${a.kind}-${a.title}`, 90);
  return `${base}-v${a.version}.${ext}`;
}

/** Media category of a content type / URL for previews. */
export function mediaCategory(contentType: string | null | undefined, url?: string | null): "image" | "video" | "audio" | "text" | "other" {
  const type = (contentType || (url ? contentTypeFromUrl(url) : "") || "").toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("text/") || type.includes("json") || type.includes("subrip")) return "text";
  return "other";
}
