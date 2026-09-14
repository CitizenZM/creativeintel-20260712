/**
 * Edit one generated script in place. Regenerating was previously the only way
 * to change a word, which threw away a script that was otherwise right — and
 * cost another model call.
 *
 * Only the human-facing copy is editable. The structured fields the studio
 * compiles from (template, videoType, beats) stay as generated, so an edit can
 * never leave a board pointing at something that no longer exists.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auditScriptText } from "@/lib/script-schema";
import { auditContext, formatComplianceViolations, loadScriptContext } from "../../_script-context";

export const maxDuration = 30;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projectId: string; scriptId: string }> }
) {
  const { projectId, scriptId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    title?: string;
    body?: string;
  };

  const existing = await prisma.script.findFirst({
    where: { id: scriptId, projectId },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Script not found" }, { status: 404 });

  const data: { title?: string; body?: string } = {};
  if (typeof body.title === "string" && body.title.trim()) data.title = body.title.trim().slice(0, 300);
  if (typeof body.body === "string" && body.body.trim()) data.body = body.body.trim();

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  // An edited script still has to clear the same compliance bar a generated
  // one does — it is reported, not rejected, since a human made the change.
  let complianceWarnings: string[] = [];
  if (data.body) {
    const ctx = await loadScriptContext(projectId).catch(() => null);
    if (ctx) {
      const audit = auditScriptText(data.body, auditContext(ctx));
      if (!audit.ok) complianceWarnings = formatComplianceViolations(audit.violations).split("\n");
    }
  }

  const script = await prisma.script.update({ where: { id: scriptId }, data });
  return NextResponse.json({ script, complianceWarnings });
}
