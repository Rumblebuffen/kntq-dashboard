// Flow lens (USD per day): open-market buying vs sell pressure, and the break-even panel.
// Fee accrual into the AF is a burn but not a purchase, so it never appears here.

import { DAY_MS } from './time.js';

export type SellSource = 'unlocks' | 'growth_foundation' | 'kpoints' | 'incentives';

export interface SellThrough {
  /** 0..1, default 1 (worst case) */
  global: number;
  overrides: Partial<Record<SellSource, number>>;
}

export function sellThroughFor(source: SellSource, st: SellThrough): number {
  const v = st.overrides[source] ?? st.global;
  if (!(v >= 0 && v <= 1)) throw new Error(`sell-through for ${source} must be between 0 and 1, got ${v}`);
  return v;
}

export interface Purchase {
  timeMs: number;
  source: string;
  kntq: number;
  usd: number;
}

/** USD of open-market purchases in (t0, t1], split by source. */
export function purchasesInWindow(purchases: Purchase[], t0: number, t1: number) {
  const bySource: Record<string, { kntq: number; usd: number }> = {};
  let usd = 0;
  let kntq = 0;
  for (const p of purchases) {
    if (!(p.timeMs > t0 && p.timeMs <= t1)) continue;
    const s = (bySource[p.source] ??= { kntq: 0, usd: 0 });
    s.kntq += p.kntq;
    s.usd += p.usd;
    usd += p.usd;
    kntq += p.kntq;
  }
  return { usd, kntq, bySource };
}

export const buyPressureUsdPerDay = (purchases: Purchase[], t0: number, t1: number): number =>
  t1 > t0 ? purchasesInWindow(purchases, t0, t1).usd / ((t1 - t0) / DAY_MS) : 0;

export interface SellPressureLine {
  source: SellSource;
  kntqPerDay: number;
}

/** Sell pressure in USD per day: each line's KNTQ per day x its sell-through x price. */
export function sellPressureUsdPerDay(lines: SellPressureLine[], priceUsd: number, st: SellThrough) {
  const bySource: Partial<Record<SellSource, number>> = {};
  let total = 0;
  for (const l of lines) {
    const usd = l.kntqPerDay * sellThroughFor(l.source, st) * priceUsd;
    bySource[l.source] = (bySource[l.source] ?? 0) + usd;
    total += usd;
  }
  return { total, bySource };
}

export interface BreakEven {
  requiredUsdPerDay: number;
  currentUsdPerDay: number;
  gapUsdPerDay: number;
  /** current / required, 0..n */
  covered: number;
}

/** Daily buybacks needed to absorb one tranche sold over `days` at the given sell-through and price. */
export function breakEven(trancheKntq: number, priceUsd: number, sellThrough: number, currentUsdPerDay: number, days = 30): BreakEven {
  const requiredUsdPerDay = (trancheKntq * priceUsd * sellThrough) / days;
  return {
    requiredUsdPerDay,
    currentUsdPerDay,
    gapUsdPerDay: requiredUsdPerDay - currentUsdPerDay,
    covered: requiredUsdPerDay > 0 ? currentUsdPerDay / requiredUsdPerDay : Number.POSITIVE_INFINITY,
  };
}
