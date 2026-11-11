// Headline metrics: for 24h, 7d and since the model start.
// Pure function of its inputs, so the CLI, the collector and the browser all get the same numbers.

import type { Assumptions } from './assumptions.js';
import { type SinkInflow, buildAttributionMap, burnedBySource, burnedInWindow, reconcileSinks, runRate, totalBurned, type SinkReconciliation, type RunRate } from './burn.js';
import { type EstimateSeries, estimatedInWindow } from './estimate.js';
import { type BreakEven, type Purchase, breakEven, buyPressureUsdPerDay, purchasesInWindow, sellPressureUsdPerDay, sellThroughFor, type SellThrough } from './flow.js';
import { type Crossover, findCrossover } from './projection.js';
import { DAY_MS } from './time.js';
import { type ObservedUnlock, type UnlockWindow, effectiveSteps, monthlyTranche, preUnlockDailyRate, smoothedAmount, trancheSchedule, unlockedInWindow } from './unlock.js';

export interface PendingBurn {
  timeMs: number;
  source: string;
  kntq: number;
}

export interface Release {
  timeMs: number;
  wallet: 'foundation' | 'growth';
  kntq: number;
}

export interface ModelInputs {
  nowMs: number;
  kntqUsd: number;
  /** current balance of every burn sink, keyed as in config */
  sinkBalances: Record<string, number>;
  /** every recorded inflow into the sinks (full history where available) */
  sinkInflows: SinkInflow[];
  /** KNTQ earmarked for burning but still held by its owner. Never part of the burned total. */
  pendingBurns: PendingBurn[];
  /** flat-rate estimates for sources with no observed data */
  estimates: EstimateSeries[];
  observedUnlocks: ObservedUnlock[];
  releases: Release[];
  /** open-market purchases, burned or not */
  purchases: Purchase[];
}

export interface WindowMetrics {
  label: string;
  t0: number;
  t1: number;
  /** true when the window was cut off at the model start */
  clamped: boolean;
  /** actual length of the window in days */
  days: number;
  burnedActual: number;
  burnedBySource: Record<string, number>;
  pendingBurn: number;
  estimated: number;
  /** actual + pending + estimated; always shown with a tag */
  burnedInclEstimates: number;
  unlocked: UnlockWindow;
  /** the unlocked figure used for comparison with burns over this window */
  unlockedForComparison: number;
  released: number;
  /** released + real unlocks - burned (KNTQ). Positive means supply grew. */
  netSupplyChangeActual: number;
  /** the same, also counting the pre-unlock projection while it applies */
  netSupplyChangeInclProjected: number;
  coverageActual: number | null;
  coverageInclEstimates: number | null;
  purchasesUsd: number;
}

export interface Headline {
  nowMs: number;
  kntqUsd: number;
  totalBurnedAllTime: number;
  sinkReconciliation: SinkReconciliation[];
  windows: WindowMetrics[];
  tranche: { kntq: number; usd: number; contributorsKntq: number; investorsKntq: number };
  firstTranche: { timeMs: number; msUntil: number; unverified: boolean };
  runRate: RunRate;
  crossover: Crossover;
  breakEven: BreakEven;
  flow: { buyUsdPerDay: number; sellUsdPerDay: number; sellBySource: Record<string, number>; windowDays: number };
  flags: string[];
}

const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);
const sumIn = <T extends { timeMs: number; kntq: number }>(xs: T[], t0: number, t1: number) =>
  xs.reduce((s, x) => (x.timeMs > t0 && x.timeMs <= t1 ? s + x.kntq : s), 0);

export function computeHeadline(inp: ModelInputs, a: Assumptions, sellThrough: SellThrough = a.sellThrough): Headline {
  const { nowMs, kntqUsd } = inp;
  const map = buildAttributionMap(a.attribution);
  const flags: string[] = [];

  // The model starts on 11 Nov, and so does the unlock projection. A rolling window is cut off at the model
  // start so burns and unlocks always cover the same period; until 18 Nov the 7d column is therefore shorter than 7 days.
  const windowSpecs = [
    { label: '24h', from: nowMs - DAY_MS },
    { label: '7d', from: nowMs - 7 * DAY_MS },
    { label: 'since 11 Nov', from: a.modelStartMs },
  ].map((w) => ({ label: w.label, t0: Math.max(w.from, a.modelStartMs), clamped: w.from < a.modelStartMs }));

  const windows: WindowMetrics[] = windowSpecs.map(({ label, t0, clamped }) => {
    const t1 = nowMs;
    const sinceStart = t0 === a.modelStartMs;
    const burnedActual = burnedInWindow(inp.sinkInflows, t0, t1);
    const pendingBurn = sumIn(inp.pendingBurns, t0, t1);
    const estimated = estimatedInWindow(inp.estimates, t0, t1);
    const unlocked = unlockedInWindow(a.unlock, inp.observedUnlocks, t0, t1, nowMs);
    // Cumulative view uses real steps; rolling windows use the 30-day smoothed rate so they compare with daily burns.
    const unlockedForComparison = unlocked.kind === 'projected' || sinceStart ? unlocked.kntq : (unlocked.smoothedKntq ?? unlocked.kntq);
    const released = sumIn(inp.releases, t0, t1);
    const realUnlocked = unlocked.kind === 'actual' ? unlockedForComparison : 0;
    const burnedInclEstimates = burnedActual + pendingBurn + estimated;
    return {
      label,
      t0,
      t1,
      clamped,
      days: (t1 - t0) / DAY_MS,
      burnedActual,
      burnedBySource: burnedBySource(inp.sinkInflows, map, t0, t1),
      pendingBurn,
      estimated,
      burnedInclEstimates,
      unlocked,
      unlockedForComparison,
      released,
      netSupplyChangeActual: released + realUnlocked - burnedActual,
      netSupplyChangeInclProjected: released + unlockedForComparison - burnedActual,
      coverageActual: ratio(burnedActual, unlockedForComparison),
      coverageInclEstimates: ratio(burnedInclEstimates, unlockedForComparison),
      purchasesUsd: purchasesInWindow(inp.purchases, t0, t1).usd,
    };
  });
  for (const w of windows) for (const f of w.unlocked.flags) if (!flags.includes(f)) flags.push(f);

  const sinkReconciliation = reconcileSinks(inp.sinkBalances, inp.sinkInflows);
  for (const r of sinkReconciliation) {
    if (r.residual < -0.01) flags.push(`sink_outflow:${r.sink}`);
    else if (r.residual > 0.01) flags.push(`sink_inflows_unrecorded:${r.sink}`);
  }

  const tr = monthlyTranche(a.unlock);
  const schedule = trancheSchedule(a.unlock);
  const firstInflow = inp.sinkInflows.reduce((m, x) => Math.min(m, x.timeMs), nowMs);
  const rr = runRate(inp.sinkInflows, nowMs, a.runRateDays, firstInflow);
  const lastTranche = schedule[schedule.length - 1]!.timeMs;
  const crossover = findCrossover(
    { nowMs, burnedSinceStart: burnedInWindow(inp.sinkInflows, a.modelStartMs, nowMs), burnRatePerDay: rr.kntqPerDay, schedule },
    lastTranche + a.crossoverHorizonYears * 365.25 * DAY_MS,
  );

  // Flow lens over the last 7 days.
  const flowDays = 7;
  const f0 = nowMs - flowDays * DAY_MS;
  const buyUsdPerDay = buyPressureUsdPerDay(inp.purchases, f0, nowMs);
  const unlockPerDay =
    nowMs < a.unlock.firstTrancheMs && inp.observedUnlocks.length === 0
      ? preUnlockDailyRate(a.unlock)
      : smoothedAmount(effectiveSteps(a.unlock, inp.observedUnlocks, nowMs), f0, nowMs, a.unlock.unlockSmoothingDays) / flowDays;
  const sell = sellPressureUsdPerDay(
    [
      { source: 'unlocks', kntqPerDay: unlockPerDay },
      { source: 'growth_foundation', kntqPerDay: sumIn(inp.releases, f0, nowMs) / flowDays },
    ],
    kntqUsd,
    sellThrough,
  );

  return {
    nowMs,
    kntqUsd,
    totalBurnedAllTime: totalBurned(inp.sinkBalances),
    sinkReconciliation,
    windows,
    tranche: { kntq: tr.total, usd: tr.total * kntqUsd, contributorsKntq: tr.contributors, investorsKntq: tr.investors },
    firstTranche: { timeMs: a.unlock.firstTrancheMs, msUntil: a.unlock.firstTrancheMs - nowMs, unverified: a.unverified.includes('vesting.first_tranche_utc') },
    runRate: rr,
    crossover,
    breakEven: breakEven(tr.total, kntqUsd, sellThroughFor('unlocks', sellThrough), buyUsdPerDay, a.unlock.unlockSmoothingDays),
    flow: { buyUsdPerDay, sellUsdPerDay: sell.total, sellBySource: sell.bySource, windowDays: flowDays },
    flags,
  };
}
