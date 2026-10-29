import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isClerkActive } from "@/lib/auth/mode";
import { accountSignUpUrl, appLandingUrl } from "@/lib/auth/account";
import { AuthCard } from "@/components/auth/auth-card";

export const metadata: Metadata = { title: "Create account · CreativeIntel OS" };

/** Sign-up lives on Xark Accounts (src/lib/auth/account.ts); this path stays so old links work. */
export default async function SignUpPage() {
  if (!isClerkActive()) {
    return (
      <AuthCard title="Sign-up is not enabled" subtitle="Accounts are off on this deployment.">
        {null}
      </AuthCard>
    );
  }
  redirect(accountSignUpUrl(appLandingUrl()));
}
