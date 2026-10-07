/**
 * The live price table: DEFAULT_PRICES, then env CI_PRICE_OVERRIDES (JSON), then the saved settings
 * JSON (AppSetting "ops.prices"), cached ~60 s. Never throws — without a database it is the defaults.
 */
import { DEFAULT_PRICES, mergePriceOverrides, type PriceTable } from "./cost-model";

export const PRICE_SETTINGS_KEY = "ops.prices";
const TTL_MS = 60_000;
let _cache: { at: number; table: PriceTable } | null = null;

function envOverrides(): unknown {
  try {
    return process.env.CI_PRICE_OVERRIDES ? JSON.parse(process.env.CI_PRICE_OVERRIDES) : null;
  } catch {
    return null;
  }
}

export async function loadPriceTable(): Promise<PriceTable> {
  const base = mergePriceOverrides(DEFAULT_PRICES, envOverrides());
  if (process.env.VITEST) return base;
  if (_cache && Date.now() - _cache.at < TTL_MS) return _cache.table;
  let table = base;
  try {
    const { prisma } = await import("@/lib/db");
    const row = await prisma.appSetting.findUnique({ where: { key: PRICE_SETTINGS_KEY } });
    if (row?.value) table = mergePriceOverrides(base, row.value);
  } catch {
    // defaults
  }
  _cache = { at: Date.now(), table };
  return table;
}

export function invalidatePriceTable(): void {
  _cache = null;
}
