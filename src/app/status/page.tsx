import { prisma } from "@/lib/db";
import { Header } from "@/components/layout/header";
import { collectSources, type JobSourceStatus, type JobStep } from "@/services/research/job-progress";
import { getStorageStatus } from "@/services/storage";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const SOURCE_LABELS: Record<string, string> = {
  youtube_shorts: "YouTube Shorts",
  youtube_long: "YouTube (long-form)",
  meta_ad_library: "Meta Ad Library API",
  tiktok_cc: "TikTok Creative Center",
  tiktok_cc_for_you: "TikTok top ads (feed)",
  tiktok_organic: "TikTok organic",
  ig_reels: "Instagram Reels",
  ad_classifier: "Ad vs UGC classifier",
  meta_ad_library_browser: "Meta Ad Library (worker)",
  tiktok_ad_library_browser: "TikTok Ad Library (worker)",
  google_ads_transparency_browser: "Google Ads Transparency (worker)",
};

const STATUS_STYLE: Record<string, string> = {
  ran: "bg-[var(--status-healthy-bg)] text-[var(--status-healthy-fg)]",
  failed: "bg-[var(--status-urgent-bg)] text-[var(--status-urgent-fg)]",
  blocked: "bg-muted text-muted-foreground",
  skipped_no_key: "bg-muted text-muted-foreground",
  pending_worker: "bg-[var(--status-ai-bg)] text-[var(--status-ai-fg)]",
};

function Dot({ ok, warn }: { ok: boolean; warn?: boolean }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 rounded-full",
        ok ? "bg-[var(--status-healthy-fg)]" : warn ? "bg-[var(--status-attention-fg)]" : "bg-[var(--status-urgent-fg)]"
      )}
    />
  );
}

const STAMP = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function stamp(d: Date | null) {
  return d ? `${STAMP.format(d)} UTC` : "never";
}

export default async function StatusPage() {
  const [recentJobs, lastAdTask, lastFetchTask, queued, failedTasks, freshRows, recentFailedRows, beatRows] = await Promise.all([
    prisma.researchJob.findMany({
      where: { status: "complete" },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { steps: true, createdAt: true },
    }),
    prisma.workerTask.findFirst({
      where: { kind: "ad_library_fetch", completedAt: { not: null } },
      orderBy: { completedAt: "desc" },
      select: { completedAt: true },
    }),
    prisma.workerTask.findFirst({
      where: { kind: "browser_fetch", completedAt: { not: null } },
      orderBy: { completedAt: "desc" },
      select: { completedAt: true },
    }),
    prisma.workerTask.count({ where: { status: { in: ["queued", "claimed", "running"] } } }),
    prisma.workerTask.count({ where: { status: "failed" } }),
    // Freshness is decided by the database's clock — reading the process clock
    // during render is impure and the app's lint rules reject it.
    prisma.$queryRaw<{ fresh: bigint }[]>`
      SELECT count(*) AS fresh FROM "WorkerTask"
      WHERE "completedAt" > now() - interval '6 hours'
    `,
    prisma.$queryRaw<{ failed: bigint }[]>`
      SELECT count(*) AS failed FROM "WorkerTask"
      WHERE kind = 'ad_library_fetch' AND status = 'failed' AND "completedAt" > now() - interval '6 hours'
    `,
    // The worker records a heartbeat on every poll, so this is true liveness —
    // an idle worker with an empty queue still shows as online.
    prisma.$queryRaw<{ last: Date | null; online: boolean | null }[]>`
      SELECT max("lastSeenAt") AS last, max("lastSeenAt") > now() - interval '3 minutes' AS online
      FROM "WorkerHeartbeat"
    `,
  ]);
  const recentFailed = Number(recentFailedRows[0]?.failed ?? 0);

  // Roll every recent run's per-source outcome into one row per source, keeping
  // the most recent note so the page says why something is not working.
  const latest = new Map<string, JobSourceStatus>();
  for (const job of recentJobs) {
    for (const s of collectSources(job.steps as unknown as JobStep[] | null)) {
      if (!latest.has(s.name)) latest.set(s.name, s);
    }
  }
  // A run's report is a snapshot taken while worker tasks were still queued,
  // so reconcile "pending worker" rows against the live queue. An empty queue
  // only means the worker finished — if its recent tasks failed, the source
  // did not actually run.
  const sources = [...latest.values()]
    .map((s) =>
      s.status === "pending_worker" && queued === 0
        ? recentFailed > 0
          ? {
              ...s,
              status: "failed" as const,
              note: `the local worker finished, but ${recentFailed} ad-library task${recentFailed === 1 ? "" : "s"} failed in the last 6 hours — check the worker log`,
            }
          : {
              ...s,
              status: "ran" as const,
              note: "the local worker has since drained the queue — re-run research to pull its results into the report",
            }
        : s
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  const storage = getStorageStatus();
  const workerSeen = [lastAdTask?.completedAt ?? null, lastFetchTask?.completedAt ?? null]
    .filter(Boolean)
    .sort((a, b) => (b as Date).getTime() - (a as Date).getTime())[0] as Date | null;
  const workerOnline = !!beatRows?.[0]?.online;
  const lastPolled = beatRows?.[0]?.last ?? null;
  const workerFresh = workerOnline || Number(freshRows?.[0]?.fresh ?? 0) > 0;

  const env = [
    ["OPENAI_API_KEY", !!process.env.OPENAI_API_KEY, "Primary LLM + image model"],
    ["GEMINI_API_KEY / GOOGLE_API_KEY", !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY), "Gemini fallback (what claude-client.ts actually reads)"],
    ["OPENROUTER_API_KEY", !!process.env.OPENROUTER_API_KEY, "Last-resort LLM fallback"],
    ["META_ACCESS_TOKEN", !!process.env.META_ACCESS_TOKEN, "Meta Ad Library API source"],
    ["YOUTUBE_API_KEY", !!process.env.YOUTUBE_API_KEY, "YouTube search (HTML fallback works without it)"],
    ["FAL_KEY", !!process.env.FAL_KEY, "Storyboard frame images"],
    ["WORKER_TOKEN", !!process.env.WORKER_TOKEN, "Local worker authentication"],
  ] as const;

  return (
    <div>
      <Header title="System status" description="Where the data actually comes from, and what is currently working." />
      <div className="px-4 py-6 sm:px-6 lg:px-8 max-w-5xl mx-auto space-y-8">
        <section className="space-y-2">
          <h2 className="text-sm font-semibold tracking-tight">Local workers</h2>
          <div className="rounded-lg border border-border divide-y divide-border text-sm">
            <div className="flex items-center justify-between gap-3 px-3 py-2.5">
              <span className="flex items-center gap-2">
                <Dot ok={workerOnline} warn={!workerOnline && (workerFresh || !!lastPolled)} />
                Research worker (ego-browser on the operator&apos;s Mac)
              </span>
              <span className="text-xs text-muted-foreground">
                {workerOnline ? "online" : `last polled ${stamp(lastPolled)}`} · last completed a task {stamp(workerSeen)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 px-3 py-2.5">
              <span className="flex items-center gap-2">
                <Dot ok={queued === 0} warn={queued > 0} />
                Task queue
              </span>
              <span className="text-xs text-muted-foreground">
                {queued} waiting · {failedTasks} failed all attempts
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 px-3 py-2.5">
              <span className="flex items-center gap-2">
                <Dot ok={storage.configured} />
                Asset storage
              </span>
              <span className="text-xs text-muted-foreground">{storage.provider}</span>
            </div>
          </div>
          {!workerOnline && (
            <p className="text-[11px] text-muted-foreground">
              The worker is not polling right now. Ad-library sources stay pending and blocked pages are skipped until it runs —
              start it with <code className="font-mono">launchctl load ~/Library/LaunchAgents/com.creativeintel.research-worker.plist</code>.
            </p>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold tracking-tight">Research sources</h2>
          <p className="text-[11px] text-muted-foreground">
            Most recent outcome for each source across the last {recentJobs.length} completed runs.
          </p>
          {sources.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">
              No completed research runs yet.
            </div>
          ) : (
            <ul className="rounded-lg border border-border divide-y divide-border">
              {sources.map((s) => (
                <li key={s.name} className="flex items-start justify-between gap-4 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{SOURCE_LABELS[s.name] ?? s.name}</p>
                    {s.note && (
                      <p className="mt-0.5 text-[11px] text-muted-foreground break-words">{s.note}</p>
                    )}
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap",
                      STATUS_STYLE[s.status] ?? "bg-muted text-muted-foreground"
                    )}
                  >
                    {s.status.replace(/_/g, " ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold tracking-tight">Credentials</h2>
          <ul className="rounded-lg border border-border divide-y divide-border">
            {env.map(([name, present, why]) => (
              <li key={name} className="flex items-center justify-between gap-4 px-3 py-2">
                <span className="flex items-center gap-2 text-sm">
                  <Dot ok={present} />
                  <code className="font-mono text-xs">{name}</code>
                </span>
                <span className="text-[11px] text-muted-foreground text-right">{why}</span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted-foreground">
            Present only means the variable is set — a key can still be rejected at call time.
          </p>
        </section>
      </div>
    </div>
  );
}
