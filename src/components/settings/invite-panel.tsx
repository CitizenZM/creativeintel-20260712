"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface InviteRow {
  id: string;
  email: string;
  createdAt: number;
  invitedBy: string | null;
}

const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

/**
 * "Invite user" on /settings/users: emails a Clerk invitation (POST /api/settings/invitations) and
 * lists pending ones with Revoke (DELETE /api/settings/invitations/[id]).
 */
export function InvitePanel({ pending, error: loadError }: { pending: InviteRow[]; error?: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/settings/invitations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    }).catch(() => null);
    const body = await res?.json().catch(() => null);
    setBusy(false);
    if (!res?.ok) return setMessage({ ok: false, text: body?.error ?? "Couldn't send the invitation" });
    setMessage({ ok: true, text: `Invitation sent to ${body.invitation.email}` });
    setEmail("");
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
    <section className="space-y-3 rounded-lg border border-border p-4">
      <div>
        <h2 className="text-sm font-semibold">Invite someone</h2>
        <p className="text-xs text-muted-foreground">
          They get an email link to create an account. Like every member, they start with their own empty workspace and
          the default monthly AI allowance.
        </p>
      </div>
      <form onSubmit={invite} className="flex flex-wrap items-center gap-2">
        <Input
          type="email"
          required
          placeholder="name@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-8 w-72 max-w-full"
          aria-label="Email to invite"
        />
        <Button size="sm" type="submit" disabled={busy || !email.trim()}>
          {busy ? "Sending…" : "Send invite"}
        </Button>
        {message && (
          <span className={message.ok ? "text-xs text-emerald-600 dark:text-emerald-400" : "text-xs text-destructive"}>
            {message.text}
          </span>
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
