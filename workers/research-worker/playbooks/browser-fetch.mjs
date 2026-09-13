// Generic page fetch through ego-browser.
//
// The app falls back to this whenever its own server-side fetch is refused:
// DuckDuckGo answers a datacentre IP with HTTP 202 + a JS challenge, and many
// DTC storefronts answer 403. The same URLs load normally from this machine's
// residential IP, so the page is rendered here and the HTML handed back for
// the app to parse with the very same code it uses for a direct fetch.
//
// Returns the settled document, not the raw transport response — client-
// rendered pages are the common case.

import { runEgoScript } from './_ego.mjs';

const MAX_CHARS = 600_000;

/**
 * Minimum spacing between fetches of the same host. A research run queues one
 * search per owner per adapter, and six DuckDuckGo fetches inside 18s came
 * back as a 205-character challenge page instead of results — the block this
 * whole path exists to get around, re-earned by hammering.
 */
const HOST_INTERVAL_MS = Number(process.env.BROWSER_FETCH_HOST_INTERVAL_MS || 7000);
const lastFetchByHost = new Map();

async function paceHost(url) {
  let host;
  try {
    host = new URL(url).host;
  } catch {
    return;
  }
  const last = lastFetchByHost.get(host) ?? 0;
  const waitFor = last + HOST_INTERVAL_MS - Date.now();
  if (waitFor > 0) await new Promise((r) => setTimeout(r, waitFor));
  lastFetchByHost.set(host, Date.now());
}

const SCRAPE = `
const task = await openSpace("creativeintel research worker");
// newPage() assigns its own label, so there is no stable one to re-resolve —
// the page is closed again at the end of every fetch. Leaving it open hit
// "PageBudgetError: Page budget reached (8/8)" after eight fetches and then
// failed every subsequent task in the space.
// Defence in depth: the finally-block below closes the page on every normal
// path, but a killed process can still strand one. Reclaim before the space
// hits its budget, since once it does, every task in it fails.
try {
  const open = await task.pages();
  for (let i = open.length - 1; i >= 1 && (await task.pages()).length > 4; i--) {
    try { await open[i].close(); } catch {}
  }
} catch {}

const page = await task.newPage();
let status = 0;
try {
  try {
    const res = await page.goto(URL);
    if (res && typeof res.status === "number") status = res.status;
  } catch (err) {
    emit({ spaceId: task.spaceId, error: "goto failed: " + (err && err.message ? err.message : String(err)) });
    throw err;
  }

  await page.waitForTimeout(WAIT_MS);

  const out = await page.evaluate((max) => ({
    finalUrl: location.href,
    title: document.title || "",
    html: (document.documentElement ? document.documentElement.outerHTML : "").slice(0, max),
    text: ((document.body && document.body.innerText) || "").slice(0, max),
  }), MAX_CHARS);

  emit({ spaceId: task.spaceId, status, ...out });
} finally {
  try { await page.close(); } catch {}
}
`;

export async function runBrowserFetch({ url, waitMs }) {
  if (!url || !/^https?:\/\//i.test(String(url))) {
    return { result: null, note: `refusing to fetch a non-http(s) url: ${url}` };
  }

  await paceHost(url);

  const body = `const URL = ${JSON.stringify(url)};
const WAIT_MS = ${Number.isFinite(waitMs) ? Math.min(Math.max(waitMs, 0), 15000) : 2500};
const MAX_CHARS = ${MAX_CHARS};
${SCRAPE}`;

  const parsed = await runEgoScript(body, { timeoutMs: 120_000 });
  if (parsed && parsed.error) {
    return { result: null, note: parsed.error };
  }

  return {
    result: {
      finalUrl: parsed.finalUrl || url,
      status: parsed.status || 0,
      title: parsed.title || '',
      html: parsed.html || '',
      text: parsed.text || '',
    },
    note: `fetched ${(parsed.text || '').length} chars of text`,
  };
}
