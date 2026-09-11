"use client";

import { ExternalLink } from "lucide-react";

// Rendered inside a card that is itself a <Link>; anchors cannot nest, so this
// opens the source in a new tab from a button instead.
export function OpenOnPlatform({ url, className }: { url: string; className?: string }) {
  return (
    <button
      type="button"
      title="Open on platform"
      aria-label="Open on platform"
      className={className}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        window.open(url, "_blank", "noopener,noreferrer");
      }}
    >
      <ExternalLink className="h-3 w-3" />
    </button>
  );
}
