"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, Brain, CheckCircle2, Eye, GraduationCap, Hourglass, PhoneCall, Wrench, XCircle, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { LOOP_STAGES, PROJECT_STEPS, type BrainEvent, type BrainTask, type BrainView } from "@/services/brain/contract";
import {
  EVENT_TONE, LOOP_STATUS_LABEL, STAGE_LABEL, STEP_LABEL, TONE_CLASS, ageLabel, groupPatterns, learningTone, loopTone, pct,
  relTime, sortEvents, sortLoops, staleMessage, taskTone, usd, type Tone,
  projectHref,
} from "./brain-format";
import { brainFixture } from "./fixture";

const POLL_MS = 10_000;

function Chip({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium", TONE_CLASS[tone])}>
      {children}
    </span>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="min-w-0 space-y-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
        {title}
        {count != null && <span className="text-xs font-normal text-muted-foreground">{count}</span>}
      </h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">{children}</div>;
}

const EVENT_ICON: Record<BrainEvent["kind"], typeof Brain> = {
  think: Brain, decide: Zap, call: PhoneCall, check: Eye, learn: GraduationCap, fix: Wrench, wait: Hourglass,
};

function TaskRow({ task, now, children }: { task: BrainTask; now: number; children?: ReactNode }) {
  return (
    <li className="space-y-1.5 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 break-words text-sm font-medium">{task.title}</span>
        <Chip tone={taskTone(task.status)}>{task.status}</Chip>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <span>{task.kind}</span>
        <span>agent {task.agent}</span>
        {task.step && <span>step {task.step}</span>}
        <span>est {usd(task.estUsd)} · actual {usd(task.actualUsd)}</span>
        <span>{relTime(task.updatedAt, now)}</span>
      </div>
      {children}
    </li>
  );
}

export function BrainBoard() {
  const [view, setView] = useState<BrainView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fixture, setFixture] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/brain", { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setView((await res.json()) as BrainView);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err)); // keep the last data
    } finally {
      setNow(Date.now());
    }
  }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("fixture") === "1") {
      queueMicrotask(() => {
        setFixture(true);
        setView(brainFixture());
      });
      return;
    }
    const first = window.setTimeout(() => void load(), 0);
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const snap = view?.snapshot ?? null;
  const stale = view ? staleMessage(view) : null;

  return (
    <div className="space-y-8">
      {fixture && <Chip tone="ai">示例数据 fixture</Chip>}
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--status-urgent-fg)]/30 bg-[var(--status-urgent-bg)] p-3 text-sm text-[var(--status-urgent-fg)] break-words">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> 读取失败 (fetch failed): {error}
          {view && " — showing last data"}
        </div>
      )}
      {stale && (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--status-attention-fg)]/30 bg-[var(--status-attention-bg)] p-3 text-sm font-medium text-[var(--status-attention-fg)]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {stale}
        </div>
      )}
      {!view && !error && <Empty>加载中 Loading…</Empty>}

      {snap && (
        <>
          {/* a. top strip */}
          <section className="space-y-3">
            <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              {LOOP_STAGES.map((s, i) => (
                <li key={s} className="relative rounded-lg border border-border p-3">
                  <div className="text-[11px] text-muted-foreground">
                    {i + 1}. {STAGE_LABEL[s]}
                  </div>
                  <div className="text-2xl font-semibold tabular-nums">{snap.stageCounts[s] ?? 0}</div>
                </li>
              ))}
            </ol>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <Stat label="今日花费 Spend today">
                {usd(snap.spend.todayUsd)} <span className="text-xs text-muted-foreground">/ cap {usd(snap.spend.capUsd)}</span>
                <Bar budget value={snap.spend.capUsd > 0 ? (snap.spend.todayUsd / snap.spend.capUsd) * 100 : 0} />
                <div className="text-xs text-muted-foreground">自动批准 auto-approved {usd(snap.spend.autoApprovedTodayUsd)}</div>
              </Stat>
              <Stat label="Mac worker 心跳 heartbeat">
                <Chip tone={snap.worker.ok ? "healthy" : "urgent"}>{snap.worker.ok ? "ok" : "down"}</Chip>{" "}
                <span className="text-xs text-muted-foreground">{relTime(snap.worker.lastSeenAt, now)}</span>
              </Stat>
              <Stat label="能力体检 Probes">
                <span className="text-[var(--status-healthy-fg)]">{snap.probes.filter((p) => p.ok).length} green</span>
                {" · "}
                <span className="text-[var(--status-urgent-fg)]">{snap.probes.filter((p) => !p.ok).length} red</span>
              </Stat>
              <Stat label="快照 Snapshot">
                {ageLabel(view?.ageSec)} ago <span className="text-xs text-muted-foreground">· {snap.host}</span>
              </Stat>
            </div>
          </section>

          {/* b. project lanes */}
          <Section title="项目泳道 (Project lanes)" count={snap.loops.length}>
            {snap.loops.length === 0 ? (
              <Empty>没有项目循环 No project loops.</Empty>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {sortLoops(snap.loops).map((l) => (
                  <li key={l.projectId} className="space-y-2 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <ProjectName id={l.projectId} name={l.name} />
                      {l.brand && <span className="text-xs text-muted-foreground">{l.brand}</span>}
                      <Chip tone="muted" title={`step ${PROJECT_STEPS.indexOf(l.step) + 1}/${PROJECT_STEPS.length}`}>
                        {STEP_LABEL[l.step] ?? l.step}
                      </Chip>
                      <Chip tone="ai">{STAGE_LABEL[l.stage] ?? l.stage}</Chip>
                      <Chip tone={loopTone(l.status)}>
                        {LOOP_STATUS_LABEL[l.status]}
                        {l.status === "waiting" && l.waitingOn ? ` · ${l.waitingOn}` : ""}
                        {l.status === "idle-defect" && l.idleSince ? ` · ${relTime(l.idleSince, now)}` : ""}
                      </Chip>
                    </div>
                    <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                      <Field k="正在做 Doing">{l.doing}</Field>
                      <Field k="下一步 Next">{l.nextAction}</Field>
                      <Field k="检查点 Checkpoint">
                        {relTime(l.nextCheckpointAt, now)} — {l.verifyHow}
                      </Field>
                      <Field k="负责 Agent">{l.agent}</Field>
                      <Field k="运行 Runs">
                        {l.runs.active} active · {l.runs.awaiting} awaiting · {l.runs.done} done · {l.runs.failed} failed
                      </Field>
                      <Field k="7天花费 Spend 7d">{usd(l.spendUsd7d)}</Field>
                    </dl>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <div className="grid gap-8 md:grid-cols-2">
            {/* c. queue */}
            <Section title="闸栏/队列 (Gate / queue)" count={snap.queue.length}>
              {snap.queue.length === 0 ? (
                <Empty>队列为空 Queue empty.</Empty>
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {snap.queue.map((t) => (
                    <TaskRow key={t.id} task={t} now={now}>
                      {t.gates.length > 0 && (
                        <details className="text-xs">
                          <summary className="flex cursor-pointer flex-wrap gap-1">
                            {t.gates.map((g) => (
                              <Chip key={g.gate} tone={g.pass ? "healthy" : "urgent"} title={g.detail}>
                                {g.pass ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                                {g.gate}
                              </Chip>
                            ))}
                          </summary>
                          <ul className="mt-1.5 space-y-0.5 text-muted-foreground">
                            {t.gates.map((g) => (
                              <li key={g.gate} className="break-words">
                                <span className="font-medium text-foreground">{g.gate}</span>: {g.detail}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </TaskRow>
                  ))}
                </ul>
              )}
            </Section>

            {/* d. executing */}
            <Section title="执行中 (Executing)" count={snap.executing.length}>
              {snap.executing.length === 0 ? (
                <Empty>没有执行中的任务 Nothing executing.</Empty>
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {snap.executing.map((t) => (
                    <TaskRow key={t.id} task={t} now={now}>
                      <Bar value={pct(t.progress)} label={`${pct(t.progress)}%`} />
                    </TaskRow>
                  ))}
                </ul>
              )}
            </Section>
          </div>

          {/* e. checks */}
          <Section title="二次复查 (Verify checks)" count={snap.checks.length}>
            {snap.checks.length === 0 ? (
              <Empty>暂无复查 No checks yet.</Empty>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {snap.checks.map((c) => (
                  <li key={`${c.runId}-${c.at}`} className="p-3">
                    <details>
                      <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                        <Chip tone={c.pass ? "healthy" : "urgent"}>{c.pass ? "pass" : "fail"}</Chip>
                        <span className="font-mono text-xs">{c.runId}</span>
                        <span className="text-xs text-muted-foreground">
                          {c.fields.filter((f) => f.pass).length}/{c.fields.length} fields · {relTime(c.at, now)}
                        </span>
                      </summary>
                      <div className="mt-2 overflow-x-auto rounded-md border border-border">
                        <table className="w-full min-w-[520px] text-xs">
                          <thead className="text-muted-foreground">
                            <tr className="border-b border-border text-left">
                              <th className="px-2 py-1.5 font-medium">字段 Field</th>
                              <th className="px-2 py-1.5 font-medium">期望 Expected</th>
                              <th className="px-2 py-1.5 font-medium">实际 Actual</th>
                              <th className="px-2 py-1.5 font-medium">Pass</th>
                              <th className="px-2 py-1.5 font-medium">来源 Source</th>
                            </tr>
                          </thead>
                          <tbody>
                            {c.fields.map((f) => (
                              <tr key={f.field} className="border-b border-border last:border-0">
                                <td className="px-2 py-1.5 font-medium">{f.field}</td>
                                <td className="px-2 py-1.5">{f.expected}</td>
                                <td className="px-2 py-1.5">{f.actual}</td>
                                <td className="px-2 py-1.5">
                                  <Chip tone={f.pass ? "healthy" : "urgent"}>{f.pass ? "✓" : "✗"}</Chip>
                                </td>
                                <td className="px-2 py-1.5 text-muted-foreground">{f.source}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* f. recovery */}
          <Section title="恢复跟进 (Recovery)" count={snap.recovery.length}>
            {snap.recovery.length === 0 ? (
              <Empty>无需恢复 Nothing to recover.</Empty>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {snap.recovery.map((t) => (
                  <TaskRow key={t.id} task={t} now={now} />
                ))}
              </ul>
            )}
          </Section>

          {/* g. events */}
          <Section title="大脑思考流 (Thinking stream)" count={snap.events.length}>
            {snap.events.length === 0 ? (
              <Empty>暂无事件 No events yet.</Empty>
            ) : (
              <ul className="max-h-[480px] divide-y divide-border overflow-y-auto rounded-lg border border-border">
                {sortEvents(snap.events).map((e, i) => {
                  const Icon = EVENT_ICON[e.kind] ?? Brain;
                  return (
                    <li key={`${e.at}-${i}`} className="flex items-start gap-2.5 px-3 py-2 text-sm">
                      <span className={cn("mt-0.5 rounded-md p-1", TONE_CLASS[EVENT_TONE[e.kind] ?? "muted"])}>
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="break-words">{e.summary}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {relTime(e.at, now)} · {e.agent} · {e.kind}
                          {e.ref ? ` · ${e.ref}` : ""}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          {/* h. learnings */}
          <Section title="学习日志 (Learnings)" count={snap.learnings.length}>
            {snap.learnings.length === 0 ? (
              <Empty>暂无学习 No learnings yet.</Empty>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {snap.learnings.map((l) => (
                  <li key={l.id} className="space-y-1 p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip tone={learningTone(l.status)}>{l.status}</Chip>
                      <span className="font-mono text-xs text-muted-foreground">{l.scope}</span>
                    </div>
                    <div className="break-words">{l.rule}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {l.evidence.length} evidence · {l.who} · {relTime(l.at, now)}
                      {l.promotedTo ? ` · → ${l.promotedTo}` : ""}
                      {l.syncedTo?.length ? ` · synced ${l.syncedTo.join(", ")}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* i. incidents + patterns + probes */}
          <div className="grid gap-8 md:grid-cols-3">
            <Section title="故障 (Incidents)" count={snap.incidents.length}>
              {snap.incidents.length === 0 ? (
                <Empty>无故障 No incidents.</Empty>
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {snap.incidents.map((x) => (
                    <li key={x.signature} className="space-y-1 p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Chip tone={x.status === "resolved" ? "healthy" : "urgent"}>{x.status}</Chip>
                        <span className="break-all font-mono text-xs">{x.signature}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {x.kind} · ×{x.count} · last {relTime(x.lastSeen, now)}
                      </div>
                      <div className="break-words text-xs">{x.sample}</div>
                      <div className="break-words text-xs text-muted-foreground">Runbook: {x.runbook}</div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="模式推广 (Patterns)" count={snap.patterns.length}>
              {snap.patterns.length === 0 ? (
                <Empty>无模式命中 No pattern hits.</Empty>
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {groupPatterns(snap.patterns).map((g) => (
                    <li key={g.pattern} className="p-3 text-sm">
                      <details>
                        <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                          <span className="min-w-0 break-words font-medium">{g.pattern}</span>
                          <Chip tone={g.open > 0 ? "urgent" : "muted"}>{g.open} open</Chip>
                          <Chip tone="healthy">{g.fixed} fixed</Chip>
                        </summary>
                        <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                          {g.hits.map((h) => (
                            <li key={`${h.file}:${h.line}`} className="break-all">
                              {h.status === "open" ? "○" : "●"} {h.file}:{h.line} <span className="opacity-70">(fix {h.fixedIn})</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="能力体检 (Probes)" count={snap.probes.length}>
              {snap.probes.length === 0 ? (
                <Empty>暂无体检 No probes yet.</Empty>
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {snap.probes.map((p) => (
                    <li key={p.name} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", p.ok ? "bg-[var(--status-healthy-fg)]" : "bg-[var(--status-urgent-fg)]")} />
                      <span className="font-medium">{p.name}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={p.detail}>
                        {p.detail}
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{relTime(p.at, now)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1 rounded-lg border border-border p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{children}</div>
    </div>
  );
}

function Field({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="inline text-muted-foreground">{k}: </dt>
      <dd className="inline break-words">{children}</dd>
    </div>
  );
}

function Bar({ value, label, budget }: { value: number; label?: string; budget?: boolean }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", budget && v >= 90 ? "bg-[var(--status-urgent-fg)]" : "bg-[var(--status-ai-fg)]")}
          style={{ width: `${v}%` }}
        />
      </div>
      {label && <span className="text-[11px] tabular-nums text-muted-foreground">{label}</span>}
    </div>
  );
}

/** a loop's name: a link to the project page for server projects, plain text for local/batch jobs (no page) */
function ProjectName({ id, name }: { id: string; name: string }) {
  const href = projectHref(id);
  if (!href) return <span className="min-w-0 break-words font-medium">{name}</span>;
  return (
    <Link href={href} className="min-w-0 break-words font-medium hover:underline">
      {name}
    </Link>
  );
}
