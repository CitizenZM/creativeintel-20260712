import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "ffmpeg-static"],
  // The GLM executor assembles masters with ffmpeg on the server; ship the
  // binary with the functions that run it.
  outputFileTracingIncludes: {
    "/api/projects/[projectId]/studio/libtv-runs/**": [
      "./node_modules/ffmpeg-static/ffmpeg",
      "./node_modules/.pnpm/ffmpeg-static@*/node_modules/ffmpeg-static/ffmpeg",
    ],
    "/api/cron/**": [
      "./node_modules/ffmpeg-static/ffmpeg",
      "./node_modules/.pnpm/ffmpeg-static@*/node_modules/ffmpeg-static/ffmpeg",
    ],
  },
  turbopack: {
    root: path.join(__dirname),
  },
  images: {
    remotePatterns: [
      { hostname: "i.ytimg.com" },
      { hostname: "oaidalleapiprodscus.blob.core.windows.net" },
    ],
  },
};

export default nextConfig;
