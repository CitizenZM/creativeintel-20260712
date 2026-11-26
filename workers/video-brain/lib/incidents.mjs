// Failures -> incidents by cause signature (ids, urls, paths, numbers stripped). One root cause = one incident.
const H = 3_600_000;
/** dedup memory per incident: every run id seen, last IDS_CAP kept (40 published incidents x 200 x ~37 B stays far under SNAPSHOT_MAX_BYTES) */
export const IDS_CAP = 200;

const norm = (s) => s
  .toLowerCase()
  .replace(/https?:\/\/\S+/g, '<url>')
  .replace(/(\/[\w.@-]+){2,}/g, '<path>')
  .replace(/\bc[a-z0-9]{20,}\b/g, '<id>')
  .replace(/\b[a-z]+_(?=[a-z]*\d)[a-z0-9]{12,}\b/g, '<id>') // req_011ChMH..., user_39vQn...
  .replace(/\b[0-9a-f-]{8,}\b/g, '<id>')
  .replace(/\d+(\.\d+)?/g, '#')
  .replace(/\s+/g, ' ')
  .trim();

// provider JSON bodies ({"error":{"message":"..."}}, {"type":"error","error":{...}}, {"detail":"..."}): the cause is the
// HTTP code + message, not request_id / user_id / trailing remedy text -> sign on code + first sentence (after $1.00 -> $#).
// OpenRouter wraps upstream failures as "Provider returned error" + metadata.raw: then raw's first sentence is the cause.
const PROVIDER_MSG = /"(?:message|detail)"\s*:\s*"((?:[^"\\]|\\.)+)/;
const RAW = /"raw"\s*:\s*"((?:[^"\\]|\\.)+)/;
const GENERIC = /^(provider returned error|upstream error|internal (server )?error|unknown error|error)$/;
const sentence = (t) => norm(t).split('. ')[0].replace(/\.$/, '');
const unescape = (t) => { try { return JSON.parse(`"${t}"`); } catch { return t.replace(/\\"/g, '"'); } };

export function signatureOf(error) {
  const s = String(error || 'unknown');
  const m = s.match(PROVIDER_MSG);
  if (!m) return norm(s).slice(0, 140);
  const brace = s.indexOf('{');
  const headRaw = brace >= 0 && brace < m.index ? s.slice(0, brace) : '';
  const code = headRaw.match(/\b([1-5]\d\d)\b/)?.[1] || s.match(/"code"\s*:\s*([1-5]\d\d)\b/)?.[1] || '';
  let msg = sentence(m[1]);
  const raw = GENERIC.test(msg) && s.match(RAW);
  if (raw) {
    const inner = unescape(raw[1]);
    msg += ` | ${sentence(inner.match(PROVIDER_MSG)?.[1] ?? inner)}`;
  }
  return `${norm(headRaw)} ${code} ${msg}`.replace(/\s+/g, ' ').trim().slice(0, 140);
}

const RUNBOOKS = [
  { re: /filter|safety|moderat|content policy/, kind: 'model', runbook: 'provider safety filter: Director rewrites the scene prompt; no blind retry', retry: false },
  { re: /budget|spend cap|allowance|insufficient|credit|balance|\b402\b/, kind: 'human', runbook: 'budget/credit/provider balance: top up (OpenRouter credits) or raise the cap - Barron', retry: false },
  { re: /product page url|setup first|no frames|storyboard not found|project not found/, kind: 'data', runbook: 'project data missing: complete the Setup/Studio step', retry: false },
  { re: /cancel/, kind: 'human', runbook: 'cancelled by a person: no action', retry: false },
  { re: /not found|no endpoints|unknown model|retired|deprecated|unavailable/, kind: 'model', runbook: 'model gone: pipeline falls back (generate.mjs GONE); probe flags the route to update; brain retries once', retry: true },
  { re: /no image returned|no output/, kind: 'model', runbook: 'keyframe returned nothing: pipeline retries twice; brain retries the run once', retry: true },
  { re: /\b401\b|authentication_error|invalid[ _-]?(x-)?api[ _-]?key|unauthori[sz]ed/i, kind: 'human', runbook: 'credential rejected (401): rotate or re-enter the key in the env file the failing stage reads - Barron', retry: false },
  { re: /enospc|no space left/i, kind: 'human', runbook: 'disk full: free space on the Mac worker - Barron', retry: false },
  { re: /exited null|killed by sig|pipeline killed|worker stopped|heartbeat|stale|econnreset|etimedout|socket hang up|fetch failed|timeout|timed out|\b5\d\d\b|rate limit|\b429\b|overloaded/, kind: 'platform', runbook: 'transient: brain retries the run once from the failed step', retry: true },
];

export function classify(error) {
  const s = String(error || '').toLowerCase();
  for (const r of RUNBOOKS) if (r.re.test(s)) return { kind: r.kind, runbook: r.runbook, retry: r.retry };
  return { kind: 'code', runbook: 'unknown cause: Doctor diagnoses it and opens a fix PR with a failing test', retry: false };
}

const SAMPLE_MAX = 300;
const unionTail = (a, b, cap) => [...a, ...b.filter((x) => !a.includes(x))].slice(-cap);

/** two stored incidents with one cause (signature format changed): sum counts, union ids, earliest firstSeen, open wins */
function merge(a, b) {
  const shared = b.ids.filter((id) => a.ids.includes(id)).length;
  const live = [a.status, b.status].filter((x) => x !== 'resolved');
  const out = {
    ...a,
    count: (a.count || 0) + (b.count || 0) - shared,
    ids: unionTail(a.ids, b.ids, IDS_CAP),
    runs: unionTail(a.runs, b.runs, 20),
    firstSeen: a.firstSeen < b.firstSeen ? a.firstSeen : b.firstSeen,
    lastSeen: a.lastSeen > b.lastSeen ? a.lastSeen : b.lastSeen,
    status: live.length ? (live.includes('open') ? 'open' : live[0]) : 'resolved',
  };
  if (out.status !== 'resolved') delete out.resolvedBy;
  return out;
}

/**
 * merge runs into the incident map (keyed by signature). `runs` may be ALL observed runs (failed + completed) or, for
 * legacy callers, only failed ones (a run without status counts as failed). Resolved after 72 h quiet, or
 * resolvedBy 'recovered' once every run it lists is visible as completed and not a $0 budget fallback (a 402 run
 * re-planned as slides completes while funds are still out). Reopened when the cause returns within 72 h.
 */
export function aggregate(prev, runs, now = Date.now()) {
  const out = {};
  for (const [k, v0] of Object.entries(prev || {})) {
    const v = { ...v0, runs: [...(v0.runs || [])], ids: [...(v0.ids || v0.runs || [])] };
    // re-key from the sample so a signature format change merges instead of duplicating every stored incident
    v.signature = v.sample ? signatureOf(v.sample) : k;
    out[v.signature] = out[v.signature] ? merge(out[v.signature], v) : v;
  }
  for (const r of runs) {
    if (!(r.status === 'failed' || r.status == null)) continue;
    if (!r.error || /cancel/i.test(r.error)) continue;
    const sample = String(r.error).slice(0, SAMPLE_MAX);
    const sig = signatureOf(sample); // same text as the stored sample -> re-keying is stable
    const c = classify(r.error);
    const at = new Date(r.updatedAt).toISOString();
    const cur = out[sig] || { signature: sig, kind: c.kind, count: 0, firstSeen: at, lastSeen: at, status: 'open', runbook: c.runbook, sample, runs: [], ids: [] };
    const seen = cur.ids.includes(r.id);
    // a run that recovered and is now failed again is a new failure under the same id
    if (!seen || (cur.status === 'resolved' && cur.resolvedBy === 'recovered')) {
      if (!seen) { cur.ids = [...cur.ids, r.id].slice(-IDS_CAP); cur.runs = [...cur.runs, r.id].slice(-20); }
      delete cur.resolvedBy; // counted once even if it stays resolved (failure older than 72 h)
      cur.count += 1;
      if (at > cur.lastSeen) cur.lastSeen = at;
      if (at < cur.firstSeen) cur.firstSeen = at;
      if (cur.status === 'resolved' && now - Date.parse(at) < 72 * 3_600_000) { cur.status = 'reopened'; delete cur.resolvedBy; }
    }
    out[sig] = cur;
  }
  const byId = new Map(runs.map((r) => [r.id, r]));
  const recovered = (id) => { const r = byId.get(id); return !!r && r.status === 'completed' && r.fallback !== 'budget'; };
  for (const v of Object.values(out)) {
    if (v.status !== 'resolved' && v.ids.length && v.ids.every(recovered)) { v.status = 'resolved'; v.resolvedBy = 'recovered'; }
    if (v.status !== 'resolved' && now - Date.parse(v.lastSeen) > 72 * H) v.status = 'resolved';
    // runbooks evolve: an open incident first seen before its rule existed is re-classified from its sample
    if (v.status === 'resolved' || !v.sample) continue;
    const c = classify(v.sample);
    if (c.kind !== v.kind || c.runbook !== v.runbook) { v.kind = c.kind; v.runbook = c.runbook; }
  }
  return out;
}
