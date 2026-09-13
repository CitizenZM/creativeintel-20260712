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

const SCRAPE = `
const task = await openSpace("creativeintel research worker");
// task.page(label) only resolves a label that already exists in the space, so
// the first fetch in a fresh space has to create the page.
let page;
try {
  page = task.page("fetch");
  await page.evaluate(() => 1);
} catch {
  page = await task.newPage();
}
let status = 0;
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
`;

export async function runBrowserFetch({ url, waitMs }) {
  if (!url || !/^https?:\/\//i.test(String(url))) {
    return { result: null, note: `refusing to fetch a non-http(s) url: ${url}` };
  }

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
