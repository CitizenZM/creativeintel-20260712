import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { LIVE_STATUSES, overlayRuns } from "./live";
import { mirrorToTables, tablesOn } from "./tables";
import {
  BRAIN_KEYS, DEFAULT_POLICY, MAX_EVENTS, MAX_LEARNINGS, SNAPSHOT_MAX_BYTES, STALE_AFTER_SEC,
  type BrainEvent, type BrainLearning, type BrainPolicy, type BrainSnapshot, type BrainView,
} from "./contract";

async function read<T>(key: string, fallback: T): Promise<T> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  return (row?.value as T | undefined) ?? fallback;
}
async function write(key: string, value: unknown): Promise<void> {
  const v = value as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
}

/** newest first, de-duplicated by at+summary, capped */
export function mergeEvents(existing: BrainEvent[], incoming: BrainEvent[], max = MAX_EVENTS): BrainEvent[] {
  const seen = new Set<string>();
  const all = [...incoming, ...existing].filter((e) => {
    const k = `${e.at}|${e.summary}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return all.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, max);
}

/** learnings keyed by id; a later write of the same id replaces it (status promotion) */
export function mergeLearnings(existing: BrainLearning[], incoming: BrainLearning[], max = MAX_LEARNINGS): BrainLearning[] {
  const byId = new Map(existing.map((l) => [l.id, l]));
  for (const l of incoming) byId.set(l.id, { ...byId.get(l.id), ...l });
  return [...byId.values()].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, max);
}

export function viewOf(snapshot: BrainSnapshot | null, now = Date.now()): BrainView {
  if (!snapshot) return { snapshot: null, ageSec: null, stale: true };
  const ageSec = Math.max(0, Math.round((now - Date.parse(snapshot.at)) / 1000));
  return { snapshot, ageSec, stale: ageSec > STALE_AFTER_SEC };
}

export const getSnapshot = () => read<BrainSnapshot | null>(BRAIN_KEYS.snapshot, null);
export const getEvents = () => read<BrainEvent[]>(BRAIN_KEYS.events, []);
export const getLearnings = () => read<BrainLearning[]>(BRAIN_KEYS.learnings, []);
export const getPolicy = async (): Promise<BrainPolicy> => ({ ...DEFAULT_POLICY, ...(await read<Partial<BrainPolicy>>(BRAIN_KEYS.policy, {})) });

export async function getView(now = Date.now()): Promise<BrainView> {
  const [snap, events, learnings, runs] = await Promise.all([
    getSnapshot(), getEvents(), getLearnings(),
    // live overlay: active Ad Studio runs re-read on every request (the snapshot is up to 5 minutes old)
    prisma.adStudioRun.findMany({ where: { status: { in: [...LIVE_STATUSES] } }, orderBy: { updatedAt: "desc" }, take: 100, select: { id: true, projectId: true, status: true, step: true, progress: true, estUsd: true, actualUsd: true, hookType: true, engine: true, updatedAt: true } }).catch(() => null),
  ]);
  const v = viewOf(snap, now);
  if (v.snapshot) v.snapshot = { ...(runs ? overlayRuns(v.snapshot, runs, now) : v.snapshot), events: events.slice(0, 120), learnings };
  return v;
}

/** store a snapshot; events and learnings are merged into their own rows. Returns the stored sizes. */
export async function publish(snapshot: BrainSnapshot): Promise<{ bytes: number; events: number; learnings: number; tables: unknown }> {
  const { events = [], learnings = [], ...rest } = snapshot;
  const body = { ...rest, events: [], learnings: [] } as BrainSnapshot;
  const bytes = JSON.stringify(body).length;
  if (bytes > SNAPSHOT_MAX_BYTES) throw new Error(`brain snapshot ${bytes} bytes > ${SNAPSHOT_MAX_BYTES}`);
  const [ev, le] = await Promise.all([getEvents(), getLearnings()]);
  const mergedEvents = mergeEvents(ev, events);
  const mergedLearnings = mergeLearnings(le, learnings);
  await write(BRAIN_KEYS.snapshot, body);
  await write(BRAIN_KEYS.events, mergedEvents);
  await write(BRAIN_KEYS.learnings, mergedLearnings);
  let tables: Awaited<ReturnType<typeof mirrorToTables>> | { error: string } | null = null;
  if (tablesOn()) tables = await mirrorToTables(snapshot, events, learnings).catch((e: unknown) => { console.warn("[brain] table mirror failed:", e); return { error: e instanceof Error ? e.message : String(e) }; });
  return { bytes, events: mergedEvents.length, learnings: mergedLearnings.length, tables };
}

export async function addLearning(l: BrainLearning): Promise<BrainLearning[]> {
  const merged = mergeLearnings(await getLearnings(), [l]);
  await write(BRAIN_KEYS.learnings, merged);
  return merged;
}

export async function appendEvents(events: BrainEvent[]): Promise<void> {
  await write(BRAIN_KEYS.events, mergeEvents(await getEvents(), events));
}
