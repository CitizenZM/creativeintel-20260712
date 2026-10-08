import type { Metadata } from "next";
import { SignIn } from "@clerk/nextjs";
import { isClerkActive } from "@/lib/auth/mode";
import { AuthCard } from "@/components/auth/auth-card";

export const metadata: Metadata = { title: "Sign in · CreativeIntel OS" };

export default function SignInPage() {
  // Without Clerk keys there is no <ClerkProvider>, so the component can't render.
  if (!isClerkActive()) {
    return (
      <AuthCard title="Sign-in is not enabled" subtitle="Accounts are off on this deployment.">
        {null}
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Sign in" subtitle="Welcome back to CreativeIntel OS.">
      <SignIn />
    </AuthCard>
  );
}
