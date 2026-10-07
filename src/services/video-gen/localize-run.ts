/**
 * Localized versions of a finished server master (edit engine v2): the same clips and edit with the
 * voiceover, captions, on-screen text and end-card copy in another language — no new generation,
 * the same re-edit path as hook variants and delivery exports (glm-assemble.renderFromRun).
 * One locale per render (~2–3 min); results live on LibtvRun.qcReport.locales.
 */
import { access } from "node:fs/promises";
import { prisma } from "@/lib/db";
import { renderFromRun } from "./glm-assemble";
import { isServerEngine } from "./libtv-pricing";
import { storyboardFrames } from "./server-executor";
import { variantAdName } from "./variants";
import { captionFontFor, localeAdName, localeProfile, localizeFrames, missingLocales, type LlmFn, type LocaleEntry, type LocaleId, type VoiceGender } from "./localize";
import type { BrandFont } from "./edit/brand-style";
import { patchQcReport } from "./qc-report";

type Qc = Record<string, unknown> & { locales?: LocaleEntry[]; localesPending?: Record<string, string> };

/** Optimistic qcReport write (qc-report.patchQcReport): other writers' keys are never lost. */
async function patchQc(runId: string, fn: (qc: Qc) => Qc) {
  await patchQcReport<Qc>(runId, fn);
}

/** A face with the locale's glyphs: a local file when one exists, else the Noto family from Google Fonts. */
export async function resolveCaptionFont(locale: LocaleId): Promise<BrandFont | null> {
  const p = localeProfile(locale);
  if (p.script === "latin") return null;
  const t = captionFontFor(locale, () => false);
  for (const file of await localCandidates(locale)) {
    if (await access(file).then(() => true, () => false)) {
      const f = captionFontFor(locale, (x) => x === file)!;
      return { family: f.family, file: f.file! };
    }
  }
  const { googleFont } = await import("./edit/brand-style");
  const g = t?.google ? await googleFont(t.google, 700) : null;
  if (!g) console.warn(`[localize] no ${locale} caption font found (local or Google Fonts) — captions may show missing glyphs`);
  return g;
}

async function localCandidates(locale: LocaleId): Promise<string[]> {
  const seen: string[] = [];
  // captionFontFor walks its table in order; collect every file it would consider.
  captionFontFor(locale, (f) => (seen.push(f), false));
  return seen;
}

export async function renderLocalizedVariant(runId: string, locale: LocaleId, opts: { gender?: VoiceGender; llm?: LlmFn } = {}): Promise<LocaleEntry> {
  const run = await prisma.libtvRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error("Run not found");
  if (!isServerEngine(run.executor) || run.status !== "completed") throw new Error(`Only completed server runs can be localized (status ${run.status})`);
  await patchQc(runId, (qc) => ({ ...qc, localesPending: { ...(qc.localesPending ?? {}), [locale]: new Date().toISOString() } }));
  try {
    const [jobs, frames, project, script] = await Promise.all([
      prisma.libtvJob.findMany({ where: { runId } }),
      storyboardFrames(run.storyboardId, run.directorPlan),
      prisma.project.findUnique({ where: { id: run.projectId }, select: { brandName: true, productName: true, productBrief: true } }),
      run.scriptId ? prisma.script.findUnique({ where: { id: run.scriptId }, select: { title: true } }) : null,
    ]);
    const { loadBrandStyle } = await import("./edit/brand-style");
    const brand = await loadBrandStyle(run.projectId);
    const product = ((project?.productBrief ?? {}) as { product?: { name?: string; brand?: string; model?: string } }).product ?? {};
    const terms = [project?.brandName, project?.productName, product.name, product.brand, product.model].filter((t): t is string => !!t?.trim());
    // The translation is a paid call: under the run's spend guard (refused over budget → the locale fails).
    const { guardLlmFn } = await import("@/services/ops/spend");
    const { defaultLocalizeLlm } = await import("./localize");
    const llm = opts.llm ?? guardLlmFn({ projectId: run.projectId, runId }, defaultLocalizeLlm, { outTokens: 4000 });
    const loc = await localizeFrames(frames, locale, { terms, ctaText: brand.ctaText, gender: opts.gender, llm });
    const font = await resolveCaptionFont(locale);
    const qc0 = (run.qcReport ?? {}) as Qc;
    const hookStyle = qc0.hookStyle === "c" || qc0.hookStyle === "p" || qc0.hookStyle === "q" ? qc0.hookStyle : undefined;
    const v = await renderFromRun({
      runId,
      projectId: run.projectId,
      aspectRatio: run.aspectRatio,
      frames: loc.frames,
      jobs,
      hookStyle,
      voice: loc.voice,
      tag: `locale-${locale}`,
      brandPatch: { ...(loc.ctaText ? { ctaText: loc.ctaText } : {}), ...(font ? { headline: font, body: font } : {}) },
    });
    const entry: LocaleEntry = {
      locale,
      voice: loc.voice,
      masterUrl: v.masterUrl,
      previewUrl: v.previewUrl,
      durationSec: v.durationSec,
      passed: v.qc.passed,
      total: v.qc.total,
      adName: localeAdName(variantAdName({ brand: project?.brandName, title: script?.title?.replace(/^⚠\s*/, ""), durationSec: v.durationSec, hookStyle: hookStyle ?? "q" }), locale),
      createdAt: new Date().toISOString(),
      fits: loc.fits,
      notes: [...loc.notes, ...(font ? [] : localeProfile(locale).script === "latin" ? [] : ["no caption font with this script's glyphs was available"])],
    };
    await patchQc(runId, (qc) => {
      const pending = { ...(qc.localesPending ?? {}) };
      delete pending[locale];
      return { ...qc, locales: [...(qc.locales ?? []).filter((e) => e.locale !== locale), entry], localesPending: pending };
    });
    return entry;
  } catch (err) {
    await patchQc(runId, (qc) => {
      const pending = { ...(qc.localesPending ?? {}) };
      delete pending[locale];
      return { ...qc, localesPending: pending };
    }).catch(() => {});
    throw err;
  }
}

/**
 * Render the requested locales one after another inside a time budget (each ~2–3 min). Locales that
 * don't fit in the budget stay missing — call again to continue; done ones are skipped unless `force`.
 */
export async function localizeRun(runId: string, locales: LocaleId[], opts: { gender?: VoiceGender; force?: boolean; budgetMs?: number; perLocaleMs?: number } = {}) {
  const deadline = Date.now() + (opts.budgetMs ?? 280_000);
  const per = opts.perLocaleMs ?? 150_000;
  const run = await prisma.libtvRun.findUnique({ where: { id: runId }, select: { qcReport: true } });
  const todo = missingLocales((run?.qcReport ?? {}) as Qc, locales, Date.now(), opts.force);
  const done: LocaleEntry[] = [];
  const failed: { locale: LocaleId; error: string }[] = [];
  const left: LocaleId[] = [];
  for (const [i, locale] of todo.entries()) {
    if (i > 0 && deadline - Date.now() < per) {
      left.push(...todo.slice(i));
      break;
    }
    try {
      done.push(await renderLocalizedVariant(runId, locale, { gender: opts.gender }));
    } catch (err) {
      failed.push({ locale, error: err instanceof Error ? err.message.slice(0, 300) : String(err) });
    }
  }
  return { done, failed, left };
}
