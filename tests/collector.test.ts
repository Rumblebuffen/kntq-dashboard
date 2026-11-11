import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { alertsFromSnapshots, baselineWallets, buildBurnHistory, buildDaily, buildModelInputs, collapseOld, diffCommitments, sequencerEstimates, sitemapSlugs, walletMovesFromBalances } from '../src/collector/derive.js';
import { type Snapshot, Store, snapshotFile } from '../src/collector/store.js';
import { loadAssumptions } from '../src/model/assumptions.js';
import { computeHeadline } from '../src/model/headline.js';
import { DAY_MS, HOUR_MS } from '../src/model/time.js';

const a = loadAssumptions(readFileSync(new URL('../config/assumptions.yaml', import.meta.url), 'utf8'));
const START = a.modelStartMs;
const BUYBACK = a.attribution.protocol_buyback![0]!;

const snap = (t: number, over: Partial<Snapshot> = {}): Snapshot => ({
  t,
  kntqUsd: 0.3,
  hypeUsd: 60,
  sinks: { hypercore_af: 1000, elysium_dead: 5 },
  wallets: { ...baselineWallets(a), deployer: 0 },
  ascend: { treasury: 0, allocator: 0 },
  feeHype: 100,
  totalSupply: null,
  kinetiq: { burned: null, circulating: null, staked: null },
  ...over,
});

describe('wallet movements from balances', () => {
  it('reports only wallets whose balance changed, signed', () => {
    const prev = baselineWallets(a);
    const cur = { ...prev, growth: prev.growth! - 2_500_000, investors: prev.investors! };
    const moves = walletMovesFromBalances(prev, cur, START + HOUR_MS);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ wallet: 'growth', kntq: -2_500_000, via: 'balance' });
  });
  it('a failed read (null) is not a movement', () => {
    const prev = baselineWallets(a);
    expect(walletMovesFromBalances(prev, { ...prev, growth: null }, START)).toEqual([]);
  });
});

describe('sequencer estimate from fee-account snapshots', () => {
  it('converts accrued HYPE at 50% into KNTQ and ignores spends', () => {
    const s = [snap(START, { feeHype: 100 }), snap(START + HOUR_MS, { feeHype: 110 }), snap(START + 2 * HOUR_MS, { feeHype: 50 }), snap(START + 3 * HOUR_MS, { feeHype: 60 })];
    const est = sequencerEstimates(s, a, START);
    const total = est.reduce((x, e) => x + (e.kntqPerDay * (e.toMs! - e.fromMs)) / DAY_MS, 0);
    // two accruals of 10 HYPE: 10 x 0.5 x $60 / $0.30 = 1,000 KNTQ each
    expect(total).toBeCloseTo(2000, 6);
    expect(est.every((e) => e.tier === 'derived' && e.source === 'sequencer')).toBe(true);
  });
  it('needs two readings', () => {
    expect(sequencerEstimates([snap(START)], a, START)).toEqual([]);
  });
});

describe('collapsing old rows', () => {
  const rows = [
    { timeMs: START - 10 * DAY_MS, kntq: 5, usd: 1, from: 'x' },
    { timeMs: START - 10 * DAY_MS + HOUR_MS, kntq: 7, usd: 2, from: 'x' },
    { timeMs: START - 10 * DAY_MS + HOUR_MS, kntq: 3, usd: 1, from: 'y' },
    { timeMs: START, kntq: 11, usd: 4, from: 'x' },
  ];
  const out = collapseOld(rows, START - DAY_MS, (r) => r.from);
  it('merges per day and key, keeps recent rows exact', () => {
    expect(out).toHaveLength(3);
    expect(out.find((r) => r.from === 'x' && r.timeMs < START)).toMatchObject({ kntq: 12, usd: 3 });
  });
  it('never changes the total', () => {
    expect(out.reduce((s, r) => s + r.kntq, 0)).toBe(26);
  });
});

describe('model inputs and daily rows from stored data', () => {
  const now = START + 36 * HOUR_MS;
  const stored = {
    snapshots: [snap(START, { sinks: { hypercore_af: 1000, elysium_dead: 5 } }), snap(now - HOUR_MS, { sinks: { hypercore_af: 1300, elysium_dead: null }, feeHype: 120 })],
    sinkInflows: [
      { id: '1', t: START - 5 * DAY_MS, sink: 'hypercore_af', from: BUYBACK, kntq: 1000, usd: 300 },
      { id: '2', t: START + 2 * HOUR_MS, sink: 'hypercore_af', from: BUYBACK, kntq: 100, usd: 30 },
      { id: '3', t: START + 30 * HOUR_MS, sink: 'hypercore_af', from: BUYBACK, kntq: 200, usd: 60 },
      { id: '4', t: START - DAY_MS, sink: 'elysium_dead', from: '0x1111111111111111111111111111111111111111', kntq: 5, usd: 1 },
    ],
    purchases: [{ id: 'p', t: START + 2 * HOUR_MS, source: 'protocol_buyback', kntq: 100, usd: 30 }],
    pendingBurns: [{ id: 'q', t: START + 3 * HOUR_MS, source: 'partner:ascend', kntq: 40 }],
    walletMoves: [
      { id: 'm1', t: START - 3 * DAY_MS, wallet: 'growth', kntq: -2_500_000, via: 'log' as const },
      { id: 'm2', t: START + 5 * HOUR_MS, wallet: 'growth', kntq: -1000, via: 'balance' as const },
    ],
  };
  const inputs = buildModelInputs(stored, a, now)!;

  it('uses the newest non-null balance of each sink', () => {
    expect(inputs.sinkBalances).toEqual({ hypercore_af: 1300, elysium_dead: 5 });
  });
  it('counts Growth outflows as releases only from the model start', () => {
    expect(inputs.releases).toEqual([{ timeMs: START + 5 * HOUR_MS, kntq: 1000, wallet: 'growth' }]);
  });
  it('reconciles sinks against the ledger', () => {
    const h = computeHeadline(inputs, a);
    expect(h.sinkReconciliation.every((r) => r.ok)).toBe(true);
    expect(h.totalBurnedAllTime).toBe(1305);
  });
  it('builds one row per ICT day, the last one partial', () => {
    const days = buildDaily(inputs, stored.snapshots, a);
    expect(days.map((d) => d.day)).toEqual(['2026-11-11', '2026-11-12']);
    expect(days[0]).toMatchObject({ burnedTotal: 100, pendingBurn: 40, released: 1000, unlockedKind: 'projected' });
    expect(days[0]!.unlockedDaily).toBeCloseTo(430_555.56, 1);
    expect(days[1]!.burnedTotal).toBe(200);
    expect(days[1]!.unlockedDaily).toBeCloseTo(430_555.56 / 2, 1);
    expect(days[0]!.purchasesUsd).toEqual({ protocol_buyback: 30 });
  });
  it('burn history starts at the first burn, before the model start', () => {
    const hist = buildBurnHistory(inputs.sinkInflows, a);
    expect(hist[0]!.day < '2026-11-11').toBe(true);
    expect(hist.reduce((s, d) => s + Object.values(d.burned).reduce((x, y) => x + y, 0), 0)).toBe(1305);
  });
});

describe('alerts', () => {
  it('raises one for a vesting wallet moving, a sink falling and the fee account spending', () => {
    const prev = snap(START);
    const cur = snap(START + HOUR_MS, { sinks: { hypercore_af: 900, elysium_dead: 5 }, feeHype: 20, ascend: { treasury: 0, allocator: 0 } });
    const moves = [{ id: 'bal:investors:1', t: cur.t, wallet: 'investors', kntq: -3_125_000, via: 'balance' as const }];
    const types = alertsFromSnapshots(prev, cur, moves).map((x) => x.type);
    expect(types).toEqual(['vesting_wallet_moved', 'sink_outflow', 'sequencer_fees_spent']);
  });
  it('stays quiet when nothing notable changed', () => {
    expect(alertsFromSnapshots(snap(START), snap(START + HOUR_MS, { feeHype: 105 }), [])).toEqual([]);
  });
});

describe('weekly commitments diff', () => {
  const prev = { projects: { oku: { title: 'Oku', commitment: '30% of Elysium revenue', share: 30, burnShare: null } }, sitemapSlugs: ['oku', 'cove'] };
  it('flags new, changed and removed commitments and new pages', () => {
    const cur = {
      projects: { oku: { title: 'Oku', commitment: '40% of Elysium revenue', share: 40, burnShare: null }, dawn: { title: 'Dawn', commitment: '40% of net revenue', share: 40, burnShare: 50 } },
      sitemapSlugs: ['oku', 'dawn'],
    };
    const kinds = diffCommitments(prev, cur).map((c) => `${c.kind}:${c.slug}`).sort();
    expect(kinds).toEqual(['changed_commitment:oku', 'new_commitment:dawn', 'new_project:dawn', 'removed_project:cove']);
  });
  it('reports nothing when nothing changed', () => {
    expect(diffCommitments(prev, prev)).toEqual([]);
  });
  it('reads mainnet slugs from the sitemap and ignores testnet', () => {
    const xml = '<url><loc>https://elysium.kinetiq.xyz/ecosystem/oku</loc></url><url><loc>https://testnet.elysium.kinetiq.xyz/ecosystem/oku</loc></url><url><loc>https://elysium.kinetiq.xyz/ecosystem/ascend</loc></url><url><loc>https://elysium.kinetiq.xyz/docs/x</loc></url>';
    expect(sitemapSlugs(xml)).toEqual(['ascend', 'oku']);
  });
});

describe('store', () => {
  it('appends only rows it has not seen, and reads snapshots across months in order', () => {
    const store = new Store(mkdtempSync(join(tmpdir(), 'kntq-')));
    expect(store.appendUnique('events/x.jsonl', [{ id: 'a' }, { id: 'b' }, { id: 'a' }])).toHaveLength(2);
    expect(store.appendUnique('events/x.jsonl', [{ id: 'b' }, { id: 'c' }])).toEqual([{ id: 'c' }]);
    expect(store.readJsonl('events/x.jsonl')).toHaveLength(3);
    const dec = Date.parse('2026-12-01T00:30:00Z');
    store.appendJsonl(snapshotFile(dec), [snap(dec)]);
    store.appendJsonl(snapshotFile(START), [snap(START)]);
    expect(store.readSnapshots().map((s) => s.t)).toEqual([START, dec]);
  });
});
