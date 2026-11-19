/**
 * Mirror the published brain snapshot into the Brain* tables (design §6) when BRAIN_TABLES=1, for queryable history.
 * The AppSetting rows stay the board's source; a failed mirror never fails the publish (it is logged and counted).
 */
import { prisma } from "@/lib/db";
import type { BrainEvent, BrainLearning, BrainSnapshot } from "./contract";

export const tablesOn = (env: Record<string, string | undefined> = process.env) => env.BRAIN_TABLES === "1";
const d = (s: string | null | undefined) => (s ? new Date(s) : null);
type Json = never;

export async function mirrorToTables(snap: BrainSnapshot, events: BrainEvent[], learnings: BrainLearning[]) {
  const counts = { loops: 0, checks: 0, incidents: 0, learnings: 0, events: 0 };
  for (const l of snap.loops) {
    const data = { name: l.name, brand: l.brand, step: l.step, stage: l.stage, status: l.status, agent: l.agent, doing: l.doing, nextAction: l.nextAction, nextCheckpointAt: new Date(l.nextCheckpointAt), verifyHow: l.verifyHow, waitingOn: l.waitingOn, idleSince: d(l.idleSince), runs: l.runs as Json, spendUsd7d: l.spendUsd7d, lastActivityAt: d(l.lastActivityAt) };
    await prisma.brainLoop.upsert({ where: { projectId: l.projectId }, create: { projectId: l.projectId, ...data }, update: data });
    counts.loops++;
  }
  for (const c of snap.checks) {
    const data = { projectId: c.projectId, at: new Date(c.at), renderedAt: d((c as { renderedAt?: string }).renderedAt), pass: c.pass, fields: c.fields as Json, critic: ((c as { critic?: unknown }).critic ?? undefined) as Json };
    await prisma.brainCheck.upsert({ where: { runId: c.runId }, create: { runId: c.runId, ...data }, update: data });
    counts.checks++;
  }
  for (const i of snap.incidents) {
    const data = { kind: i.kind, count: i.count, firstSeen: new Date(i.firstSeen), lastSeen: new Date(i.lastSeen), status: i.status, runbook: i.runbook, sample: i.sample, runs: i.runs as Json };
    await prisma.brainIncident.upsert({ where: { signature: i.signature }, create: { signature: i.signature, ...data }, update: data });
    counts.incidents++;
  }
  for (const l of learnings) {
    const data = { at: new Date(l.at), who: l.who, scope: l.scope, rule: l.rule, evidence: (l.evidence ?? []) as Json, status: l.status, promotedTo: l.promotedTo ?? null };
    await prisma.brainLearning.upsert({ where: { id: l.id }, create: { id: l.id, ...data }, update: data });
    counts.learnings++;
  }
  if (events.length) {
    const r = await prisma.brainEvent.createMany({ data: events.map((e) => ({ at: new Date(e.at), agent: e.agent, kind: e.kind, projectId: e.projectId ?? null, summary: e.summary, ref: e.ref ?? null })), skipDuplicates: true });
    counts.events = r.count;
  }
  return counts;
}
