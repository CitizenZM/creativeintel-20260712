/**
 * Pure collectors for the content-history archive: turn the rows a project's producers wrote (project
 * fields, scripts, storyboards, LibTV runs and jobs, brand assets, catalog runs, report deliveries,
 * autopilot runs) into ArtifactCandidates — what to archive, under which slot (`sourceKey`).
 *
 * Slots: a field that can be overwritten has a fixed slot ("run:<id>:master", "project:<id>:campaignPlan"),
 * so each value it ever held becomes a version of it. A file found inside a JSON document (qcReport,
 * job settings, image-ad sets) is its own slot keyed by its URL — once produced, a URL never changes.
 * Candidates come out oldest first (a slot's earlier values before its current one), so versions number
 * in production order. Used by the live hooks (services/artifacts/archive.ts) and the backfill alike.
 */
import { createHash } from "node:crypto";
import { contentTypeFromUrl, type ArtifactKind } from "./kinds";

export interface ArtifactCandidate {
  kind: ArtifactKind;
  title: string;
  sourceKey: string;
  sourceField: string;
  /** A file: its storage URL (https: or data:). */
  url?: string | null;
  /** A text / JSON artifact: its full value, stored in the DB. */
  content?: unknown;
  contentType?: string | null;
  /** Bytes already in hand (a generated DOCX): stored without a fetch. */
  data?: Uint8Array | null;
  /** What identifies the value instead of the content (a report without its generated-at stamp). */
  dedupeValue?: unknown;
  /** Skip a new version when the slot got one less than this long ago (reports rendered on every download). */
  minIntervalMs?: number;
  runId?: string | null;
  jobId?: string | null;
  storyboardId?: string | null;
  producedAt?: Date | string | null;
  meta?: Record<string, unknown> | null;
}

type Dateish = Date | string | null | undefined;
type Row = Record<string, unknown>;

export interface ProjectFieldsRow {
  id: string;
  name?: string | null;
  brandName?: string | null;
  productBrief?: unknown;
  productBriefAt?: Dateish;
  campaignPlan?: unknown;
  campaignPlanAt?: Dateish;
  testPlan?: unknown;
  testPlanAt?: Dateish;
  mediaPlan?: unknown;
  mediaPlanAt?: Dateish;
  nextRound?: unknown;
  nextRoundAt?: Dateish;
  imageAdSets?: unknown;
  creativeEditHistory?: unknown;
}

export interface ScriptRow extends Row {
  id: string;
  projectId: string;
  title?: string | null;
  createdAt?: Dateish;
}

export interface StoryboardRow extends Row {
  id: string;
  projectId: string;
  title?: string | null;
  frames?: unknown;
  version?: number | null;
  createdAt?: Dateish;
}

export interface JobRow {
  id: string;
  runId: string;
  projectId?: string;
  kind: string;
  nodeName: string;
  shotIndex?: number | null;
  status?: string | null;
  resultUrl?: string | null;
  settings?: unknown;
  completedAt?: Dateish;
}

export interface RunRow {
  id: string;
  projectId: string;
  storyboardId?: string | null;
  status?: string | null;
  canvasName?: string | null;
  masterMp4Url?: string | null;
  voiceoverUrl?: string | null;
  subtitlesUrl?: string | null;
  previewMp4Url?: string | null;
  contactSheetUrl?: string | null;
  directorPlan?: unknown;
  qcReport?: unknown;
  createdAt?: Dateish;
  completedAt?: Dateish;
  jobs?: JobRow[];
}

export interface BrandAssetRow {
  id: string;
  kind: string;
  variant?: string | null;
  url: string;
  bytes?: number | null;
  format?: string | null;
  caption?: string | null;
  createdAt?: Dateish;
}

export interface CatalogRunRow {
  id: string;
  projectId: string;
  source?: string | null;
  results?: unknown;
  createdAt?: Dateish;
}

export interface ReportDeliveryRow {
  id: string;
  projectId: string;
  channel?: string | null;
  status?: string | null;
  payload?: unknown;
  periodFrom?: Dateish;
  periodTo?: Dateish;
  createdAt?: Dateish;
}

export interface AutopilotRunRow {
  id: string;
  projectId?: string | null;
  status?: string | null;
  step?: string | null;
  input?: unknown;
  state?: unknown;
  createdAt?: Dateish;
}

export interface ProjectSnapshot {
  project: ProjectFieldsRow;
  scripts: ScriptRow[];
  storyboards: StoryboardRow[];
  runs: RunRow[];
  brandAssets: BrandAssetRow[];
  catalogRuns: CatalogRunRow[];
  reportDeliveries: ReportDeliveryRow[];
  autopilotRuns: AutopilotRunRow[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const short = (id: string) => id.slice(-6);
const isObj = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);
const present = (v: unknown) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0) && !(isObj(v) && Object.keys(v).length === 0);

/** A JSON-safe copy (Dates → ISO strings, undefined dropped). */
export function toJson(v: unknown): unknown {
  if (v === undefined) return null;
  return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x)));
}

function omit(row: Row, keys: string[]): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) if (!keys.includes(k)) out[k] = v;
  return out;
}

const STORAGE_HOST = /(^|\.)(blob\.vercel-storage\.com|cloudinary\.com|storage\.googleapis\.com|amazonaws\.com|r2\.dev|r2\.cloudflarestorage\.com|supabase\.co)$/i;
const FILE_EXT = /\.(mp4|mov|webm|m4v|mp3|wav|m4a|aac|png|jpe?g|webp|gif|svg|srt|vtt|zip|json|csv|pdf|docx|txt|md)$/i;

/** True for a stored file (storage host or a file extension) — not a web page link. */
export function isFileUrl(s: string): boolean {
  if (/^data:(image|video|audio|application|text)\//i.test(s)) return true;
  if (!/^https?:\/\//i.test(s)) return false;
  try {
    const u = new URL(s);
    return STORAGE_HOST.test(u.hostname) || FILE_EXT.test(u.pathname);
  } catch {
    return false;
  }
}

export type JsonPath = (string | number)[];

/** Every stored-file URL inside a JSON value, with its path (depth-first, document order). */
export function fileUrlsIn(value: unknown, path: JsonPath = [], out: { path: JsonPath; url: string }[] = [], depth = 0): { path: JsonPath; url: string }[] {
  if (depth > 12) return out;
  if (typeof value === "string") {
    if (isFileUrl(value)) out.push({ path, url: value });
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => fileUrlsIn(v, [...path, i], out, depth + 1));
  } else if (isObj(value)) {
    for (const [k, v] of Object.entries(value)) fileUrlsIn(v, [...path, k], out, depth + 1);
  }
  return out;
}

export function pathString(path: JsonPath): string {
  return path.map((p, i) => (typeof p === "number" ? `[${p}]` : i ? `.${p}` : p)).join("");
}

/** A slot for a file found inside a document: keyed by its URL (stable, short). */
export function urlSlot(prefix: string, url: string): string {
  return `${prefix}:file:${createHash("sha256").update(url).digest("hex").slice(0, 20)}`;
}

/** The objects along a path inside `root` (root first). */
function objectsAlong(root: unknown, path: JsonPath): Row[] {
  const out: Row[] = [];
  let cur: unknown = root;
  for (const p of path) {
    if (isObj(cur)) out.push(cur);
    cur = (cur as Record<string | number, unknown> | null)?.[p as never];
  }
  return out;
}

const LABEL_KEYS = ["hookStyle", "format", "locale", "name", "adName", "aspect", "template", "sku", "key", "label"];

function labelOf(o: Row): string | null {
  for (const k of LABEL_KEYS) if (typeof o[k] === "string" && (o[k] as string).length <= 60) return o[k] as string;
  return null;
}

/** The kind of a file by its leaf key / URL, else null. */
function kindByLeaf(leaf: string, url: string): ArtifactKind | null {
  const l = leaf.toLowerCase();
  if (/cover|thumb/.test(l)) return "cover";
  if (/srt|subtitle|caption/.test(l) || /\.(srt|vtt)(\?|$)/i.test(url)) return "subtitles";
  if (/voiceover|^vo(url)?$|audio/.test(l)) return "voiceover";
  if (/contactsheet/.test(l)) return "contact-sheet";
  if (/preview/.test(l)) return "preview";
  return null;
}

function kindByType(url: string, fallback: ArtifactKind): ArtifactKind {
  const type = contentTypeFromUrl(url) ?? "";
  if (type.startsWith("image/")) return "keyframe";
  if (type.startsWith("video/")) return "clip";
  return fallback;
}

/** Kind of a file found in a run's qcReport, from the section it sits in. */
export function qcFileKind(path: JsonPath, url: string, qc: unknown): ArtifactKind {
  const keys = path.filter((p): p is string => typeof p === "string").map((k) => k.toLowerCase());
  if (keys.some((k) => k.includes("cover"))) return "cover";
  const leaf = keys[keys.length - 1] ?? "";
  const byLeaf = kindByLeaf(leaf, url);
  if (byLeaf) return byLeaf;
  const section = keys[0] ?? "";
  if (section === "autofix") return "master";
  if (section === "variants" || section.startsWith("batch")) return "variant";
  if (section.startsWith("locale")) return "locale";
  if (section === "exports") {
    const entry = objectsAlong(qc, path)[1];
    return typeof entry?.format === "string" && /^\d+s$/.test(entry.format) ? "cutdown" : "export";
  }
  if (section.startsWith("export")) return "export";
  return "other";
}

const sectionTitle = (s: string) => s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());

function docFileTitle(prefix: string, root: unknown, path: JsonPath): string {
  const labels = objectsAlong(root, path)
    .slice(1)
    .map(labelOf)
    .filter((x): x is string => !!x);
  const head = typeof path[0] === "string" ? sectionTitle(path[0]) : "";
  const leaf = path[path.length - 1];
  return [prefix, [head, ...labels].filter(Boolean).join(" "), typeof leaf === "string" && path.length > 1 ? leaf : null].filter(Boolean).join(" · ");
}

function producedOf(o: Row | undefined, fallback: Dateish): Dateish {
  const v = o?.createdAt ?? o?.at ?? o?.renderedAt;
  return typeof v === "string" ? v : fallback;
}

/** Keep the first candidate per URL (slot candidates come first, so a known slot wins). */
export function dedupeByUrl(cands: ArtifactCandidate[], seen = new Set<string>()): ArtifactCandidate[] {
  const out: ArtifactCandidate[] = [];
  for (const c of cands) {
    if (c.url) {
      if (seen.has(c.url)) continue;
      seen.add(c.url);
    }
    out.push(c);
  }
  return out;
}

// ─── Collectors ──────────────────────────────────────────────────────────────

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Brief, campaign plan (with its pre-edit snapshots), test / media plan, next-round proposal, image ads. */
export function collectProjectFields(p: ProjectFieldsRow): ArtifactCandidate[] {
  const out: ArtifactCandidate[] = [];
  const key = (f: string) => `project:${p.id}:${f}`;
  const history = asArray(p.creativeEditHistory).filter(isObj);

  if (present(p.productBrief)) out.push({ kind: "brief", title: "Product brief", sourceKey: key("productBrief"), sourceField: "Project.productBrief", content: toJson(p.productBrief), producedAt: p.productBriefAt });

  // Chat edits keep the plan / storyboard state from before each edit, oldest first: earlier versions.
  for (const h of history) {
    const when = typeof h.at === "string" ? h.at : null;
    if (present(h.plan)) out.push({ kind: "plan", title: "Campaign plan", sourceKey: key("campaignPlan"), sourceField: "Project.creativeEditHistory[].plan", content: toJson(h.plan), producedAt: when, meta: { beforeEdit: typeof h.message === "string" ? h.message.slice(0, 200) : null } });
    const sb = isObj(h.storyboard) ? h.storyboard : null;
    if (sb && typeof sb.id === "string" && present(sb.frames))
      out.push({ kind: "storyboard", title: `Storyboard ${short(sb.id)} (before a chat edit)`, sourceKey: `storyboard:${sb.id}`, sourceField: "Project.creativeEditHistory[].storyboard", storyboardId: sb.id, content: toJson({ frames: sb.frames }), producedAt: when });
  }
  if (present(p.campaignPlan)) out.push({ kind: "plan", title: "Campaign plan", sourceKey: key("campaignPlan"), sourceField: "Project.campaignPlan", content: toJson(p.campaignPlan), producedAt: p.campaignPlanAt });
  if (present(p.testPlan)) out.push({ kind: "test-plan", title: "Test plan", sourceKey: key("testPlan"), sourceField: "Project.testPlan", content: toJson(p.testPlan), producedAt: p.testPlanAt });
  if (present(p.mediaPlan)) out.push({ kind: "media-plan", title: "Media plan", sourceKey: key("mediaPlan"), sourceField: "Project.mediaPlan", content: toJson(p.mediaPlan), producedAt: p.mediaPlanAt });
  if (present(p.nextRound)) out.push({ kind: "plan", title: "Next test round proposal", sourceKey: key("nextRound"), sourceField: "Project.nextRound", content: toJson(p.nextRound), producedAt: p.nextRoundAt });

  // Image ad sets are kept latest first and capped: register oldest first.
  const sets = asArray(p.imageAdSets).filter(isObj).reverse();
  for (const set of sets) {
    asArray(set.items).forEach((it, i) => {
      if (!isObj(it) || typeof it.url !== "string" || !it.url) return;
      const label = [it.template, it.format].filter((x) => typeof x === "string").join(" ");
      out.push({
        kind: "image-ad",
        title: `Image ad ${label || i + 1}`,
        sourceKey: urlSlot(key("imageAd"), it.url),
        sourceField: "Project.imageAdSets[].items[].url",
        url: it.url,
        contentType: contentTypeFromUrl(it.url) ?? "image/png",
        producedAt: typeof set.createdAt === "string" ? set.createdAt : null,
        meta: { template: it.template ?? null, format: it.format ?? null, w: it.w ?? null, h: it.h ?? null, copy: set.copy ?? null },
      });
    });
  }
  return out;
}

export function collectScript(s: ScriptRow): ArtifactCandidate[] {
  return [
    {
      kind: "script",
      title: s.title || `Script ${short(s.id)}`,
      sourceKey: `script:${s.id}`,
      sourceField: "Script",
      // Selection flags (status, deletedAt) are UI state, not content.
      content: toJson(omit(s, ["status", "deletedAt", "project"])),
      producedAt: s.createdAt,
    },
  ];
}

export function collectStoryboard(b: StoryboardRow): ArtifactCandidate[] {
  const out: ArtifactCandidate[] = [
    {
      kind: "storyboard",
      title: `${b.title || `Storyboard ${short(b.id)}`}${b.version ? ` v${b.version}` : ""}`,
      sourceKey: `storyboard:${b.id}`,
      sourceField: "Storyboard.frames",
      storyboardId: b.id,
      content: toJson(omit(b, ["isActive", "deletedAt", "project"])),
      producedAt: b.createdAt,
    },
  ];
  for (const f of fileUrlsIn(b.frames)) {
    out.push({ kind: kindByType(f.url, "other"), title: `Storyboard ${short(b.id)} · frame ${typeof f.path[0] === "number" ? f.path[0] + 1 : ""}`.trim(), sourceKey: urlSlot(`storyboard:${b.id}`, f.url), sourceField: `Storyboard.frames${pathString(f.path)}`, storyboardId: b.id, url: f.url, contentType: contentTypeFromUrl(f.url), producedAt: b.createdAt });
  }
  return out;
}

export function collectJob(j: JobRow, runRow?: { storyboardId?: string | null }): ArtifactCandidate[] {
  if (j.kind === "upload") return []; // an input (packshot / reference), archived from the brand kit
  const kind: ArtifactKind = j.kind === "image" ? "keyframe" : j.kind === "video" ? "clip" : "other";
  const base = { runId: j.runId, jobId: j.id, storyboardId: runRow?.storyboardId ?? null, producedAt: j.completedAt };
  const out: ArtifactCandidate[] = [];
  if (j.resultUrl && j.status !== "failed") {
    out.push({ ...base, kind, title: `${j.nodeName} (run ${short(j.runId)})`, sourceKey: `job:${j.id}:result`, sourceField: "LibtvJob.resultUrl", url: j.resultUrl, contentType: contentTypeFromUrl(j.resultUrl) });
  }
  // QC candidates, rejected takes and repairs the job's settings kept.
  for (const f of fileUrlsIn(j.settings)) {
    out.push({ ...base, kind: kindByType(f.url, kind), title: `${j.nodeName} · ${pathString(f.path)} (run ${short(j.runId)})`, sourceKey: urlSlot(`job:${j.id}`, f.url), sourceField: `LibtvJob.settings.${pathString(f.path)}`, url: f.url, contentType: contentTypeFromUrl(f.url) });
  }
  return out;
}

const RUN_FILES: { field: keyof RunRow; slot: string; kind: ArtifactKind; label: string }[] = [
  { field: "masterMp4Url", slot: "master", kind: "master", label: "Master" },
  { field: "previewMp4Url", slot: "preview", kind: "preview", label: "Preview" },
  { field: "voiceoverUrl", slot: "voiceover", kind: "voiceover", label: "Voiceover" },
  { field: "subtitlesUrl", slot: "subtitles", kind: "subtitles", label: "Subtitles (SRT)" },
  { field: "contactSheetUrl", slot: "contactSheet", kind: "contact-sheet", label: "Contact sheet" },
];

/** A run's master (with the auto-fixed predecessor first), outputs, qcReport files, plans and its jobs. */
export function collectRun(r: RunRow, opts: { jobs?: boolean } = {}): ArtifactCandidate[] {
  const name = `Run ${short(r.id)}`;
  const when = r.completedAt ?? r.createdAt;
  const base = { runId: r.id, storyboardId: r.storyboardId ?? null };
  const out: ArtifactCandidate[] = [];
  const qc = isObj(r.qcReport) ? r.qcReport : null;

  // The auto-fix keeps only the master it replaced: it is the slot's earlier value.
  const autofix = qc && isObj(qc.autofix) ? qc.autofix : null;
  if (typeof autofix?.previousMasterUrl === "string" && autofix.previousMasterUrl && autofix.previousMasterUrl !== r.masterMp4Url) {
    out.push({ ...base, kind: "master", title: `${name} · master (before auto-fix)`, sourceKey: `run:${r.id}:master`, sourceField: "LibtvRun.qcReport.autofix.previousMasterUrl", url: autofix.previousMasterUrl, contentType: "video/mp4", producedAt: r.completedAt ?? r.createdAt });
  }
  for (const f of RUN_FILES) {
    const url = r[f.field];
    if (typeof url === "string" && url) out.push({ ...base, kind: f.kind, title: `${name} · ${f.label}`, sourceKey: `run:${r.id}:${f.slot}`, sourceField: `LibtvRun.${String(f.field)}`, url, contentType: contentTypeFromUrl(url) ?? (f.kind === "subtitles" ? "application/x-subrip" : null), producedAt: typeof autofix?.at === "string" && f.kind === "master" && autofix.promoted ? autofix.at : when });
  }
  if (present(r.directorPlan)) out.push({ ...base, kind: "plan", title: `${name} · director plan`, sourceKey: `run:${r.id}:directorPlan`, sourceField: "LibtvRun.directorPlan", content: toJson(r.directorPlan), producedAt: r.createdAt });

  // Variants, batches, locales, exports, export pack, covers, auto-fix attempts…: every file in qcReport.
  if (qc) {
    for (const f of fileUrlsIn(qc)) {
      const entry = objectsAlong(qc, f.path)[1];
      out.push({ ...base, kind: qcFileKind(f.path, f.url, qc), title: docFileTitle(name, qc, f.path), sourceKey: urlSlot(`run:${r.id}`, f.url), sourceField: `LibtvRun.qcReport.${pathString(f.path)}`, url: f.url, contentType: contentTypeFromUrl(f.url), producedAt: producedOf(entry, when) });
    }
    out.push({ ...base, kind: "other", title: `${name} · QC report`, sourceKey: `run:${r.id}:qcReport`, sourceField: "LibtvRun.qcReport", content: toJson(qc), producedAt: when });
  }
  if (opts.jobs !== false) for (const j of r.jobs ?? []) out.push(...collectJob(j, r));
  return dedupeByUrl(out);
}

export function collectBrandAsset(projectId: string, a: BrandAssetRow): ArtifactCandidate[] {
  void projectId; // brand assets hang off the kit; the caller's project is the archive's
  const k = a.kind.toUpperCase();
  const kind: ArtifactKind = k === "PACKSHOT" ? "packshot" : k === "LOGO" ? "logo" : "other";
  const label = [kind === "other" ? k.toLowerCase() : null, a.variant, a.caption].filter(Boolean).join(" · ");
  return [
    {
      kind,
      title: `${kind === "packshot" ? "Packshot" : kind === "logo" ? "Logo" : "Brand asset"}${label ? ` · ${label}` : ""}`.slice(0, 160),
      sourceKey: `brandAsset:${a.id}`,
      sourceField: "BrandAsset.url",
      url: a.url,
      contentType: contentTypeFromUrl(a.url) ?? (a.format ? `image/${a.format === "jpg" ? "jpeg" : a.format}` : null),
      producedAt: a.createdAt,
      meta: { brandAssetId: a.id, variant: a.variant ?? null, bytes: a.bytes ?? null },
    },
  ];
}

export function collectCatalogRun(c: CatalogRunRow): ArtifactCandidate[] {
  const out: ArtifactCandidate[] = [];
  const res = isObj(c.results) ? c.results : {};
  if (present(res.plan)) out.push({ kind: "plan", title: `Catalog plan ${short(c.id)}`, sourceKey: `catalog:${c.id}:plan`, sourceField: "CatalogRun.results.plan", content: toJson(res.plan), producedAt: c.createdAt });
  const images = isObj(res.images) ? res.images : {};
  for (const [sku, rec] of Object.entries(images)) {
    if (!isObj(rec)) continue;
    for (const it of asArray(rec.items)) {
      if (!isObj(it) || typeof it.url !== "string") continue;
      out.push({ kind: "image-ad", title: `Catalog ${sku} · ${[it.template, it.format].filter(Boolean).join(" ")}`, sourceKey: urlSlot(`catalog:${c.id}`, it.url), sourceField: "CatalogRun.results.images[sku].items[].url", url: it.url, contentType: contentTypeFromUrl(it.url) ?? "image/png", producedAt: typeof rec.at === "string" ? rec.at : c.createdAt, meta: { sku, catalogRunId: c.id } });
    }
  }
  return out;
}

export function collectReportDelivery(r: ReportDeliveryRow): ArtifactCandidate[] {
  if (!present(r.payload)) return [];
  const p = isObj(r.payload) ? r.payload : {};
  return [
    {
      kind: "report",
      title: `${typeof p.subject === "string" ? p.subject : "Weekly digest"} (${r.status ?? "built"})`,
      sourceKey: `reportDelivery:${r.id}`,
      sourceField: "ReportDelivery.payload",
      content: toJson(r.payload),
      producedAt: r.createdAt,
      meta: { channel: r.channel ?? null, status: r.status ?? null },
    },
  ];
}

export function collectAutopilotRun(a: AutopilotRunRow): ArtifactCandidate[] {
  if (!present(a.state) && !present(a.input)) return [];
  return [{ kind: "other", title: `Autopilot ${short(a.id)} (${a.status ?? "?"} · ${a.step ?? "?"})`, sourceKey: `autopilot:${a.id}`, sourceField: "AutopilotRun.state", content: toJson({ input: a.input ?? null, state: a.state ?? null }), producedAt: a.createdAt }];
}

const time = (d: Dateish) => (d ? new Date(d).getTime() : 0);

/** Everything a project produced, oldest producers first, each file once. */
export function collectSnapshot(s: ProjectSnapshot): ArtifactCandidate[] {
  const seen = new Set<string>();
  const byTime = <T extends { createdAt?: Dateish }>(rows: T[]) => [...rows].sort((a, b) => time(a.createdAt) - time(b.createdAt));
  return dedupeByUrl(
    [
      ...collectProjectFields(s.project),
      ...byTime(s.scripts).flatMap(collectScript),
      ...byTime(s.storyboards).flatMap(collectStoryboard),
      ...byTime(s.runs).flatMap((r) => collectRun(r)),
      ...byTime(s.brandAssets).flatMap((a) => collectBrandAsset(s.project.id, a)),
      ...byTime(s.catalogRuns).flatMap(collectCatalogRun),
      ...byTime(s.reportDeliveries).flatMap(collectReportDelivery),
      ...byTime(s.autopilotRuns).flatMap(collectAutopilotRun),
    ],
    seen
  );
}
