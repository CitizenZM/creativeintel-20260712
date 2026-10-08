"use client";

import { UserButton } from "@clerk/nextjs";
import { Users } from "lucide-react";

/** Account menu (profile, sign-out). Owners also get "Manage users". Only rendered under <ClerkProvider>. */
export function UserMenu({ isOwner, showName = false }: { isOwner: boolean; showName?: boolean }) {
  return (
    <UserButton showName={showName}>
      {isOwner && (
        <UserButton.MenuItems>
          <UserButton.Link label="Manage users" labelIcon={<Users className="h-4 w-4" />} href="/settings/users" />
        </UserButton.MenuItems>
      )}
    </UserButton>
  );
}
