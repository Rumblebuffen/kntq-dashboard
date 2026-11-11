import { describe, expect, it } from 'vitest';
import { DAY_MS, HOUR_MS, addMonthsUtc, daysBetween, ictDayKey, ictDayStartMs } from '../src/model/time.js';
import { type ObservedUnlock, type UnlockParams, effectiveSteps, monthlyTranche, preUnlockDailyRate, projectedPreUnlock, scheduledCumulative, smoothedAmount, trancheSchedule, unlockedInWindow } from '../src/model/unlock.js';

const START = Date.parse('2026-11-10T17:00:00Z'); // 11 Nov 00:00 ICT
const BRIEF_FIRST = Date.parse('2026-11-27T19:00:00Z'); // 28 Nov 02:00 ICT, the brief's anchor
const p = (firstTrancheMs = BRIEF_FIRST): UnlockParams => ({
  contributorsKntq: 235_000_000,
  investorsKntq: 75_000_000,
  trancheCount: 24,
  firstTrancheMs,
  modelStartMs: START,
  preUnlockSmoothingDays: 30,
  unlockSmoothingDays: 30,
});

describe('tranche maths (brief section 13)', () => {
  it('monthly tranche is 12,916,667 KNTQ', () => {
    const t = monthlyTranche(p());
    expect(Math.round(t.contributors)).toBe(9_791_667);
    expect(t.investors).toBe(3_125_000);
    expect(Math.round(t.total)).toBe(12_916_667);
  });

  it('daily equivalent is 430,556 KNTQ', () => {
    expect(Math.round(preUnlockDailyRate(p()))).toBe(430_556);
  });

  it('11 Nov 00:00 ICT to 28 Nov 02:00 ICT is about 17.08 days and about 7.36M KNTQ', () => {
    expect(daysBetween(START, BRIEF_FIRST)).toBeCloseTo(17.083, 3);
    const projected = projectedPreUnlock(p(), START, BRIEF_FIRST);
    expect(projected / 1e6).toBeCloseTo(7.36, 2);
  });

  it('at $0.40 one tranche is about $5.2M', () => {
    expect((monthlyTranche(p()).total * 0.4) / 1e6).toBeCloseTo(5.17, 2);
  });
});

describe('schedule', () => {
  const s = trancheSchedule(p(Date.parse('2026-11-27T11:36:17Z')));
  it('has 24 tranches summing to 310M', () => {
    expect(s).toHaveLength(24);
    expect(s.reduce((x, t) => x + t.kntq, 0)).toBeCloseTo(310_000_000, 3);
  });
  it('steps monthly on the same day and time', () => {
    expect(new Date(s[1]!.timeMs).toISOString()).toBe('2026-12-27T11:36:17.000Z');
    expect(new Date(s[23]!.timeMs).toISOString()).toBe('2028-10-27T11:36:17.000Z');
  });
  it('cumulative is a step function', () => {
    const q = p(Date.parse('2026-11-27T11:36:17Z'));
    expect(scheduledCumulative(q, s[0]!.timeMs - 1)).toBe(0);
    expect(scheduledCumulative(q, s[0]!.timeMs)).toBeCloseTo(12_916_666.67, 1);
    expect(scheduledCumulative(q, s[23]!.timeMs)).toBeCloseTo(310_000_000, 3);
  });
  it('month arithmetic clamps to the end of short months', () => {
    expect(new Date(addMonthsUtc(Date.parse('2027-01-31T00:00:00Z'), 1)).toISOString()).toBe('2027-02-28T00:00:00.000Z');
    expect(new Date(addMonthsUtc(Date.parse('2026-11-27T11:36:17Z'), 14)).toISOString()).toBe('2028-01-27T11:36:17.000Z');
  });
});

describe('pre-unlock projection', () => {
  it('is zero before the model start and stops at the first tranche', () => {
    expect(projectedPreUnlock(p(), START - 10 * DAY_MS, START)).toBe(0);
    const full = projectedPreUnlock(p(), START, BRIEF_FIRST);
    expect(projectedPreUnlock(p(), START - DAY_MS, BRIEF_FIRST + 30 * DAY_MS)).toBeCloseTo(full, 6);
  });
  it('one day is 430,556', () => {
    expect(Math.round(projectedPreUnlock(p(), START, START + DAY_MS))).toBe(430_556);
  });
  it('is used, and labelled projected, while no tranche is due', () => {
    const now = START + 5 * DAY_MS;
    const w = unlockedInWindow(p(), [], START, now, now);
    expect(w.kind).toBe('projected');
    expect(w.kntq).toBeCloseTo(5 * 430_555.5556, 0);
  });
});

describe('projection is never added to real unlocks', () => {
  it('the day after the first tranche, unlocked since 11 Nov is one tranche, not tranche plus projection', () => {
    const now = BRIEF_FIRST + DAY_MS;
    const w = unlockedInWindow(p(), [], START, now, now);
    expect(w.kind).toBe('actual');
    expect(w.kntq).toBeCloseTo(12_916_666.67, 1);
    expect(w.kntq).toBeLessThan(12_916_667 + 1); // not 12.9M + 7.36M
  });
});

describe('30-day smoothing', () => {
  const steps = [{ timeMs: BRIEF_FIRST, kntq: 12_916_666.67 }];
  it('one day after a tranche is tranche / 30', () => {
    expect(smoothedAmount(steps, BRIEF_FIRST, BRIEF_FIRST + DAY_MS, 30)).toBeCloseTo(430_555.56, 1);
  });
  it('integrates to the whole tranche over 30 days and no more', () => {
    expect(smoothedAmount(steps, BRIEF_FIRST - DAY_MS, BRIEF_FIRST + 30 * DAY_MS, 30)).toBeCloseTo(12_916_666.67, 2);
    expect(smoothedAmount(steps, BRIEF_FIRST, BRIEF_FIRST + 90 * DAY_MS, 30)).toBeCloseTo(12_916_666.67, 2);
  });
});

describe('scheduled vs seen on-chain', () => {
  const now = BRIEF_FIRST + 2 * DAY_MS;
  it('flags a tranche that is due but has not moved, and still counts it', () => {
    const w = unlockedInWindow(p(), [], START, now, now);
    expect(w.flags).toContain('scheduled_not_yet_moved');
    expect(w.kntq).toBeCloseTo(12_916_666.67, 1);
    expect(w.observedKntq).toBe(0);
  });
  it('does not flag when the wallets moved the scheduled amount', () => {
    const obs: ObservedUnlock[] = [
      { timeMs: BRIEF_FIRST + HOUR_MS, kntq: 9_791_666.67, wallet: 'contributors' },
      { timeMs: BRIEF_FIRST + HOUR_MS, kntq: 3_125_000, wallet: 'investors' },
    ];
    const w = unlockedInWindow(p(), obs, START, now, now);
    expect(w.flags).toEqual([]);
    expect(w.kntq).toBeCloseTo(12_916_666.67, 1);
  });
  it('counts and flags tokens that move before the schedule', () => {
    const early = START + 3 * DAY_MS;
    const obs: ObservedUnlock[] = [{ timeMs: early, kntq: 5_000_000, wallet: 'investors' }];
    const at = early + DAY_MS;
    const w = unlockedInWindow(p(), obs, START, at, at);
    expect(w.kind).toBe('actual');
    expect(w.kntq).toBe(5_000_000);
    expect(w.flags).toContain('moved_ahead_of_schedule');
    expect(effectiveSteps(p(), obs, at)).toHaveLength(1);
  });
  it('does not double count early movement once the schedule catches up', () => {
    const obs: ObservedUnlock[] = [{ timeMs: START + 3 * DAY_MS, kntq: 5_000_000, wallet: 'investors' }];
    const w = unlockedInWindow(p(), obs, START - DAY_MS, now, now);
    expect(w.kntq).toBeCloseTo(5_000_000 + 12_916_666.67, 1);
  });
});

describe('ICT days', () => {
  it('11 Nov 00:00 ICT is 10 Nov 17:00 UTC', () => {
    expect(ictDayStartMs(Date.parse('2026-11-11T03:00:00Z'))).toBe(START);
    expect(ictDayKey(START)).toBe('2026-11-11');
    expect(ictDayKey(START - 1)).toBe('2026-11-10');
  });
});
