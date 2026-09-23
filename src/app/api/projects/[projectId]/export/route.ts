import { prisma } from "@/lib/db";
import { buildZip, type ZipEntry } from "@/lib/zip";

export const dynamic = "force-dynamic";

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  return [];
}

interface FrameLike {
  imageUrl?: string | null;
  scene?: string | null;
  visualDirection?: string | null;
  duration?: string | null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { brand: true },
  });
  if (!project) {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const [scripts, storyboards, libtvRuns] = await Promise.all([
    prisma.script.findMany({
      where: { projectId, deletedAt: null },
      orderBy: { predictedScore: "desc" },
    }),
    prisma.storyboard.findMany({
      where: { projectId, deletedAt: null },
      orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
    }),
    prisma.libtvRun.findMany({
      where: { projectId, status: "completed" },
      orderBy: { completedAt: "desc" },
      include: { jobs: { orderBy: [{ shotIndex: "asc" }, { nodeName: "asc" }] } },
    }),
  ]);

  const brandName = project.brandName || project.brand?.name || "Brand";
  const generatedAt = new Date().toISOString();

  // ── campaign.html ─────────────────────────────────────────────────────────
  const scriptsHtml = scripts
    .map((s) => {
      const hooks = asArray(s.hookVariants);
      const ctas = asArray(s.ctaVariants);
      return `
      <section class="script">
        <h3>${esc(s.title)} <span class="score">${s.predictedScore != null ? Math.round(s.predictedScore) : "—"}/100</span></h3>
        <p class="meta">${esc(s.format)} · ${esc(s.duration)} · ${esc(s.platform || "")}</p>
        <p><strong>Angle:</strong> ${esc(s.angle)}</p>
        ${hooks.length ? `<p><strong>Hooks:</strong></p><ul>${hooks.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>` : ""}
        <p><strong>Body:</strong></p>
        <p class="body">${esc(s.body)}</p>
        ${ctas.length ? `<p><strong>CTAs:</strong> ${ctas.map(esc).join(" · ")}</p>` : ""}
      </section>`;
    })
    .join("\n");

  const storyboardsHtml = storyboards
    .map((b) => {
      const frames = (Array.isArray(b.frames) ? b.frames : []) as FrameLike[];
      const cards = frames
        .map((f) => {
          const cap = [f.duration, f.scene || f.visualDirection]
            .filter(Boolean)
            .join(" · ");
          const img = f.imageUrl
            ? `<img src="${esc(f.imageUrl)}" alt="" loading="lazy" />`
            : `<div class="noimg">no image</div>`;
          return `<figure>${img}<figcaption>${esc(cap)}</figcaption></figure>`;
        })
        .join("");
      return `
      <section class="storyboard">
        <h3>${esc(b.title)}</h3>
        <p class="meta">${esc(b.style || "")}${b.totalDuration ? ` · ${esc(b.totalDuration)}` : ""}</p>
        <div class="frames">${cards}</div>
      </section>`;
    })
    .join("\n");

  // ── LibTV runs: master/preview plus the per-frame keyframe and clip URLs ───
  const hosted = (url: string | null | undefined) => !!url && /^https?:\/\//.test(url);

  const libtvExport = libtvRuns.map((run) => ({
    id: run.id,
    scriptId: run.scriptId,
    storyboardId: run.storyboardId,
    canvasUuid: run.canvasUuid,
    canvasUrl: run.canvasUrl,
    imageModel: run.imageModel,
    videoModel: run.videoModel,
    aspectRatio: run.aspectRatio,
    clipDurationSec: run.clipDurationSec,
    creditsSpent: run.creditsSpent,
    completedAt: run.completedAt,
    masterMp4Url: run.masterMp4Url,
    previewMp4Url: run.previewMp4Url,
    contactSheetUrl: run.contactSheetUrl,
    frames: run.jobs
      .filter((j) => j.kind !== "upload")
      .map((j) => ({
        nodeName: j.nodeName,
        kind: j.kind,
        frameNumber: (j.settings as { frameNumber?: number } | null)?.frameNumber ?? j.shotIndex + 1,
        segment: (j.settings as { segment?: string } | null)?.segment ?? null,
        status: j.status,
        url: j.resultUrl,
      })),
  }));

  const libtvHtml = libtvExport
    .map((run) => {
      const keyframes = run.frames
        .filter((f) => f.kind === "image" && hosted(f.url))
        .map(
          (f) =>
            `<figure><img src="${esc(f.url)}" alt="" loading="lazy" /><figcaption>${esc(f.nodeName)} · ${esc(f.segment || "")}</figcaption></figure>`
        )
        .join("");
      const links = [
        run.masterMp4Url && hosted(run.masterMp4Url) ? `<a href="${esc(run.masterMp4Url)}">Master MP4</a>` : "",
        run.previewMp4Url && hosted(run.previewMp4Url) ? `<a href="${esc(run.previewMp4Url)}">720p preview</a>` : "",
        run.contactSheetUrl && hosted(run.contactSheetUrl) ? `<a href="${esc(run.contactSheetUrl)}">Contact sheet</a>` : "",
        run.canvasUrl ? `<a href="${esc(run.canvasUrl)}">Open in LibTV</a>` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      return `
      <section class="storyboard">
        <h3>${esc(run.imageModel)} → ${esc(run.videoModel)} <span class="score">${run.creditsSpent} credits</span></h3>
        <p class="meta">${esc(run.aspectRatio)} · ${run.clipDurationSec}s clips · ${run.completedAt ? esc(String(run.completedAt).slice(0, 10)) : ""}</p>
        <p>${links || "<span class='sub'>No hosted outputs — the worker had no storage provider configured.</span>"}</p>
        <div class="frames">${keyframes}</div>
      </section>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(brandName)} — Campaign Package</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; max-width: 820px; margin: 0 auto; padding: 40px 24px; color: #111; line-height: 1.5; }
  h1 { font-size: 28px; margin-bottom: 4px; }
  h2 { font-size: 18px; margin-top: 40px; border-bottom: 2px solid #111; padding-bottom: 6px; }
  h3 { font-size: 15px; margin-bottom: 2px; }
  .sub { color: #666; font-size: 13px; }
  .meta { color: #888; font-size: 12px; margin: 2px 0 8px; }
  .score { float: right; color: #2563eb; font-size: 12px; font-weight: 600; }
  .script, .storyboard { border: 1px solid #e5e5e5; border-radius: 10px; padding: 16px; margin: 14px 0; }
  .body { white-space: pre-wrap; background: #fafafa; padding: 10px; border-radius: 6px; font-size: 13px; }
  ul { margin: 4px 0; padding-left: 20px; }
  .frames { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; margin-top: 10px; }
  figure { margin: 0; }
  figure img { width: 100%; aspect-ratio: 9/16; object-fit: cover; border-radius: 6px; background: #f0f0f0; }
  .noimg { width: 100%; aspect-ratio: 9/16; display: grid; place-items: center; background: #f0f0f0; border-radius: 6px; color: #aaa; font-size: 11px; }
  figcaption { font-size: 10px; color: #666; margin-top: 4px; }
  @media print { .script, .storyboard { break-inside: avoid; } }
</style>
</head>
<body>
  <h1>${esc(brandName)}</h1>
  <p class="sub">Campaign package · ${esc(project.name)} · generated ${esc(generatedAt.slice(0, 10))}</p>

  <h2>Brand</h2>
  <p><strong>Promise:</strong> ${esc(project.brand?.brandPromise || "—")}</p>
  <p><strong>Value proposition:</strong> ${esc(project.brand?.valueProposition || "—")}</p>
  <p><strong>Tone of voice:</strong> ${esc(project.brand?.toneOfVoice || "—")}</p>
  <p><strong>Target audience:</strong> ${esc(project.brand?.targetAudience || "—")}</p>
  <p><strong>Campaign goal:</strong> ${esc(project.campaignGoal || "—")}</p>

  <h2>Scripts (${scripts.length})</h2>
  ${scriptsHtml || "<p class='sub'>No scripts generated.</p>"}

  <h2>Storyboards (${storyboards.length})</h2>
  ${storyboardsHtml || "<p class='sub'>No storyboards generated.</p>"}

  <h2>Rendered ads (${libtvExport.length})</h2>
  ${libtvHtml || "<p class='sub'>No completed LibTV runs.</p>"}
</body>
</html>`;

  const entries: ZipEntry[] = [
    { name: "campaign.html", data: html },
    {
      name: "scripts.json",
      data: JSON.stringify(scripts, null, 2),
    },
    {
      name: "storyboards.json",
      data: JSON.stringify(storyboards, null, 2),
    },
    {
      name: "libtv-runs.json",
      data: JSON.stringify(libtvExport, null, 2),
    },
    {
      name: "README.txt",
      data:
        `${brandName} — Campaign Package\n` +
        `Project: ${project.name}\n` +
        `Generated: ${generatedAt}\n\n` +
        `Contents:\n` +
        `  campaign.html     Open in a browser; print to PDF for a polished deliverable.\n` +
        `  scripts.json      ${scripts.length} script(s), structured.\n` +
        `  storyboards.json  ${storyboards.length} storyboard(s) with frame image URLs.\n` +
        `  libtv-runs.json   ${libtvExport.length} completed run(s): master + 720p preview +\n` +
        `                    contact sheet, and the per-frame keyframe/clip URLs.\n\n` +
        `Storyboard images and generated videos are hosted remotely and referenced\n` +
        `by URL inside campaign.html. A url beginning "file://" means the worker ran\n` +
        `without CLOUDINARY_URL or BLOB_READ_WRITE_TOKEN and the asset exists only on\n` +
        `the operator's Mac.\n`,
    },
  ];

  const zip = buildZip(entries);
  const safeName = brandName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

  return new Response(zip as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${safeName}-campaign.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
