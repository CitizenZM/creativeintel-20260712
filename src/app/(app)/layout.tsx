import { ClerkProvider } from "@clerk/nextjs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppChrome } from "@/components/layout/app-chrome";
import { UserMenu } from "@/components/layout/user-menu";
import { isClerkActive } from "@/lib/auth/mode";
import { currentAppUser } from "@/services/app-user";
export const dynamic = "force-dynamic";
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

export default async function AppLayout({children}: {children: React.ReactNode}) {
  // Clerk only when its keys are set (src/lib/auth/mode.ts): builds and deployments without them
  // render exactly as before. The AppUser row is upserted here on the first signed-in page load.
  const clerk = isClerkActive();
  const appUser = clerk ? await currentAppUser() : null;

  const shell = (
    <TooltipProvider>
      <AppChrome
        account={clerk ? <UserMenu isOwner={appUser?.role === "owner"} /> : null}
        isAdmin={!clerk || appUser?.role === "owner"}
      >
        {children}
      </AppChrome>
    </TooltipProvider>
  );

  return clerk ? (
          <ClerkProvider
            appearance={clerkAppearance}
            signInUrl={process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL || "/sign-in"}
            signUpUrl={process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL || "/sign-up"}
          >
            {shell}
          </ClerkProvider>
        ) : (
          shell
        );
}
