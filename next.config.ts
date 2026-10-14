import path from "node:path";
import type { NextConfig } from "next";
import { scriptPolicy } from "./src/lib/csp";

/**
 * Security headers on every response (pages and API). Deliberately conservative so nothing that
 * works today breaks:
 * - CSP enforces only the directives that can't break the app — no framing (clickjacking), no
 *   <base> hijacking, no plugins, upgrade any stray http:// subresource. A full script-src policy
 *   needs Clerk's and Next's script origins/nonces worked out first.
 * - Permissions-Policy turns off device APIs the app never uses.
 * - COOP same-origin-allow-popups keeps "Open on platform" (window.open) working.
 * - HSTS adds includeSubDomains (clerk., accounts., clkmail. are all HTTPS).
 */
export const SECURITY_HEADERS = [
  { key: "Content-Security-Policy-Report-Only", value: scriptPolicy() },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; upgrade-insecure-requests",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), interest-cohort=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  serverExternalPackages: ["pg", "ffmpeg-static", "msedge-tts"],
  // The GLM executor assembles masters with ffmpeg on the server; ship the
  // binary with the functions that run it.
  outputFileTracingIncludes: {
    "/api/queues/render": [
      "./node_modules/.pnpm/ffmpeg-static@*/node_modules/ffmpeg-static/ffmpeg",
      "./assets/fonts/**",
    ],
    "/api/projects/[projectId]/studio/libtv-runs/**": [
      "./node_modules/.pnpm/ffmpeg-static@*/node_modules/ffmpeg-static/ffmpeg",
      "./assets/fonts/**",
    ],
    "/api/cron/**": [
      "./node_modules/.pnpm/ffmpeg-static@*/node_modules/ffmpeg-static/ffmpeg",
      "./assets/fonts/**",
    ],
  },
  // local-files is disabled on Vercel. Its filesystem fallback must not pull
  // repository docs, source files, and tooling into every function bundle.
  outputFileTracingExcludes: {
    // `out/` contains local render experiments and QA media (489 MB here).
    // Server code uses runtime temp files and Blob; no route reads these
    // repository fixtures in production.
    "/*": ["./out/**"],
    "/api/**": [
      "./.git/**",
      "./.claude/**",
      "./docs/**",
      "./workers/**",
      "./scripts/**",
      "./prisma/migrations/**",
      "./src/**/*.ts",
      "./src/**/*.tsx",
      "./*.md",
      "./*.yml",
      "./*.yaml",
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
