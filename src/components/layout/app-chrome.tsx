"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { BottomNav } from "@/components/layout/bottom-nav";

const AUTH_PAGE = /^\/(sign-in|sign-up|blocked|terms|privacy)(\/|$)/;

/**
 * The app shell (sidebar, mobile topbar, bottom nav). The sign-in / sign-up pages get a bare
 * canvas instead — the shell's widgets call protected APIs a signed-out visitor can't reach. So does
 * /blocked and the public legal pages (/terms, /privacy). `isAdmin` (the master admin, or any non-Clerk mode) shows the platform-wide links.
 */
export function AppChrome({
  account,
  isAdmin = true,
  children,
}: {
  account: ReactNode;
  isAdmin?: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  if (AUTH_PAGE.test(pathname)) return <main className="min-h-screen">{children}</main>;
  return (
    <>
      <Sidebar account={account} isAdmin={isAdmin} />
      <Topbar account={account} />
      <main className="min-h-screen pt-14 pb-16 lg:ml-60 lg:pt-0 lg:pb-0">{children}</main>
      <BottomNav />
    </>
  );
}
