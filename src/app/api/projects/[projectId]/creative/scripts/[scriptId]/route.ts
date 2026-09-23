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
    selectedHookIdx?: unknown;
    selectedCtaIdx?: unknown;
    roleName?: unknown;
    environmentName?: unknown;
    restore?: unknown;
  };

  if (body.restore === true) {
    // Bring back the script and the storyboards archived together with it.
    const archived = await prisma.script.findFirst({
      where: { id: scriptId, projectId, deletedAt: { not: null } },
      select: { deletedAt: true },
    });
    if (!archived) return NextResponse.json({ error: "No archived script with that id" }, { status: 404 });
    await prisma.$transaction([
      prisma.script.update({ where: { id: scriptId }, data: { deletedAt: null } }),
      prisma.storyboard.updateMany({
        where: { projectId, scriptId, deletedAt: archived.deletedAt },
        data: { deletedAt: null },
      }),
    ]);
    const boards = await prisma.storyboard.findMany({
      where: { projectId, scriptId, deletedAt: null },
      orderBy: { version: "desc" },
      select: { id: true, isActive: true },
    });
    if (boards.length && !boards.some((b) => b.isActive)) {
      await prisma.storyboard.update({ where: { id: boards[0].id }, data: { isActive: true } });
    }
    return NextResponse.json({ ok: true });
  }

  const existing = await prisma.script.findFirst({
    where: { id: scriptId, projectId, ...LIVE },
    select: { id: true, hookVariants: true, ctaVariants: true },
  });
  if (!existing) return NextResponse.json({ error: "Script not found" }, { status: 404 });

  const data: {
    title?: string;
    body?: string;
    status?: string;
    selectedHookIdx?: number | null;
    selectedCtaIdx?: number | null;
    roleName?: string | null;
    environmentName?: string | null;
  } = {};

  const optionIndex = (value: unknown, options: unknown): number | null | "invalid" => {
    if (value === null) return null;
    const len = Array.isArray(options) ? options.length : 0;
    return Number.isInteger(value) && (value as number) >= 0 && (value as number) < len ? (value as number) : "invalid";
  };
  for (const [key, options] of [
    ["selectedHookIdx", existing.hookVariants],
    ["selectedCtaIdx", existing.ctaVariants],
  ] as const) {
    if (body[key] === undefined) continue;
    const idx = optionIndex(body[key], options);
    if (idx === "invalid") return NextResponse.json({ error: `${key} is not one of this script's options` }, { status: 400 });
    data[key] = idx;
  }
  for (const key of ["roleName", "environmentName"] as const) {
    if (body[key] === undefined) continue;
    if (body[key] !== null && typeof body[key] !== "string") {
      return NextResponse.json({ error: `${key} must be a string or null` }, { status: 400 });
    }
    data[key] = typeof body[key] === "string" ? (body[key] as string).trim().slice(0, 120) || null : null;
  }
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
