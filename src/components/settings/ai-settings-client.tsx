"use client";

import { useState } from "react";
import { Check, Loader2, Plug, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { AiSettingsView } from "@/services/settings/ai-settings-view";
import type { Capability, ProviderType } from "@/services/settings/ai-settings-core";

const CAPABILITY_COPY: Record<Capability, { title: string; hint: string }> = {
  text: { title: "Text", hint: "Research analysis, scripts, storyboards — every JSON completion." },
  vision: { title: "Vision", hint: "Calls that look at images (ad teardowns with frames)." },
  image: { title: "Image", hint: "Storyboard frames and keyframes in Studio." },
  video: { title: "Video (render engine)", hint: "Default clip model when a Studio run is compiled." },
};

const TYPE_COPY: Record<ProviderType, { label: string; caps: Capability[]; baseUrl: string; hint: string }> = {
  "openai-compatible": {
    label: "OpenAI-compatible (chat, vision, images)",
    caps: ["text", "vision", "image"],
    baseUrl: "",
    hint: "Any /v1 API: OpenAI, DeepSeek, Together, Groq, a vLLM server…",
  },
  "zhipu-paid": {
    label: "Zhipu paid models (incl. video)",
    caps: ["text", "vision", "image", "video"],
    baseUrl: "https://open.bigmodel.cn/api/paas/v4/",
    hint: "Paid video: cogvideox-3 (¥1/clip) or viduq1-image (¥2.5/clip), rendered by the GLM executor.",
  },
  fal: {
    label: "fal.ai (images)",
    caps: ["image"],
    baseUrl: "https://fal.run/",
    hint: "Image model path, e.g. fal-ai/flux/dev.",
  },
};

const PRICE_FIELDS: Record<Capability, { key: "inputPerMTokUsd" | "outputPerMTokUsd" | "perImageUsd" | "perClipUsd"; label: string }[]> = {
  text: [
    { key: "inputPerMTokUsd", label: "$ / 1M input tokens" },
    { key: "outputPerMTokUsd", label: "$ / 1M output tokens" },
  ],
  vision: [],
  image: [{ key: "perImageUsd", label: "$ / image" }],
  video: [{ key: "perClipUsd", label: "$ / clip (required)" }],
};

const fmt = new Intl.NumberFormat("en-US");
const usd = (n: number) => `$${n < 1 ? n.toFixed(3) : n.toFixed(2)}`;

function Dot({ ok, warn }: { ok: boolean; warn?: boolean }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 shrink-0 rounded-full",
        ok ? "bg-[var(--status-healthy-fg)]" : warn ? "bg-[var(--status-attention-fg)]" : "bg-[var(--status-urgent-fg)]"
      )}
    />
  );
}

async function send<T>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init.json !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

export function AiSettingsClient({ initial }: { initial: AiSettingsView }) {
  const [view, setView] = useState(initial);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setView(await send<AiSettingsView>("/api/settings/ai"));
  }

  async function save(field: string, patch: Record<string, unknown>) {
    setSaving(field);
    setError(null);
    try {
      setView(await send<AiSettingsView>("/api/settings/ai", { method: "PUT", json: patch }));
      setSaved(field);
      setTimeout(() => setSaved((s) => (s === field ? null : s)), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(null);
    }
  }

  const strict = view.strictFree;
  const strictSource =
    strict.source === "db"
      ? "Saved on this page"
      : strict.source === "env"
        ? `From env AI_COST_MODE=${strict.envValue}`
        : "Default (AI_COST_MODE not set)";

  return (
    <div className="space-y-8">
      {error && (
        <div className="rounded-lg border border-[var(--status-urgent-fg)]/40 bg-[var(--status-urgent-bg)] px-3 py-2 text-sm text-[var(--status-urgent-fg)]">
          {error}
        </div>
      )}
      {view.dbError && (
        <div className="rounded-lg border border-[var(--status-attention-fg)]/40 bg-[var(--status-attention-bg)] px-3 py-2 text-xs text-[var(--status-attention-fg)]">
          Settings could not be read from the database, so env defaults apply: {view.dbError.slice(0, 200)}
        </div>
      )}

      {/* ── Strict free mode ─────────────────────────────────────────── */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold tracking-tight">Strict free mode</h2>
        <div className="rounded-lg border border-border px-3 py-3 text-sm">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="font-medium">{strict.effective ? "On — only free models run" : "Off — paid engines allowed"}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                When on, every call goes to Zhipu&apos;s free models (GLM-4.7-Flash, GLM-4.6V-Flash, CogView-3-Flash,
                CogVideoX-Flash), Pollinations or your own ComfyUI node, and anything that would spend money is refused.{" "}
                {strictSource}.
              </p>
            </div>
            <label className="flex shrink-0 cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                role="switch"
                className="h-4 w-4 accent-foreground"
                checked={strict.effective}
                disabled={saving === "strictFree"}
                onChange={(e) => save("strictFree", { strictFree: e.target.checked })}
              />
              <span className="text-xs text-muted-foreground">{saved === "strictFree" ? "Saved" : "Enabled"}</span>
            </label>
          </div>
          {strict.source === "db" && (
            <button
              type="button"
              className="mt-2 text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
              onClick={() => save("strictFree", { strictFree: null })}
            >
              Reset to the env default
            </button>
          )}
          {strict.effective && !view.zhipuConfigured && (
            <p className="mt-2 text-[11px] text-[var(--status-urgent-fg)]">
              ZHIPU_API_KEY is not set — free text, vision, image and video calls will fail until it is.
            </p>
          )}
        </div>
      </section>

      {/* ── Engines ──────────────────────────────────────────────────── */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold tracking-tight">Engines</h2>
        <p className="text-[11px] text-muted-foreground">
          The chosen engine is tried first; if it fails or has no key, calls fall back in the usual order. Text currently
          resolves to <span className="font-mono">{view.activeTextModel}</span>.
        </p>
        <ul className="rounded-lg border border-border divide-y divide-border">
          {(Object.keys(CAPABILITY_COPY) as Capability[]).map((cap) => {
            const options = view.capabilities[cap];
            const current = options.find((o) => o.value === view.settings[cap]);
            return (
              <li key={cap} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{CAPABILITY_COPY[cap].title}</p>
                  <p className="text-[11px] text-muted-foreground">{CAPABILITY_COPY[cap].hint}</p>
                  {current?.disabledReason && current.value !== "auto" && (
                    <p className="mt-0.5 text-[11px] text-[var(--status-attention-fg)]">
                      Saved choice is unavailable ({current.disabledReason}) — calls fall back automatically.
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 sm:w-80">
                  <select
                    aria-label={`${CAPABILITY_COPY[cap].title} engine`}
                    value={view.settings[cap]}
                    disabled={saving === cap}
                    onChange={(e) => save(cap, { [cap]: e.target.value })}
                    className="h-9 w-full rounded-md border border-border bg-background px-2 text-xs"
                  >
                    {options.map((o) => (
                      <option key={o.value} value={o.value} disabled={!!o.disabledReason && o.value !== view.settings[cap]}>
                        {o.label}
                        {o.paid ? " · paid" : o.value === "auto" ? "" : " · free"}
                        {o.disabledReason ? ` — ${o.disabledReason}` : ""}
                      </option>
                    ))}
                  </select>
                  <span className="w-4">
                    {saving === cap ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : saved === cap ? (
                      <Check className="h-4 w-4 text-[var(--status-healthy-fg)]" />
                    ) : null}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <FreeAllowance view={view} />
      <Usage view={view} />
      <Providers view={view} onChanged={refresh} />
    </div>
  );
}

function FreeAllowance({ view }: { view: AiSettingsView }) {
  const { video, image, facts } = view.allowance;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold tracking-tight">How much can I generate for free?</h2>
      <div className="rounded-lg border border-border px-3 py-3 text-sm space-y-2">
        <p>
          <span className="font-medium">Tokens: no published cap.</span> GLM-4.7-Flash (text) and GLM-4.6V-Flash (vision)
          cost ¥0 for input and output. Zhipu limits free models by <em>concurrency</em> — how many requests run at once —
          not by a daily token quota, and does not publish that number for the free models (your account&apos;s limit is on
          the Zhipu console). Past it you get error 1302 and calls wait and retry.
        </p>
        <p>
          <span className="font-medium">Video minutes: priced at ¥0, capped by throughput.</span>{" "}
          {video.clipsPerHour != null ? (
            <>
              Estimate: about <span className="font-medium">{video.clipsPerHour} clips ≈ {video.minutesPerHour?.toFixed(1)} min of video per hour</span>{" "}
              — {video.concurrency} clips in flight (this app&apos;s cap) × 3600 s ÷ {video.measuredSecondsPerClip} s per clip
              (measured over your last {video.samples} free clips) × {video.clipSeconds} s per clip (assumed; Zhipu doesn&apos;t
              publish the Flash clip length).
            </>
          ) : (
            <>
              No estimate yet — Zhipu publishes neither the free-model concurrency nor the generation time, and there are no
              finished free clips to measure. Render one GLM run and this fills in (clips/hour = {video.concurrency} in flight ×
              3600 s ÷ measured seconds per clip).
            </>
          )}
        </p>
        <p>
          <span className="font-medium">Images:</span> CogView-3-Flash takes about {image.secondsMin}–{image.secondsMax} s per
          image (published), so each concurrent slot yields roughly {fmt.format(image.perSlotPerHourLow)}–
          {fmt.format(image.perSlotPerHourHigh)} images per hour — an estimate.
        </p>
        <p className="text-[11px] text-muted-foreground">
          Zhipu&apos;s terms let it limit the frequency or volume of free services, or change them, at any time.
        </p>
      </div>
      <details className="rounded-lg border border-border px-3 py-2 text-sm">
        <summary className="cursor-pointer text-xs font-medium">Published facts and sources</summary>
        <table className="mt-2 w-full text-xs">
          <tbody className="divide-y divide-border">
            {facts.flatMap((m) =>
              m.facts.map((f, i) => (
                <tr key={`${m.model}-${i}`}>
                  <td className="py-1.5 pr-3 font-mono whitespace-nowrap align-top">{i === 0 ? m.model : ""}</td>
                  <td className="py-1.5 pr-3 text-muted-foreground align-top">{f.label}</td>
                  <td className="py-1.5 pr-3 align-top">{f.value}</td>
                  <td className="py-1.5 align-top">
                    <a href={f.source} target="_blank" rel="noreferrer" className="underline underline-offset-2 text-muted-foreground">
                      source
                    </a>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </details>
    </section>
  );
}

function Usage({ view }: { view: AiSettingsView }) {
  const { totals, engines, since, error } = view.usage;
  const tiles = [
    ["Tokens in", fmt.format(totals.inputTokens)],
    ["Tokens out", fmt.format(totals.outputTokens)],
    ["Images", fmt.format(totals.images)],
    ["Video minutes", totals.videoMinutes.toFixed(1)],
    ["Paid spend (est.)", usd(totals.paidSpendUsd)],
  ];
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold tracking-tight">Usage this month</h2>
      <p className="text-[11px] text-muted-foreground">Since {since.slice(0, 10)} (UTC), recorded per call.</p>
      {error ? (
        <div className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">
          Usage isn&apos;t available yet ({error.slice(0, 160)}).
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {tiles.map(([label, value]) => (
              <div key={label} className="rounded-lg border border-border px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
                <p className="text-lg font-semibold tabular-nums">{value}</p>
              </div>
            ))}
          </div>
          {totals.unpricedPaidCalls > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {fmt.format(totals.unpricedPaidCalls)} paid call{totals.unpricedPaidCalls === 1 ? "" : "s"} have no known price
              (env providers, or connected APIs without prices) and are not in the spend estimate.
            </p>
          )}
          {engines.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">No AI calls recorded yet this month.</div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-3 py-2 font-medium">Engine</th>
                    <th className="px-3 py-2 font-medium text-right">Calls</th>
                    <th className="px-3 py-2 font-medium text-right">Tokens in / out</th>
                    <th className="px-3 py-2 font-medium text-right">Images</th>
                    <th className="px-3 py-2 font-medium text-right">Video min</th>
                    <th className="px-3 py-2 font-medium text-right">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {engines.map((e) => {
                    const name = e.provider.startsWith("custom:")
                      ? (view.providers.find((p) => `custom:${p.id}` === e.provider)?.name ?? "Deleted provider")
                      : e.provider;
                    return (
                      <tr key={e.provider}>
                        <td className="px-3 py-2">
                          <span className="font-medium">{name}</span>
                          <span className="ml-1 text-muted-foreground">{e.models.join(", ")}</span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt.format(e.calls)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {fmt.format(e.inputTokens)} / {fmt.format(e.outputTokens)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt.format(e.images)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{e.videoMinutes.toFixed(1)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {e.free ? "free" : e.unpricedCalls === e.calls ? "unknown" : usd(e.costUsd) + (e.unpricedCalls ? "+" : "")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

const EMPTY_FORM = {
  name: "",
  type: "openai-compatible" as ProviderType,
  baseUrl: "",
  apiKey: "",
  models: { text: "", vision: "", image: "", video: "" } as Record<Capability, string>,
  prices: {} as Record<string, string>,
};

function Providers({ view, onChanged }: { view: AiSettingsView; onChanged: () => Promise<void> }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, { ok: boolean; message: string }>>({});
  const typeCopy = TYPE_COPY[form.type];

  async function add() {
    setBusy("add");
    setError(null);
    try {
      const models: Partial<Record<Capability, string>> = {};
      for (const cap of typeCopy.caps) if (form.models[cap].trim()) models[cap] = form.models[cap].trim();
      const prices: Record<string, number> = {};
      for (const [k, v] of Object.entries(form.prices)) if (v.trim() !== "") prices[k] = Number(v);
      await send("/api/settings/ai/providers", {
        method: "POST",
        json: {
          name: form.name,
          type: form.type,
          baseUrl: form.baseUrl.trim() || null,
          apiKey: form.apiKey,
          models,
          prices: Object.keys(prices).length ? prices : null,
        },
      });
      setForm(EMPTY_FORM);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy(`del-${id}`);
    try {
      await send(`/api/settings/ai/providers/${id}`, { method: "DELETE" });
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function test(id: string) {
    setBusy(`test-${id}`);
    try {
      const r = await send<{ ok: boolean; message: string }>(`/api/settings/ai/providers/${id}/test`, { method: "POST" });
      setTests((t) => ({ ...t, [id]: r }));
    } catch (err) {
      setTests((t) => ({ ...t, [id]: { ok: false, message: err instanceof Error ? err.message : String(err) } }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold tracking-tight">Connect a model API</h2>
      <p className="text-[11px] text-muted-foreground">
        Bring your own paid key. Keys are encrypted at rest (AES-256-GCM) and only the last 4 characters are ever shown.
        Connected APIs appear in the engine menus above.
      </p>

      {view.providers.length > 0 && (
        <ul className="rounded-lg border border-border divide-y divide-border">
          {view.providers.map((p) => (
            <li key={p.id} className="px-3 py-2.5 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium">
                    <Dot ok={!p.keyError} />
                    {p.name}
                    <span className="text-[11px] font-normal text-muted-foreground">{TYPE_COPY[p.type].label}</span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground break-words">
                    Key ••••{p.keyLast4} · {p.baseUrl} ·{" "}
                    {p.capabilities.map((c) => `${c}: ${p.models[c]}`).join(" · ")}
                    {p.prices?.perClipUsd ? ` · ${usd(p.prices.perClipUsd)}/clip` : ""}
                  </p>
                  {p.keyError && <p className="mt-0.5 text-[11px] text-[var(--status-urgent-fg)]">{p.keyError}</p>}
                  {tests[p.id] && (
                    <p className={cn("mt-0.5 text-[11px]", tests[p.id].ok ? "text-[var(--status-healthy-fg)]" : "text-[var(--status-urgent-fg)]")}>
                      {tests[p.id].message}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button size="sm" variant="outline" disabled={!!busy} onClick={() => test(p.id)}>
                    {busy === `test-${p.id}` ? <Loader2 className="animate-spin" /> : <Plug />}
                    Test connection
                  </Button>
                  <Button size="sm" variant="destructive" disabled={!!busy} onClick={() => remove(p.id)} aria-label={`Delete ${p.name}`}>
                    {busy === `del-${p.id}` ? <Loader2 className="animate-spin" /> : <Trash2 />}
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-lg border border-border px-3 py-3 space-y-3">
        {!view.encryptionReady && (
          <p className="rounded-md bg-[var(--status-attention-bg)] px-2 py-1.5 text-[11px] text-[var(--status-attention-fg)]">
            SETTINGS_ENCRYPTION_KEY is not set, so keys can&apos;t be stored. Add a 32-byte key (e.g.{" "}
            <code className="font-mono">openssl rand -base64 32</code>) to the environment and redeploy.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Name</span>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="My Zhipu account" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Type</span>
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as ProviderType, prices: {} })}
              className="h-8 w-full rounded-lg border border-input bg-background px-2 text-xs"
            >
              {(Object.keys(TYPE_COPY) as ProviderType[]).map((t) => (
                <option key={t} value={t}>
                  {TYPE_COPY[t].label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Base URL</span>
            <Input
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              placeholder={typeCopy.baseUrl || "https://api.example.com/v1"}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">API key</span>
            <Input
              type="password"
              autoComplete="off"
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              placeholder="Stored encrypted"
            />
          </label>
        </div>
        <p className="text-[11px] text-muted-foreground">{typeCopy.hint}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {typeCopy.caps.map((cap) => (
            <div key={cap} className="space-y-1.5">
              <label className="block">
                <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {CAPABILITY_COPY[cap].title} model id
                </span>
                <Input
                  value={form.models[cap]}
                  onChange={(e) => setForm({ ...form, models: { ...form.models, [cap]: e.target.value } })}
                  placeholder={cap === "video" ? "cogvideox-3" : cap === "image" && form.type === "fal" ? "fal-ai/flux/dev" : "optional"}
                />
              </label>
              {form.models[cap].trim() &&
                PRICE_FIELDS[cap].map((f) => (
                  <label key={f.key} className="flex items-center gap-2">
                    <Input
                      inputMode="decimal"
                      className="w-28"
                      value={form.prices[f.key] ?? ""}
                      onChange={(e) => setForm({ ...form, prices: { ...form.prices, [f.key]: e.target.value } })}
                    />
                    <span className="text-[11px] text-muted-foreground">{f.label}</span>
                  </label>
                ))}
            </div>
          ))}
        </div>
        {error && <p className="text-[11px] text-[var(--status-urgent-fg)]">{error}</p>}
        <Button disabled={busy === "add" || !form.name.trim() || !form.apiKey.trim() || !view.encryptionReady} onClick={add}>
          {busy === "add" && <Loader2 className="animate-spin" />}
          Connect
        </Button>
      </div>
    </section>
  );
}
