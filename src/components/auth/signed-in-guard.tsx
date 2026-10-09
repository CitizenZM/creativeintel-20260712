"use client";

import { SignOutButton, useUser } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

/**
 * Sign-up while already signed in: Clerk's <SignUp/> would silently drop the visitor into the app as
 * the CURRENT account — so an invitation link opened in a browser where the admin is signed in
 * showed the admin's projects, not a fresh account. Say who is signed in and offer to sign out
 * (coming straight back here, invitation ticket included) instead of rendering the form.
 */
export function SignedInGuard({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn, user } = useUser();
  const params = useSearchParams();
  if (!isLoaded) return null;
  if (!isSignedIn) return <>{children}</>;

  const invitation = params.has("__clerk_ticket");
  const back = typeof window !== "undefined" ? window.location.href : "/sign-up";
  return (
    <div className="w-full max-w-sm space-y-3 rounded-lg border border-border p-5 text-center">
      <p className="text-sm">
        You&rsquo;re signed in as <span className="font-medium">{user?.primaryEmailAddress?.emailAddress}</span>.
      </p>
      <p className="text-xs text-muted-foreground">
        {invitation
          ? "To accept this invitation with a new account, sign out first — you'll come straight back here."
          : "Sign out first to create a different account."}
      </p>
      <div className="flex justify-center gap-2">
        <SignOutButton redirectUrl={back}>
          <button className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background">Sign out and continue</button>
        </SignOutButton>
        <Link href="/" className="rounded-md border border-border px-3 py-1.5 text-xs font-medium">
          Stay signed in
        </Link>
      </div>
    </div>
  );
}
