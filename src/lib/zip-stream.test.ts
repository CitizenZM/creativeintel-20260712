import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { crc32, dosDateTime, zipStream } from "./zip-stream";

function hasUnzip(): boolean {
  try {
    execFileSync("unzip", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const parts: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  return Buffer.concat(parts);
}

async function* chunks(...parts: string[]): AsyncIterable<Uint8Array> {
  for (const p of parts) yield new TextEncoder().encode(p);
}

const dir = mkdtempSync(join(tmpdir(), "zip-stream-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("zipStream", () => {
  const big = new Uint8Array(300_000).map((_, i) => (i * 7) % 251);
  const entries = () => [
    { name: "manifest.json", data: JSON.stringify({ ok: true }) },
    { name: "media/frame one.png", data: new Uint8Array([137, 80, 78, 71]), date: new Date(2026, 9, 8, 12, 30, 10) },
    { name: "media/master-v2.mp4", data: async () => chunks("part-1|", "part-2|", "part-3") },
    { name: "media/big.bin", data: async () => (async function* () { yield big.subarray(0, 100_000); yield big.subarray(100_000); })() },
    { name: "media/missing.mp4", data: async () => null }, // a source that is gone is skipped
    { name: "notes/ünïcode.txt", data: "héllo" },
  ];

  it.skipIf(!hasUnzip())("produces an archive that `unzip -l` lists and `unzip -t` verifies", async () => {
    const skipped: string[] = [];
    const zip = await collect(zipStream(entries(), { onSkip: (name) => skipped.push(name) }));
    const file = join(dir, "a.zip");
    writeFileSync(file, zip);
    const list = execFileSync("unzip", ["-l", file], { encoding: "utf8" });
    for (const n of ["manifest.json", "media/frame one.png", "media/master-v2.mp4", "media/big.bin", "code.txt"]) expect(list).toContain(n);
    // macOS unzip prints non-ASCII names as "?": check the stored UTF-8 name directly.
    expect(zip.includes(Buffer.from("notes/ünïcode.txt", "utf8"))).toBe(true);
    expect(list).not.toContain("missing.mp4");
    expect(list).toMatch(/5 files/);
    expect(skipped).toEqual(["media/missing.mp4"]);
    const test = execFileSync("unzip", ["-t", file], { encoding: "utf8" });
    expect(test).toContain("No errors detected");
    expect(execFileSync("unzip", ["-p", file, "media/master-v2.mp4"], { encoding: "utf8" })).toBe("part-1|part-2|part-3");
    expect(Buffer.compare(execFileSync("unzip", ["-p", file, "media/big.bin"]), Buffer.from(big))).toBe(0);
    expect(execFileSync("unzip", ["-p", file, "manifest.json"], { encoding: "utf8" })).toBe('{"ok":true}');
  });

  it("an empty archive is a bare end-of-central-directory record", async () => {
    const zip = await collect(zipStream([]));
    expect(zip.length).toBe(22);
    expect(zip.readUInt32LE(0)).toBe(0x06054b50);
  });

  it("crc32 and DOS timestamps", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    const { date, time } = dosDateTime(new Date(2026, 9, 8, 12, 30, 10));
    expect(date).toBe(((2026 - 1980) << 9) | (10 << 5) | 8);
    expect(time).toBe((12 << 11) | (30 << 5) | 5);
  });
});
