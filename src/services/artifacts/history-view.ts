/**
 * View model of the History tab: artifacts grouped by kind (in the archive's kind order), then by slot,
 * each slot's versions newest first; slots ordered by their latest activity. Pure.
 */
import { ARTIFACT_KINDS, ARTIFACT_KIND_LABELS, isArtifactKind } from "./kinds";

export interface HistoryItemLike {
  id: string;
  kind: string;
  sourceKey: string;
  version: number;
  createdAt: string;
  producedAt: string | null;
}

export interface HistorySlot<T extends HistoryItemLike> {
  sourceKey: string;
  latest: T;
  versions: T[];
  lastAt: string;
}

export interface HistoryGroup<T extends HistoryItemLike> {
  kind: string;
  label: string;
  count: number;
  slots: HistorySlot<T>[];
}

const when = (i: HistoryItemLike) => i.producedAt ?? i.createdAt;

export function groupHistory<T extends HistoryItemLike>(items: T[]): HistoryGroup<T>[] {
  const byKind = new Map<string, Map<string, T[]>>();
  for (const i of items) {
    const slots = byKind.get(i.kind) ?? new Map<string, T[]>();
    slots.set(i.sourceKey, [...(slots.get(i.sourceKey) ?? []), i]);
    byKind.set(i.kind, slots);
  }
  const order = (k: string) => (isArtifactKind(k) ? ARTIFACT_KINDS.indexOf(k) : ARTIFACT_KINDS.length);
  return [...byKind.entries()]
    .sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b))
    .map(([kind, slots]) => {
      const list = [...slots.entries()].map(([sourceKey, versions]) => {
        const sorted = [...versions].sort((a, b) => b.version - a.version);
        const lastAt = sorted.map(when).sort().at(-1) ?? sorted[0].createdAt;
        return { sourceKey, latest: sorted[0], versions: sorted, lastAt };
      });
      list.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
      return { kind, label: isArtifactKind(kind) ? ARTIFACT_KIND_LABELS[kind] : kind, count: list.reduce((n, s) => n + s.versions.length, 0), slots: list };
    });
}

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
