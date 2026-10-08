import type { Metadata } from "next";
import { SignUp } from "@clerk/nextjs";
import { isClerkActive } from "@/lib/auth/mode";
import { AuthCard } from "@/components/auth/auth-card";

export const metadata: Metadata = { title: "Create account · CreativeIntel OS" };

export default function SignUpPage() {
  if (!isClerkActive()) {
    return (
      <AuthCard title="Sign-up is not enabled" subtitle="Accounts are off on this deployment.">
        {null}
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Create your account" subtitle="Sign up with your email — we'll send a verification code.">
      <SignUp />
    </AuthCard>
  );
}
