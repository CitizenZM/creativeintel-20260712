/**
 * The campaign report as .docx (the owner's preferred report format), built with the pure-JS `docx`
 * package: headings, KPI table, data tables, text bar charts and hyperlinks to masters and keyframes.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type { CampaignReportModel } from "./campaign-report";

const usd = (n: number) => `$${n.toFixed(n !== 0 && Math.abs(n) < 0.1 ? 3 : 2)}`;
const pct = (n: number) => `${Math.round(n)}%`;
const FONT = "Calibri";
const ACCENT = "2F6FDE";
const MUTED = "6B6B70";
/** A4 width minus the 1000-twip margins. */
const TEXT_WIDTH_TWIPS = 11906 - 2000;
const safeUrl = (u: string | null | undefined) => (u && /^https?:\/\//.test(u) ? u : null);

const h1 = (text: string) => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 120 }, children: [new TextRun({ text, font: FONT, bold: true, size: 30, color: "1D1D1F" })] });
const h2 = (text: string) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 80 }, children: [new TextRun({ text, font: FONT, bold: true, size: 24, color: "1D1D1F" })] });
const p = (text: string, o: { muted?: boolean; bold?: string; size?: number } = {}) =>
  new Paragraph({
    spacing: { after: 100 },
    children: [
      ...(o.bold ? [new TextRun({ text: `${o.bold} `, bold: true, font: FONT, size: o.size ?? 21 })] : []),
      new TextRun({ text, font: FONT, size: o.size ?? 21, color: o.muted ? MUTED : undefined }),
    ],
  });
const link = (label: string, url: string) => new ExternalHyperlink({ link: url, children: [new TextRun({ text: label, style: "Hyperlink", font: FONT, size: 19 })] });

const border = { style: BorderStyle.SINGLE, size: 4, color: "E3E3E0" };
const borders = { top: border, bottom: border, left: border, right: border };

function cell(content: string | (TextRun | ExternalHyperlink)[], o: { header?: boolean; align?: "right"; widthPct?: number } = {}): TableCell {
  const children = typeof content === "string" ? [new TextRun({ text: content, font: FONT, size: 18, bold: o.header, color: o.header ? "FFFFFF" : undefined })] : content;
  return new TableCell({
    borders,
    ...(o.widthPct ? { width: { size: o.widthPct, type: WidthType.PERCENTAGE } } : {}),
    shading: o.header ? { type: ShadingType.CLEAR, color: "auto", fill: ACCENT } : undefined,
    margins: { top: 50, bottom: 50, left: 80, right: 80 },
    children: [new Paragraph({ alignment: o.align === "right" ? AlignmentType.RIGHT : AlignmentType.LEFT, children })],
  });
}

/** widths: column widths in percent of the text width. */
function table(head: string[], rows: (string | (TextRun | ExternalHyperlink)[])[][], numeric: number[] = [], widths?: number[]): Table {
  const o = (i: number, header?: boolean) => ({ header, align: numeric.includes(i) ? ("right" as const) : undefined, widthPct: widths?.[i] });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    ...(widths ? { columnWidths: widths.map((w) => Math.round((TEXT_WIDTH_TWIPS * w) / 100)) } : {}),
    rows: [
      new TableRow({ tableHeader: true, children: head.map((h, i) => cell(h, o(i, true))) }),
      ...rows.map((r) => new TableRow({ children: r.map((c, i) => cell(c, o(i))) })),
    ],
  });
}

/** A bar chart Word renders anywhere: label, a bar of block characters, the value. */
function textBars(title: string, items: { label: string; value: number; display: string }[]): (Paragraph | Table)[] {
  if (!items.length) return [];
  const max = Math.max(...items.map((i) => i.value), 1e-9);
  return [
    p(title, { muted: true, size: 19 }),
    table(
      ["", "", ""],
      items.map((it) => [it.label, [new TextRun({ text: "█".repeat(Math.max(1, Math.round((it.value / max) * 24))), color: ACCENT, font: "Consolas", size: 16 })], it.display]),
      [2],
      [30, 45, 25]
    ),
  ];
}

const spacer = () => new Paragraph({ spacing: { after: 80 }, children: [] });

export async function renderReportDocx(m: CampaignReportModel): Promise<Buffer> {
  const body: (Paragraph | Table)[] = [];
  body.push(
    new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: `${m.project.title} — Campaign Report`, font: FONT, bold: true, size: 40 })] }),
    p(`${m.project.name} · generated ${m.generatedAt.slice(0, 16).replace("T", " ")} UTC`, { muted: true, size: 19 })
  );

  body.push(h1("Key numbers"), table(m.keyNumbers.map((k) => k.label), [m.keyNumbers.map((k) => k.value)]));

  body.push(h1("Executive summary"), p(m.executiveSummary.text));
  if (m.executiveSummary.source === "llm") body.push(p("AI-written; every figure checked against the report's numbers.", { muted: true, size: 17 }));

  body.push(h1("Product brief"));
  if (m.brief) {
    if (m.brief.bigIdea) body.push(p(m.brief.bigIdea, { bold: "Big idea:" }));
    if (m.brief.audience) body.push(p(m.brief.audience, { bold: "Audience:" }));
    if (m.brief.job) body.push(p(m.brief.job, { muted: true }));
    if (m.brief.sellingPoints.length) {
      body.push(h2("Top selling points"), table(["#", "Claim", "Benefit", "Proof shot", "Evidence"], m.brief.sellingPoints.map((s, i) => [String(i + 1), s.claim, s.benefit, s.proof, s.evidence.replace(/_/g, " ")]), [], [5, 30, 30, 22, 13]));
    }
    if (m.brief.objections.length) body.push(h2("Objections we answer"), table(["Objection", "Answer"], m.brief.objections.map((o) => [o.objection, o.answer])));
    if (m.brief.keywords.length) body.push(spacer(), p(m.brief.keywords.join(" · "), { bold: "Keywords:" }));
  } else body.push(p("Not extracted yet.", { muted: true }));

  body.push(h1("Campaign plan"));
  if (m.plan) {
    body.push(p(`${m.plan.goal}${m.plan.bigIdea ? ` — ${m.plan.bigIdea}` : ""}`, { bold: "Goal:" }));
    for (const pl of m.plan.platforms) {
      body.push(
        h2(`${pl.label} — ${pl.durationSec} s, ${pl.aspect}`),
        table(["Hook", "Family", "Opening text", "Opening VO"], pl.hooks.map((h) => [h.name, h.family, h.openingText, h.openingVO]), [], [24, 12, 34, 30]),
        spacer(),
        p(`${pl.endCard.name}${pl.endCard.headline ? ` — “${pl.endCard.headline}”` : ""} · button “${pl.endCard.button}”`, { bold: "End card:" }),
        table(["Time", "Beat", "Visual", "On screen"], pl.beats.map((b) => [`${b.t0.toFixed(1)}–${b.t1.toFixed(1)} s`, b.purpose, b.visual, b.onScreenText ?? ""]), [], [13, 11, 52, 24])
      );
    }
  } else body.push(p("No campaign plan yet.", { muted: true }));

  body.push(h1("Production"));
  const runs = m.production.runs;
  if (runs.length) {
    body.push(
      table(
        ["Run", "Status", "Engine", "QC", "Preflight", "Director", "Variants", "Spent", "Master"],
        runs.map((r) => [
          `${r.label} (${r.createdAt.slice(0, 10)})`,
          r.status,
          `${r.engine}${r.models ? ` — ${r.models}` : ""}`,
          r.qc ? `${r.qc.passed}/${r.qc.total}` : "—",
          r.preflight ? String(r.preflight.score) : "—",
          r.director ? `${r.director.score}${r.director.flagged ? ` (${r.director.flagged} flagged)` : ""}` : "—",
          String(r.variants.length),
          `${usd(r.spentUsd)}${r.approvedBudgetUsd != null ? ` of ${usd(r.approvedBudgetUsd)}` : ""}`,
          safeUrl(r.masterUrl) ? [link("mp4", r.masterUrl!)] : "—",
        ]),
        [7]
      ),
      spacer(),
      ...textBars("Master QC score per run", runs.filter((r) => r.qc).map((r) => ({ label: r.label, value: r.qc!.pct, display: `${r.qc!.passed}/${r.qc!.total} (${pct(r.qc!.pct)})` })))
    );
    for (const r of runs.filter((x) => x.variants.length)) {
      body.push(h2(`${r.label} — hook variants`), table(["Hook", "Ad name", "QC", "File"], r.variants.map((v) => [v.name, v.adName, v.passed !== null ? `${v.passed}/${v.total}` : "—", safeUrl(v.url) ? [link("mp4", v.url!)] : "—"])));
    }
    for (const r of runs.filter((x) => x.keyframes.length)) {
      body.push(
        h2(`${r.label} — keyframes`),
        p(`${r.keyframeQc.passed}/${r.keyframeQc.reviewed} passed vision QC, ${r.keyframeQc.rerolled} rerolled.`, { muted: true, size: 19 }),
        table(
          ["Keyframe", "QC", "Issues", "Image"],
          r.keyframes.filter((k) => safeUrl(k.url)).slice(0, 24).map((k) => [k.node, k.qcOk === null ? "—" : k.qcOk ? "pass" : "fail", k.issues.join("; "), [link("open", k.url)]])
        )
      );
    }
  } else body.push(p("No runs yet.", { muted: true }));

  const s = m.spend;
  body.push(h1("Spend vs budget"));
  body.push(
    p(
      s.budgetUsd != null
        ? `${usd(s.totalUsd)} of ${usd(s.budgetUsd)} approved (${pct((100 * s.totalUsd) / s.budgetUsd)} used${s.totalUsd > s.budgetUsd ? " — over budget" : ""}).`
        : `${usd(s.totalUsd)} spent; no budget cap set.`
    )
  );
  if (s.openReservedUsd > 0) body.push(p(`${usd(s.openReservedUsd)} is reserved at estimate (not yet reconciled with the provider's bill).`, { muted: true, size: 19 }));
  body.push(...textBars("Spend by kind of call", s.byKindLabelled.map((b) => ({ label: b.label, value: b.usd, display: `${usd(b.usd)} · ${b.calls} calls` }))));
  if (s.byModel.length) body.push(spacer(), table(["Model", "Calls", "Spent"], s.byModel.map((b) => [b.key, String(b.calls), usd(b.usd)]), [1, 2]));

  body.push(h1("Performance learnings"));
  if (m.performance) {
    body.push(
      ...textBars("Hook rate by hook style", m.performance.styles.map((x) => ({ label: `${x.name} hooks`, value: x.hookRatePct, display: `${x.hookRatePct.toFixed(1)}%` }))),
      spacer(),
      table(["Hook style", "Ads", "Impressions", "Hook rate", "CTR", "Spend"], m.performance.styles.map((x) => [x.name, String(x.ads), x.impressions.toLocaleString("en-US"), `${x.hookRatePct.toFixed(1)}%`, `${x.ctrPct.toFixed(2)}%`, usd(x.spend)]), [1, 2, 3, 4, 5]),
      spacer(),
      p(`${m.performance.hookWinner ? `${m.performance.hookWinner} hooks stop the scroll best (significant).` : "No significant hook-rate winner yet."} ${m.performance.ctrWinner ? `${m.performance.ctrWinner} hooks get the most clicks (significant).` : "No significant CTR winner yet."}`)
    );
  } else body.push(p("No ad results imported yet.", { muted: true }));

  body.push(h1("Next actions"), ...m.nextActions.map((a, i) => p(a, { bold: `${i + 1}.` })));

  const doc = new Document({
    creator: "CreativeIntel",
    title: `${m.project.title} — Campaign Report`,
    styles: { default: { document: { run: { font: FONT, size: 21 } } } },
    sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } }, children: body }],
  });
  return Packer.toBuffer(doc);
}

export const DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";