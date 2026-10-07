"use client";

import { useState } from "react";
import { FileDown, FileText } from "lucide-react";
import { btn, Panel } from "./bits";
import { reportUrl } from "./view-model";

/** Client campaign report downloads (HTML / DOCX); the AI narrative is one budget-guarded text-model call. */
export function ReportsCard({ projectId }: { projectId: string }) {
  const [ai, setAi] = useState(false);
  return (
    <Panel
      icon={<FileText className="h-4 w-4" />}
      title="Client report"
      testId="reports-card"
      description="Campaign report for the client: deliverables, spend, test results and next actions."
      actions={
        <>
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground" title="Off: the deterministic summary (free). On: one text-model call writes the executive summary.">
            <input type="checkbox" checked={ai} onChange={(e) => setAi(e.target.checked)} /> AI narrative
          </label>
          <a href={reportUrl(projectId, "html", ai)} target="_blank" rel="noreferrer" className={btn}>
            <FileText className="h-3.5 w-3.5" /> HTML
          </a>
          <a href={reportUrl(projectId, "docx", ai)} className={btn}>
            <FileDown className="h-3.5 w-3.5" /> DOCX
          </a>
        </>
      }
    >
      <p className="text-[11px] text-muted-foreground">Generated on download from the latest data{ai ? " — the AI summary takes a few seconds." : "."}</p>
    </Panel>
  );
}
