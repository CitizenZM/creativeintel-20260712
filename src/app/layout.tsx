import type { Metadata } from "next";
import Script from "next/script";
import { ClerkProvider } from "@clerk/nextjs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppChrome } from "@/components/layout/app-chrome";
import { UserMenu } from "@/components/layout/user-menu";
import { isClerkActive } from "@/lib/auth/mode";
import { currentAppUser } from "@/services/app-user";
import "./globals.css";

export const metadata: Metadata = {
  title: "CreativeIntel OS",
  description: "AI-powered brand intelligence platform",
};

// Clerk's components follow the app's light/dark tokens (globals.css).
const clerkAppearance = {
  variables: {
    colorPrimary: "var(--primary)",
    colorPrimaryForeground: "var(--primary-foreground)",
    colorBackground: "var(--card)",
    colorForeground: "var(--foreground)",
    colorMuted: "var(--muted)",
    colorMutedForeground: "var(--muted-foreground)",
    colorInput: "var(--background)",
    colorInputForeground: "var(--foreground)",
    colorBorder: "var(--border)",
    colorRing: "var(--ring)",
    colorDanger: "var(--destructive)",
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
    borderRadius: "0.5rem",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Clerk only when its keys are set (src/lib/auth/mode.ts): builds and deployments without them
  // render exactly as before. The AppUser row is upserted here on the first signed-in page load.
  const clerk = isClerkActive();
  const appUser = clerk ? await currentAppUser() : null;

  const shell = (
    <TooltipProvider>
      <AppChrome account={clerk ? <UserMenu isOwner={appUser?.role === "owner"} /> : null}>{children}</AppChrome>
    </TooltipProvider>
  );

  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <Script src="/theme-init.js" strategy="beforeInteractive" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full font-sans bg-background text-foreground">
        {clerk ? (
          <ClerkProvider
            appearance={clerkAppearance}
            signInUrl={process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL || "/sign-in"}
            signUpUrl={process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL || "/sign-up"}
          >
            {shell}
          </ClerkProvider>
        ) : (
          shell
        )}
      </body>
    </html>
  );
}
