import type { ShareAccess } from "@/lib/auth/access";

/** Labels and one-line meanings of the share levels, shared by the invite form and the access table. */
export const ACCESS_LEVELS: { value: ShareAccess; label: string; hint: string }[] = [
  { value: "view", label: "View", hint: "See the project and play its media" },
  { value: "download", label: "View + download", hint: "Also export the history zip, files, report and packs" },
  { value: "edit", label: "Edit", hint: "Also change it and generate (paid AI uses their own allowance)" },
];
