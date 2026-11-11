// Burn accounting.
//
// The double-counting rule: total burned is the sum of the burn-sink balances and nothing else.
// Sources (fees, buybacks, partners) only label where a sink's inflows came from. A partner burn that was
// routed into a sink is already inside that sink's balance, so it is attributed, never added.

import { DAY_MS } from './time.js';

export interface SinkInflow {
  timeMs: number;
  sink: string; // key from config sinks, e.g. "hypercore_af"
  from: string; // sender address
  kntq: number;
  usd?: number;
}

export const UNATTRIBUTED = 'unattributed';

/** address (any case) -> source label */
export type AttributionMap = Record<string, string>;

export function buildAttributionMap(bySource: Record<string, string[]>): AttributionMap {
  const map: AttributionMap = {};
  for (const [source, addresses] of Object.entries(bySource)) {
    for (const a of addresses) {
      const key = a.toLowerCase();
      if (map[key] && map[key] !== source) throw new Error(`address ${key} is attributed to both ${map[key]} and ${source}`);
      map[key] = source;
    }
  }
  return map;
}

export const classify = (inflow: SinkInflow, map: AttributionMap): string => map[inflow.from.toLowerCase()] ?? UNATTRIBUTED;

const inWindow = (t: number, t0: number, t1: number) => t > t0 && t <= t1;

/** KNTQ that entered any sink in (t0, t1]. */
export const burnedInWindow = (inflows: SinkInflow[], t0: number, t1: number): number =>
  inflows.reduce((s, x) => (inWindow(x.timeMs, t0, t1) ? s + x.kntq : s), 0);

/** The same amount split by source. The parts always sum to burnedInWindow. */
export function burnedBySource(inflows: SinkInflow[], map: AttributionMap, t0: number, t1: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of inflows) {
    if (!inWindow(x.timeMs, t0, t1)) continue;
    const src = classify(x, map);
    out[src] = (out[src] ?? 0) + x.kntq;
  }
  return out;
}

/** Ground truth: the sum of the sink balances. */
export const totalBurned = (sinkBalances: Record<string, number>): number =>
  Object.values(sinkBalances).reduce((s, v) => s + v, 0);

export interface SinkReconciliation {
  sink: string;
  balance: number;
  ledgerSum: number;
  /** balance minus ledger. Positive: inflows we have no record of. Negative: something left the sink. */
  residual: number;
  ok: boolean;
}

/** Compare each sink's balance with the sum of the inflows recorded for it. */
export function reconcileSinks(sinkBalances: Record<string, number>, inflows: SinkInflow[], toleranceKntq = 0.01): SinkReconciliation[] {
  return Object.entries(sinkBalances).map(([sink, balance]) => {
    const ledgerSum = inflows.reduce((s, x) => (x.sink === sink ? s + x.kntq : s), 0);
    const residual = balance - ledgerSum;
    return { sink, balance, ledgerSum, residual, ok: Math.abs(residual) <= toleranceKntq };
  });
}

export interface GuardedBreakdown {
  total: number;
  bySource: Record<string, number>;
  unattributed: number;
}

/**
 * The double-counting guard. Given the change in sink balances and the amounts attributed to sources,
 * return a breakdown whose parts sum exactly to the sink change. Attributing more than the sinks received
 * means something was counted twice, so it throws.
 */
export function guardedBreakdown(sinkDelta: number, attributed: Record<string, number>, toleranceKntq = 0.01): GuardedBreakdown {
  const named = Object.entries(attributed).filter(([k]) => k !== UNATTRIBUTED);
  const sum = named.reduce((s, [, v]) => s + v, 0);
  if (sum > sinkDelta + toleranceKntq) {
    throw new Error(`double count: ${sum.toFixed(4)} KNTQ attributed to sources but the sinks only received ${sinkDelta.toFixed(4)}`);
  }
  return { total: sinkDelta, bySource: Object.fromEntries(named), unattributed: Math.max(0, sinkDelta - sum) };
}

export interface PartnerBurnReport {
  slug: string;
  kntq: number;
  /** Key of the tracked sink the partner says it burned into, or null if the destination is not a tracked sink. */
  sink: string | null;
}

/**
 * Fold partner-reported burns into the picture without ever raising the total.
 * Reports into a tracked sink are informational (already in that sink's balance).
 * Reports to anywhere else are returned as warnings: the fix is to add that address as a sink, not to add the number.
 */
export function withPartnerReports(sinkBalances: Record<string, number>, reports: PartnerBurnReport[]) {
  const total = totalBurned(sinkBalances);
  const insideSinks = reports.filter((r) => r.sink !== null && r.sink in sinkBalances);
  const outsideSinks = reports.filter((r) => r.sink === null || !(r.sink in sinkBalances)).filter((r) => r.kntq > 0);
  return { total, insideSinks, outsideSinks };
}

export interface RunRate {
  kntqPerDay: number;
  daysUsed: number;
  /** true when less history than the requested window was available */
  shortHistory: boolean;
}

/** Average KNTQ per day over the trailing window, using whatever history exists if it is shorter. */
export function runRate(inflows: SinkInflow[], nowMs: number, windowDays: number, historyStartMs: number): RunRate {
  const fullStart = nowMs - windowDays * DAY_MS;
  const start = Math.max(fullStart, historyStartMs);
  const daysUsed = (nowMs - start) / DAY_MS;
  if (daysUsed <= 0) return { kntqPerDay: 0, daysUsed: 0, shortHistory: true };
  return { kntqPerDay: burnedInWindow(inflows, start, nowMs) / daysUsed, daysUsed, shortHistory: start > fullStart };
}
