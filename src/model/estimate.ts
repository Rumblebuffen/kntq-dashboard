// Estimates for sources with no observed burns yet (brief section 6).
// Nothing here is ever merged into an "actual" figure; callers keep the tag.

import { DAY_MS, overlapMs } from './time.js';

export type EvidenceTier = 'actual' | 'derived' | 'benchmark';

export interface EstimateInputs {
  revenueUsdPerDay: number;
  /** share of revenue that buys KNTQ, 0..1 */
  commitment: number;
  /** share of the KNTQ bought that is burned, 0..1 */
  burnedShare: number;
  priceUsd: number;
  /** bear 0.25, base 1, bull 3 */
  scenario?: number;
}

const check = (name: string, v: number, lo = 0, hi = 1) => {
  if (!(v >= lo && v <= hi)) throw new Error(`${name} must be between ${lo} and ${hi}, got ${v}`);
};

/** estimated KNTQ bought per day = revenue x commitment / price */
export function estimateDailyBoughtKntq(i: EstimateInputs): number {
  check('commitment', i.commitment);
  if (!(i.priceUsd > 0)) throw new Error('price must be positive');
  if (i.revenueUsdPerDay < 0) throw new Error('revenue cannot be negative');
  return (i.revenueUsdPerDay * (i.scenario ?? 1) * i.commitment) / i.priceUsd;
}

/** estimated KNTQ burned per day = revenue x commitment x burned share / price */
export function estimateDailyBurnKntq(i: EstimateInputs): number {
  check('burnedShare', i.burnedShare);
  return estimateDailyBoughtKntq(i) * i.burnedShare;
}

/** Share of a partner's revenue base that ends up burned, and bought-but-not-burned. */
export function partnerShares(commitment: number, burnedShare: number) {
  check('commitment', commitment);
  check('burnedShare', burnedShare);
  return { burnedOfRevenue: commitment * burnedShare, boughtNotBurnedOfRevenue: commitment * (1 - burnedShare) };
}

/** KNTQ the sequencer's fee accrual would buy: HYPE collected x KNTQ share x HYPE price / KNTQ price. */
export function sequencerAccrualKntq(feeHype: number, kntqShare: number, hypeUsd: number, kntqUsd: number): number {
  check('kntqShare', kntqShare);
  if (!(kntqUsd > 0)) throw new Error('price must be positive');
  return (Math.max(0, feeHype) * kntqShare * hypeUsd) / kntqUsd;
}

export interface EstimateSeries {
  source: string;
  tier: Exclude<EvidenceTier, 'actual'>;
  kntqPerDay: number;
  fromMs: number;
  /** open-ended if omitted */
  toMs?: number;
}

/** Estimated KNTQ in [t0, t1] from a set of flat-rate estimate series. */
export const estimatedInWindow = (series: EstimateSeries[], t0: number, t1: number): number =>
  series.reduce((s, e) => s + (e.kntqPerDay * overlapMs(t0, t1, e.fromMs, e.toMs ?? Number.POSITIVE_INFINITY)) / DAY_MS, 0);
