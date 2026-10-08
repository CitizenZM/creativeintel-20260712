import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { zipStream } from "@/lib/zip-stream";
import { archiveEntries, contentDisposition, downloadPlan, latestOnly, parseListFilters, type ServableArtifact } from "./serve";

const at = new Date("2026-10-01T10:00:00Z");
const row = (over: Partial<ServableArtifact>): ServableArtifact => ({ id: "a1", kind: "plan", title: "Campaign plan", version: 1, sourceKey: "k", sourceField: "Project.campaignPlan", url: null, contentType: null, bytes: null, sha256: null, content: null, createdAt: at, producedAt: null, hasBlob: false, ...over });

describe("downloadPlan", () => {
  it("JSON content downloads as .json; an HTML report as .html", () => {
    const p = downloadPlan(row({ content: { a: 1 } }));
    expect(p).toMatchObject({ source: "content", filename: "plan-Campaign-plan-v1.json", contentType: "application/json; charset=utf-8" });
    expect(p.source === "content" && JSON.parse(p.body)).toEqual({ a: 1 });
    expect(downloadPlan(row({ kind: "report", title: "Report (HTML)", content: "<h1>x</h1>", contentType: "text/html" }))).toMatchObject({ source: "content", filename: "report-Report-HTML-v1.html" });
  });
  it("stored bytes win over the URL; else the URL is proxied", () => {
    expect(downloadPlan(row({ kind: "report", title: "Report (DOCX)", hasBlob: true, contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }))).toMatchObject({ source: "blob", filename: "report-Report-DOCX-v1.docx" });
    expect(downloadPlan(row({ kind: "master", title: "Run 1 · Master", version: 3, url: "https://b.blob.vercel-storage.com/m.mp4", contentType: "video/mp4" }))).toMatchObject({ source: "proxy", filename: "master-Run-1-Master-v3.mp4" });
  });
  it("Content-Disposition carries a safe ASCII name and the UTF-8 one", () => {
    expect(contentDisposition('a "b" ü.json')).toBe(`attachment; filename="a _b_ _.json"; filename*=UTF-8''a%20%22b%22%20%C3%BC.json`);
    expect(contentDisposition("x.mp4", true)).toMatch(/^inline;/);
  });
});

describe("list filters", () => {
  it("parses kinds, latest and limit", () => {
    const f = parseListFilters(new URLSearchParams("kind=master,bogus,variant&latest=1&limit=99999&runId=r1"));
    expect(f).toMatchObject({ kinds: ["master", "variant"], latest: true, limit: 2000, runId: "r1" });
  });
  it("latestOnly keeps the newest version per slot", () => {
    const rows = [row({ id: "1", sourceKey: "a", version: 1 }), row({ id: "2", sourceKey: "a", version: 2 }), row({ id: "3", sourceKey: "b", version: 1 })];
    expect(latestOnly(rows).map((r) => r.id)).toEqual(["2", "3"]);
  });
});

const dir = mkdtempSync(join(tmpdir(), "artifact-zip-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const hasUnzip = (() => {
  try {
    execFileSync("unzip", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("archiveEntries → zip", () => {
  it.skipIf(!hasUnzip)("lists every archived artifact plus manifest.json under unzip -l", async () => {
    const rows = [
      row({ id: "p1", content: { hooks: ["a"] } }),
      row({ id: "p2", version: 2, content: { hooks: ["b"] } }),
      row({ id: "r1", kind: "report", title: "Report (HTML)", content: "<h1>r</h1>", contentType: "text/html" }),
      row({ id: "d1", kind: "report", title: "Report (DOCX)", hasBlob: true, contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: 4 }),
      row({ id: "m1", kind: "master", title: "Run 1 · Master", url: "https://b.blob.vercel-storage.com/m.mp4", contentType: "video/mp4", bytes: 6 }),
      row({ id: "m2", kind: "master", title: "Run 1 · Master", version: 2, url: "https://b.blob.vercel-storage.com/gone.mp4", contentType: "video/mp4" }),
      row({ id: "h1", kind: "master", title: "Huge", url: "https://b.blob.vercel-storage.com/huge.mp4", contentType: "video/mp4", bytes: 10_000 }),
      row({ id: "l1", kind: "logo", title: "Logo", url: "data:image/png;base64,AQID", contentType: "image/png" }),
    ];
    const opened: string[] = [];
    const entries = archiveEntries({ id: "proj", name: "Acme" }, rows, {
      async blobOf(id) {
        return id === "d1" ? new Uint8Array([80, 75, 3, 4]) : null;
      },
      async openUrl(url) {
        opened.push(url);
        if (url.includes("gone")) return null;
        return new Response(new Uint8Array([0, 0, 0, 24, 102, 116])).body;
      },
    }, { maxBytes: 1_000, now: at });
    const reader = zipStream(entries).getReader();
    const parts: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
    }
    const file = join(dir, "all.zip");
    writeFileSync(file, Buffer.concat(parts));
    const list = execFileSync("unzip", ["-l", file], { encoding: "utf8" });
    for (const n of ["plan/plan-Campaign-plan-v1.json", "plan/plan-Campaign-plan-v2.json", "report/report-Report-HTML-v1.html", "report/report-Report-DOCX-v1.docx", "master/master-Run-1-Master-v1.mp4", "logo/logo-Logo-v1.png", "manifest.json"]) expect(list).toContain(n);
    expect(list).not.toContain("gone");
    expect(list).not.toContain("Huge");
    expect(list).toMatch(/7 files/);
    expect(list).not.toContain("master-Run-1-Master-v2.mp4");
    expect(execFileSync("unzip", ["-t", file], { encoding: "utf8" })).toContain("No errors detected");
    expect(opened).not.toContain("https://b.blob.vercel-storage.com/huge.mp4");
    const manifest = JSON.parse(execFileSync("unzip", ["-p", file, "manifest.json"], { encoding: "utf8" }));
    expect(manifest.count).toBe(8);
    const by = Object.fromEntries(manifest.artifacts.map((a: { id: string }) => [a.id, a]));
    expect(by.m2).toMatchObject({ path: null, note: expect.stringMatching(/could not be fetched/) });
    expect(by.h1).toMatchObject({ path: null, note: expect.stringMatching(/capped/) });
    expect(by.m1.path).toBe("master/master-Run-1-Master-v1.mp4");
  });
});
