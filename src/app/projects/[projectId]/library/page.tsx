import Link from "next/link";
import { prisma } from "@/lib/db";
import { Star, Archive, CheckCircle2, Film, Layout, FileText, Wand2, History } from "lucide-react";
import { RestoreButton } from "@/components/library/restore-button";
import { getScriptTemplate } from "@/services/ai/prompts/script-templates";
import { formatDuration } from "@/lib/format-duration";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

function fmt(d: Date | null | undefined) {
  return d
    ? d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "—";
}

function Section({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold tracking-tight flex items-center gap-2">
        <Icon className="h-4 w-4" /> {title}
        <span className="text-xs font-normal text-muted-foreground num">({count})</span>
      </h3>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground rounded-lg border border-dashed border-border p-4">{children}</p>;
}

/**
 * Everything this project has generated, in one place: every angle batch,
 * script, storyboard version and render, with what was picked and what was
 * archived (restorable). This is where saved work is found again.
 */
export default async function LibraryPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ archived?: string }>;
}) {
  const { projectId } = await params;
  const { archived } = await searchParams;
  const showArchived = archived === "1";
  const where = showArchived ? { projectId } : { projectId, deletedAt: null };

  const [angles, scripts, storyboards, runs, jobs] = await Promise.all([
    prisma.angle.findMany({ where, orderBy: { createdAt: "desc" } }),
    prisma.script.findMany({ where, orderBy: { createdAt: "desc" } }),
    prisma.storyboard.findMany({
      where,
      orderBy: [{ version: "desc" }],
      select: { id: true, title: true, scriptId: true, version: true, isActive: true, deletedAt: true, frames: true, createdAt: true },
    }),
    prisma.libtvRun.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, status: true, createdAt: true, masterMp4Url: true, storyboardId: true },
    }),
    prisma.job.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 15 }),
  ]);

  const scriptTitle = new Map(scripts.map((s) => [s.id, s.title]));
  const batches = new Map<string, typeof angles>();
  for (const a of angles) batches.set(a.batchId, [...(batches.get(a.batchId) ?? []), a]);
  const boardGroups = new Map<string, typeof storyboards>();
  for (const b of storyboards) {
    const key = b.scriptId ?? b.id;
    boardGroups.set(key, [...(boardGroups.get(key) ?? []), b]);
  }
  const boardById = new Map(storyboards.map((b) => [b.id, b]));
  const base = `/projects/${projectId}`;

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Project library</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Every version generated for this project is saved here — angles, scripts, storyboards and renders.
            Picked items are marked; archived items can be restored.
          </p>
        </div>
        <Link
          href={showArchived ? `${base}/library` : `${base}/library?archived=1`}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
        >
          <Archive className="h-3.5 w-3.5" />
          {showArchived ? "Hide archived" : "Show archived"}
        </Link>
      </div>

      <Section icon={Wand2} title="Angles" count={angles.length}>
        {batches.size === 0 ? (
          <Empty>No angles yet — generate them on the Creative page.</Empty>
        ) : (
          <div className="space-y-3">
            {[...batches.values()].map((batch) => (
              <div key={batch[0].batchId} className="rounded-lg border border-border bg-card p-3 space-y-1.5">
                <p className="text-[11px] text-muted-foreground">Generated {fmt(batch[0].createdAt)} · {batch.length} angles</p>
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1">
                  {batch.map((a) => (
                    <li key={a.id} className={cn("flex items-center gap-2 text-xs", a.deletedAt && "opacity-50")}>
                      {a.status === "selected" ? (
                        <Star className="h-3 w-3 shrink-0 fill-foreground" aria-label="Starred" />
                      ) : (
                        <span className="w-3 shrink-0" />
                      )}
                      <span className="min-w-0 truncate">{a.title}</span>
                      <span className="num text-muted-foreground shrink-0">{a.predictedScore ?? "—"}</span>
                      {a.deletedAt && <RestoreButton url={`/api/projects/${projectId}/creative/angles/${a.id}`} />}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section icon={FileText} title="Scripts" count={scripts.length}>
        {scripts.length === 0 ? (
          <Empty>No scripts yet.</Empty>
        ) : (
          <div className="rounded-lg border border-border bg-card divide-y divide-border">
            {scripts.map((s) => (
              <div key={s.id} className={cn("flex items-center gap-3 px-3 py-2 text-xs", s.deletedAt && "opacity-50")}>
                {s.status === "selected" ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--status-healthy-fg)]" aria-label="Selected" />
                ) : (
                  <span className="w-3.5 shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate font-medium">{s.title}</span>
                <span className="hidden sm:inline text-muted-foreground shrink-0">
                  {getScriptTemplate(s.template)?.name ?? s.template ?? s.format}
                </span>
                <span className="text-muted-foreground shrink-0">{fmt(s.createdAt)}</span>
                {s.deletedAt ? (
                  <RestoreButton url={`/api/projects/${projectId}/creative/scripts/${s.id}`} />
                ) : (
                  <Link href={`${base}/creative`} className="shrink-0 text-muted-foreground hover:text-foreground">
                    Open
                  </Link>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section icon={Layout} title="Storyboards" count={storyboards.length}>
        {boardGroups.size === 0 ? (
          <Empty>No storyboards yet.</Empty>
        ) : (
          <div className="space-y-2">
            {[...boardGroups.entries()].map(([key, versions]) => (
              <div key={key} className="rounded-lg border border-border bg-card p-3 space-y-1.5">
                <p className="text-xs font-medium">{scriptTitle.get(key) ?? versions[0].title}</p>
                <ul className="space-y-1">
                  {versions.map((v) => {
                    const frames = Array.isArray(v.frames) ? (v.frames as { approved?: boolean | null }[]) : [];
                    const approved = frames.filter((f) => f.approved === true).length;
                    return (
                      <li key={v.id} className={cn("flex items-center gap-3 text-xs", v.deletedAt && "opacity-50")}>
                        <span className={cn("rounded px-1.5 py-0.5 font-semibold border", v.isActive && !v.deletedAt ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground")}>
                          v{v.version}
                        </span>
                        <span className="text-muted-foreground num">
                          {approved}/{frames.length} frames approved
                        </span>
                        {v.isActive && !v.deletedAt && <span className="text-[11px] text-muted-foreground">active — used by Studio</span>}
                        <span className="ml-auto text-muted-foreground">{fmt(v.createdAt)}</span>
                        {v.deletedAt ? (
                          <RestoreButton url={`/api/projects/${projectId}/creative/storyboards/${v.id}`} />
                        ) : (
                          <Link href={`${base}/studio?storyboardId=${v.id}`} className="text-muted-foreground hover:text-foreground">
                            Studio
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section icon={Film} title="Renders" count={runs.length}>
        {runs.length === 0 ? (
          <Empty>No Studio runs yet.</Empty>
        ) : (
          <div className="rounded-lg border border-border bg-card divide-y divide-border">
            {runs.map((r) => {
              const board = r.storyboardId ? boardById.get(r.storyboardId) : undefined;
              return (
                <div key={r.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                  <span className="font-medium capitalize">{r.status.replace("_", " ")}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {board ? `${board.title} · v${board.version}` : "Storyboard"}
                  </span>
                  <span className="text-muted-foreground">{fmt(r.createdAt)}</span>
                  {r.masterMp4Url ? (
                    <a href={r.masterMp4Url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                      Master MP4
                    </a>
                  ) : (
                    <Link href={`${base}/studio`} className="text-muted-foreground hover:text-foreground">
                      Studio
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section icon={History} title="Recent AI jobs" count={jobs.length}>
        {jobs.length === 0 ? (
          <Empty>No background jobs yet.</Empty>
        ) : (
          <div className="rounded-lg border border-border bg-card divide-y divide-border">
            {jobs.map((j) => {
              const secs = j.startedAt && j.completedAt ? (j.completedAt.getTime() - j.startedAt.getTime()) / 1000 : null;
              return (
                <div key={j.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                  <span className="font-medium capitalize w-24 shrink-0">{j.kind}</span>
                  <span className="capitalize text-muted-foreground w-20 shrink-0">{j.status}</span>
                  <span className="num text-muted-foreground">
                    {j.kind === "analysis" ? `${j.done}%` : `${j.done}/${j.total} done${j.failed ? ` · ${j.failed} failed` : ""}`}
                  </span>
                  <span className="ml-auto text-muted-foreground">
                    {fmt(j.createdAt)}
                    {secs != null ? ` · ${formatDuration(secs)}` : ""}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}
