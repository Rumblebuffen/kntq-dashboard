// Cumulative projection from the model start: burned at the current run-rate vs unlocked across all tranches,
// and the date (if any) when cumulative burned catches cumulative unlocked.

import { DAY_MS } from './time.js';
import type { Tranche } from './unlock.js';

export interface ProjectionInputs {
  nowMs: number;
  /** burned since the model start, as at now */
  burnedSinceStart: number;
  burnRatePerDay: number;
  schedule: Tranche[];
}

export const projectedBurnedAt = (i: ProjectionInputs, tMs: number): number =>
  i.burnedSinceStart + (i.burnRatePerDay * Math.max(0, tMs - i.nowMs)) / DAY_MS;

export const scheduledUnlockedAt = (schedule: Tranche[], tMs: number): number =>
  schedule.reduce((s, tr) => (tr.timeMs <= tMs ? s + tr.kntq : s), 0);

export interface Crossover {
  /**
   * The crossover to mark: when cumulative burned reaches cumulative unlocked and stays at or above it
   * through every remaining tranche. null if that does not happen within the horizon.
   */
  lastingMs: number | null;
  /** The first time burned catches unlocked after being behind. It may fall behind again at the next tranche. */
  firstMs: number | null;
  /** When burned first falls behind unlocked (normally the first tranche). null if it never does. */
  behindFromMs: number | null;
}

/**
 * Unlocked is a step function and burned is a straight line, so within each gap between tranches the line
 * either reaches the current step height or it does not. Check each gap in order. The last gap that starts
 * with burned behind is the one whose crossing (if any) is lasting.
 */
export function findCrossover(i: ProjectionInputs, horizonMs: number): Crossover {
  const steps = [...i.schedule].sort((a, b) => a.timeMs - b.timeMs);
  const boundaries = [i.nowMs, ...steps.filter((s) => s.timeMs > i.nowMs).map((s) => s.timeMs)];
  let behindFromMs: number | null = null;
  let firstMs: number | null = null;
  let lastingMs: number | null = null;

  for (let k = 0; k < boundaries.length; k++) {
    const from = boundaries[k]!;
    if (from >= horizonMs) break;
    const to = Math.min(boundaries[k + 1] ?? horizonMs, horizonMs);
    const unlocked = scheduledUnlockedAt(steps, from);
    if (projectedBurnedAt(i, from) >= unlocked) continue;
    behindFromMs ??= from;
    lastingMs = null; // behind again, so any earlier crossing did not last
    if (i.burnRatePerDay > 0) {
      const t = i.nowMs + ((unlocked - i.burnedSinceStart) / i.burnRatePerDay) * DAY_MS;
      if (t <= to) {
        firstMs ??= t;
        lastingMs = t;
      }
    }
  }
  return { lastingMs, firstMs, behindFromMs };
}

/** Points for the cumulative chart: one at now, then just before and at each remaining tranche. */
export function cumulativeSeries(i: ProjectionInputs) {
  const times = [i.nowMs, ...i.schedule.filter((s) => s.timeMs > i.nowMs).flatMap((s) => [s.timeMs - 1, s.timeMs])];
  return times.map((tMs) => ({ tMs, burned: projectedBurnedAt(i, tMs), unlocked: scheduledUnlockedAt(i.schedule, tMs) }));
}
