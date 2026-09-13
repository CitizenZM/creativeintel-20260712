"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { LIGHTING_OPTIONS, STYLE_OPTIONS, type LookOption } from "@/lib/visual-direction";

function OptionRow({
  options,
  value,
  onChange,
  disabled,
}: {
  options: LookOption[];
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            disabled={disabled}
            title={o.clause}
            onClick={() => onChange(active ? "" : o.id)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50",
              active
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Lighting / style / free-text direction applied to the next generation. Left
 * empty, the board keeps whatever look the AI picks from the brand truth.
 */
export function LookControls({
  lighting,
  style,
  notes,
  onLighting,
  onStyle,
  onNotes,
  disabled,
}: {
  lighting: string;
  style: string;
  notes: string;
  onLighting: (v: string) => void;
  onStyle: (v: string) => void;
  onNotes: (v: string) => void;
  disabled?: boolean;
}) {
  const touched = !!lighting || !!style || !!notes.trim();

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold">Look &amp; lighting</p>
        {touched && (
          <button
            type="button"
            onClick={() => {
              onLighting("");
              onStyle("");
              onNotes("");
            }}
            className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            Reset
          </button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground -mt-1">
        Applied to every frame of the storyboards you generate next, and carried into the studio
        render. Leave blank to let the AI choose from the brand kit.
      </p>

      <div className="space-y-1.5">
        <Label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          Style
        </Label>
        <OptionRow options={STYLE_OPTIONS} value={style} onChange={onStyle} disabled={disabled} />
      </div>

      <div className="space-y-1.5">
        <Label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          Lighting
        </Label>
        <OptionRow
          options={LIGHTING_OPTIONS}
          value={lighting}
          onChange={onLighting}
          disabled={disabled}
        />
      </div>

      <div className="space-y-1.5">
        <Label
          htmlFor="styleNotes"
          className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider"
        >
          Anything else about the look
        </Label>
        <Input
          id="styleNotes"
          value={notes}
          disabled={disabled}
          onChange={(e) => onNotes(e.target.value)}
          placeholder="e.g. shot on 35mm film, muted palette, always show the rider's face"
          className="h-9 rounded-md text-sm"
        />
      </div>
    </div>
  );
}
