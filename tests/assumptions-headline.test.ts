import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadAssumptions } from '../src/model/assumptions.js';
import { type ModelInputs, computeHeadline } from '../src/model/headline.js';
import { DAY_MS, HOUR_MS } from '../src/model/time.js';

const yamlText = readFileSync(new URL('../config/assumptions.yaml', import.meta.url), 'utf8');
const a = loadAssumptions(yamlText);

describe('config/assumptions.yaml', () => {
  it('loads and matches the allocation', () => {
    expect(a.maxSupplyKntq).toBe(1_000_000_000);
    expect(a.unlock.contributorsKntq + a.unlock.investorsKntq).toBe(310_000_000);
    expect(new Date(a.modelStartMs).toISOString()).toBe('2026-11-10T17:00:00.000Z');
  });
  it('every constant carries a source, a date and a confidence', () => {
    expect(a.meta.length).toBeGreaterThan(40);
    for (const m of a.meta) expect(m.source.length).toBeGreaterThan(3);
  });
  it('lists what is unverified, including the first-tranche date', () => {
    expect(a.unverified).toContain('vesting.first_tranche_utc');
    expect(a.unverified).toContain('partners.boxa');
  });
  it('Ascend is 72% of fees to KNTQ with 40% burned (conservative), 60% as the alternative', () => {
    expect(a.partners.ascend).toMatchObject({ commitment: 0.72, burnedShare: 0.4, altBurnedShare: 0.6 });
  });
  it('accepts a new attribution block as the README describes, including a quoted partner name', () => {
    const edited = yamlText.replace(
      '\ntokens:\n',
      '\n  sequencer_buyback:\n    value: ["0x1111111111111111111111111111111111111111"]\n    source: test\n    retrieved: 2026-12-01\n    confidence: high\n  "partner:ascend":\n    value: ["0x2222222222222222222222222222222222222222"]\n    source: test\n    retrieved: 2026-12-01\n    confidence: high\n\ntokens:\n',
    );
    const b = loadAssumptions(edited);
    expect(b.attribution.sequencer_buyback).toEqual(['0x1111111111111111111111111111111111111111']);
    expect(b.attribution['partner:ascend']).toEqual(['0x2222222222222222222222222222222222222222']);
  });
  it('rejects a malformed edit with a readable message', () => {
    expect(() => loadAssumptions(yamlText.replace('value: 1.0\n    source: Brief section 4 (default 100%', 'value: 150\n    source: Brief section 4 (default 100%'))).toThrow(/sell_through.global/);
    expect(() => loadAssumptions(yamlText.replace('value: "0xfefefefefefefefefefefefefefefefefefefefe"', 'value: "0xfefe"'))).toThrow(/sinks.hypercore_af/);
    expect(() => loadAssumptions(yamlText.replace('confidence: UNVERIFIED', 'confidence: maybe'))).toThrow(/confidence/);
  });
});

describe('headline', () => {
  const FEES = a.attribution.fees![0]!;
  const BUYBACK = a.attribution.protocol_buyback![0]!;
  const now = a.modelStartMs + 2 * DAY_MS;
  const inputs: ModelInputs = {
    nowMs: now,
    kntqUsd: 0.4,
    sinkBalances: { hypercore_af: 1_010_000 },
    sinkInflows: [
      { timeMs: a.modelStartMs - 20 * DAY_MS, sink: 'hypercore_af', from: BUYBACK, kntq: 1_000_000 },
      { timeMs: now - 30 * HOUR_MS, sink: 'hypercore_af', from: BUYBACK, kntq: 6_000 },
      { timeMs: now - 2 * HOUR_MS, sink: 'hypercore_af', from: FEES, kntq: 4_000 },
    ],
    pendingBurns: [{ timeMs: now - HOUR_MS, source: 'partner:ascend', kntq: 500 }],
    estimates: [{ source: 'sequencer', tier: 'derived', kntqPerDay: 250, fromMs: a.modelStartMs }],
    observedUnlocks: [],
    releases: [{ timeMs: now - 3 * HOUR_MS, wallet: 'growth', kntq: 100_000 }],
    purchases: [{ timeMs: now - 30 * HOUR_MS, source: 'protocol_buyback', kntq: 6_000, usd: 2_400 }],
  };
  const h = computeHeadline(inputs, a);
  const since = h.windows.find((w) => w.label === 'since 11 Nov')!;
  const day = h.windows.find((w) => w.label === '24h')!;

  it('total burned is the sink balance', () => {
    expect(h.totalBurnedAllTime).toBe(1_010_000);
    expect(h.sinkReconciliation[0]!.ok).toBe(true);
  });
  it('windows count only what falls inside them', () => {
    expect(since.burnedActual).toBe(10_000);
    expect(day.burnedActual).toBe(4_000);
    expect(since.burnedBySource).toEqual({ protocol_buyback: 6_000, fees: 4_000 });
  });
  it('a rolling window is cut off at the model start so burns and unlocks cover the same period', () => {
    const week = h.windows.find((w) => w.label === '7d')!;
    expect(week.clamped).toBe(true);
    expect(week.days).toBe(2);
    expect(week.burnedActual).toBe(since.burnedActual); // the 1,000,000 burned before 11 Nov is not in it
    expect(week.unlockedForComparison).toBe(since.unlockedForComparison);
    expect(day.clamped).toBe(false);
    expect(day.days).toBe(1);
  });
  it('estimates and pending burns are kept apart from the actual figure', () => {
    expect(since.pendingBurn).toBe(500);
    expect(since.estimated).toBeCloseTo(500, 6);
    expect(since.burnedInclEstimates).toBeCloseTo(11_000, 6);
    expect(since.burnedActual).toBe(10_000);
  });
  it('before the first tranche unlocked is the projection, and net supply change says which it used', () => {
    expect(since.unlocked.kind).toBe('projected');
    expect(since.unlockedForComparison).toBeCloseTo(2 * 430_555.5556, 1);
    expect(since.netSupplyChangeActual).toBe(100_000 - 10_000);
    expect(since.netSupplyChangeInclProjected).toBeCloseTo(100_000 + 861_111.11 - 10_000, 0);
    expect(since.coverageActual).toBeCloseTo(10_000 / 861_111.11, 6);
  });
  it('tranche, countdown and break-even use the live price', () => {
    expect(h.tranche.usd / 1e6).toBeCloseTo(5.17, 2);
    expect(h.firstTranche.msUntil).toBe(a.unlock.firstTrancheMs - now);
    expect(h.firstTranche.unverified).toBe(true);
    expect(h.breakEven.requiredUsdPerDay / 1000).toBeCloseTo(172.2, 1);
    expect(h.breakEven.currentUsdPerDay).toBeCloseTo(2_400 / 7, 6);
  });
  it('flags a sink whose balance is below its ledger', () => {
    const bad = computeHeadline({ ...inputs, sinkBalances: { hypercore_af: 1_000_000 } }, a);
    expect(bad.flags).toContain('sink_outflow:hypercore_af');
  });
  it('the sell-through slider changes the flow lens only', () => {
    const half = computeHeadline(inputs, a, { global: 0.5, overrides: {} });
    expect(half.flow.sellUsdPerDay).toBeCloseTo(h.flow.sellUsdPerDay / 2, 6);
    expect(half.breakEven.requiredUsdPerDay).toBeCloseTo(h.breakEven.requiredUsdPerDay / 2, 6);
    expect(half.windows).toEqual(h.windows);
  });
});
