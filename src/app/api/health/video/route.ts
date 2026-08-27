import { NextResponse } from "next/server";
import { checkBinaries } from "@/services/video/binaries";
import { isCloudinaryConfigured } from "@/services/video/cloudinary-render";

export async function GET() {
  const bins = await checkBinaries();
  const cloud = isCloudinaryConfigured();
  const localReady = bins.ytdlp.available && bins.ffmpeg.available;
  // Cloud import works when Cloudinary is configured (YouTube only via ytdl-core).
  const cloudReady = cloud;
  return NextResponse.json({
    ready: localReady || cloudReady,
    mode: localReady ? "local" : cloudReady ? "cloud" : "none",
    binaries: bins,
    cloudinary: { configured: cloud },
    transcribe: {
      groq: !!process.env.GROQ_API_KEY,
      openai: !!process.env.OPENAI_API_KEY,
    },
    moneyprinter: { configured: !!process.env.MONEYPRINTER_PATH },
    videoGen: {
      fal: !!process.env.FAL_KEY,
      google: !!(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY),
    },
  });
}
