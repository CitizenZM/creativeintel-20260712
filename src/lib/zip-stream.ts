/**
 * Streaming ZIP writer — STORE method (no compression), no dependency. Entries are written one at a time
 * as the consumer pulls, so a "download all" never holds more than one chunk of a video in memory:
 *
 *   local file header · data · [data descriptor]   per entry
 *   central directory record                        per entry
 *   end of central directory
 *
 * Bytes in hand get their CRC-32 and sizes in the local header. A streamed entry (a blob fetched while
 * zipping) sets general-purpose flag bit 3: zeros in the local header, then a data descriptor with the
 * real CRC-32 / sizes after the data; the central directory always carries the real values. Names are
 * UTF-8 (flag bit 11). No ZIP64: an archive past 4 GiB or 65 535 entries is refused.
 * (src/lib/zip.ts is the in-memory variant for small text bundles.)
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** Running CRC-32: start from 0xffffffff, finish with `^ 0xffffffff`. */
function crcUpdate(crc: number, buf: Uint8Array): number {
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return crc >>> 0;
}

export function crc32(buf: Uint8Array): number {
  return (crcUpdate(0xffffffff, buf) ^ 0xffffffff) >>> 0;
}

/** MS-DOS date / time words (local time, 2-second resolution, 1980–2107). */
export function dosDateTime(d: Date): { date: number; time: number } {
  const year = Math.min(Math.max(d.getFullYear(), 1980), 2107);
  return {
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
  };
}

type Body = AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>;

export interface StreamZipEntry {
  /** Path inside the archive ("media/master-v2.mp4"). */
  name: string;
  /** Bytes or text in hand, or an opener for a body streamed when the entry is written (null = skip). */
  data: Uint8Array | string | (() => Promise<Body | null>);
  date?: Date;
}

export interface ZipStreamOptions {
  /** A streamed entry whose source could not be opened (skipped) or failed part-way (kept truncated). */
  onSkip?: (name: string, error?: unknown) => void;
}

const MAX_U32 = 0xffffffff;
const FLAG_UTF8 = 0x0800;
const FLAG_DESCRIPTOR = 0x0008;

interface CentralRecord {
  name: Uint8Array;
  flags: number;
  crc: number;
  size: number;
  offset: number;
  date: number;
  time: number;
}

function localHeader(name: Uint8Array, flags: number, crc: number, size: number, date: number, time: number): Uint8Array {
  const h = new Uint8Array(30 + name.length);
  const v = new DataView(h.buffer);
  v.setUint32(0, 0x04034b50, true);
  v.setUint16(4, 20, true); // version needed: 2.0
  v.setUint16(6, flags, true);
  v.setUint16(8, 0, true); // method: STORE
  v.setUint16(10, time, true);
  v.setUint16(12, date, true);
  v.setUint32(14, crc, true);
  v.setUint32(18, size, true); // compressed = uncompressed (STORE)
  v.setUint32(22, size, true);
  v.setUint16(26, name.length, true);
  v.setUint16(28, 0, true);
  h.set(name, 30);
  return h;
}

function dataDescriptor(crc: number, size: number): Uint8Array {
  const d = new Uint8Array(16);
  const v = new DataView(d.buffer);
  v.setUint32(0, 0x08074b50, true);
  v.setUint32(4, crc, true);
  v.setUint32(8, size, true);
  v.setUint32(12, size, true);
  return d;
}

function centralRecord(r: CentralRecord): Uint8Array {
  const c = new Uint8Array(46 + r.name.length);
  const v = new DataView(c.buffer);
  v.setUint32(0, 0x02014b50, true);
  v.setUint16(4, 0x0314, true); // made by: Unix, 2.0
  v.setUint16(6, 20, true);
  v.setUint16(8, r.flags, true);
  v.setUint16(10, 0, true);
  v.setUint16(12, r.time, true);
  v.setUint16(14, r.date, true);
  v.setUint32(16, r.crc, true);
  v.setUint32(20, r.size, true);
  v.setUint32(24, r.size, true);
  v.setUint16(28, r.name.length, true);
  v.setUint16(30, 0, true); // extra
  v.setUint16(32, 0, true); // comment
  v.setUint16(34, 0, true); // disk
  v.setUint16(36, 0, true); // internal attrs
  v.setUint32(38, (0o100644 << 16) >>> 0, true); // external attrs: regular file, rw-r--r--
  v.setUint32(42, r.offset, true);
  c.set(r.name, 46);
  return c;
}

function endOfCentralDirectory(count: number, size: number, offset: number): Uint8Array {
  const e = new Uint8Array(22);
  const v = new DataView(e.buffer);
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(8, count, true);
  v.setUint16(10, count, true);
  v.setUint32(12, size, true);
  v.setUint32(16, offset, true);
  return e;
}

async function* bodyChunks(body: Body): AsyncIterable<Uint8Array> {
  if (typeof (body as ReadableStream<Uint8Array>).getReader === "function") {
    const reader = (body as ReadableStream<Uint8Array>).getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        if (value?.length) yield value;
      }
    } finally {
      reader.releaseLock();
    }
  } else {
    for await (const chunk of body as AsyncIterable<Uint8Array>) if (chunk?.length) yield chunk;
  }
}

async function* zipChunks(entries: Iterable<StreamZipEntry> | AsyncIterable<StreamZipEntry>, opts: ZipStreamOptions): AsyncGenerator<Uint8Array> {
  const enc = new TextEncoder();
  const central: CentralRecord[] = [];
  let offset = 0;
  const guard = (n: number) => {
    if (n > MAX_U32) throw new Error("Archive larger than 4 GiB (ZIP64 is not supported) — download fewer files at once");
  };

  for await (const entry of entries as AsyncIterable<StreamZipEntry>) {
    const name = enc.encode(entry.name.replace(/^\/+/, ""));
    const { date, time } = dosDateTime(entry.date ?? new Date());
    const start = offset;

    if (typeof entry.data === "string" || entry.data instanceof Uint8Array) {
      const bytes = typeof entry.data === "string" ? enc.encode(entry.data) : entry.data;
      const crc = crc32(bytes);
      const header = localHeader(name, FLAG_UTF8, crc, bytes.length, date, time);
      guard(offset + header.length + bytes.length);
      yield header;
      if (bytes.length) yield bytes;
      offset += header.length + bytes.length;
      central.push({ name, flags: FLAG_UTF8, crc, size: bytes.length, offset: start, date, time });
      continue;
    }

    let body: Body | null = null;
    try {
      body = await entry.data();
    } catch (err) {
      opts.onSkip?.(entry.name, err);
      continue;
    }
    if (!body) {
      opts.onSkip?.(entry.name);
      continue;
    }
    const flags = FLAG_UTF8 | FLAG_DESCRIPTOR;
    const header = localHeader(name, flags, 0, 0, date, time);
    yield header;
    offset += header.length;
    let crc = 0xffffffff;
    let size = 0;
    try {
      for await (const chunk of bodyChunks(body)) {
        crc = crcUpdate(crc, chunk);
        size += chunk.length;
        guard(offset + size + 16);
        yield chunk;
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("ZIP64")) throw err;
      opts.onSkip?.(entry.name, err); // kept as far as it got: a valid, truncated entry
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    yield dataDescriptor(crc, size);
    offset += size + 16;
    central.push({ name, flags, crc, size, offset: start, date, time });
  }

  if (central.length > 0xffff) throw new Error("More than 65 535 files (ZIP64 is not supported)");
  const cdStart = offset;
  let cdSize = 0;
  for (const r of central) {
    const rec = centralRecord(r);
    cdSize += rec.length;
    yield rec;
  }
  guard(cdStart + cdSize);
  yield endOfCentralDirectory(central.length, cdSize, cdStart);
}

/** The archive as a byte stream, produced as it is read. */
export function zipStream(entries: Iterable<StreamZipEntry> | AsyncIterable<StreamZipEntry>, opts: ZipStreamOptions = {}): ReadableStream<Uint8Array> {
  const it = zipChunks(entries, opts);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await it.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (err) {
        controller.error(err);
      }
    },
    async cancel() {
      await it.return(undefined);
    },
  });
}
