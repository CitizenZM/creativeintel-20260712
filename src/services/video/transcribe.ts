import { promises as fs } from "node:fs";
import { isStrictFree } from "@/lib/cost-mode";
import path from "node:path";
import { runProc, checkBinaries } from "./binaries";

export interface TranscribedSegment {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptResult {
  text: string;
  segments: TranscribedSegment[];
  language?: string;
  source: "groq" | "openai" | "none";
}

// Whisper endpoints (Groq + OpenAI) natively accept these containers — no
// transcoding needed. Uploading as-is is what makes transcription work on
// serverless runtimes where ffmpeg is not installed/available.
const NATIVE_CONTENT_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
  ".webm": "audio/webm",
  ".wav": "audio/wav",
  ".mpga": "audio/mpeg",
  ".mpeg": "video/mpeg",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
};

function nativeContentType(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  return NATIVE_CONTENT_TYPES[ext];
}

// Prefer Groq's whisper-large-v3 (free tier, fast). Fall back to OpenAI Whisper.
// If neither key is set, return a graceful no-transcript result.
export async function transcribeAudio(videoPath: string): Promise<TranscriptResult> {
  const groqKey = process.env.GROQ_API_KEY;
  // Strict free mode: Groq's free tier only — never paid OpenAI Whisper.
  const openaiKey = isStrictFree() ? undefined : process.env.OPENAI_API_KEY;

  if (!groqKey && !openaiKey) {
    return { text: "", segments: [], source: "none" };
  }

  let uploadPath = videoPath;
  let contentType = nativeContentType(videoPath);

  // Only fall back to ffmpeg wav conversion when the input container isn't
  // natively accepted by the whisper endpoints AND ffmpeg is actually
  // available on this runtime (serverless environments typically lack it).
  if (!contentType) {
    const bins = await checkBinaries();
    if (!bins.ffmpeg.available) {
      console.error(
        `transcribeAudio: unsupported container "${path.extname(videoPath)}" and ffmpeg is not available — skipping transcription.`
      );
      return { text: "", segments: [], source: "none" };
    }

    const wavPath = videoPath.replace(/\.[^.]+$/, ".wav");
    try {
      await runProc(
        "ffmpeg",
        ["-y", "-i", videoPath, "-ac", "1", "-ar", "16000", "-vn", wavPath],
        { timeoutMs: 60_000 }
      );
    } catch (err) {
      console.error("ffmpeg conversion failed:", err);
      return { text: "", segments: [], source: "none" };
    }
    uploadPath = wavPath;
    contentType = "audio/wav";
  }

  const buf = await fs.readFile(uploadPath);
  const filename = path.basename(uploadPath);

  if (groqKey) {
    try {
      return await transcribeGroq(buf, filename, contentType, groqKey);
    } catch (err) {
      console.error("Groq transcribe failed:", err);
    }
  }
  if (openaiKey) {
    try {
      return await transcribeOpenAI(buf, filename, contentType, openaiKey);
    } catch (err) {
      console.error("OpenAI transcribe failed:", err);
    }
  }
  return { text: "", segments: [], source: "none" };
}

async function transcribeGroq(
  buffer: Buffer,
  filename: string,
  contentType: string,
  key: string
): Promise<TranscriptResult> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buffer)], { type: contentType }), filename);
  form.append("model", "whisper-large-v3");
  form.append("response_format", "verbose_json");
  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data: { text: string; language?: string; segments?: { start: number; end: number; text: string }[] } =
    await res.json();
  return {
    text: data.text || "",
    segments: data.segments || [],
    language: data.language,
    source: "groq",
  };
}

async function transcribeOpenAI(
  buffer: Buffer,
  filename: string,
  contentType: string,
  key: string
): Promise<TranscriptResult> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buffer)], { type: contentType }), filename);
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data: { text: string; language?: string; segments?: { start: number; end: number; text: string }[] } =
    await res.json();
  return {
    text: data.text || "",
    segments: data.segments || [],
    language: data.language,
    source: "openai",
  };
}
