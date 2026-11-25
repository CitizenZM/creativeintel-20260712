"use client";

import { UserButton } from "@clerk/nextjs";
import { LayoutGrid, Users } from "lucide-react";

/** Account menu (profile, sign-out). Owners also get "Manage users". Only rendered under <ClerkProvider>. */
export function UserMenu({ isOwner, chooserUrl, showName = false }: { isOwner: boolean; chooserUrl?: string; showName?: boolean }) {
  return (
    <UserButton showName={showName}>
      <UserButton.MenuItems>
        {chooserUrl && <UserButton.Link label="Switch system" labelIcon={<LayoutGrid className="h-4 w-4" />} href={chooserUrl} />}
        {isOwner && <UserButton.Link label="Manage users" labelIcon={<Users className="h-4 w-4" />} href="/settings/users" />}
      </UserButton.MenuItems>
    </UserButton>
  );
}
