import Link from "next/link";
import { Sparkles } from "lucide-react";
import { PRIVACY_PATH, TERMS_PATH } from "@/lib/legal";

/**
 * Frame for Clerk's <SignIn/> / <SignUp/>: the app's brand mark over a centred card, with the legal
 * links underneath. `consent` adds the sign-up agreement line (Clerk's own checkbox records it).
 */
export function AuthCard({
  title,
  subtitle,
  consent = false,
  children,
}: {
  title: string;
  subtitle: string;
  consent?: boolean;
  children: React.ReactNode;
}) {
  const link = "underline underline-offset-4 hover:text-foreground";
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 py-10">
      <Link href="/" className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-foreground text-background">
          <Sparkles className="h-4 w-4" />
        </div>
        <span className="text-base font-semibold tracking-tight">CreativeIntel</span>
      </Link>
      <div className="text-center">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {children}
      <p className="max-w-sm text-center text-xs leading-5 text-muted-foreground">
        {consent ? "By creating an account you agree to the " : "Use of CreativeIntel is subject to the "}
        <Link href={TERMS_PATH} className={link}>
          Terms of Service
        </Link>{" "}
        and{" "}
        <Link href={PRIVACY_PATH} className={link}>
          Privacy Policy
        </Link>
        .
      </p>
    </div>
  );
}
