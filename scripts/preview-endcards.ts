/**
 * Local end-card preview: every template × theme rendered through the same ffmpeg overlay chain as the
 * v2 edit (template layers → fine print → bouncing CTA button → logo), with mid-animation and final frames,
 * contact sheets, and numeric layout checks (strict 9:16 safe box y 288–1220, no overlapping readable
 * layers, CTA button on screen for the last second). No network, no paid APIs.
 *
 *   npx vite-node --config vitest.config.ts scripts/preview-endcards.ts [--only E05,E06] [--themes brand,dark] [--bg frame.jpg] [--logo logo.png] [--landscape]
 *
 * Output: out/endcards-preview/ (gitignored) — sheet-final.jpg, sheet-mid.jpg, <id>-<theme>-{mid,final,last1s}.jpg, <id>-<theme>.mp4, report.json
 */
import { execFile } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";
import { DEFAULT_STYLE, type BrandStyle } from "../src/services/video-gen/edit/brand-style";
import { END_CARD_THEMES, endCardLayers, endCardSlots, layerFilter, layerInputArgs, RENDERABLE_END_CARDS, type EndCardData, type EndCardTemplate, type EndCardTheme, type LayerAnim } from "../src/services/video-gen/edit/endcard-render";
import { ctaButtonPng, finePrintPng, logoPng } from "../src/services/video-gen/edit/text-layers";

const run = promisify(execFile);
const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const OUT = path.resolve("out/endcards-preview");
const LANDSCAPE = process.argv.includes("--landscape");
const C = LANDSCAPE ? { w: 1920, h: 1080 } : { w: 1080, h: 1920 };
const SAFE = { top: 288, bottom: 1220 };
const CTA = 0.4; // end card starts here
const TOTAL = 3.6; // 3.2 s end card

async function svg(file: string, body: string, w: number, h: number) {
  await sharp(Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`)).png().toFile(file);
  return file;
}

/** A footage-like end frame: a living room with a TV on a stand (mid-tones, so every theme is tested on real contrast). */
async function background(file: string) {
  const { w, h } = C;
  const tvW = w * 0.62;
  const tvH = tvW * 0.58;
  const x = (w - tvW) / 2;
  const y = h * 0.42 - tvH / 2;
  return svg(file, `<defs><linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6E7C8C"/><stop offset="0.7" stop-color="#9AA5AE"/><stop offset="1" stop-color="#5A4632"/></linearGradient><linearGradient id="scr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1E6FD9"/><stop offset="0.5" stop-color="#F28A2E"/><stop offset="1" stop-color="#2B1450"/></linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#wall)"/><rect y="${h * 0.7}" width="${w}" height="${h * 0.3}" fill="#6B5139"/>
    <rect x="${x - 10}" y="${y - 10}" width="${tvW + 20}" height="${tvH + 20}" rx="8" fill="#111"/><rect x="${x}" y="${y}" width="${tvW}" height="${tvH}" fill="url(#scr)"/>
    <rect x="${w * 0.3}" y="${h * 0.62}" width="${w * 0.4}" height="${h * 0.05}" rx="6" fill="#3B2C1E"/><circle cx="${w * 0.82}" cy="${h * 0.3}" r="${w * 0.06}" fill="#E9E2C8" opacity="0.6"/>`, w, h);
}

async function product(file: string, kind: "tv" | "bar" | "tab", color: string) {
  const s = 600;
  const body =
    kind === "tv" ? `<rect x="40" y="120" width="520" height="310" rx="10" fill="#111"/><rect x="52" y="132" width="496" height="286" fill="${color}"/><rect x="270" y="430" width="60" height="50" fill="#333"/><rect x="200" y="476" width="200" height="14" rx="6" fill="#333"/>`
    : kind === "bar" ? `<rect x="40" y="250" width="520" height="90" rx="40" fill="#1A1A1A"/><rect x="70" y="270" width="460" height="50" rx="24" fill="${color}" opacity="0.5"/><rect x="230" y="380" width="140" height="160" rx="20" fill="#1A1A1A"/>`
    : `<rect x="130" y="60" width="340" height="480" rx="28" fill="#222"/><rect x="146" y="80" width="308" height="440" rx="16" fill="${color}"/>`;
  return svg(file, body, s, s);
}

const SAMPLE: Record<EndCardTemplate, (assets: Record<string, string>) => EndCardData> = {
  E01: () => ({ headline: "Hangs like art" }),
  E02: () => ({ headline: "Black Friday deal", pct: 30 }),
  E03: () => ({ code: "TCL10", pct: 10 }),
  E04: () => ({ headline: "Holiday price", price: 999, comparePrice: 1299 }),
  E05: () => ({ deadline: "Ends Sunday 11:59 PM", headline: "Up to 40% off" }),
  E06: () => ({ rating: 4.6, reviewCount: 12480, quote: "The picture is unreal and setup took five minutes. Best TV we've owned.", quoteBy: "Verified buyer, Amazon" }),
  E07: (a) => ({ headline: "Find yours", skus: [{ imagePath: a.tv, label: "QM8 65\"", price: 1299 }, { imagePath: a.bar, label: "Q-Class soundbar", price: 399 }, { imagePath: a.tab, label: "NXTPAPER 14", price: 349 }] }),
  E08: () => ({ headline: "Gift it", pct: 25 }),
  E09: () => ({ headline: "Holiday deal", button: "Tap Shop Now below" }),
  E10: () => ({ appName: "TCL Home", rating: 4.8, downloads: "2M+ downloads", benefits: ["Control every TCL device", "Free on iOS & Android"] }),
  E11: () => ({ url: "https://www.tcl.com/us/en/qm8", pct: 15 }),
  E12: () => ({ sticker: "ok go get one before they sell out 🛒" }),
};

interface Ov {
  file: string;
  startSec: number;
  endSec: number;
  y: number;
  anim?: LayerAnim;
  bounce?: boolean;
  role: string;
  png: Buffer;
}

/** Alpha bounding box of a PNG (x0, y0, x1, y1), or null when fully transparent. */
async function alphaBox(png: Buffer): Promise<[number, number, number, number] | null> {
  const { data, info } = await sharp(png).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++)
      if (data[y * info.width + x] > 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const ff = ffmpegPath as unknown as string;
  const only = arg("--only")?.split(",") as EndCardTemplate[] | undefined;
  const themes = (arg("--themes")?.split(",") as EndCardTheme[] | undefined) ?? END_CARD_THEMES;
  const ids = only ?? RENDERABLE_END_CARDS;
  const assets = {
    bg: arg("--bg") ?? (await background(path.join(OUT, `_bg${LANDSCAPE ? "_l" : ""}.png`))),
    tv: await product(path.join(OUT, "_tv.png"), "tv", "#2A7DE1"),
    bar: await product(path.join(OUT, "_bar.png"), "bar", "#E4002B"),
    tab: await product(path.join(OUT, "_tab.png"), "tab", "#F2C14E"),
  };
  // A wide wordmark logo (TCL-style) unless one is given; logoPng fetches a URL, so serve it as a data URL.
  const logoFile = arg("--logo") ?? (await svg(path.join(OUT, "_logo.png"), `<rect width="420" height="130" rx="10" fill="#E4002B"/><text x="210" y="98" font-family="Helvetica" font-weight="bold" font-size="96" fill="white" text-anchor="middle">BRAND</text>`, 420, 130));
  const look: BrandStyle = { ...DEFAULT_STYLE, logoUrl: `data:image/png;base64,${(await readFile(logoFile)).toString("base64")}` };
  const slots = endCardSlots(C);
  const report: Record<string, unknown>[] = [];
  const tag = LANDSCAPE ? "-16x9" : "";

  const jobs: (() => Promise<void>)[] = [];
  for (const id of ids)
    for (const theme of themes)
      jobs.push(async () => {
        const name = `${id}-${theme}${tag}`;
        const dir = path.join(OUT, "_work", name);
        await mkdir(dir, { recursive: true });
        const t = await endCardLayers(id, { ...SAMPLE[id](assets), theme }, C, look, { durationSec: TOTAL - CTA });
        if (!t) {
          report.push({ name, error: "template returned null for its sample data" });
          return;
        }
        const ovs: Ov[] = [];
        for (const [i, l] of t.layers.entries()) {
          const file = path.join(dir, `l${i}.png`);
          await writeFile(file, l.png);
          const endSec = l.durSec !== undefined ? Math.min(TOTAL, CTA + l.delaySec + l.durSec) : TOTAL;
          ovs.push({ file, startSec: CTA + l.delaySec, endSec, y: l.y, anim: l.anim === "bounce" ? undefined : l.anim, bounce: l.anim === "bounce", role: l.role, png: l.png });
        }
        const fine = await finePrintPng("Offer valid thru 12/01/2026 at brand.com. While supplies last.", C, look);
        await writeFile(path.join(dir, "fine.png"), fine);
        ovs.push({ file: path.join(dir, "fine.png"), startSec: CTA + 0.3, endSec: TOTAL, y: t.fineY ?? slots.fine, role: "fine", png: fine });
        const btnStart = CTA + 0.55;
        if (!t.hideButton) {
          const b = await ctaButtonPng(look.ctaText, C, t.look);
          await writeFile(path.join(dir, "btn.png"), b);
          ovs.push({ file: path.join(dir, "btn.png"), startSec: btnStart, endSec: TOTAL, y: slots.button, bounce: true, role: "button", png: b });
        }
        const logo = await logoPng(look.logoUrl!, C);
        if (logo) {
          await writeFile(path.join(dir, "logo.png"), logo);
          ovs.push({ file: path.join(dir, "logo.png"), startSec: CTA, endSec: TOTAL, y: slots.logo, role: "logo", png: logo });
        }

        // ── numeric checks on the final frame ──
        const issues: string[] = [];
        const boxes: { role: string; i: number; b: [number, number, number, number] }[] = [];
        for (const [i, o] of ovs.entries()) {
          if (o.endSec < TOTAL - 0.01) continue; // not on the final frame
          const ab = await alphaBox(o.png);
          if (!ab) continue;
          const m = await sharp(o.png).metadata();
          const left = Math.round((C.w - (m.width ?? 0)) / 2);
          const top = Math.round(C.h * o.y - (m.height ?? 0) / 2);
          const b: [number, number, number, number] = [left + ab[0], top + ab[1], left + ab[2], top + ab[3]];
          if (o.role === "backdrop") continue;
          if (!LANDSCAPE && (b[1] < SAFE.top || b[3] > SAFE.bottom)) issues.push(`${o.role}#${i} y ${b[1]}–${b[3]} outside safe box`);
          if (b[0] < 0 || b[2] > C.w || b[1] < 0 || b[3] > C.h) issues.push(`${o.role}#${i} outside frame`);
          if (o.role !== "decor") boxes.push({ role: o.role, i, b });
        }
        // Layers that share a centre and size by design (star fills on the row, bar text on the bar) stack on purpose.
        const sameSlot = (a: Ov, b: Ov) => a.y === b.y && a.role === b.role;
        for (let a = 0; a < boxes.length; a++)
          for (let b = a + 1; b < boxes.length; b++) {
            const A = boxes[a].b, B = boxes[b].b;
            const ov = Math.min(A[2], B[2]) - Math.max(A[0], B[0]) > 2 && Math.min(A[3], B[3]) - Math.max(A[1], B[1]) > 2;
            if (ov && !sameSlot(ovs[boxes[a].i], ovs[boxes[b].i])) issues.push(`overlap ${boxes[a].role}#${boxes[a].i} [${A.join(",")}] × ${boxes[b].role}#${boxes[b].i} [${B.join(",")}]`);
          }
        if (!t.hideButton && btnStart > TOTAL - 1) issues.push("button not on screen for the last second");

        // ── render through ffmpeg exactly like render-v2 ──
        const inputs = ["-loop", "1", "-framerate", "30", "-t", TOTAL.toFixed(3), "-i", assets.bg, ...ovs.flatMap((o) => layerInputArgs(o.file, o.anim, TOTAL))];
        const video = [`[0:v]scale=${C.w}:${C.h},setsar=1[fx]`];
        ovs.forEach((o, i) => {
          const from = i === 0 ? "[fx]" : `[o${i - 1}]`;
          if (o.anim && o.anim !== "none" && o.anim !== "bounce") {
            video.push(...layerFilter(1 + i, o.anim, o.y, o.startSec, o.endSec, from, `[o${i}]`));
            return;
          }
          const y = o.bounce ? `'H*${o.y}-h/2-H*0.09*abs(cos(2*PI*1.6*(t-${o.startSec.toFixed(3)})))*exp(-3.2*(t-${o.startSec.toFixed(3)}))'` : `H*${o.y}-h/2`;
          video.push(`${from}[${1 + i}:v]overlay=x=(W-w)/2:y=${y}:eval=${o.bounce ? "frame" : "init"}:enable='between(t,${o.startSec.toFixed(3)},${o.endSec.toFixed(3)})'[o${i}]`);
        });
        video.push(`[o${ovs.length - 1}]format=yuv420p[v]`);
        const mp4 = path.join(OUT, `${name}.mp4`);
        await run(ff, ["-y", "-v", "error", ...inputs, "-filter_complex", video.join(";"), "-map", "[v]", "-r", "30", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "20", "-t", TOTAL.toFixed(3), mp4], { maxBuffer: 16 * 1024 * 1024 });
        for (const [label, at] of [["mid", CTA + 0.3], ["last1s", TOTAL - 0.98], ["final", TOTAL - 0.04]] as const) {
          await run(ff, ["-y", "-v", "error", "-ss", at.toFixed(3), "-i", mp4, "-frames:v", "1", "-q:v", "3", path.join(OUT, `${name}-${label}.jpg`)]);
        }
        report.push({ name, layers: t.layers.length, hideButton: t.hideButton, issues });
        console.log(`${name.padEnd(16)} ${issues.length ? `✗ ${issues.join(" | ")}` : "✓"}`);
      });

  const POOL = 4;
  let next = 0;
  await Promise.all(Array.from({ length: POOL }, async () => {
    while (next < jobs.length) await jobs[next++]();
  }));

  // ── contact sheets: rows = themes, columns = templates ──
  const tw = LANDSCAPE ? 384 : 270;
  const th = LANDSCAPE ? 216 : 480;
  for (const label of ["final", "mid", "last1s"]) {
    const items: sharp.OverlayOptions[] = [];
    // Always the full grid (12 × 4): partial runs (--only) refresh their cells, the rest are kept.
    for (const [r, theme] of END_CARD_THEMES.entries())
      for (const [col, id] of RENDERABLE_END_CARDS.entries()) {
        const f = path.join(OUT, `${id}-${theme}${tag}-${label}.jpg`);
        try {
          items.push({ input: await sharp(f).resize(tw, th).toBuffer(), left: col * tw, top: 40 + r * (th + 40) });
        } catch {
          /* null template */
        }
        items.push({ input: Buffer.from(`<svg width="${tw}" height="40"><text x="8" y="28" font-family="Helvetica" font-size="22" fill="white">${id} · ${theme}</text></svg>`), left: col * tw, top: r * (th + 40) });
      }
    await sharp({ create: { width: tw * RENDERABLE_END_CARDS.length, height: END_CARD_THEMES.length * (th + 40) + 40, channels: 3, background: "#202020" } })
      .composite(items)
      .jpeg({ quality: 82 })
      .toFile(path.join(OUT, `sheet-${label}${tag}.jpg`));
  }
  await writeFile(path.join(OUT, `report${tag}.json`), JSON.stringify(report, null, 2));
  const bad = report.filter((r) => (r.issues as string[] | undefined)?.length || r.error);
  console.log(`\n${report.length} renders, ${bad.length} with issues → ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
