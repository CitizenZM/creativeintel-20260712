"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { ShareAccess } from "@/lib/auth/access";
import { ACCESS_LEVELS } from "./access-level";

export interface ShareView {
  id: string;
  projectId: string;
  projectName: string;
  email: string;
  access: ShareAccess;
  joined: boolean;
}

/** "Project access" on /settings/users: every share, its level (editable) and Remove. */
export function SharesTable({ shares }: { shares: ShareView[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function call(id: string, init: RequestInit) {
    setBusy(id);
    setError(null);
    const res = await fetch(`/api/settings/shares/${id}`, init).catch(() => null);
    setBusy(null);
    if (!res?.ok) return setError("Couldn't update that share");
    router.refresh();
  }

  return (
    <section className="space-y-3 rounded-lg border border-border p-4">
      <div>
        <h2 className="text-sm font-semibold">Project access</h2>
        <p className="text-xs text-muted-foreground">
          Projects shared with coworkers. Changes apply within seconds; removing a share hides the project from them.
        </p>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {shares.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing is shared yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="py-1.5 text-left font-medium">Coworker</th>
                <th className="py-1.5 text-left font-medium">Project</th>
                <th className="py-1.5 text-left font-medium">Access</th>
                <th className="py-1.5 text-left font-medium">Status</th>
                <th className="py-1.5" />
              </tr>
            </thead>
            <tbody>
              {shares.map((s) => (
                <tr key={s.id} className="border-t border-border">
                  <td className="py-1.5 font-medium">{s.email}</td>
                  <td className="py-1.5">{s.projectName}</td>
                  <td className="py-1.5">
                    <select
                      value={s.access}
                      disabled={busy !== null}
                      onChange={(e) =>
                        call(s.id, {
                          method: "PATCH",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({ access: e.target.value }),
                        })
                      }
                      className="h-7 rounded-md border border-border bg-background px-1.5 text-xs"
                      aria-label={`Access for ${s.email} on ${s.projectName}`}
                    >
                      {ACCESS_LEVELS.map((l) => (
                        <option key={l.value} value={l.value}>
                          {l.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1.5 text-muted-foreground">{s.joined ? "Joined" : "Invited"}</td>
                  <td className="py-1.5 text-right">
                    <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => call(s.id, { method: "DELETE" })}>
                      {busy === s.id ? "…" : "Remove"}
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
