// Thin wrapper around the operator's ego-browser (ego-lite) CLI.
//
// ego-browser runs a Node.js ESM script supplied on stdin (`ego-browser nodejs`)
// with `taskSpace`, `page`, etc. injected. It is NOT Playwright — only the
// documented TaskSpace/Page API is available inside the script.
//
// Convention: a playbook script prints exactly one line
//   __RESULT__<json>
// which this helper parses. Everything else is treated as logging.
//
// ego-browser relays the inner script's console.log to ITS OWN stderr, not
// stdout, so the marker has to be looked for on both streams — scanning stdout
// alone rejected every successful run with "produced no __RESULT__ line", with
// the result payload sitting in the error message's own stderr excerpt.

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const STATE_DIR = join(homedir(), '.creativeintel-research-worker');
const SPACE_FILE = join(STATE_DIR, 'space.json');
const RESULT_MARKER = '__RESULT__';

export const EGO_BIN = process.env.EGO_BROWSER_BIN || 'ego-browser';

/** The worker keeps ONE task space for its whole lifetime, per the ego-browser skill. */
export async function loadSpaceId() {
  try {
    const raw = await readFile(SPACE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return typeof parsed.spaceId === 'number' ? parsed.spaceId : null;
  } catch {
    return null;
  }
}

export async function saveSpaceId(spaceId) {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(SPACE_FILE, JSON.stringify({ spaceId }, null, 2));
}

/**
 * Run a script body through `ego-browser nodejs`. The body may reference
 * `SPACE_ID` (number|null) and must print `__RESULT__<json>`.
 */
export async function runEgoScript(body, { timeoutMs = 180_000 } = {}) {
  const spaceId = await loadSpaceId();
  const script = `const SPACE_ID = ${spaceId === null ? 'null' : spaceId};
const RESULT_MARKER = ${JSON.stringify(RESULT_MARKER)};
async function openSpace(name) {
  // The cached space id goes stale whenever ego lite restarts or the space is
  // closed, and taskSpace() then throws "task space not found: <id>" for every
  // task forever — the worker looked alive but could not run a single
  // playbook. Fall back to a fresh space and let the caller persist the new id.
  if (SPACE_ID !== null) {
    try {
      return await taskSpace(SPACE_ID);
    } catch (err) {
      if (!/not found/i.test(err && err.message ? err.message : String(err))) throw err;
    }
  }
  return await taskSpace(name);
}
function emit(value) { console.log(RESULT_MARKER + JSON.stringify(value)); }
${body}
`;

  return new Promise((resolve, reject) => {
    const child = spawn(EGO_BIN, ['nodejs'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`ego-browser script timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`could not run "${EGO_BIN} nodejs": ${err.message}`));
    });
    child.on('close', async (code) => {
      clearTimeout(timer);
      // stdout first, then stderr — ego-browser forwards the script's
      // console.log on stderr, so the marker legitimately lands on either.
      const findMarker = (stream) =>
        stream
          .split('\n')
          .map((l) => l.trim())
          .reverse()
          .find((l) => l.startsWith(RESULT_MARKER));
      const line = findMarker(stdout) ?? findMarker(stderr);
      if (!line) {
        reject(
          new Error(
            `ego-browser produced no ${RESULT_MARKER} line (exit ${code}). stdout: ${stdout.slice(0, 400)} stderr: ${stderr.slice(0, 800)}`
          )
        );
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(line.slice(RESULT_MARKER.length));
      } catch (err) {
        reject(new Error(`could not parse ego-browser result: ${err.message}`));
        return;
      }
      if (parsed && typeof parsed.spaceId === 'number') {
        await saveSpaceId(parsed.spaceId).catch(() => {});
      }
      if (parsed && parsed.error) {
        reject(new Error(parsed.error));
        return;
      }
      resolve(parsed);
    });

    child.stdin.write(script);
    child.stdin.end();
  });
}

/** `Aug 3, 2026` / `Jul 9, 2025 - Nov 21, 2025` → { firstSeen, lastSeen } ISO strings. */
export function parseDateRange(text) {
  if (!text) return {};
  const range = text.match(
    /([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})\s*[-–]\s*([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})/
  );
  if (range) {
    return { firstSeen: toIso(range[1]), lastSeen: toIso(range[2]) };
  }
  const single = text.match(/([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})/);
  if (single) return { firstSeen: toIso(single[1]) };

  // Defense-in-depth: the meta-ad-library playbook forces &locale=en_US, but
  // if a future session ever renders the page in Simplified Chinese anyway
  // (root cause of the 2026-09-11 "0 candidates" bug — see that playbook's
  // header comment), dates show up as "YYYY年M月D日" instead. Parse that form
  // too rather than silently dropping every date.
  const cnRange = text.match(
    /(\d{4})年(\d{1,2})月(\d{1,2})日\s*[-－]\s*(\d{4})年(\d{1,2})月(\d{1,2})日/
  );
  if (cnRange) {
    return {
      firstSeen: toIsoFromYmd(cnRange[1], cnRange[2], cnRange[3]),
      lastSeen: toIsoFromYmd(cnRange[4], cnRange[5], cnRange[6]),
    };
  }
  const cnSingle = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (cnSingle) return { firstSeen: toIsoFromYmd(cnSingle[1], cnSingle[2], cnSingle[3]) };

  return {};
}

function toIso(value) {
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? undefined : new Date(ts).toISOString();
}

function toIsoFromYmd(year, month, day) {
  const ts = Date.UTC(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(ts) ? undefined : new Date(ts).toISOString();
}

/** Facebook wraps outbound links as l.facebook.com/l.php?u=<encoded>. */
export function unwrapFacebookLink(href) {
  if (!href) return undefined;
  try {
    const url = new URL(href);
    if (url.hostname.endsWith('facebook.com') && url.pathname === '/l.php') {
      const target = url.searchParams.get('u');
      if (target) return decodeURIComponent(target);
    }
    return href;
  } catch {
    return href;
  }
}

/** width/height → the aspect bucket the ranking gate understands. */
export function aspectFrom(width, height) {
  if (!width || !height) return undefined;
  const ratio = width / height;
  if (ratio < 0.62) return '9:16';
  if (ratio < 0.9) return '4:5';
  if (ratio < 1.15) return '1:1';
  return '16:9';
}
