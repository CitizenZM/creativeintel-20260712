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
import { LIVE, isSelectionStatus } from "@/services/creative-library";

export const maxDuration = 30;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projectId: string; scriptId: string }> }
) {
  const { projectId, scriptId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    title?: string;
    body?: string;
    status?: unknown;
  };

  const existing = await prisma.script.findFirst({
    where: { id: scriptId, projectId, ...LIVE },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Script not found" }, { status: 404 });

  const data: { title?: string; body?: string; status?: string } = {};
  if (typeof body.title === "string" && body.title.trim()) data.title = body.title.trim().slice(0, 300);
  if (typeof body.body === "string" && body.body.trim()) data.body = body.body.trim();
  if (body.status !== undefined) {
    if (!isSelectionStatus(body.status)) {
      return NextResponse.json({ error: "status must be draft or selected" }, { status: 400 });
    }
    data.status = body.status;
  }

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

/**
 * Archive a script. Its storyboards stay (a rendered run may point at them)
 * but drop out of the lists along with it.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; scriptId: string }> }
) {
  const { projectId, scriptId } = await params;
  const now = new Date();
  const [scripts] = await prisma.$transaction([
    prisma.script.updateMany({
      where: { id: scriptId, projectId, ...LIVE },
      data: { deletedAt: now, status: "draft" },
    }),
    prisma.storyboard.updateMany({
      where: { projectId, scriptId, ...LIVE },
      data: { deletedAt: now, isActive: false },
    }),
  ]);
  if (!scripts.count) return NextResponse.json({ error: "Script not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
