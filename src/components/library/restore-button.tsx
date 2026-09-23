"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";

/** Un-archive one saved item (angle, script or storyboard) and refresh the list. */
export function RestoreButton({ url }: { url: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function restore() {
    setBusy(true);
    setFailed(false);
    const res = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restore: true }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) router.refresh();
    else setFailed(true);
  }
  return (
    <button
      type="button"
      onClick={restore}
      disabled={busy}
      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] font-medium hover:bg-muted disabled:opacity-60"
    >
      <RotateCcw className="h-3 w-3" />
      {failed ? "Retry restore" : busy ? "Restoring…" : "Restore"}
    </button>
  );
}
