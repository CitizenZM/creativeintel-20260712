"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Brain, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useJob } from "@/components/jobs/use-job";
import { JobProgress } from "@/components/jobs/job-progress";
import { cn } from "@/lib/utils";
import type { JobView } from "@/services/jobs";

// A background run stops at the function's time limit; resume automatically
// while it keeps making progress so nobody has to babysit the button.
const MAX_AUTO_RESUMES = 3;

/**
 * Re-analyze as a background job: live stage checklist, percent and ETA,
 * survives a reload, and refreshes the page's data when it finishes.
 */
export function AnalysisRunner({ projectId, attention }: { projectId: string; attention?: boolean }) {
  const router = useRouter();
  const resumes = useRef(0);
  const lastPercent = useRef(0);
  const [resumeTick, setResumeTick] = useState(0);

  const url = `/api/projects/${projectId}/insights/reanalyze`;
  const analysis = useJob(projectId, "analysis", (job: JobView) => {
    router.refresh();
    const progressed = job.percent > lastPercent.current;
    lastPercent.current = job.percent;
    if (job.result?.partial && progressed && resumes.current < MAX_AUTO_RESUMES) {
      resumes.current += 1;
      setResumeTick((n) => n + 1);
    }
  });

  const { start } = analysis;
  // Resuming a partial run always proceeds — the server's "nothing changed"
  // check is for fresh clicks, not for finishing work already under way.
  useEffect(() => {
    if (resumeTick > 0) void start(url, { force: true }).catch(() => {});
  }, [resumeTick, start, url]);

  const [notice, setNotice] = useState<string | null>(null);

  function run(force = false) {
    resumes.current = 0;
    lastPercent.current = 0;
    setNotice(null);
    void analysis.start(url, force ? { force: true } : {}).catch((err: unknown) => {
      setNotice(err instanceof Error ? err.message : "Could not start the analysis");
    });
  }

  return (
    <>
      <Button
        onClick={() => run()}
        disabled={analysis.running}
        variant="outline"
        size="sm"
        className={cn("h-8 rounded-md text-xs", attention && !analysis.running && "cta-attention")}
      >
        {analysis.running ? (
          <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
        ) : (
          <Brain className="mr-1.5 h-3 w-3" />
        )}
        {analysis.running ? "Analyzing…" : "Re-analyze"}
      </Button>
      {notice && !analysis.running && (
        <p className="basis-full text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
          {notice}
          {notice.startsWith("Nothing has changed") && (
            <button
              type="button"
              onClick={() => run(true)}
              className="font-medium text-foreground underline underline-offset-2"
            >
              Re-analyze anyway
            </button>
          )}
        </p>
      )}
      {analysis.job && (
        <JobProgress
          className="basis-full"
          job={analysis.job}
          title="Analyzing competitor ads"
          onCancel={analysis.cancel}
          onRetry={() => run(true)}
          onDismiss={analysis.dismiss}
        />
      )}
    </>
  );
}
