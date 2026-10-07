/**
 * Synthetic product images for the consistency tests (sharp + SVG, no files):
 * a tablet-like device — dark body, a screen inset by `bezel` (fraction of the
 * short side) showing a simple picture — on a plain background.
 */
import sharp from "sharp";

export interface DeviceOpts {
  width?: number;
  height?: number;
  /** Device body size as a fraction of the canvas. */
  bodyW?: number;
  bodyH?: number;
  bezel?: number;
  body?: string;
  background?: string;
  /** Screen picture colours. */
  sky?: string;
  sun?: string;
  ground?: string;
}

export function deviceSvg(o: DeviceOpts = {}): string {
  const W = o.width ?? 640;
  const H = o.height ?? 480;
  const bw = W * (o.bodyW ?? 0.7);
  const bh = H * (o.bodyH ?? 0.6);
  const x = (W - bw) / 2;
  const y = (H - bh) / 2;
  const t = Math.min(bw, bh) * (o.bezel ?? 0.03);
  const sx = x + t, sy = y + t, sw = bw - 2 * t, sh = bh - 2 * t;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="100%" height="100%" fill="${o.background ?? "#f4f4f2"}"/>
  <rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="${Math.min(bw, bh) * 0.04}" fill="${o.body ?? "#1c1c1e"}"/>
  <rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" fill="${o.sky ?? "#3d7bd9"}"/>
  <rect x="${sx}" y="${sy + sh * 0.62}" width="${sw}" height="${sh * 0.38}" fill="${o.ground ?? "#3e9a4a"}"/>
  <circle cx="${sx + sw * 0.72}" cy="${sy + sh * 0.3}" r="${sh * 0.14}" fill="${o.sun ?? "#f2c230"}"/>
  <rect x="${sx + sw * 0.12}" y="${sy + sh * 0.42}" width="${sw * 0.18}" height="${sh * 0.3}" fill="#c8553d"/>
</svg>`;
}

export function deviceImage(o: DeviceOpts = {}, format: "png" | "jpeg" = "png"): Promise<Buffer> {
  const img = sharp(Buffer.from(deviceSvg(o)));
  return format === "png" ? img.png().toBuffer() : img.jpeg({ quality: 88 }).toBuffer();
}

/** Normalised bounding box of the device body for the given options. */
export function deviceBox(o: DeviceOpts = {}): [number, number, number, number] {
  const bw = o.bodyW ?? 0.7;
  const bh = o.bodyH ?? 0.6;
  return [(1 - bw) / 2, (1 - bh) / 2, (1 + bw) / 2, (1 + bh) / 2];
}
