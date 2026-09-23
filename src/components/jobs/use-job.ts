"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { JobView } from "@/services/jobs";

const POLL_MS = 2000;
const TERMINAL = ["completed", "failed", "cancelled"];

export function isTerminal(job: JobView | null): boolean {
  return !!job && TERMINAL.includes(job.status);
}

/**
 * Tracks one kind of background job for a project. On mount it picks up a job
 * that is still running (so a reload keeps the progress bar); `start` posts to
 * a route in background mode and resolves once the job finishes.
 */
export function useJob(
  projectId: string,
  kind: JobView["kind"],
  onFinished?: (job: JobView) => void
) {
  const [job, setJob] = useState<JobView | null>(null);
  const finishedRef = useRef(onFinished);
  useEffect(() => {
    finishedRef.current = onFinished;
  }, [onFinished]);
  const waiters = useRef<((job: JobView) => void)[]>([]);
  const pollingId = useRef<string | null>(null);
  const alive = useRef(true);

  const poll = useCallback(
    async (jobId: string) => {
      if (pollingId.current === jobId) return;
      pollingId.current = jobId;
      while (alive.current && pollingId.current === jobId) {
        const data = await fetch(`/api/projects/${projectId}/jobs/${jobId}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        const next: JobView | null = data?.job ?? null;
        if (next) {
          setJob(next);
          if (isTerminal(next)) {
            pollingId.current = null;
            finishedRef.current?.(next);
            for (const w of waiters.current.splice(0)) w(next);
            return;
          }
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    },
    [projectId]
  );

  useEffect(() => {
    alive.current = true;
    fetch(`/api/projects/${projectId}/jobs?kind=${kind}&active=1`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.job && alive.current) {
          setJob(data.job);
          void poll(data.job.id);
        }
      })
      .catch(() => {});
    return () => {
      alive.current = false;
      pollingId.current = null;
    };
  }, [projectId, kind, poll]);

  /** Start a job; resolves with the finished job (or rejects if it never started). */
  const start = useCallback(
    async (url: string, body: Record<string, unknown> = {}): Promise<JobView> => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, background: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.jobId) throw new Error(data.error || `Could not start (${res.status})`);
      const finished = new Promise<JobView>((resolve) => waiters.current.push(resolve));
      setJob({
        id: data.jobId,
        kind,
        status: "queued",
        total: data.requested ?? 0,
        done: 0,
        failed: 0,
        percent: 0,
        currentStep: null,
        steps: [],
        result: null,
        error: null,
        etaSeconds: null,
        elapsedSeconds: null,
        createdAt: new Date().toISOString(),
        completedAt: null,
      });
      void poll(data.jobId);
      return finished;
    },
    [kind, poll]
  );

  const cancel = useCallback(async () => {
    if (!job) return;
    await fetch(`/api/projects/${projectId}/jobs/${job.id}/cancel`, { method: "POST" }).catch(() => {});
  }, [job, projectId]);

  const dismiss = useCallback(() => setJob(null), []);

  const running = !!job && !isTerminal(job);
  return { job, running, start, cancel, dismiss };
}
