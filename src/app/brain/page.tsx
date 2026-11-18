import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { BrainBoard } from "./brain-board";

export const metadata: Metadata = { title: "Video Brain · CreativeIntel OS" };

export default function BrainPage() {
  return (
    <div>
      <Header
        title="Video Brain"
        description="大脑循环看板 — what the autonomous video brain is doing, waiting on, checking and learning. Read-only, refreshes every 10 s."
      />
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <BrainBoard />
      </div>
    </div>
  );
}
