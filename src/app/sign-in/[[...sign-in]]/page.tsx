import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isClerkActive } from "@/lib/auth/mode";
import { accountSignInUrl, safeReturnUrl } from "@/lib/auth/account";
import { AuthCard } from "@/components/auth/auth-card";

export const metadata: Metadata = { title: "Sign in · CreativeIntel OS" };

/** Sign-in lives on Xark Accounts (src/lib/auth/account.ts); this path stays so old links work. */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isClerkActive()) {
    return (
      <AuthCard title="Sign-in is not enabled" subtitle="Accounts are off on this deployment.">
        {null}
      </AuthCard>
    );
  }
  const { redirect_url } = await searchParams;
  redirect(accountSignInUrl(safeReturnUrl(typeof redirect_url === "string" ? redirect_url : null)));
}
