/**
 * Screen-plate visual check — free and local (ffmpeg-static + sharp, no model calls).
 *
 *   npx vite-node scripts/screenplate-verify.ts
 *
 * Synthesises a 4 s 1080×1920 clip: a TV (dark bezel, flat green #00FF00 screen) moves and skews
 * across a textured wall, its corners known exactly at t=0 and t=4. Two locally drawn images (a
 * sunflower-painting placeholder and a sheet-music page) are composited onto the screen, switching
 * with a fade at 2 s — once from the stated first/last corners (overlay mode) and once from the
 * free key detector (key mode). Frames at 0 / 1 / 2.5 / 4 s and a contact sheet land in
 * out/screenplate-test/, with numeric checks (content colour inside, no green fringe, picture
 * outside unchanged, corners on the bezel).
 */
import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";
import { applyScreenPlate, expandQuad, homography, quadAt, type Point, type Quad, type ScreenPlate, type TrackKey } from "../src/services/video-gen/edit/screen-plate";

const run = promisify(execFile);
const OUT = path.join(process.cwd(), "out/screenplate-test");
const W = 1080, H = 1920, DUR = 4, FPS = 30;
const CW = 1600, CH = 900; // content images (16:9)

// Device plane (the PNG warped onto the moving quad): body inset E, screen inset BX/BY, screen exactly 16:9.
const DW = 1720, DH = 1020, E = 6, BX = 60, BY = (DH - (DW - 2 * BX) * 9 / 16) / 2;
const DEVICE_T0: Quad = [[0.1, 0.3], [0.88, 0.26], [0.9, 0.53], [0.08, 0.5]];
const DEVICE_T4: Quad = [[0.18, 0.37], [0.93, 0.41], [0.9, 0.63], [0.15, 0.57]];

function screenQuad(device: Quad): Quad {
  const m = homography(device);
  return ([[BX / DW, BY / DH], [1 - BX / DW, BY / DH], [1 - BX / DW, 1 - BY / DH], [BX / DW, 1 - BY / DH]] as Point[]).map(([u, v]) => m(u, v)) as Quad;
}

async function images() {
  const device = `<svg xmlns="http://www.w3.org/2000/svg" width="${DW}" height="${DH}"><rect x="${E}" y="${E}" width="${DW - 2 * E}" height="${DH - 2 * E}" rx="14" fill="#1b1b1d"/><rect x="${E + 8}" y="${E + 8}" width="${DW - 2 * E - 16}" height="${DH - 2 * E - 16}" rx="10" fill="#2a2a2e"/><rect x="${BX}" y="${BY}" width="${DW - 2 * BX}" height="${DH - 2 * BY}" fill="#00ff00"/></svg>`;
  await sharp(Buffer.from(device)).png().toFile(path.join(OUT, "device.png"));
  const flowers = Array.from({ length: 9 }, (_, i) => {
    const x = 520 + (i % 3) * 230 + (i * 37) % 60, y = 230 + Math.floor(i / 3) * 140 + (i * 53) % 40, r = 62 + (i * 17) % 26;
    const petals = Array.from({ length: 14 }, (_, k) => `<ellipse cx="${x}" cy="${y - r}" rx="${r * 0.28}" ry="${r * 0.62}" fill="${k % 2 ? "#f2b705" : "#e89a0c"}" transform="rotate(${(k * 360) / 14} ${x} ${y})"/>`).join("");
    return `${petals}<circle cx="${x}" cy="${y}" r="${r * 0.55}" fill="#6b3d12"/><circle cx="${x}" cy="${y}" r="${r * 0.35}" fill="#8a5418"/>`;
  }).join("");
  const sun = `<svg xmlns="http://www.w3.org/2000/svg" width="${CW}" height="${CH}"><rect width="${CW}" height="${CH}" fill="#d9c25a"/><rect y="560" width="${CW}" height="340" fill="#c48a2c"/><path d="M640 900 L700 560 L1080 560 L1140 900 Z" fill="#e2b13c"/><path d="M700 600 Q890 520 1080 600" stroke="#2f5d8a" stroke-width="10" fill="none"/>${flowers}<rect x="5" y="5" width="${CW - 10}" height="${CH - 10}" fill="none" stroke="#ff00ff" stroke-width="60"/><text x="60" y="840" font-family="Georgia" font-size="54" fill="#3b2508">Sunflowers</text></svg>`;
  await sharp(Buffer.from(sun)).png().toFile(path.join(OUT, "sunflowers.png"));
  const staves = Array.from({ length: 5 }, (_, s) => {
    const y0 = 120 + s * 150;
    const lines = Array.from({ length: 5 }, (_, l) => `<line x1="80" x2="${CW - 80}" y1="${y0 + l * 16}" y2="${y0 + l * 16}" stroke="#111" stroke-width="3"/>`).join("");
    const notes = Array.from({ length: 16 }, (_, n) => {
      const x = 180 + n * 85, y = y0 + ((n * 7 + s * 3) % 9) * 8;
      return `<ellipse cx="${x}" cy="${y}" rx="11" ry="8" fill="#111" transform="rotate(-20 ${x} ${y})"/><line x1="${x + 10}" x2="${x + 10}" y1="${y}" y2="${y - 52}" stroke="#111" stroke-width="3"/>`;
    }).join("");
    return lines + notes + `<text x="92" y="${y0 + 52}" font-size="74" font-family="serif" fill="#111">𝄞</text>`;
  }).join("");
  const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${CW}" height="${CH}"><rect width="${CW}" height="${CH}" fill="#f7f4ec"/>${staves}<rect x="5" y="5" width="${CW - 10}" height="${CH - 10}" fill="none" stroke="#ff00ff" stroke-width="60"/></svg>`;
  await sharp(Buffer.from(sheet)).png().toFile(path.join(OUT, "sheet.png"));
}

const ffExpr = (a: number, b: number, size: number) => `${(a * size).toFixed(3)}+${((b - a) * size).toFixed(3)}*min(in/${FPS}/${DUR},1)`;

async function clip(file: string) {
  // Wall: warm texture + a couple of shapes. Device: the PNG on a transparent 1080×1920 plane
  // (1 px clear ring so the clamped warp leaves the outside clear), warped onto the moving quad.
  const order: [number, string, string][] = [[0, "x0", "y0"], [1, "x1", "y1"], [3, "x2", "y2"], [2, "x3", "y3"]];
  const corners = order.map(([c, xn, yn]) => `${xn}='${ffExpr(DEVICE_T0[c][0], DEVICE_T4[c][0], W)}':${yn}='${ffExpr(DEVICE_T0[c][1], DEVICE_T4[c][1], H)}'`).join(":");
  const g = [
    `color=c=0x6e5643:s=${W}x${H}:r=${FPS}:d=${DUR},noise=alls=22:allf=t,drawbox=x=0:y=1450:w=${W}:h=470:color=0x3b2a20:t=fill,drawbox=x=80:y=1250:w=380:h=200:color=0x8c6a4a:t=fill,drawbox=x=700:y=180:w=260:h=120:color=0xd8cbb4:t=fill[bg]`,
    `[0:v]scale=${W - 2}:${H - 2},pad=${W}:${H}:1:1:color=black@0,format=yuva444p,fps=${FPS},perspective=${corners}:sense=destination:eval=frame[dev]`,
    `[bg][dev]overlay=0:0:format=yuv444,format=yuv420p[v]`,
  ].join(";");
  await run(ffmpegPath!, ["-y", "-v", "error", "-loop", "1", "-framerate", String(FPS), "-t", String(DUR), "-i", path.join(OUT, "device.png"), "-filter_complex", g, "-map", "[v]", "-t", String(DUR), "-c:v", "libx264", "-crf", "14", "-preset", "veryfast", "-pix_fmt", "yuv420p", file], { timeout: 300_000 });
}

async function frameAt(video: string, n: number, out: string) {
  await run(ffmpegPath!, ["-y", "-v", "error", "-i", video, "-vf", `select=eq(n\\,${n})`, "-vsync", "0", "-frames:v", "1", "-update", "1", out]);
  return out;
}

type Raw = { data: Buffer; w: number; h: number };
async function raw(file: string, w?: number, h?: number): Promise<Raw> {
  const img = sharp(file).removeAlpha();
  const { data, info } = await (w ? img.resize(w, h!, { fit: "fill" }) : img).raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}
const px = (r: Raw, x: number, y: number) => {
  const i = (Math.round(Math.min(r.h - 1, Math.max(0, y))) * r.w + Math.round(Math.min(r.w - 1, Math.max(0, x)))) * 3;
  return [r.data[i], r.data[i + 1], r.data[i + 2]];
};
const diff = (a: number[], b: number[]) => (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 3;
function distToQuad(q: Quad, x: number, y: number) {
  let d = Infinity;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = q[i], [bx, by] = q[(i + 1) % 4];
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
    d = Math.min(d, Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay)));
  }
  return d;
}
function inside(q: Quad, x: number, y: number) {
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = q[i], [bx, by] = q[(i + 1) % 4];
    const c = Math.sign((bx - ax) * (y - ay) - (by - ay) * (x - ax));
    if (c && s && c !== s) return false;
    if (c) s = c;
  }
  return true;
}

async function check(label: string, video: string, original: string, contents: { sun: Raw; sheet: Raw }) {
  const truthTrack: TrackKey[] = [{ t: 0, quad: DEVICE_T0 }, { t: DUR, quad: DEVICE_T4 }];
  const rows: string[] = [];
  let ok = true;
  for (const [name, n] of [["0s", 0], ["1s", 30], ["2.5s", 75], ["4s", DUR * FPS - 1]] as const) {
    const t = n / FPS;
    const fFile = await frameAt(video, n, path.join(OUT, `${label}-${name}.png`));
    const oFile = await frameAt(original, n, path.join(OUT, `orig-${name}.png`));
    const f = await raw(fFile), o = await raw(oFile);
    const dev = quadAt(truthTrack, Math.min(t, DUR)).map(([x, y]) => [x * W, y * H]) as Quad;
    const scr = screenQuad(dev);
    const m = homography(scr);
    const content = t < 2 ? contents.sun : contents.sheet;
    // 1. content colour inside the screen (9 points)
    // (patch means: thin staff lines are resampled away on a ~780 px screen, so single pixels can't match)
    let cd = 0, cn = 0;
    for (const u of [0.2, 0.35, 0.5, 0.65, 0.8]) for (const v of [0.2, 0.5, 0.8]) {
      const a = [0, 0, 0], b = [0, 0, 0];
      for (let i = -5; i <= 5; i++) for (let j = -5; j <= 5; j++) {
        const uu = u + i * 0.004, vv = v + j * 0.004;
        const [x, y] = m(uu, vv);
        px(f, x, y).forEach((c, k) => (a[k] += c));
        px(content, uu * content.w, vv * content.h).forEach((c, k) => (b[k] += c));
      }
      cd += diff(a.map((c) => c / 121), b.map((c) => c / 121));
      cn++;
    }
    // 2. placement / drift: the content's magenta edge band (stroke 60 centred 5 px in → 35 px of the
    //    1600 × 900 image) must sit where the content quad puts it — the screen grown by the mode's bleed
    //    (2 px overlay; 3 px + 1 % of the shorter side under a key, where the bleed is hidden by the bezel).
    //    Mid-side probes: halfway through the visible part of the band must be magenta, 4 px past the
    //    band must not — a side that drifts by more than ~4 px fails.
    const side = (i: number) => Math.hypot(scr[(i + 1) % 4][0] - scr[i][0], scr[(i + 1) % 4][1] - scr[i][1]);
    const bleed = label === "keyed" ? 3 + 0.01 * Math.min(side(0), side(1)) : 2;
    const mc = homography(expandQuad(scr, bleed));
    const isM = (u: number, v: number) => { const [x, y] = mc(u, v); const [r, g, b] = px(f, x, y); return r > 150 && b > 150 && g < 140; };
    const ew = (side(0) + side(2)) / 2 + 2 * bleed, eh = (side(1) + side(3)) / 2 + 2 * bleed;
    const bandW = (35 / CW) * ew, bandH = (35 / CH) * eh; // band width on screen, px
    const inU = (bleed + bandW) / 2 / ew, outU = (bandW + 4) / ew, inV = (bleed + bandH) / 2 / eh, outV = (bandH + 4) / eh;
    const probes: [number, number, boolean][] = [
      [0.5, inV, true], [0.5, outV, false], [0.5, 1 - inV, true], [0.5, 1 - outV, false],
      [inU, 0.5, true], [outU, 0.5, false], [1 - inU, 0.5, true], [1 - outU, 0.5, false],
    ];
    // Key mode tracks the DETECTED screen (corner error up to ~4 px vs this analytic reference, ~2 px of
    // which is the synthetic clip's own chroma/pad offset), so up to two of its eight ±4 px probes may miss.
    const cornerHits = probes.filter(([u, v, want]) => isM(u, v) === want).length;
    // 3. green fringe in a ±4 px band around the screen edge; 4. picture outside the device unchanged
    let fringe = 0, band = 0, od = 0, on = 0;
    for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
      const d = distToQuad(scr, x, y);
      if (d <= 4) {
        band++;
        const [r, g, b] = px(f, x, y);
        if (g > r + 60 && g > b + 60) fringe++;
      } else if (!inside(dev, x, y) && distToQuad(dev, x, y) > 6) {
        od += diff(px(f, x, y), px(o, x, y));
        on++;
      }
    }
    let green = 0, total = 0;
    for (let k = 0; k < 400; k++) {
      const [x, y] = m(0.02 + 0.96 * ((k % 20) / 19), 0.02 + 0.96 * (Math.floor(k / 20) / 19));
      const [r, g, b] = px(f, x, y);
      total++;
      if (g > r + 60 && g > b + 60) green++;
    }
    const rowOk = cd / cn < 28 && cornerHits >= (label === "keyed" ? 6 : 8) && fringe / band < 0.01 && od / on < 4.5 && green === 0;
    ok &&= rowOk;
    rows.push(`${label} ${name.padEnd(4)} contentΔ=${(cd / cn).toFixed(1)} edges=${cornerHits}/8 fringe=${fringe}/${band} greenInside=${green}/${total} outsideΔ=${(od / on).toFixed(2)} ${rowOk ? "OK" : "FAIL"}`);
  }
  console.log(rows.join("\n"));
  return ok;
}

async function main() {
  if (!ffmpegPath) throw new Error("no ffmpeg");
  await mkdir(OUT, { recursive: true });
  await images();
  const src = path.join(OUT, "clip.mp4");
  await clip(src);
  const first = screenQuad(DEVICE_T0), last = screenQuad(DEVICE_T4);
  const contents = [
    { path: path.join(OUT, "sunflowers.png"), fromSec: 0 },
    { path: path.join(OUT, "sheet.png"), fromSec: 2, transition: "fade" as const },
  ];
  const tA = Date.now();
  const plateA: ScreenPlate = { contents, firstLast: [first, last], aspect: 16 / 9 };
  await applyScreenPlate({ src, out: path.join(OUT, "plate-firstlast.mp4"), plate: plateA, dir: OUT });
  const tB = Date.now();
  const plateB: ScreenPlate = { contents, detect: "key", key: "#00FF00", aspect: 16 / 9 };
  const { track } = await applyScreenPlate({ src, out: path.join(OUT, "plate-keyed.mp4"), plate: plateB, dir: OUT });
  const tC = Date.now();
  const truth: TrackKey[] = [{ t: 0, quad: first }, { t: DUR, quad: last }];
  const err = Math.max(...track.flatMap((k) => quadAt(truth, k.t).map(([x, y], i) => Math.hypot((x - k.quad[i][0]) * W, (y - k.quad[i][1]) * H))));
  console.log(`render firstLast ${((tB - tA) / 1000).toFixed(1)} s, keyed (detect+render) ${((tC - tB) / 1000).toFixed(1)} s; key detector: ${track.length} keys, max corner error ${err.toFixed(2)} px`);
  const sun = await raw(path.join(OUT, "sunflowers.png"));
  const sheet = await raw(path.join(OUT, "sheet.png"));
  const okA = await check("firstlast", path.join(OUT, "plate-firstlast.mp4"), src, { sun, sheet });
  const okB = await check("keyed", path.join(OUT, "plate-keyed.mp4"), src, { sun, sheet });
  // Contact sheet: original | firstLast | keyed, at 0 / 1 / 2.5 / 4 s.
  const tiles = ["0s", "1s", "2.5s", "4s"].flatMap((n) => [`orig-${n}.png`, `firstlast-${n}.png`, `keyed-${n}.png`].map((f) => path.join(OUT, f)));
  await run(ffmpegPath, ["-y", "-v", "error", ...tiles.flatMap((t) => ["-i", t]), "-filter_complex", `${tiles.map((_, i) => `[${i}:v]scale=270:480[t${i}]`).join(";")};${tiles.map((_, i) => `[t${i}]`).join("")}xstack=inputs=${tiles.length}:layout=${tiles.map((_, i) => `${(i % 3) * 270}_${Math.floor(i / 3) * 480}`).join("|")}`, "-frames:v", "1", "-update", "1", path.join(OUT, "contact-sheet.png")]);
  // Close-up of one corner to inspect edges/fringe at 4×.
  for (const label of ["firstlast", "keyed"]) {
    const [x, y] = screenQuad(quadAt([{ t: 0, quad: DEVICE_T0 }, { t: DUR, quad: DEVICE_T4 }], 2.5).map(([a, b]) => [a * W, b * H]) as Quad)[0];
    await sharp(path.join(OUT, `${label}-2.5s.png`)).extract({ left: Math.round(x) - 60, top: Math.round(y) - 60, width: 120, height: 120 }).resize(480, 480, { kernel: "nearest" }).toFile(path.join(OUT, `${label}-2.5s-corner-zoom.png`));
  }
  console.log(`${okA && okB ? "PASS" : "FAIL"} — frames + contact-sheet.png in ${OUT}`);
  if (!(okA && okB)) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
