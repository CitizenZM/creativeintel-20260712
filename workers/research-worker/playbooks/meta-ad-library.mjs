// Meta Ad Library playbook.
//
// Selector strategy verified live on 2026-09-10: Meta's class names are
// obfuscated atoms and change per deploy, so the only stable anchor is the
// literal text node "Library ID: <digits>". We climb from it to the results
// grid and read each card's own <video> element — the mp4 URL and the poster
// are on the card itself, no click into a snapshot view is needed.
//
// Root-caused live on 2026-09-11: every task was failing with "0 candidates —
// no Library ID nodes found" even for advertisers that clearly run video ads
// (Crepe Erase, Grande Cosmetics, Olay). The page was rendering fully — ~48
// results, real video cards — but in Simplified Chinese
// (document.documentElement.lang === "zh-Hans") because the worker machine's
// browser locale/egress isn't US-English. The label reads
// "资料库编号：<digits>" instead of "Library ID: <digits>", so the English-only
// regex never matched anything and the playbook always saw an empty grid.
// `&locale=en_US` on the search URL reliably forces the English render
// (verified: lang flips to "en", label flips to "Library ID: <digits>"), so
// that's the primary fix. The card-matching regex is also made bilingual as a
// defense-in-depth fallback in case a future session ignores the locale param.
//
// Public pages only. No login, no CAPTCHA, one page load per task.

import { runEgoScript, parseDateRange, unwrapFacebookLink, aspectFrom } from './_ego.mjs';

/** Lowercase, strip punctuation and legal suffixes, collapse whitespace. */
function normaliseAdvertiser(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[®™©]/g, '')
    .replace(/\b(inc|llc|ltd|co|corp|gmbh|company|official)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * True when the ad's advertiser plausibly IS the requested one — equal, or one
 * name starting with the other on a word boundary. "ridge wallet" matches
 * "ridge"; "willow ridge weddings events" does not.
 */
function advertiserMatches(name, needle) {
  if (!name || !needle) return false;
  if (name === needle) return true;
  return name.startsWith(needle + ' ') || needle.startsWith(name + ' ');
}

function searchUrl({ advertiser, country }) {
  const params = new URLSearchParams({
    active_status: 'all',
    ad_type: 'all',
    country,
    locale: 'en_US',
    media_type: 'video',
    q: advertiser,
    search_type: 'keyword_unordered',
  });
  return `https://www.facebook.com/ads/library/?${params.toString()}`;
}

const SCRAPE = `
const task = await openSpace("creativeintel research worker");
const page = task.page("p1");
await page.goto(URL);

// Poll for the Library ID label (either language — see the file header) for
// up to 25s instead of a fixed sleep, since the grid can take a while to
// hydrate. If it still hasn't appeared, scroll once and keep polling briefly
// — some sessions only populate the grid after the first scroll event.
const ID_TEXT_RE = /(?:Library ID|\\u8d44\\u6599\\u5e93\\u7f16\\u53f7)[:\\uff1a]\\s*\\d+/;
async function waitForIdText(budgetMs) {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    // document.body can be transiently null right after goto(), between
    // navigations (Meta sometimes bounces through a cookie-consent redirect
    // before settling on the ads library page) — reproduced live 2026-09-13,
    // crashed the whole evaluate and burned a worker attempt.
    const found = await page.evaluate(
      (re) => new RegExp(re[0], re[1]).test((document.body && document.body.innerText) || ""),
      [ID_TEXT_RE.source, ID_TEXT_RE.flags]
    );
    if (found) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

let scrolls = 0;
let found = await waitForIdText(18000);
if (!found && scrolls < 2) {
  await page.mouse.wheel(0, 1600);
  scrolls++;
  found = await waitForIdText(7000);
}

// Give the lazily-attached <video> elements a chance to report metadata.
await page.evaluate(() => {
  for (const v of document.querySelectorAll("video")) {
    try { v.preload = "metadata"; v.load(); } catch {}
  }
});
await page.waitForTimeout(2500);

// One more scroll (still within the two-scroll budget) to surface any
// remaining lazy cards before reading the grid.
if (scrolls < 2) {
  await page.mouse.wheel(0, 1600);
  scrolls++;
  await page.waitForTimeout(1500);
}

const cards = await page.evaluate((limit) => {
  const ID_RE = /^(?:Library ID|\\u8d44\\u6599\\u5e93\\u7f16\\u53f7)[:\\uff1a]\\s*(\\d+)$/;
  const ID_RE_LOOSE = /(?:Library ID|\\u8d44\\u6599\\u5e93\\u7f16\\u53f7)[:\\uff1a]\\s*(\\d+)/;
  const idEls = [...document.querySelectorAll("div,span")]
    .filter((d) => ID_RE.test((d.textContent || "").trim()));
  if (idEls.length === 0) return { cards: [], reason: "no Library ID nodes found" };

  let node = idEls[0];
  for (let i = 0; i < 6 && node.parentElement; i++) node = node.parentElement;
  const grid = node;

  const seen = new Set();
  const out = [];
  for (const card of [...grid.children]) {
    const text = card.innerText || "";
    const libraryId = (text.match(ID_RE_LOOSE) || [])[1];
    if (!libraryId || seen.has(libraryId)) continue;

    // Only cards that actually carry a <video> count as video ads — a
    // keyword search can still surface a non-video card even with
    // media_type=video applied.
    const video = card.querySelector("video");
    if (!video) continue;
    seen.add(libraryId);

    const advertiserAnchor = card.querySelector('a[href*="facebook.com/"]:not([href*="/l.php"])');
    const ctaAnchor = card.querySelector('a[href*="/l.php"]');

    out.push({
      libraryId,
      dateText:
        (text.match(/Started running on ([^\\n]+)/) || [])[1] ||
        (text.match(/([A-Z][a-z]{2} \\d{1,2}, \\d{4} - [A-Z][a-z]{2} \\d{1,2}, \\d{4})/) || [])[1] ||
        (text.match(/([^\\n]*\\u5f00\\u59cb\\u6295\\u653e)/) || [])[1] ||
        (text.match(/(\\d{4}\\u5e74\\d{1,2}\\u6708\\d{1,2}\\u65e5\\s*-\\s*\\d{4}\\u5e74\\d{1,2}\\u6708\\d{1,2}\\u65e5)/) || [])[1] ||
        "",
      active: /\\bActive\\b/.test(text) || /\\u6295\\u653e\\u4e2d/.test(text),
      advertiser: advertiserAnchor ? (advertiserAnchor.innerText || "").trim() : "",
      advertiserHref: advertiserAnchor ? advertiserAnchor.href : "",
      ctaHref: ctaAnchor ? ctaAnchor.href : "",
      body: text.slice(0, 600),
      videoSrc: video.currentSrc || video.src || "",
      poster: video.poster || "",
      durationSec: isFinite(video.duration) && video.duration > 0 ? video.duration : null,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
    });
    if (out.length >= limit) break;
  }
  return { cards: out, reason: out.length === 0 ? "grid produced no cards with a <video>" : "" };
}, LIMIT);

emit({ spaceId: task.spaceId, ...cards });
`;

/** Numeric page id when the advertiser link is /<digits>/, otherwise the slug. */
function advertiserIdFrom(href) {
  if (!href) return undefined;
  const numeric = href.match(/facebook\.com\/(\d{6,})\/?/);
  if (numeric) return numeric[1];
  const slug = href.match(/facebook\.com\/([^/?#]+)/);
  return slug?.[1];
}

function bodyTitle(text, advertiser) {
  const cleaned = (text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(
      (l) =>
        l &&
        !/^Library ID:/.test(l) &&
        !/^资料库编号[:：]/.test(l) &&
        !/^(Active|Inactive|Sponsored|Open Dropdown|Platforms?)$/i.test(l) &&
        !/^(投放中|已停止|赞助内容|打开下拉菜单|平台)$/.test(l) &&
        !/^Started running on/.test(l) &&
        !/开始投放$/.test(l) &&
        !/^See (ad details|summary details)$/i.test(l) &&
        !/^(查看广告详情|查看摘要详情)$/.test(l) &&
        // Meta's own "this card collapses several creative variants" notice —
        // never a real ad body, but long enough (>12 chars) to have been
        // picked up as the title by the length heuristic below.
        !/^This ad has multiple versions\.?$/i.test(l) &&
        !/^(此广告|该广告)(展示了|有)多个版本\.?$/.test(l)
    );
  // Ad body text only — first real content line long enough to be a title,
  // not a UI label. If the card carries none, fall back to the page/
  // advertiser name rather than a bare label string.
  const body = cleaned.find((l) => l.length > 12);
  if (body) return body.slice(0, 160);
  return advertiser ? `${advertiser} — video ad`.slice(0, 160) : 'Meta ad';
}

export async function runMetaAdLibrary(payload) {
  const country = (payload.countries?.[0] || 'US').toUpperCase();
  // Capped at 20 per task regardless of what's requested — this playbook
  // scrolls at most twice, which is not enough headroom to safely go higher.
  const limit = Math.min(payload.limit || 20, 20);
  const url = searchUrl({ advertiser: payload.advertiser, country });

  const body = `const URL = ${JSON.stringify(url)};
const LIMIT = ${limit};
${SCRAPE}`;

  const result = await runEgoScript(body, { timeoutMs: 180_000 });
  const advertiserNeedle = normaliseAdvertiser(payload.advertiser);

  const candidates = (result.cards || [])
    // A keyword search returns ads that merely MENTION the brand. A substring
    // test was far too loose — searching "Ridge" accepted "Willow Ridge
    // Weddings & Events", and a card with no advertiser at all was accepted
    // outright. Anchor the match to the start of the name instead.
    .filter((c) => advertiserMatches(normaliseAdvertiser(c.advertiser), advertiserNeedle))
    .map((c) => {
      const { firstSeen, lastSeen } = parseDateRange(c.dateText);
      const aspect = aspectFrom(c.videoWidth, c.videoHeight);
      return {
        sourceId: `meta_ad_library:${c.libraryId}`,
        source: 'meta_ad_library',
        platform: /instagram/i.test(c.ctaHref || '') ? 'instagram' : 'facebook',
        durationSec: c.durationSec ?? undefined,
        aspect,
        isPaidAd: true,
        adEvidence: 'ad_library',
        adConfidence: 1,
        advertiserName: c.advertiser || payload.advertiser,
        advertiserId: advertiserIdFrom(c.advertiserHref),
        adLibraryId: c.libraryId,
        competitorId: payload.competitorId ?? null,
        metrics: {},
        firstSeen,
        lastSeen: lastSeen ?? (c.active ? undefined : firstSeen),
        landingUrl: unwrapFacebookLink(c.ctaHref),
        videoUrl: c.videoSrc || undefined,
        thumbnailUrl: c.poster || '',
        permalink: `https://www.facebook.com/ads/library/?id=${c.libraryId}`,
        title: bodyTitle(c.body, c.advertiser || payload.advertiser),
        description: (c.body || '').slice(0, 500),
        publishedAt: firstSeen,
        channelTitle: c.advertiser || undefined,
      };
    });

  return { candidates, note: result.reason || `${candidates.length} video ads` };
}
