"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type Action = "block" | "unblock" | "make-owner" | "make-member";

/** Per-row controls on /settings/users (POST /api/settings/users/[id]). Hidden on your own row. */
export function UserActions({ id, role, status }: { id: string; role: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: Action) {
    setBusy(action);
    setError(null);
    const res = await fetch(`/api/settings/users/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    }).catch(() => null);
    const body = await res?.json().catch(() => null);
    setBusy(null);
    if (!res?.ok) return setError(body?.error ?? "Couldn't update this account");
    router.refresh();
  }

  const button = (action: Action, label: string, variant: "outline" | "destructive" = "outline") => (
    <Button key={action} size="sm" variant={variant} disabled={busy !== null} onClick={() => run(action)}>
      {busy === action ? "…" : label}
    </Button>
  );

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {status === "blocked" ? button("unblock", "Unblock") : button("block", "Block", "destructive")}
      {status !== "blocked" &&
        (role === "owner" ? button("make-member", "Remove admin") : button("make-owner", "Make admin"))}
      {error && <span className="w-full text-right text-xs text-destructive">{error}</span>}
    </div>
  );
}
