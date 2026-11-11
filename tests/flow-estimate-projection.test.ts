import { describe, expect, it } from 'vitest';
import { estimateDailyBoughtKntq, estimateDailyBurnKntq, estimatedInWindow, partnerShares, sequencerAccrualKntq } from '../src/model/estimate.js';
import { breakEven, buyPressureUsdPerDay, purchasesInWindow, sellPressureUsdPerDay, sellThroughFor } from '../src/model/flow.js';
import { findCrossover, projectedBurnedAt } from '../src/model/projection.js';
import { DAY_MS } from '../src/model/time.js';
import { type UnlockParams, trancheSchedule } from '../src/model/unlock.js';

const TRANCHE = 310_000_000 / 24;

describe('break-even (brief section 13)', () => {
  it('at $0.40 and 100% sell-through is about $172K a day', () => {
    const b = breakEven(TRANCHE, 0.4, 1, 0);
    expect(b.requiredUsdPerDay / 1000).toBeCloseTo(172.2, 1);
  });
  it('scales with sell-through and reports the gap', () => {
    const b = breakEven(TRANCHE, 0.4, 0.5, 20_000);
    expect(b.requiredUsdPerDay / 1000).toBeCloseTo(86.1, 1);
    expect(b.gapUsdPerDay).toBeCloseTo(b.requiredUsdPerDay - 20_000, 6);
    expect(b.covered).toBeCloseTo(20_000 / b.requiredUsdPerDay, 9);
  });
});

describe('sell-through', () => {
  const st = { global: 1, overrides: { kpoints: 0.25 } };
  it('uses the override where set and the global figure otherwise', () => {
    expect(sellThroughFor('unlocks', st)).toBe(1);
    expect(sellThroughFor('kpoints', st)).toBe(0.25);
  });
  it('rejects values outside 0..1', () => {
    expect(() => sellThroughFor('unlocks', { global: 1.2, overrides: {} })).toThrow();
  });
  it('sell pressure = KNTQ/day x sell-through x price, per line', () => {
    const s = sellPressureUsdPerDay(
      [
        { source: 'unlocks', kntqPerDay: 430_556 },
        { source: 'kpoints', kntqPerDay: 100_000 },
      ],
      0.3,
      st,
    );
    expect(s.bySource.unlocks).toBeCloseTo(129_166.8, 1);
    expect(s.bySource.kpoints).toBeCloseTo(7_500, 6);
    expect(s.total).toBeCloseTo(136_666.8, 1);
  });
});

describe('buy pressure', () => {
  const T = 1_800_000_000_000;
  const purchases = [
    { timeMs: T - 6 * DAY_MS, source: 'protocol_buyback', kntq: 10_000, usd: 3_000 },
    { timeMs: T - 1 * DAY_MS, source: 'partner:ascend', kntq: 20_000, usd: 6_000 },
    { timeMs: T - 9 * DAY_MS, source: 'protocol_buyback', kntq: 99_999, usd: 99_999 },
  ];
  it('counts burned and unburned purchases alike, inside the window only', () => {
    const w = purchasesInWindow(purchases, T - 7 * DAY_MS, T);
    expect(w.usd).toBe(9_000);
    expect(w.bySource['partner:ascend']).toEqual({ kntq: 20_000, usd: 6_000 });
    expect(buyPressureUsdPerDay(purchases, T - 7 * DAY_MS, T)).toBeCloseTo(9_000 / 7, 9);
  });
});

describe('estimates (brief section 6)', () => {
  const base = { revenueUsdPerDay: 10_000, commitment: 0.4, burnedShare: 0.5, priceUsd: 0.4 };
  it('burned/day = revenue x commitment x burned share / price', () => {
    expect(estimateDailyBurnKntq(base)).toBeCloseTo(5_000, 9);
    expect(estimateDailyBoughtKntq(base)).toBeCloseTo(10_000, 9);
  });
  it('scenarios scale revenue: bear 0.25x, bull 3x', () => {
    expect(estimateDailyBurnKntq({ ...base, scenario: 0.25 })).toBeCloseTo(1_250, 9);
    expect(estimateDailyBurnKntq({ ...base, scenario: 3 })).toBeCloseTo(15_000, 9);
  });
  it('rejects shares above 100% and non-positive prices', () => {
    expect(() => estimateDailyBurnKntq({ ...base, commitment: 1.2 })).toThrow();
    expect(() => estimateDailyBurnKntq({ ...base, priceUsd: 0 })).toThrow();
  });
  it('Ascend: 90% x 80% x 40% = 28.8% of fees burned, 43.2% bought and kept', () => {
    const s = partnerShares(0.9 * 0.8, 0.4);
    expect(s.burnedOfRevenue).toBeCloseTo(0.288, 12);
    expect(s.boughtNotBurnedOfRevenue).toBeCloseTo(0.432, 12);
  });
  it('sequencer accrual = HYPE x 50% x HYPE price / KNTQ price', () => {
    expect(sequencerAccrualKntq(100, 0.5, 30, 0.3)).toBeCloseTo(5_000, 9);
    expect(sequencerAccrualKntq(-5, 0.5, 30, 0.3)).toBe(0);
  });
  it('a flat estimate integrates over the overlap with the window', () => {
    const T = 1_800_000_000_000;
    const series = [{ source: 'x', tier: 'derived' as const, kntqPerDay: 1_000, fromMs: T - 2 * DAY_MS }];
    expect(estimatedInWindow(series, T - 7 * DAY_MS, T)).toBeCloseTo(2_000, 6);
  });
});

describe('crossover', () => {
  const now = Date.parse('2026-11-11T00:00:00Z');
  const p: UnlockParams = { contributorsKntq: 235e6, investorsKntq: 75e6, trancheCount: 24, firstTrancheMs: Date.parse('2026-11-27T11:36:17Z'), modelStartMs: now, preUnlockSmoothingDays: 30, unlockSmoothingDays: 30 };
  const schedule = trancheSchedule(p);
  const last = schedule[23]!.timeMs;
  const horizon = last + 10 * 365.25 * DAY_MS;

  it('burned line is a straight line from now', () => {
    expect(projectedBurnedAt({ nowMs: now, burnedSinceStart: 100, burnRatePerDay: 10, schedule }, now + 5 * DAY_MS)).toBe(150);
  });

  it('at a low burn rate there is no crossover within the horizon', () => {
    const c = findCrossover({ nowMs: now, burnedSinceStart: 0, burnRatePerDay: 13_700, schedule }, horizon);
    expect(c.lastingMs).toBeNull();
    expect(c.firstMs).toBeNull();
    expect(c.behindFromMs).toBe(schedule[0]!.timeMs);
  });

  it('a brief catch-up between tranches is not the lasting crossover', () => {
    // 310K a day reaches the first tranche's 12.92M on day 41.67, then falls behind again at tranche 2.
    // It reaches the full 310M on day 1,000, after the last tranche (about day 716).
    const c = findCrossover({ nowMs: now, burnedSinceStart: 0, burnRatePerDay: 310e6 / 1000, schedule }, horizon);
    expect((c.firstMs! - now) / DAY_MS).toBeCloseTo(12_916_666.67 / 310_000, 4);
    expect((c.lastingMs! - now) / DAY_MS).toBeCloseTo(1000, 6);
  });

  it('a burn faster than the unlock pace crosses once and stays ahead', () => {
    // 600K a day: 9.89M burned at the first tranche (behind 12.92M), level on day 21.53, ahead at every later tranche.
    const c = findCrossover({ nowMs: now, burnedSinceStart: 0, burnRatePerDay: 600_000, schedule }, horizon);
    expect(c.behindFromMs).toBe(schedule[0]!.timeMs);
    expect((c.firstMs! - now) / DAY_MS).toBeCloseTo(12_916_666.67 / 600_000, 4);
    expect(c.lastingMs).toBe(c.firstMs);
  });

  it('never behind means no crossover to report', () => {
    const c = findCrossover({ nowMs: now, burnedSinceStart: 400e6, burnRatePerDay: 0, schedule }, horizon);
    expect(c).toEqual({ lastingMs: null, firstMs: null, behindFromMs: null });
  });

  it('zero burn rate never crosses', () => {
    expect(findCrossover({ nowMs: now, burnedSinceStart: 0, burnRatePerDay: 0, schedule }, horizon).lastingMs).toBeNull();
  });
});
