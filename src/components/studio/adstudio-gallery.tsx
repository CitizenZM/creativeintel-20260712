"use client";

/**
 * Visual pickers for the Ad Studio panel:
 *  - OpeningGallery: the 35-hook house library (H01–H35) as animated mocks (hook-mock.tsx). Hooks that map to an
 *    Ad Studio opening style also show the real first-two-seconds strip from our finished ads (public/adstudio/styles).
 *  - EndingGallery: the 12 end-card templates rendered by Xark's own end-card code in this project's brand look
 *    (api …/studio/adstudio-endcard-preview), switchable between the 4 looks.
 */
import { useState } from "react";
import { cn } from "@/lib/utils";
import { HookMock, HookMockStyle, MockBrand } from "./hook-mock";
import { brandingQuery, type Branding } from "@/services/video-gen/adstudio-branding";

export interface OpeningOpt { id: string; name: string; family: string; enforced: string | null; desc?: string; motion?: string; durationSec?: number[] }
export interface EndCardOpt { id: string; name: string; useFor: string }
export interface ExampleClip { src: string; kind: "reference" | "our-ad"; title: string; note: string }
export type ClipMap = Record<string, ExampleClip[]>;

/** real example clips (cut from saved reference ads and our finished ads) for the selected hook / end card */
/** a looping, muted thumbnail of a real clip */
const ClipThumb = ({ src, className }: { src: string; className?: string }) => (
  <video src={src} className={cn("bg-black object-cover", className)} autoPlay muted loop playsInline preload="metadata" />
);

export function ClipViewer({ id, name, clips, empty, still }: { id: string; name: string; clips: ExampleClip[]; empty: string; still?: string }) {
  return (
    <div data-testid="adstudio-clip-viewer" data-for={id} className="rounded-lg border border-border bg-muted/30 p-2">
      <p className="mb-1.5 text-xs font-semibold"><span className="font-mono text-muted-foreground">{id}</span> {name} · real examples</p>
      {clips.length || still ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {still && (
            <figure className="w-44 shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element -- server-rendered PNG preview */}
              <img src={still} alt={`${id} rendered for this brand`} className="aspect-[9/16] w-full rounded bg-muted object-cover" />
              <figcaption className="mt-1 text-[10px] leading-tight"><span className="rounded bg-foreground/10 px-1 py-px font-medium">Xark render</span><span className="block text-muted-foreground">This template with your brand and a sample offer</span></figcaption>
            </figure>
          )}
          {clips.map((c) => (
            <figure key={c.src} className="w-44 shrink-0">
              <video src={c.src} className="aspect-[9/16] w-full rounded bg-black object-cover" autoPlay muted loop playsInline controls preload="metadata" />
              <figcaption className="mt-1 space-y-0.5 text-[10px] leading-tight">
                <span className={cn("rounded px-1 py-px font-medium", c.kind === "reference" ? "bg-sky-500/15 text-sky-700 dark:text-sky-300" : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300")}>{c.kind === "reference" ? "Reference ad" : "Our Ad Studio ad"}</span>
                <span className="block text-muted-foreground">{c.note}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      ) : <p className="text-[11px] text-muted-foreground">{empty}</p>}
    </div>
  );
}

const FAMILIES: [string, string][] = [["all", "All 35"], ["reveal", "Product reveal"], ["claim", "Claim / text"], ["native", "Creator-native"], ["demo", "Demo / story"]];
const STYLE_NAME: Record<string, string> = {
  product_hero: "product hero pop-in", text_slab: "brand-colour type card", cap_bold: "bold outlined caption", ai_talk: "AI person talking",
  broll_open: "b-roll opener", punch: "punch-in cut", whip: "whip pan",
};

/** styles whose example strip really shows the style (the product_hero and broll_open strips do not, so none is shown) */
export const STRIP_OK = new Set(["text_slab", "cap_bold", "ai_talk", "punch", "whip"]);

const tile = (on: boolean) =>
  cn("group flex flex-col overflow-hidden rounded-lg border text-left transition-colors", on ? "border-foreground ring-2 ring-foreground/70" : "border-border hover:border-foreground/40");

export function OpeningGallery({ openings, value, onChange, clips = {}, autoId, branding = {} }: { openings: OpeningOpt[]; value: string; onChange: (id: string) => void; clips?: ClipMap; autoId?: string; branding?: Branding }) {
  const [fam, setFam] = useState("all");
  const list = openings.filter((o) => fam === "all" || o.family === fam);
  const shownId = value === "auto" ? autoId : value;
  const shown = openings.find((o) => o.id === shownId);
  return (
    <MockBrand.Provider value={{ product: branding.productImageUrl, logo: branding.logoUrl }}>
    <div data-testid="adstudio-opening-gallery" className="space-y-2">
      <HookMockStyle />
      <div className="flex flex-wrap gap-1.5 text-[11px]">
        {FAMILIES.map(([id, label]) => (
          <button key={id} type="button" onClick={() => setFam(id)} className={cn("rounded-full border px-2.5 py-0.5", fam === id ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground")}>{label}</button>
        ))}
        <span className="ml-auto self-center text-muted-foreground">Click a hook to play real examples · ✓ = enforced on shot 1 · ▶ n = saved example clips</span>
      </div>
      {shown && <ClipViewer id={shown.id} name={(value === "auto" ? "Auto → " : "") + shown.name} clips={clips[shown.id] ?? []} empty="No saved video uses this hook yet — the animated mock shows the move." />}
      {value === "auto" && !shown && <p className="text-[11px] text-muted-foreground">Auto: the campaign plan has no hook picked yet, so Ad Studio decides.</p>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {[{ id: "auto", label: autoId ? `Auto · ${autoId}` : "Auto", note: "The campaign plan's hook" }, { id: "", label: "None", note: "Ad Studio decides" }].map((x) => (
          <button key={x.id || "none"} type="button" onClick={() => onChange(x.id)} className={tile(value === x.id)}>
            {x.id === "auto" && autoId ? (
              <div className="flex justify-center bg-black/90 p-1.5">
                {clips[autoId]?.[0] ? <ClipThumb src={clips[autoId][0].src} className="aspect-[9/16] h-36 w-auto rounded" /> : <HookMock id={autoId} className="h-36 w-auto rounded" />}
              </div>
            ) : (
              <div className="flex h-[9.75rem] items-center justify-center bg-muted/60 px-2 text-center text-xs text-muted-foreground">{x.note}</div>
            )}
            <div className="p-2 text-xs font-semibold">{x.label}<p className="text-[10px] font-normal text-muted-foreground">{x.note}</p></div>
          </button>
        ))}
        {list.map((o) => (
          <button key={o.id} type="button" data-hook={o.id} onClick={() => onChange(o.id)} title={o.desc} className={tile(value === o.id)}>
            <div className="flex justify-center bg-black/90 p-1.5">
              {clips[o.id]?.[0] ? <ClipThumb src={clips[o.id][0].src} className="aspect-[9/16] h-36 w-auto rounded" /> : <HookMock id={o.id} className="h-36 w-auto rounded" />}
            </div>
            {!clips[o.id]?.length && o.enforced && STRIP_OK.has(o.enforced) && (
              <figure className="border-t border-border bg-black">
                {/* eslint-disable-next-line @next/next/no-img-element -- static strip from public/ */}
                <img src={`/adstudio/styles/${o.enforced}.jpg`} alt={`${o.id} real example, first 2 seconds`} loading="lazy" className="aspect-[600/356] w-full object-cover" />
                <figcaption className="px-1.5 py-0.5 text-[9px] text-white/70">Real first 2 s from our ads</figcaption>
              </figure>
            )}
            <div className="space-y-0.5 p-2">
              <p className="text-xs font-semibold leading-tight"><span className="font-mono text-muted-foreground">{o.id}</span> {o.name}{o.enforced ? " ✓" : ""}{clips[o.id]?.length ? <span className="ml-1 rounded bg-foreground/10 px-1 font-normal">▶ {clips[o.id].length}</span> : null}</p>
              {o.enforced && <p className="text-[10px] text-muted-foreground">Ad Studio: {STYLE_NAME[o.enforced] ?? o.enforced}</p>}
              {o.motion && <p className="line-clamp-2 text-[10px] text-muted-foreground">{o.motion}</p>}
            </div>
          </button>
        ))}
      </div>
    </div>
    </MockBrand.Provider>
  );
}

export function EndingGallery({ projectId, cards, themes, value, theme, onChange, onTheme, clips = {}, autoId, branding = {} }: {
  branding?: Branding;
  projectId: string; cards: EndCardOpt[]; themes: string[]; value: string; theme: string; onChange: (id: string) => void; onTheme: (t: string) => void; clips?: ClipMap; autoId?: string;
}) {
  const shownId = value === "auto" ? autoId : value;
  const shown = cards.find((c) => c.id === shownId);
  const still = (id: string) => `/api/projects/${projectId}/studio/adstudio-endcard-preview?card=${id}&theme=${theme}${brandingQuery(branding)}`;
  return (
    <div data-testid="adstudio-ending-gallery" className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="font-medium">Look</span>
        {themes.map((t) => (
          <button key={t} type="button" onClick={() => onTheme(t)} className={cn("rounded-full border px-2.5 py-0.5 capitalize", theme === t ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground")}>{t}</button>
        ))}
        <span className="ml-auto text-muted-foreground">Click a card to play real endings · stills use this project&apos;s brand look and sample prices</span>
      </div>
      {shown && <ClipViewer id={shown.id} name={(value === "auto" ? "Auto → " : "") + shown.name} clips={clips[shown.id] ?? []} still={still(shown.id)} empty="" />}
      {shown && !clips[shown.id]?.length && <p className="text-[11px] text-muted-foreground">No saved ad ends this way yet, so only Xark&apos;s render is shown.</p>}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {[{ id: "auto", label: autoId ? `Auto · ${autoId}` : "Auto", note: "The campaign plan's end card" }, { id: "", label: "Ad Studio close", note: "Offer + logo + CTA" }].map((x) => (
          <button key={x.id || "own"} type="button" onClick={() => onChange(x.id)} className={tile(value === x.id)}>
            {x.id === "auto" && autoId ? (
              clips[autoId]?.[0] ? <ClipThumb src={clips[autoId][0].src} className="aspect-[9/16] w-full" /> : (
                // eslint-disable-next-line @next/next/no-img-element -- server-rendered PNG preview
                <img src={still(autoId)} alt={`Auto ${autoId}`} loading="lazy" className="aspect-[9/16] w-full bg-muted object-cover" />
              )
            ) : <div className="flex aspect-[9/16] items-center justify-center bg-muted/60 px-2 text-center text-[11px] text-muted-foreground">{x.note}</div>}
            <div className="p-1.5 text-[11px] font-semibold">{x.label}</div>
          </button>
        ))}
        {cards.map((e) => (
          <button key={e.id} type="button" data-card={e.id} onClick={() => onChange(e.id)} title={e.useFor} className={tile(value === e.id)}>
            {clips[e.id]?.[0] ? <ClipThumb src={clips[e.id][0].src} className="aspect-[9/16] w-full" /> : (
              // eslint-disable-next-line @next/next/no-img-element -- server-rendered PNG preview
              <img src={still(e.id)} alt={`${e.id} ${e.name}`} loading="lazy" className="aspect-[9/16] w-full bg-muted object-cover" />
            )}
            <div className="p-1.5">
              <p className="text-[11px] font-semibold leading-tight"><span className="font-mono text-muted-foreground">{e.id}</span> {e.name}{clips[e.id]?.length ? <span className="ml-1 rounded bg-foreground/10 px-1 font-normal">▶ {clips[e.id].length}</span> : null}</p>
              <p className="line-clamp-2 text-[10px] text-muted-foreground">{e.useFor}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
