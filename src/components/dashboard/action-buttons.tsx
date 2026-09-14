"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Search, Brain, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface ActionButtonProps {
  endpoint: string;
  label: string;
  loadingLabel: string;
  icon: "refresh" | "search" | "brain" | "plus";
  body?: Record<string, unknown>;
  variant?: "default" | "outline";
  className?: string;
  onComplete?: () => void;
  /**
   * Keep re-posting while the response reports work still outstanding
   * (`{ done: false }`). Analysis stages are time-budgeted per request, and
   * without this someone has to keep pressing the button until the numbers
   * stop moving.
   */
  autoContinue?: boolean;
}

const MAX_CONTINUE_ROUNDS = 6;

const ICONS = {
  refresh: RefreshCw,
  search: Search,
  brain: Brain,
  plus: Plus,
};

export function ActionButton({
  endpoint,
  label,
  loadingLabel,
  icon,
  body,
  variant = "outline",
  className,
  onComplete,
  autoContinue,
}: ActionButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [round, setRound] = useState(0);
  const Icon = ICONS[icon];

  async function handleClick() {
    setLoading(true);
    setRound(0);
    try {
      for (let i = 0; i < (autoContinue ? MAX_CONTINUE_ROUNDS : 1); i++) {
        setRound(i + 1);
        const res = await fetch(endpoint, {
          method: "POST",
          headers: body ? { "Content-Type": "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
        if (!autoContinue) break;
        const data = await res.json().catch(() => null);
        // Stop when the server says it is finished, or when it stops making
        // progress, so a permanently-stuck item cannot loop forever.
        if (!data || data.done !== false) break;
      }
      router.refresh();
      onComplete?.();
    } catch {
      // ignore
    } finally {
      setLoading(false);
      setRound(0);
    }
  }

  return (
    <Button
      onClick={handleClick}
      disabled={loading}
      variant={variant === "default" ? undefined : "outline"}
      size="sm"
      className={cn("h-8 rounded-md text-xs", className)}
    >
      {loading ? (
        <>
          <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
          {loadingLabel}
          {autoContinue && round > 1 ? ` (pass ${round})` : ""}
        </>
      ) : (
        <>
          <Icon className="mr-1.5 h-3 w-3" />
          {label}
        </>
      )}
    </Button>
  );
}

export function LoadMoreButton({
  projectId,
  currentCount,
}: {
  projectId: string;
  currentCount: number;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [added, setAdded] = useState(0);

  async function loadMore() {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/content/search-more`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ offset: currentCount }),
        }
      );
      const data = await res.json().catch(() => ({}));
      setAdded(data.added || 0);
      router.refresh();
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-2 py-6">
      <Button
        onClick={loadMore}
        disabled={loading}
        variant="outline"
        className="h-10 rounded-md px-6"
      >
        {loading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Searching for more videos...
          </>
        ) : (
          <>
            <Search className="mr-2 h-4 w-4" />
            Load more videos
          </>
        )}
      </Button>
      {added > 0 && (
        <p className="text-xs text-muted-foreground">
          Added {added} new video{added !== 1 ? "s" : ""}
        </p>
      )}
      <p className="text-[10px] text-muted-foreground">
        Currently showing {currentCount} results
      </p>
    </div>
  );
}
