// Unlock model: tranche maths, the pre-unlock projection, and what counts as unlocked in a window.
//
// Rules (brief section 4 and Phase 0 decisions):
// - Before the first tranche a "Projected (pre-unlock)" line runs at tranche / 30 per day from the model start.
// - The projection is its own series. It is never added to real unlocks.
// - After the first tranche, cumulative figures are monthly steps and daily figures are a 30-day smoothed rate.
// - There is no vesting contract, so "unlocked" after the first tranche is the larger of the scheduled amount
//   and what has been seen leaving the wallets. Any difference between the two is reported.

import { DAY_MS, addMonthsUtc, overlapMs } from './time.js';

export interface UnlockParams {
  contributorsKntq: number;
  investorsKntq: number;
  trancheCount: number;
  firstTrancheMs: number;
  modelStartMs: number;
  preUnlockSmoothingDays: number;
  unlockSmoothingDays: number;
}

export interface Tranche {
  index: number; // 1-based
  timeMs: number;
  contributorsKntq: number;
  investorsKntq: number;
  kntq: number;
}

export interface ObservedUnlock {
  timeMs: number;
  kntq: number;
  wallet: 'contributors' | 'investors';
}

export function monthlyTranche(p: UnlockParams) {
  const contributors = p.contributorsKntq / p.trancheCount;
  const investors = p.investorsKntq / p.trancheCount;
  return { contributors, investors, total: contributors + investors };
}

export function trancheSchedule(p: UnlockParams): Tranche[] {
  const t = monthlyTranche(p);
  return Array.from({ length: p.trancheCount }, (_, i) => ({
    index: i + 1,
    timeMs: addMonthsUtc(p.firstTrancheMs, i),
    contributorsKntq: t.contributors,
    investorsKntq: t.investors,
    kntq: t.total,
  }));
}

/** KNTQ per day of the "Projected (pre-unlock)" line. */
export const preUnlockDailyRate = (p: UnlockParams): number => monthlyTranche(p).total / p.preUnlockSmoothingDays;

/** Projected KNTQ in [t0, t1], counting only the part between the model start and the first tranche. */
export function projectedPreUnlock(p: UnlockParams, t0: number, t1: number): number {
  return (preUnlockDailyRate(p) * overlapMs(t0, t1, p.modelStartMs, p.firstTrancheMs)) / DAY_MS;
}

/** Cumulative scheduled KNTQ unlocked at time t (a step function). */
export function scheduledCumulative(p: UnlockParams, tMs: number): number {
  return trancheSchedule(p).reduce((s, tr) => (tr.timeMs <= tMs ? s + tr.kntq : s), 0);
}

export const observedCumulative = (events: ObservedUnlock[], tMs: number): number =>
  events.reduce((s, e) => (e.timeMs <= tMs ? s + e.kntq : s), 0);

interface Step {
  timeMs: number;
  kntq: number;
}

/**
 * The unlock steps the model treats as real up to `nowMs`: every scheduled tranche that has fallen due,
 * plus any amount seen leaving the wallets beyond the schedule (dated when it was seen).
 */
export function effectiveSteps(p: UnlockParams, observed: ObservedUnlock[], nowMs: number): Step[] {
  const steps: Step[] = trancheSchedule(p)
    .filter((tr) => tr.timeMs <= nowMs)
    .map((tr) => ({ timeMs: tr.timeMs, kntq: tr.kntq }));
  // Walk observed outflows in time order; whatever exceeds the schedule at that moment is an extra step.
  let extra = 0;
  let seen = 0;
  for (const e of [...observed].filter((o) => o.timeMs <= nowMs).sort((a, b) => a.timeMs - b.timeMs)) {
    seen += e.kntq;
    const excess = seen - scheduledCumulative(p, e.timeMs) - extra;
    if (excess > 1e-6) {
      steps.push({ timeMs: e.timeMs, kntq: excess });
      extra += excess;
    }
  }
  return steps.sort((a, b) => a.timeMs - b.timeMs);
}

/** Smoothed amount in [t0, t1]: each step is spread evenly over the `days` that follow it. */
export function smoothedAmount(steps: Step[], t0: number, t1: number, days: number): number {
  return steps.reduce((s, st) => s + (st.kntq * overlapMs(t0, t1, st.timeMs, st.timeMs + days * DAY_MS)) / (days * DAY_MS), 0);
}

export type UnlockKind = 'projected' | 'actual';

export interface UnlockWindow {
  kind: UnlockKind;
  /** The figure to use for this window: projected before the first tranche, real steps after it. */
  kntq: number;
  /** After the first tranche only: the same window with each step spread over 30 days. */
  smoothedKntq: number | null;
  /** Seen leaving the vesting wallets in the window. */
  observedKntq: number;
  /** Due under the schedule in the window. */
  scheduledKntq: number;
  flags: string[];
}

/**
 * What counts as unlocked between t0 and t1, judged at `nowMs`.
 * The projection applies only while no tranche is due and nothing has left the wallets.
 */
export function unlockedInWindow(p: UnlockParams, observed: ObservedUnlock[], t0: number, t1: number, nowMs: number): UnlockWindow {
  const obsBefore = observedCumulative(observed, t0);
  const obsNow = observedCumulative(observed, t1);
  const observedKntq = obsNow - obsBefore;
  const scheduledKntq = scheduledCumulative(p, t1) - scheduledCumulative(p, t0);
  const flags: string[] = [];
  const anyReal = nowMs >= p.firstTrancheMs || observedCumulative(observed, nowMs) > 0;

  if (!anyReal) {
    return { kind: 'projected', kntq: projectedPreUnlock(p, t0, t1), smoothedKntq: null, observedKntq: 0, scheduledKntq: 0, flags };
  }

  const steps = effectiveSteps(p, observed, nowMs);
  const kntq = steps.reduce((s, st) => (st.timeMs > t0 && st.timeMs <= t1 ? s + st.kntq : s), 0);
  const totalScheduled = scheduledCumulative(p, nowMs);
  const totalObserved = observedCumulative(observed, nowMs);
  const tolerance = monthlyTranche(p).total * 0.001;
  if (totalObserved < totalScheduled - tolerance) flags.push('scheduled_not_yet_moved');
  if (totalObserved > totalScheduled + tolerance) flags.push('moved_ahead_of_schedule');
  return {
    kind: 'actual',
    kntq,
    smoothedKntq: smoothedAmount(steps, t0, t1, p.unlockSmoothingDays),
    observedKntq,
    scheduledKntq,
    flags,
  };
}
