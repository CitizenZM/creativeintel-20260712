/**
 * The campaign report as one self-contained HTML file: inline CSS (light + dark), tables, inline-SVG
 * bar charts, keyframe thumbnails by URL. No scripts, no external stylesheets or fonts.
 */
import type { CampaignReportModel } from "./campaign-report";

const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const usd = (n: number) => `$${n.toFixed(n !== 0 && Math.abs(n) < 0.1 ? 3 : 2)}`;
const pct = (n: number) => `${Math.round(n)}%`;
const safeUrl = (u: string | null | undefined) => (u && /^https?:\/\//.test(u) ? u : null);

/** Horizontal bar chart: one row per item, value label at the bar's end. */
export function barChartSvg(items: { label: string; value: number; display: string }[], opts: { title: string; width?: number } ): string {
  if (!items.length) return "";
  const width = opts.width ?? 640;
  const labelW = 200;
  const row = 28;
  const max = Math.max(...items.map((i) => i.value), 1e-9);
  const barMax = width - labelW - 90;
  const h = items.length * row + 8;
  const rows = items
    .map((it, i) => {
      const y = i * row + 4;
      const w = Math.max(2, (it.value / max) * barMax);
      return `<text x="${labelW - 8}" y="${y + 17}" text-anchor="end" class="cl">${esc(it.label.length > 30 ? `${it.label.slice(0, 29)}…` : it.label)}</text>` +
        `<rect x="${labelW}" y="${y + 4}" width="${w.toFixed(1)}" height="18" rx="3" class="cb"/>` +
        `<text x="${(labelW + w + 6).toFixed(1)}" y="${y + 17}" class="cv">${esc(it.display)}</text>`;
    })
    .join("");
  return `<figure class="chart"><figcaption>${esc(opts.title)}</figcaption><svg role="img" aria-label="${esc(opts.title)}" viewBox="0 0 ${width} ${h}" width="100%" preserveAspectRatio="xMinYMin meet">${rows}</svg></figure>`;
}

/** Spend vs budget meter. */
function budgetMeter(spent: number, budget: number | null): string {
  if (budget == null || budget <= 0) return `<p class="muted">No budget cap set — every paid call is still recorded in the ledger.</p>`;
  const used = Math.min(1, spent / budget);
  const over = spent > budget;
  return `<svg role="img" aria-label="Spend versus budget" viewBox="0 0 640 34" width="100%"><rect x="0" y="6" width="640" height="18" rx="9" class="track"/><rect x="0" y="6" width="${(640 * used).toFixed(1)}" height="18" rx="9" class="${over ? "over" : used > 0.8 ? "warn" : "cb"}"/></svg>
<p>${usd(spent)} of ${usd(budget)} approved (${pct((100 * spent) / budget)} used${over ? " — over budget" : ""}).</p>`;
}

function table(head: string[], rows: string[][], cls = ""): string {
  if (!rows.length) return "";
  return `<div class="tw"><table class="${cls}"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></div>`;
}

const CSS = `
:root{--bg:#f7f7f5;--card:#fff;--fg:#1d1d1f;--muted:#6b6b70;--line:#e3e3e0;--accent:#2f6fde;--accent-soft:#e8effc;--ok:#1f8a4c;--bad:#c4372f;--warn:#c98a00;--track:#ececea}
@media (prefers-color-scheme:dark){:root{--bg:#141416;--card:#1e1e21;--fg:#ececef;--muted:#a0a0a8;--line:#333338;--accent:#79a6ff;--accent-soft:#22304a;--ok:#5fd08e;--bad:#ff7a70;--warn:#f0b840;--track:#2c2c31}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
main{max-width:980px;margin:0 auto;padding:32px 16px 64px}
header h1{font-size:28px;line-height:1.2;margin:0 0 4px}header p{margin:0;color:var(--muted)}
section{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px 22px;margin-top:20px}
h2{font-size:19px;margin:0 0 12px}h3{font-size:15px;margin:18px 0 8px}
.muted{color:var(--muted)}.small{font-size:13px}
.kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-top:20px}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px}.kpi b{display:block;font-size:22px;line-height:1.2}.kpi span{color:var(--muted);font-size:12.5px}
.summary{font-size:16px}.tag{display:inline-block;font-size:11.5px;padding:1px 8px;border-radius:99px;background:var(--accent-soft);color:var(--accent);margin-left:6px;vertical-align:2px}
.tw{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13.5px}th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.03em}
span.num{display:block;text-align:right;font-variant-numeric:tabular-nums}.beats td:first-child{white-space:nowrap}
.ok{color:var(--ok)}.bad{color:var(--bad)}
.chart{margin:12px 0}.chart figcaption{font-size:13px;color:var(--muted);margin-bottom:4px}
svg .cl{fill:var(--fg);font-size:12px}svg .cv{fill:var(--muted);font-size:12px}svg .cb{fill:var(--accent)}svg .track{fill:var(--track)}svg .warn{fill:var(--warn)}svg .over{fill:var(--bad)}
.thumbs{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px;margin-top:8px}
.thumbs figure{margin:0}.thumbs img{width:100%;aspect-ratio:9/16;object-fit:cover;border-radius:8px;border:1px solid var(--line);background:var(--track)}
.thumbs figcaption{font-size:11.5px;color:var(--muted);text-align:center}
ol.actions li{margin:4px 0}
a{color:var(--accent)}
footer{margin-top:24px;color:var(--muted);font-size:12px}
@media print{body{background:#fff}section{break-inside:avoid}}
`;

export function renderReportHtml(m: CampaignReportModel): string {
  const p = m.project;
  const kpis = `<div class="kpis">${m.keyNumbers.map((k) => `<div class="kpi"><b>${esc(k.value)}</b><span>${esc(k.label)}</span></div>`).join("")}</div>`;

  const summary = `<section><h2>Executive summary${m.executiveSummary.source === "llm" ? '<span class="tag">AI-written, numbers checked</span>' : ""}</h2><p class="summary">${esc(m.executiveSummary.text)}</p></section>`;

  const brief = m.brief
    ? `<section><h2>Product brief</h2>
${m.brief.bigIdea ? `<p><strong>Big idea:</strong> ${esc(m.brief.bigIdea)}</p>` : ""}
${m.brief.audience ? `<p><strong>Audience:</strong> ${esc(m.brief.audience)}</p>` : ""}
${m.brief.job ? `<p class="muted small">${esc(m.brief.job)}</p>` : ""}
<h3>Top selling points</h3>
${table(["#", "Claim", "Benefit", "Proof shot", "Evidence"], m.brief.sellingPoints.map((s, i) => [String(i + 1), esc(s.claim), esc(s.benefit), esc(s.proof), esc(s.evidence.replace(/_/g, " "))]))}
${m.brief.objections.length ? `<h3>Objections we answer</h3>${table(["Objection", "Answer"], m.brief.objections.map((o) => [esc(o.objection), esc(o.answer)]))}` : ""}
${m.brief.keywords.length ? `<p class="small"><strong>Keywords:</strong> ${m.brief.keywords.map(esc).join(" · ")}</p>` : ""}
</section>`
    : `<section><h2>Product brief</h2><p class="muted">Not extracted yet.</p></section>`;

  const plan = m.plan
    ? `<section><h2>Campaign plan</h2><p><strong>Goal:</strong> ${esc(m.plan.goal)}${m.plan.bigIdea ? ` · <strong>Idea:</strong> ${esc(m.plan.bigIdea)}` : ""}</p>
${m.plan.platforms
  .map(
    (pl) => `<h3>${esc(pl.label)} — ${pl.durationSec} s, ${esc(pl.aspect)}</h3>
${table(["Hook", "Family", "Opening text", "Opening VO"], pl.hooks.map((h) => [esc(h.name), esc(h.family), esc(h.openingText), esc(h.openingVO)]))}
<p class="small"><strong>End card:</strong> ${esc(pl.endCard.name)}${pl.endCard.headline ? ` — “${esc(pl.endCard.headline)}”` : ""} · button “${esc(pl.endCard.button)}”</p>
${table(["Time", "Beat", "Visual", "On screen"], pl.beats.map((b) => [`${b.t0.toFixed(1)}–${b.t1.toFixed(1)} s`, esc(b.purpose), esc(b.visual), esc(b.onScreenText ?? "")]), "small beats")}`
  )
  .join("")}</section>`
    : `<section><h2>Campaign plan</h2><p class="muted">No campaign plan yet.</p></section>`;

  const runs = m.production.runs;
  const qcChart = barChartSvg(
    runs.filter((r) => r.qc).map((r) => ({ label: r.label, value: r.qc!.pct, display: `${r.qc!.passed}/${r.qc!.total} (${pct(r.qc!.pct)})` })),
    { title: "Master QC score per run" }
  );
  const production = `<section><h2>Production</h2>
${table(
  ["Run", "Status", "Engine / models", "Master QC", "Preflight", "Director", "Variants", "Spent", "Master"],
  runs.map((r) => [
    `${esc(r.label)}<br><span class="muted small">${esc(r.createdAt.slice(0, 10))}</span>`,
    `<span class="${r.status === "completed" ? "ok" : r.status === "failed" ? "bad" : ""}">${esc(r.status)}</span>`,
    `${esc(r.engine)}<br><span class="muted small">${esc(r.models)}</span>`,
    r.qc ? `${r.qc.passed}/${r.qc.total}` : "—",
    r.preflight ? `${r.preflight.score}` : "—",
    r.director ? `${r.director.score}${r.director.flagged ? ` <span class="bad small">(${r.director.flagged} flagged)</span>` : ""}` : "—",
    String(r.variants.length),
    `<span class="num">${usd(r.spentUsd)}</span>${r.approvedBudgetUsd != null ? `<br><span class="muted small">of ${usd(r.approvedBudgetUsd)}</span>` : ""}`,
    safeUrl(r.masterUrl) ? `<a href="${esc(r.masterUrl)}">mp4</a>` : "—",
  ])
)}
${qcChart}
${runs
  .filter((r) => r.variants.length)
  .map((r) => `<h3>${esc(r.label)} — hook variants</h3>${table(["Hook", "Ad name", "QC", "File"], r.variants.map((v) => [esc(v.name), `<span class="small">${esc(v.adName)}</span>`, v.passed !== null ? `${v.passed}/${v.total}` : "—", safeUrl(v.url) ? `<a href="${esc(v.url)}">mp4</a>` : "—"]))}`)
  .join("")}
${runs
  .filter((r) => r.keyframes.length)
  .map(
    (r) => `<h3>${esc(r.label)} — keyframes <span class="muted small">(${r.keyframeQc.passed}/${r.keyframeQc.reviewed} passed vision QC, ${r.keyframeQc.rerolled} rerolled)</span></h3><div class="thumbs">${r.keyframes
      .filter((k) => safeUrl(k.url))
      .slice(0, 24)
      .map((k) => `<figure><img src="${esc(k.url)}" alt="${esc(k.node)}" loading="lazy"><figcaption>${esc(k.node)}${k.qcOk === false ? ' <span class="bad">✕</span>' : k.qcOk ? ' <span class="ok">✓</span>' : ""}</figcaption></figure>`)
      .join("")}</div>`
  )
  .join("")}
</section>`;

  const s = m.spend;
  const spend = `<section><h2>Spend vs budget</h2>
${budgetMeter(s.totalUsd, s.budgetUsd)}
${s.openReservedUsd > 0 ? `<p class="muted small">${usd(s.openReservedUsd)} of this is reserved at estimate (calls not yet reconciled with the provider's bill).</p>` : ""}
${barChartSvg(s.byKindLabelled.map((b) => ({ label: b.label, value: b.usd, display: `${usd(b.usd)} · ${b.calls} call${b.calls === 1 ? "" : "s"}` })), { title: "Spend by kind of call" })}
${table(["Model", "Calls", "Spent"], s.byModel.map((b) => [esc(b.key), `<span class="num">${b.calls}</span>`, `<span class="num">${usd(b.usd)}</span>`]))}
</section>`;

  const perf = m.performance
    ? `<section><h2>Performance learnings</h2>
${barChartSvg(m.performance.styles.map((x) => ({ label: `${x.name} hooks`, value: x.hookRatePct, display: `${x.hookRatePct.toFixed(1)}% hook rate` })), { title: "Hook rate (3-second views ÷ impressions) by hook style" })}
${table(["Hook style", "Ads", "Impressions", "Hook rate", "CTR", "Spend"], m.performance.styles.map((x) => [esc(x.name), String(x.ads), x.impressions.toLocaleString("en-US"), `${x.hookRatePct.toFixed(1)}%`, `${x.ctrPct.toFixed(2)}%`, usd(x.spend)]))}
<p>${m.performance.hookWinner ? `<strong>${esc(m.performance.hookWinner)}</strong> hooks stop the scroll best (significant). ` : "No significant hook-rate winner yet. "}${m.performance.ctrWinner ? `<strong>${esc(m.performance.ctrWinner)}</strong> hooks get the most clicks (significant).` : "No significant CTR winner yet."}</p>
</section>`
    : `<section><h2>Performance learnings</h2><p class="muted">No ad results imported yet.</p></section>`;

  const actions = `<section><h2>Next actions</h2><ol class="actions">${m.nextActions.map((a) => `<li>${esc(a)}</li>`).join("")}</ol></section>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark">
<title>${esc(p.title)} — Campaign Report</title><style>${CSS}</style></head>
<body><main>
<header><h1>${esc(p.title)} — Campaign Report</h1><p>${esc(p.name)}${p.productUrl ? ` · <a href="${esc(p.productUrl)}">product page</a>` : ""} · generated ${esc(m.generatedAt.slice(0, 16).replace("T", " "))} UTC</p></header>
${kpis}
${summary}
${brief}
${plan}
${production}
${spend}
${perf}
${actions}
<footer>CreativeIntel campaign report · prices and spend from the SpendEntry ledger (estimates until reconciled with the provider's bill).</footer>
</main></body></html>`;
}
