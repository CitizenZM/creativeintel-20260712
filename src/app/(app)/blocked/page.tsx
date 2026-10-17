import type { Metadata } from "next";
import { SignOutButton } from "@clerk/nextjs";
import { isClerkActive } from "@/lib/auth/mode";

export const metadata: Metadata = { title: "Account blocked · CreativeIntel OS" };
export const dynamic = "force-dynamic";

/** Where the proxy sends a blocked account (src/lib/auth/gate.ts). Rendered without the app shell. */
export default function BlockedPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-sm space-y-3 text-center">
        <h1 className="text-lg font-semibold">This account has been blocked</h1>
        <p className="text-sm text-muted-foreground">
          The workspace administrator has turned off access for this account. Contact them if you think this is a
          mistake.
        </p>
        {/* <ClerkProvider> only wraps the app when Clerk is the active gate (src/app/layout.tsx). */}
        {isClerkActive() && (
          <SignOutButton>
            <button className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted">
              Sign out
            </button>
          </SignOutButton>
        )}
      </div>
    </div>
  );
}
