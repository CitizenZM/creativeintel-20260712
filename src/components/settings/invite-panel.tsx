"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ShareAccess } from "@/lib/auth/access";
import { ACCESS_LEVELS } from "./access-level";

export interface InviteRow {
  id: string;
  email: string;
  createdAt: number;
  invitedBy: string | null;
}

export interface ShareableProject {
  id: string;
  name: string;
  category: string | null;
}

const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

/**
 * "Invite a coworker" on /settings/users: email + the projects to share + their access level
 * (POST /api/settings/invitations). Nothing is shared unless ticked — a new account otherwise starts
 * with only its own empty workspace. Pending Clerk invitations are listed with Revoke.
 */
export function InvitePanel({
  pending,
  projects,
  error: loadError,
}: {
  pending: InviteRow[];
  projects: ShareableProject[];
  error?: string | null;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [access, setAccess] = useState<ShareAccess>("view");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? projects.filter((p) => `${p.name} ${p.category ?? ""}`.toLowerCase().includes(q)) : projects;
  }, [projects, filter]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/settings/invitations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, projectIds: [...selected], access }),
    }).catch(() => null);
    const body = await res?.json().catch(() => null);
    setBusy(false);
    if (!res?.ok) return setMessage({ ok: false, text: body?.error ?? "Couldn't send the invitation" });
    const level = ACCESS_LEVELS.find((l) => l.value === body.access)?.label ?? body.access;
    const what = body.shared ? `${body.shared} project${body.shared === 1 ? "" : "s"} shared (${level})` : "no projects shared";
    setMessage({
      ok: true,
      text: body.existingAccount
        ? `${body.email} already has an account — ${what}.`
        : body.invitation
          ? `Invitation sent to ${body.email} — ${what}.`
          : `${body.email} already has a pending invitation — ${what}.`,
    });
    setEmail("");
    setSelected(new Set());
    router.refresh();
  }

  async function revoke(id: string) {
    setRevoking(id);
    const res = await fetch(`/api/settings/invitations/${id}`, { method: "DELETE" }).catch(() => null);
    setRevoking(null);
    if (!res?.ok) return setMessage({ ok: false, text: "Couldn't revoke that invitation" });
    router.refresh();
  }

  return (
    <section className="space-y-4 rounded-lg border border-border p-4">
      <div>
        <h2 className="text-sm font-semibold">Invite a coworker</h2>
        <p className="text-xs text-muted-foreground">
          They get an email link to create an account with their own empty workspace. Tick the projects to share —
          only those are visible to them, at the level you choose.
        </p>
      </div>

      <form onSubmit={invite} className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="email"
            required
            placeholder="name@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-8 w-72 max-w-full"
            aria-label="Email to invite"
          />
          <select
            value={access}
            onChange={(e) => setAccess(e.target.value as ShareAccess)}
            className="h-8 rounded-md border border-border bg-background px-2 text-sm"
            aria-label="Access level"
          >
            {ACCESS_LEVELS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
          <Button size="sm" type="submit" disabled={busy || !email.trim()}>
            {busy ? "Sending…" : selected.size ? `Invite & share ${selected.size}` : "Send invite"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{ACCESS_LEVELS.find((l) => l.value === access)?.hint}.</p>

        <div className="rounded-md border border-border">
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <span className="text-xs font-medium">
              Projects to share <span className="text-muted-foreground">({selected.size} selected)</span>
            </span>
            <Input
              placeholder="Filter projects"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="h-7 w-44"
              aria-label="Filter projects"
            />
          </div>
          <ul className="max-h-56 overflow-y-auto py-1">
            {visible.map((p) => (
              <li key={p.id}>
                <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted/50">
                  <input
                    type="checkbox"
                    checked={selected.has(p.id)}
                    onChange={() => toggle(p.id)}
                    aria-label={`Share ${p.name}`}
                  />
                  <span className="font-medium">{p.name}</span>
                  {p.category && <span className="text-xs text-muted-foreground">{p.category}</span>}
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground">{p.id.slice(-6)}</span>
                </label>
              </li>
            ))}
            {!visible.length && <li className="px-3 py-2 text-xs text-muted-foreground">No projects match.</li>}
          </ul>
        </div>

        {message && (
          <p className={message.ok ? "text-xs text-emerald-600 dark:text-emerald-400" : "text-xs text-destructive"}>
            {message.text}
          </p>
        )}
      </form>

      {loadError && <p className="text-xs text-destructive">Couldn&rsquo;t load pending invitations: {loadError}</p>}
      {pending.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="py-1.5 text-left font-medium">Pending invitation</th>
                <th className="py-1.5 text-left font-medium">Sent (UTC)</th>
                <th className="py-1.5 text-left font-medium">By</th>
                <th className="py-1.5" />
              </tr>
            </thead>
            <tbody>
              {pending.map((i) => (
                <tr key={i.id} className="border-t border-border">
                  <td className="py-1.5 font-medium">{i.email}</td>
                  <td className="py-1.5 text-muted-foreground">{fmt.format(new Date(i.createdAt))}</td>
                  <td className="py-1.5 text-muted-foreground">{i.invitedBy ?? "—"}</td>
                  <td className="py-1.5 text-right">
                    <Button size="sm" variant="outline" disabled={revoking !== null} onClick={() => revoke(i.id)}>
                      {revoking === i.id ? "…" : "Revoke"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
