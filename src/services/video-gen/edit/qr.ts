/**
 * A small, dependency-free QR Code encoder (ISO/IEC 18004) for the E11 end card: byte mode,
 * error correction M, versions 1–10 (up to 213 bytes — plenty for a short landing URL).
 * Mask chosen by the standard penalty score. Returns the module matrix (true = dark), without
 * the quiet zone.
 */

// [data codewords per block, number of blocks] groups and EC codewords per block, level M.
const M_BLOCKS: Record<number, { ec: number; groups: [number, number][] }> = {
  1: { ec: 10, groups: [[16, 1]] },
  2: { ec: 16, groups: [[28, 1]] },
  3: { ec: 26, groups: [[44, 1]] },
  4: { ec: 18, groups: [[32, 2]] },
  5: { ec: 24, groups: [[43, 2]] },
  6: { ec: 16, groups: [[27, 4]] },
  7: { ec: 18, groups: [[31, 4]] },
  8: { ec: 22, groups: [[38, 2], [39, 2]] },
  9: { ec: 22, groups: [[36, 3], [37, 2]] },
  10: { ec: 26, groups: [[43, 4], [44, 1]] },
};
const ALIGN: Record<number, number[]> = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};
const dataCapacity = (v: number) => M_BLOCKS[v].groups.reduce((n, [len, count]) => n + len * count, 0);

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const r = new Array<number>(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      r[j] = gfMul(r[j], root);
      if (j + 1 < degree) r[j] ^= r[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return r;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const r = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ (r.shift() as number);
    r.push(0);
    divisor.forEach((d, i) => (r[i] ^= gfMul(d, factor)));
  }
  return r;
}

/** Bytes → the final interleaved codeword sequence for version v, level M. */
function codewords(bytes: Uint8Array, v: number): number[] {
  const cap = dataCapacity(v);
  const bits: number[] = [];
  const put = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, v < 10 ? 8 : 16);
  bytes.forEach((b) => put(b, 8));
  put(0, Math.min(4, cap * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((n, b) => (n << 1) | b, 0));
  for (let pad = 0xec; data.length < cap; pad ^= 0xec ^ 0x11) data.push(pad);

  const { ec, groups } = M_BLOCKS[v];
  const divisor = rsDivisor(ec);
  const blocks: number[][] = [];
  let k = 0;
  for (const [len, count] of groups) for (let i = 0; i < count; i++) blocks.push(data.slice(k, (k += len)));
  const ecBlocks = blocks.map((b) => rsRemainder(b, divisor));
  const out: number[] = [];
  const maxLen = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < maxLen; i++) for (const b of blocks) if (i < b.length) out.push(b[i]);
  for (let i = 0; i < ec; i++) for (const b of ecBlocks) out.push(b[i]);
  return out;
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

class Matrix {
  readonly size: number;
  readonly dark: boolean[][];
  readonly fn: boolean[][];
  constructor(readonly version: number) {
    this.size = version * 4 + 17;
    this.dark = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.fn = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }
  setFn(x: number, y: number, d: boolean) {
    this.dark[y][x] = d;
    this.fn[y][x] = true;
  }
  drawFunctionPatterns() {
    const n = this.size;
    for (let i = 0; i < n; i++) {
      this.setFn(6, i, i % 2 === 0);
      this.setFn(i, 6, i % 2 === 0);
    }
    for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) {
      for (let dy = -4; dy <= 4; dy++)
        for (let dx = -4; dx <= 4; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          const dist = Math.max(Math.abs(dx), Math.abs(dy));
          if (x >= 0 && x < n && y >= 0 && y < n) this.setFn(x, y, dist !== 2 && dist !== 4);
        }
    }
    const pos = ALIGN[this.version];
    const last = pos.length - 1;
    pos.forEach((ay, i) =>
      pos.forEach((ax, j) => {
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) this.setFn(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }),
    );
    this.drawFormat(0);
    if (this.version >= 7) {
      let rem = this.version;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const bits = (this.version << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const bit = ((bits >>> i) & 1) === 1;
        const a = n - 11 + (i % 3);
        const b = Math.floor(i / 3);
        this.setFn(a, b, bit);
        this.setFn(b, a, bit);
      }
    }
  }
  /** Format bits for level M (00) + mask, BCH(15,5), XOR 0x5412. */
  drawFormat(mask: number) {
    const n = this.size;
    const data = (0b00 << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) this.setFn(8, i, bit(i));
    this.setFn(8, 7, bit(6));
    this.setFn(8, 8, bit(7));
    this.setFn(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.setFn(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) this.setFn(n - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.setFn(8, n - 15 + i, bit(i));
    this.setFn(8, n - 8, true);
  }
  placeData(cw: number[]) {
    const n = this.size;
    let i = 0;
    for (let right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < n; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? n - 1 - vert : vert;
          if (!this.fn[y][x] && i < cw.length * 8) {
            this.dark[y][x] = ((cw[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
            i++;
          }
        }
      }
    }
  }
  applyMask(mask: number) {
    const f = MASKS[mask];
    for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) if (!this.fn[y][x] && f(x, y)) this.dark[y][x] = !this.dark[y][x];
  }
  penalty(): number {
    const n = this.size;
    const d = this.dark;
    let score = 0;
    const line = (get: (i: number, j: number) => boolean) => {
      for (let i = 0; i < n; i++) {
        let run = 1;
        for (let j = 1; j <= n; j++) {
          if (j < n && get(i, j) === get(i, j - 1)) run++;
          else {
            if (run >= 5) score += 3 + (run - 5);
            run = 1;
          }
        }
        const seq = Array.from({ length: n }, (_, j) => (get(i, j) ? 1 : 0)).join("");
        for (const p of ["10111010000", "00001011101"]) for (let at = seq.indexOf(p); at >= 0; at = seq.indexOf(p, at + 1)) score += 40;
      }
    };
    line((y, x) => d[y][x]);
    line((x, y) => d[y][x]);
    for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) if (d[y][x] === d[y][x + 1] && d[y][x] === d[y + 1][x] && d[y][x] === d[y + 1][x + 1]) score += 3;
    const darkCount = d.reduce((s, row) => s + row.filter(Boolean).length, 0);
    const total = n * n;
    score += (Math.ceil(Math.abs(darkCount * 20 - total * 10) / total) - 1) * 10;
    return score;
  }
}

/** The smallest version (1–10, level M) that holds `text` as UTF-8 bytes. */
export function qrVersionFor(text: string): number {
  const len = new TextEncoder().encode(text).length;
  for (let v = 1; v <= 10; v++) {
    const headerBits = 4 + (v < 10 ? 8 : 16);
    if (headerBits + len * 8 <= dataCapacity(v) * 8) return v;
  }
  throw new Error(`QR payload too long (${len} bytes; max 213)`);
}

/** Encode `text` (UTF-8, byte mode, level M). `mask` forces a mask pattern (tests); default picks the lowest penalty. */
export function encodeQr(text: string, mask?: number): { version: number; size: number; mask: number; modules: boolean[][] } {
  const version = qrVersionFor(text);
  const cw = codewords(new TextEncoder().encode(text), version);
  const build = (m: number) => {
    const q = new Matrix(version);
    q.drawFunctionPatterns();
    q.placeData(cw);
    q.applyMask(m);
    q.drawFormat(m);
    return q;
  };
  let best = mask ?? 0;
  if (mask === undefined) {
    let bestScore = Infinity;
    for (let m = 0; m < 8; m++) {
      const s = build(m).penalty();
      if (s < bestScore) {
        bestScore = s;
        best = m;
      }
    }
  }
  const q = build(best);
  return { version, size: q.size, mask: best, modules: q.dark };
}

/** Exposed for tests: the Reed–Solomon EC bytes for `data` with `degree` EC codewords. */
export const _rs = { divisor: rsDivisor, remainder: rsRemainder, codewords };
