// Failures -> incidents by cause signature (ids, urls, paths, numbers stripped). One root cause = one incident.
const H = 3_600_000;

export function signatureOf(error) {
  return String(error || 'unknown')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/(\/[\w.@-]+){2,}/g, '<path>')
    .replace(/\bc[a-z0-9]{20,}\b/g, '<id>')
    .replace(/\b[0-9a-f-]{8,}\b/g, '<id>')
    .replace(/\d+(\.\d+)?/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

const RUNBOOKS = [
  { re: /filter|safety|moderat|content policy/, kind: 'model', runbook: 'provider safety filter: Director rewrites the scene prompt; no blind retry', retry: false },
  { re: /budget|spend cap|allowance|insufficient|credit|balance|\b402\b/, kind: 'human', runbook: 'budget/credit/provider balance: top up (OpenRouter credits) or raise the cap - Barron', retry: false },
  { re: /product page url|setup first|no frames|storyboard not found|project not found/, kind: 'data', runbook: 'project data missing: complete the Setup/Studio step', retry: false },
  { re: /cancel/, kind: 'human', runbook: 'cancelled by a person: no action', retry: false },
  { re: /not found|no endpoints|unknown model|retired|deprecated|unavailable/, kind: 'model', runbook: 'model gone: pipeline falls back (generate.mjs GONE); probe flags the route to update; brain retries once', retry: true },
  { re: /no image returned|no output/, kind: 'model', runbook: 'keyframe returned nothing: pipeline retries twice; brain retries the run once', retry: true },
  { re: /worker stopped|heartbeat|stale|econnreset|etimedout|socket hang up|fetch failed|timeout|timed out|\b5\d\d\b|rate limit|\b429\b|overloaded/, kind: 'platform', runbook: 'transient: brain retries the run once from the failed step', retry: true },
];

export function classify(error) {
  const s = String(error || '').toLowerCase();
  for (const r of RUNBOOKS) if (r.re.test(s)) return { kind: r.kind, runbook: r.runbook, retry: r.retry };
  return { kind: 'code', runbook: 'unknown cause: Doctor diagnoses it and opens a fix PR with a failing test', retry: false };
}

/** merge failed runs into the incident map (keyed by signature); resolved after 72 h quiet, reopened on return */
export function aggregate(prev, failedRuns, now = Date.now()) {
  const out = Object.fromEntries(Object.entries(prev || {}).map(([k, v]) => [k, { ...v, runs: [...(v.runs || [])] }]));
  for (const r of failedRuns) {
    if (!r.error || /cancel/i.test(r.error)) continue;
    const sig = signatureOf(r.error);
    const c = classify(r.error);
    const at = new Date(r.updatedAt).toISOString();
    const cur = out[sig] || { signature: sig, kind: c.kind, count: 0, firstSeen: at, lastSeen: at, status: 'open', runbook: c.runbook, sample: String(r.error).slice(0, 300), runs: [] };
    if (!cur.runs.includes(r.id)) {
      cur.runs = [...cur.runs, r.id].slice(-20);
      cur.count += 1;
      if (at > cur.lastSeen) cur.lastSeen = at;
      if (at < cur.firstSeen) cur.firstSeen = at;
      if (cur.status === 'resolved' && now - Date.parse(at) < 72 * 3_600_000) cur.status = 'reopened';
    }
    out[sig] = cur;
  }
  for (const v of Object.values(out)) if (v.status !== 'resolved' && now - Date.parse(v.lastSeen) > 72 * H) v.status = 'resolved';
  return out;
}
