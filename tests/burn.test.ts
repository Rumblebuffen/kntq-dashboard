import { describe, expect, it } from 'vitest';
import { type SinkInflow, UNATTRIBUTED, buildAttributionMap, burnedBySource, burnedInWindow, guardedBreakdown, reconcileSinks, runRate, totalBurned, withPartnerReports } from '../src/model/burn.js';
import { DAY_MS } from '../src/model/time.js';
import { EVM_DECIMALS, HYPERCORE_DECIMALS, fromBaseUnits, usdToKntq } from '../src/model/units.js';

const FEES = '0x51172933b60847085e2a959e860e2ec9e240ac09';
const BUYBACK = '0xaa3b7392052d62928cc87701e3ca6fb6630bb6e2';
const PARTNER = '0x1111111111111111111111111111111111111111';
const map = buildAttributionMap({ fees: [FEES], protocol_buyback: [BUYBACK], 'partner:oku': [PARTNER] });

const T = Date.parse('2026-11-11T00:00:00Z');
const inflows: SinkInflow[] = [
  { timeMs: T - 2 * DAY_MS, sink: 'hypercore_af', from: FEES, kntq: 1000 },
  { timeMs: T - 1 * DAY_MS, sink: 'hypercore_af', from: BUYBACK.toUpperCase().replace('0X', '0x'), kntq: 500 },
  { timeMs: T - 0.5 * DAY_MS, sink: 'hypercore_af', from: PARTNER, kntq: 200 },
  { timeMs: T - 0.25 * DAY_MS, sink: 'hypercore_af', from: '0x2222222222222222222222222222222222222222', kntq: 50 },
];

describe('double-counting guard', () => {
  it('total burned is the sum of sink balances and nothing else', () => {
    expect(totalBurned({ hypercore_af: 1750, elysium_dead: 10 })).toBe(1760);
  });

  it('a partner burn routed into the AF is attributed, never added', () => {
    const sinks = { hypercore_af: 1750 };
    const before = withPartnerReports(sinks, []);
    const after = withPartnerReports(sinks, [{ slug: 'oku', kntq: 200, sink: 'hypercore_af' }]);
    expect(after.total).toBe(before.total);
    expect(after.total).toBe(1750);
    expect(after.insideSinks).toHaveLength(1);
  });

  it('a partner burn reported to an untracked destination is surfaced, not added', () => {
    const r = withPartnerReports({ hypercore_af: 1750 }, [{ slug: 'cove', kntq: 300, sink: null }]);
    expect(r.total).toBe(1750);
    expect(r.outsideSinks.map((x) => x.slug)).toEqual(['cove']);
  });

  it('the source breakdown sums exactly to the amount the sinks received', () => {
    const t0 = T - 3 * DAY_MS;
    const by = burnedBySource(inflows, map, t0, T);
    const total = burnedInWindow(inflows, t0, T);
    expect(Object.values(by).reduce((s, v) => s + v, 0)).toBe(total);
    expect(by).toEqual({ fees: 1000, protocol_buyback: 500, 'partner:oku': 200, [UNATTRIBUTED]: 50 });
  });

  it('attributing more than the sinks received throws', () => {
    expect(() => guardedBreakdown(1000, { fees: 600, 'partner:oku': 600 })).toThrow(/double count/);
  });

  it('whatever is not attributed is shown as unattributed', () => {
    const g = guardedBreakdown(1750, { fees: 1000, protocol_buyback: 500, 'partner:oku': 200 });
    expect(g.unattributed).toBe(50);
    expect(g.total).toBe(1750);
    expect(Object.values(g.bySource).reduce((s, v) => s + v, 0) + g.unattributed).toBe(g.total);
  });

  it('one address cannot belong to two sources', () => {
    expect(() => buildAttributionMap({ fees: [FEES], protocol_buyback: [FEES] })).toThrow(/both/);
  });
});

describe('sink reconciliation', () => {
  it('balance equal to the ledger is ok', () => {
    expect(reconcileSinks({ hypercore_af: 1750 }, inflows)[0]).toMatchObject({ ok: true, residual: 0 });
  });
  it('a balance below the ledger means something left the sink', () => {
    const r = reconcileSinks({ hypercore_af: 1700 }, inflows)[0]!;
    expect(r.ok).toBe(false);
    expect(r.residual).toBe(-50);
  });
});

describe('run-rate', () => {
  it('averages over the trailing window', () => {
    const r = runRate(inflows, T, 30, T - 400 * DAY_MS);
    expect(r.kntqPerDay).toBeCloseTo(1750 / 30, 6);
    expect(r.shortHistory).toBe(false);
  });
  it('uses the days available when history is shorter than the window', () => {
    const r = runRate(inflows, T, 30, T - 3 * DAY_MS);
    expect(r.daysUsed).toBe(3);
    expect(r.kntqPerDay).toBeCloseTo(1750 / 3, 6);
    expect(r.shortHistory).toBe(true);
  });
});

describe('unit conversions', () => {
  it('HyperCore base units have 8 decimals', () => {
    expect(fromBaseUnits(456906889420483n, HYPERCORE_DECIMALS)).toBe(4569068.89420483);
  });
  it('EVM base units have 18 decimals', () => {
    expect(fromBaseUnits(10n ** 27n, EVM_DECIMALS)).toBe(1_000_000_000);
    expect(fromBaseUnits('0x' + (235_000_000n * 10n ** 18n).toString(16), EVM_DECIMALS)).toBe(235_000_000);
    expect(fromBaseUnits(77382898965240000000000n, EVM_DECIMALS)).toBe(77382.89896524);
  });
  it('USD to KNTQ needs a positive price', () => {
    expect(usdToKntq(308, 0.308)).toBeCloseTo(1000, 9);
    expect(() => usdToKntq(1, 0)).toThrow();
  });
});
