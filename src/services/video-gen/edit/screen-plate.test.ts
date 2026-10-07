import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  applyScreenPlate,
  applyScreenPlates,
  cornerExpr,
  detectKeyedQuad,
  detectScreenQuad,
  homography,
  insideQuad,
  orderQuad,
  quadAt,
  resolveTrack,
  screenPlateFilter,
  snapQuadToEdges,
  type Quad,
} from "./screen-plate";

const run = promisify(execFile);
const near = (a: number[], b: number[], tol: number) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const px = (q: Quad, w: number, h: number) => q.map(([x, y]) => [x * w, y * h]) as Quad;
const svgPoly = (q: Quad) => q.map(([x, y]) => `${x},${y}`).join(" ");

describe("geometry + track", () => {
  const q: Quad = [[10, 20], [110, 10], [120, 90], [5, 80]];
  it("homography sends the unit square's corners onto the quad", () => {
    const m = homography(q);
    expect(near(m(0, 0), q[0], 1e-9)).toBe(true);
    expect(near(m(1, 0), q[1], 1e-9)).toBe(true);
    expect(near(m(1, 1), q[2], 1e-9)).toBe(true);
    expect(near(m(0, 1), q[3], 1e-9)).toBe(true);
    expect(insideQuad(q, ...m(0.5, 0.5))).toBe(true);
  });
  it("orders shuffled corners TL TR BR BL", () => {
    expect(orderQuad([q[2], q[0], q[3], q[1]])).toEqual(q);
  });
  it("firstLast spans the clip, quadAt interpolates linearly and holds after the last key", () => {
    const a: Quad = [[0.1, 0.1], [0.5, 0.1], [0.5, 0.4], [0.1, 0.4]];
    const b: Quad = [[0.3, 0.2], [0.7, 0.2], [0.7, 0.5], [0.3, 0.5]];
    const tr = resolveTrack({ firstLast: [a, b] }, 4);
    expect(tr.map((k) => k.t)).toEqual([0, 4]);
    expect(near(quadAt(tr, 2)[0], [0.2, 0.15], 1e-9)).toBe(true);
    expect(near(quadAt(tr, 9)[2], [0.7, 0.5], 1e-9)).toBe(true);
    expect(() => resolveTrack({}, 4)).toThrow(/no track/);
  });
  it("corner expressions are piecewise-linear in the frame number", () => {
    const tr = resolveTrack({ track: [{ t: 2, quad: [[0.5, 0], [1, 0], [1, 1], [0, 1]] }, { t: 0, quad: [[0.25, 0], [1, 0], [1, 1], [0, 1]] }] }, 4);
    expect(cornerExpr(tr, 0, 0, 1000)).toBe("250+250*clip(((in/30)-0)/2,0,1)");
    expect(cornerExpr(tr, 1, 0, 1000)).toBe("1000"); // static corner → constant
    expect(cornerExpr(tr, 0, 0, 1000, "smooth")).toContain("*(3-2*");
  });
});

describe("screenPlateFilter", () => {
  const plate = {
    contents: [{ path: "a.png", fromSec: 0 }, { path: "b.png", fromSec: 2, transition: "fade" as const }, { path: "c.png", fromSec: 3, transition: "wipe" as const }],
    firstLast: [[[0.1, 0.3], [0.9, 0.3], [0.9, 0.5], [0.1, 0.5]], [[0.2, 0.3], [0.9, 0.35], [0.9, 0.55], [0.15, 0.5]]] as [Quad, Quad],
  };
  it("warps the content timeline onto the moving quad and overlays it", () => {
    const f = screenPlateFilter(plate, 1080, 1920, 4, 1);
    expect(f).toContain("[1:v]select=eq(n\\,0),scale=");
    expect(f).toContain("[3:v]select=");
    expect(f).toMatch(/alphamerge,loop=loop=150:size=1/);
    expect(f).toMatch(/xfade=transition=fade:duration=0\.4:offset=1\.8/);
    expect(f).toMatch(/xfade=transition=wipeleft:duration=0\.5:offset=2\.75/);
    expect(f).toMatch(/perspective=x0='[^']*clip\(\(\(in\/30\)-0\)\/4,0,1\)[^']*'.*sense=destination:eval=frame/);
    expect(f).toContain("alphamerge");
    expect(f).toContain("[0:v]fps=30");
    expect(f.endsWith("format=yuv420p[sp]")).toBe(true);
    expect(f).not.toContain("colorkey");
  });
  it("key mode keys the screen colour out and puts the content underneath", () => {
    const f = screenPlateFilter({ ...plate, key: "#00FF00" }, 1080, 1920, 4, 1, { inLabel: "[v0]", outLabel: "[out]" });
    expect(f).toContain("colorkey=0x00ff00:0.33:0.08");
    expect(f).toContain("[v0]fps=30");
    expect(f.endsWith("[out]")).toBe(true);
    // black screens are not keyed by default (the bezel is black too)
    expect(screenPlateFilter({ ...plate, key: "#000000" }, 1080, 1920, 4, 1)).not.toContain("colorkey");
  });
});

describe("detectors", () => {
  const W = 360, H = 640;
  const truth: Quad = [[52.4, 201.3], [301.7, 180.6], [318.2, 352.9], [40.1, 331.2]];
  async function frame(screen: string) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#6e5643"/><rect x="20" y="480" width="120" height="60" fill="#8c6a4a"/><circle cx="300" cy="560" r="10" fill="#00ff00"/><polygon points="${svgPoly(expandBy(truth, 9))}" fill="#1b1b1d"/><polygon points="${svgPoly(truth)}" fill="${screen}"/></svg>`;
    return sharp(Buffer.from(svg)).png().toBuffer();
  }
  function expandBy(q: Quad, d: number): Quad {
    const cx = q.reduce((n, p) => n + p[0], 0) / 4, cy = q.reduce((n, p) => n + p[1], 0) / 4;
    return q.map(([x, y]) => { const l = Math.hypot(x - cx, y - cy); return [x + ((x - cx) / l) * d * 1.4, y + ((y - cy) / l) * d * 1.4]; }) as Quad;
  }

  it("detectKeyedQuad finds the largest green quad (ignores small green things)", async () => {
    const q = await detectKeyedQuad(await frame("#00ff00"), "#00FF00");
    expect(q).not.toBeNull();
    px(q!, W, H).forEach((p, i) => expect(near(p, truth[i], 1.5)).toBe(true));
  });
  it("detectKeyedQuad returns null without a key-coloured screen", async () => {
    expect(await detectKeyedQuad(await frame("#3060a0"), "#00FF00")).toBeNull();
  });
  it("snapQuadToEdges pulls a rough quad onto the screen edge", async () => {
    const { data, info } = await sharp(await frame("#d8d8d8")).grayscale().raw().toBuffer({ resolveWithObject: true });
    const rough = truth.map(([x, y], i) => [x + [5, -4, 3, -5][i], y + [-4, 5, 4, -3][i]]) as Quad;
    const snapped = snapQuadToEdges({ data, width: info.width, height: info.height }, rough, { radius: 10 });
    snapped.forEach((p, i) => expect(near(p, truth[i], 1.2)).toBe(true));
  });
  it("detectScreenQuad: vision gives rough corners (mocked), the local snap makes them exact", async () => {
    const img = await frame("#d8d8d8");
    const rough = truth.map(([x, y], i) => [(x + [4, -3, 3, -4][i]) / W, (y + [3, 4, -3, -2][i]) / H]);
    const vision = vi.fn(async (url: string) => {
      expect(url).toMatch(/^data:image\/jpeg;base64,/);
      return { found: true, tl: rough[0], tr: rough[1], br: rough[2], bl: rough[3] };
    });
    const q = await detectScreenQuad(img, { vision });
    expect(vision).toHaveBeenCalledOnce();
    px(q!, W, H).forEach((p, i) => expect(near(p, truth[i], 1.5)).toBe(true));
    const noRefine = await detectScreenQuad(img, { vision, refine: false });
    expect(near(noRefine![0], rough[0], 1e-9)).toBe(true);
  });
  it("detectScreenQuad never throws", async () => {
    const img = await frame("#d8d8d8");
    expect(await detectScreenQuad(img, { vision: async () => ({ found: false }) })).toBeNull();
    expect(await detectScreenQuad(img, { vision: async () => ({ found: true, tl: [0.1, 0.1], tr: [0.1, 0.1], br: [0.1, 0.1], bl: [0.1, 0.1] }) })).toBeNull();
    expect(await detectScreenQuad(img, { vision: async () => { throw new Error("quota"); } })).toBeNull();
  });
});

describe.skipIf(!ffmpegPath)("compositing on a moving green screen (ffmpeg)", () => {
  const W = 180, H = 320, DUR = 1, FPS = 30;
  const Q0: Quad = [[0.15, 0.3], [0.85, 0.27], [0.88, 0.55], [0.12, 0.52]];
  const Q1: Quad = [[0.22, 0.36], [0.9, 0.4], [0.86, 0.62], [0.18, 0.58]];
  let dir = "";
  let clip = "";
  const files: Record<string, string> = {};

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "screenplate-"));
    for (const [name, colour] of [["red", "#e01010"], ["blue", "#1030e0"]]) {
      files[name] = path.join(dir, `${name}.png`);
      await sharp({ create: { width: 160, height: 90, channels: 3, background: colour } }).png().toFile(files[name]);
    }
    // green plane with a 1 px clear ring, warped onto Q0 → Q1 (linear) over a textured wall
    const green = path.join(dir, "green.png");
    await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect x="1" y="1" width="${W - 2}" height="${H - 2}" fill="#00ff00"/></svg>`)).png().toFile(green);
    const e = (a: number, b: number, s: number) => `${(a * s).toFixed(2)}+${((b - a) * s).toFixed(2)}*min(in/${FPS}/${DUR},1)`;
    const c = ([[0, "x0", "y0"], [1, "x1", "y1"], [3, "x2", "y2"], [2, "x3", "y3"]] as const).map(([k, xn, yn]) => `${xn}='${e(Q0[k][0], Q1[k][0], W)}':${yn}='${e(Q0[k][1], Q1[k][1], H)}'`).join(":");
    clip = path.join(dir, "clip.mp4");
    await run(ffmpegPath!, ["-y", "-v", "error", "-loop", "1", "-framerate", String(FPS), "-t", String(DUR), "-i", green, "-filter_complex",
      `color=c=0x6e5643:s=${W}x${H}:r=${FPS}:d=${DUR},drawbox=x=0:y=250:w=${W}:h=70:color=0x3b2a20:t=fill,drawgrid=w=24:h=24:t=1:c=0x8c6a4a[bg];[0:v]format=yuva444p,perspective=${c}:sense=destination:eval=frame[s];[bg][s]overlay=format=yuv444,format=yuv420p[v]`,
      "-map", "[v]", "-t", String(DUR), "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p", clip]);
  }, 120_000);
  afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  async function frameRgb(video: string, n: number) {
    const out = path.join(dir, `f${n}-${path.basename(video)}.png`);
    await run(ffmpegPath!, ["-y", "-v", "error", "-i", video, "-vf", `select=eq(n\\,${n})`, "-vsync", "0", "-frames:v", "1", "-update", "1", out]);
    const { data } = await sharp(out).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    return (x: number, y: number) => { const i = (Math.round(y) * W + Math.round(x)) * 3; return [data[i], data[i + 1], data[i + 2]]; };
  }

  async function verify(out: string) {
    for (const [n, want] of [[6, [224, 16, 16]], [24, [16, 48, 224]]] as const) {
      const t = n / FPS;
      const q = px(quadAt([{ t: 0, quad: Q0 }, { t: DUR, quad: Q1 }], t), W, H);
      const m = homography(q);
      const got = await frameRgb(out, n), orig = await frameRgb(clip, n);
      // content colour across the screen, no green left inside
      for (const u of [0.08, 0.5, 0.92]) for (const v of [0.1, 0.5, 0.9]) {
        const [x, y] = m(u, v);
        const c = got(x, y);
        expect(near(c, want as unknown as number[], 40), `frame ${n} (${u},${v}) = ${c}`).toBe(true);
      }
      // the wall outside the screen is untouched
      let diff = 0, count = 0;
      for (let y = 4; y < H; y += 6) for (let x = 4; x < W; x += 6) {
        const d = Math.min(...q.map((p, i) => { const b = q[(i + 1) % 4]; const L = Math.hypot(b[0] - p[0], b[1] - p[1]); return Math.abs((x - p[0]) * (b[1] - p[1]) - (y - p[1]) * (b[0] - p[0])) / L; }));
        if (insideQuad(q, x, y) || d < 5) continue;
        diff += got(x, y).reduce((s, v, k) => s + Math.abs(v - orig(x, y)[k]), 0) / 3;
        count++;
      }
      expect(diff / count).toBeLessThan(3);
    }
  }

  const contents = () => [{ path: files.red, fromSec: 0 }, { path: files.blue, fromSec: 0.5 }];

  it("firstLast corners → content tracks the screen, switches at fromSec, outside unchanged", async () => {
    const out = path.join(dir, "fl.mp4");
    await applyScreenPlate({ src: clip, out, dir, plate: { contents: contents(), firstLast: [Q0, Q1], glare: 0 } });
    await verify(out);
  }, 120_000);

  it("detect: key → finds the green screen on sampled frames and keys it out", async () => {
    const out = path.join(dir, "key.mp4");
    const { track } = await applyScreenPlate({ src: clip, out, dir, plate: { contents: contents(), detect: "key", key: "#00FF00", glare: 0 } });
    expect(track.length).toBeGreaterThanOrEqual(2);
    px(track[0].quad, W, H).forEach((p, i) => expect(near(p, px(Q0, W, H)[i], 2.5)).toBe(true));
    await verify(out);
  }, 120_000);

  it("applyScreenPlates swaps only the planned frames' sources", async () => {
    const sources = new Map([["u1", clip], ["u2", clip]]);
    await applyScreenPlates({
      dir,
      frames: [{ frameNumber: 1, screenPlate: { contents: contents(), firstLast: [Q0, Q1] } }, { frameNumber: 2, screenPlate: null }],
      segments: [{ kind: "clip", url: "u1", frameNumber: 1 }, { kind: "clip", url: "u2", frameNumber: 2 }],
      sources,
    });
    expect(sources.get("u1")).toMatch(/sp1-1\.mp4$/);
    expect(sources.get("u2")).toBe(clip);
  }, 120_000);
});
