"use client";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import type { CampaignGoal } from "@/services/creative/types";
import { SectionLabel } from "./score-bar";
import { GOALS, type PromoForm } from "./view-model";

const FIELDS: { key: keyof PromoForm; label: string; placeholder: string; type?: string }[] = [
  { key: "pct", label: "% off", placeholder: "20" },
  { key: "code", label: "Coupon code", placeholder: "SAVE20" },
  { key: "price", label: "Price", placeholder: "299.99" },
  { key: "comparePrice", label: "Compare-at price", placeholder: "349.99" },
  { key: "deadline", label: "Deadline", placeholder: "", type: "date" },
];

export function GoalPromoForm({
  goal,
  promo,
  onGoal,
  onPromo,
}: {
  goal: CampaignGoal;
  promo: PromoForm;
  onGoal: (g: CampaignGoal) => void;
  onPromo: (p: PromoForm) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <SectionLabel>Goal</SectionLabel>
        <div role="radiogroup" aria-label="Campaign goal" className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
          {GOALS.map((g) => (
            <button
              key={g.id}
              type="button"
              role="radio"
              aria-checked={goal === g.id}
              onClick={() => onGoal(g.id)}
              title={g.hint}
              className={cn(
                "rounded-md border px-2.5 py-2 text-left transition-colors",
                goal === g.id ? "border-foreground bg-foreground text-background" : "border-border hover:border-foreground/40"
              )}
            >
              <span className="block text-xs font-medium">{g.label}</span>
              <span className={cn("block text-[10px] leading-tight", goal === g.id ? "opacity-70" : "text-muted-foreground")}>{g.hint}</span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <SectionLabel>Promo (optional — unlocks offer, coupon, strike-through and deadline end cards)</SectionLabel>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {FIELDS.map((f) => (
            <label key={f.key} className="block">
              <span className="mb-1 block text-[11px] text-muted-foreground">{f.label}</span>
              <Input
                type={f.type ?? "text"}
                inputMode={f.key === "code" || f.key === "deadline" ? undefined : "decimal"}
                value={promo[f.key]}
                placeholder={f.placeholder}
                onChange={(e) => onPromo({ ...promo, [f.key]: e.target.value })}
              />
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
