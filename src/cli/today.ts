// Prints today's headline numbers from live data. Usage: npm run today [-- --sell-through 0.5] [-- --json]

import { readFileSync } from 'node:fs';
import { type Assumptions, loadAssumptions } from '../model/assumptions.js';
import type { SinkInflow } from '../model/burn.js';
import { type EstimateSeries, sequencerAccrualKntq } from '../model/estimate.js';
import type { Purchase } from '../model/flow.js';
import { type ModelInputs, type PendingBurn, type Release, computeHeadline } from '../model/headline.js';
import { DAY_MS, daysBetween, formatIct, formatUtc } from '../model/time.js';
import type { ObservedUnlock } from '../model/unlock.js';
import * as f from '../sources/fetch.js';

const args = process.argv.slice(2);
const argVal = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const notes: string[] = [];
async function safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    notes.push(`${label}: unavailable (${String(e).slice(0, 120)})`);
    return fallback;
  }
}

const n0 = (v: number) => Math.round(v).toLocaleString('en-GB');
const n2 = (v: number) => v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd = (v: number) => `$${n0(v)}`;
const pct = (v: number | null) => (v === null ? 'n/a' : `${(v * 100).toFixed(2)}%`);
const row = (label: string, ...cols: string[]) => console.log(`  ${label.padEnd(34)}${cols.map((c) => c.padStart(22)).join('')}`);

async function gather(a: Assumptions, nowMs: number): Promise<{ inputs: ModelInputs; extra: Record<string, any> }> {
  const af = a.sinks.hypercore_af!.address;
  const kntqPair = a.tokens.kntqSpotPair;
  const hypePair = a.tokens.hypeSpotPair;

  const prices = await f.fetchSpotPrices([kntqPair, hypePair]);
  const kntqUsd = prices[kntqPair]!;
  const hypeUsd = prices[hypePair]!;
  const closes = await safe('KNTQ hourly prices', () => f.fetchHourlyCloses(kntqPair, nowMs - 9 * DAY_MS, nowMs), [] as [number, number][]);

  // Burn sinks: balances and inflow ledgers.
  const [afBalance, afLedger, supply] = await Promise.all([f.fetchSpotBalance(af, 'KNTQ'), f.fetchKntqLedger(af, a.genesisMs - DAY_MS), f.fetchTokenSupply(a.tokens.kntqTokenId)]);
  const sinkInflows: SinkInflow[] = afLedger.filter((t) => t.to === af).map((t) => ({ timeMs: t.timeMs, sink: 'hypercore_af', from: t.from, kntq: t.kntq, usd: t.usd }));
  const afOutflows = afLedger.filter((t) => t.from === af);
  const sinkBalances: Record<string, number> = { hypercore_af: afBalance };

  const deadTransfers = await safe('Elysium dead-address transfers', () => f.fetchTransfersTo(f.ELYSIUM_RPC, a.tokens.kntqElysium, a.sinks.elysium_dead!.address), null);
  if (deadTransfers) {
    sinkBalances.elysium_dead = await f.erc20Balance(f.ELYSIUM_RPC, a.tokens.kntqElysium, a.sinks.elysium_dead!.address);
    for (const t of deadTransfers) sinkInflows.push({ timeMs: t.timeMs, sink: 'elysium_dead', from: t.from, kntq: t.kntq, usd: t.kntq * f.priceAt(closes, t.timeMs, kntqUsd) });
  }

  // Open-market purchases: Kinetiq's buyback wallet (exact, from fills).
  const purchases: Purchase[] = [];
  const flowStart = Math.min(a.modelStartMs, nowMs - 7 * DAY_MS);
  const fills = await safe('buyback wallet fills', () => f.fetchFills(a.wallets.buyback!.address, flowStart), []);
  for (const x of fills) if (x.coin === kntqPair && x.side === 'B') purchases.push({ timeMs: x.timeMs, source: 'protocol_buyback', kntq: x.sz, usd: x.sz * x.px });

  // Ascend: KNTQ arriving in its burn treasury (pending burn) and ecosystem allocator (bought, kept).
  const pendingBurns: PendingBurn[] = [];
  const ascend = a.partners.ascend;
  let ascendTreasury = 0;
  let ascendAllocator = 0;
  if (ascend?.burnTreasury && ascend.ecosystemAllocator) {
    const [toTreasury, toAllocator] = await safe(
      'Ascend treasuries',
      () => Promise.all([f.fetchTransfersTo(f.ELYSIUM_RPC, a.tokens.kntqElysium, ascend.burnTreasury!), f.fetchTransfersTo(f.ELYSIUM_RPC, a.tokens.kntqElysium, ascend.ecosystemAllocator!)]),
      [[], []] as [f.TokenTransfer[], f.TokenTransfer[]],
    );
    for (const t of toTreasury) pendingBurns.push({ timeMs: t.timeMs, source: 'partner:ascend', kntq: t.kntq });
    for (const t of [...toTreasury, ...toAllocator]) purchases.push({ timeMs: t.timeMs, source: 'partner:ascend', kntq: t.kntq, usd: t.kntq * f.priceAt(closes, t.timeMs, kntqUsd) });
    ascendTreasury = toTreasury.reduce((s, t) => s + t.kntq, 0);
    ascendAllocator = toAllocator.reduce((s, t) => s + t.kntq, 0);
  }

  // Vesting, Foundation and Growth wallets (HyperEVM balances against their allocations / baselines).
  const evmBal = (addr: string) => f.erc20Balance(f.HYPEREVM_RPC, a.tokens.kntqHyperEvm, addr);
  const [contrib, invest, foundation, growth] = await Promise.all([evmBal(a.wallets.contributors!.address), evmBal(a.wallets.investors!.address), evmBal(a.wallets.foundation!.address), evmBal(a.wallets.growth!.address)]);
  const observedUnlocks: ObservedUnlock[] = [];
  if (a.unlock.contributorsKntq - contrib > 1e-6) observedUnlocks.push({ timeMs: nowMs, kntq: a.unlock.contributorsKntq - contrib, wallet: 'contributors' });
  if (a.unlock.investorsKntq - invest > 1e-6) observedUnlocks.push({ timeMs: nowMs, kntq: a.unlock.investorsKntq - invest, wallet: 'investors' });
  const releases: Release[] = [];
  const foundationOut = a.wallets.foundation!.baselineKntq! - foundation;
  const growthOut = a.wallets.growth!.baselineKntq! - growth;
  if (foundationOut > 1e-6) releases.push({ timeMs: nowMs, wallet: 'foundation', kntq: foundationOut });
  if (growthOut > 1e-6) releases.push({ timeMs: nowMs, wallet: 'growth', kntq: growthOut });

  // Elysium sequencer fees: HYPE accrued in the fee account since the model start, as a derived estimate.
  const estimates: EstimateSeries[] = [];
  const feeNow = await safe('sequencer fee account', () => f.nativeBalance(f.ELYSIUM_RPC, a.sequencer.feeAccount), null as number | null);
  const feeAtStart = await safe(
    'sequencer fee account at model start',
    async () => f.nativeBalance(f.ELYSIUM_RPC, a.sequencer.feeAccount, await f.blockAtTime(f.ELYSIUM_RPC, a.modelStartMs)),
    null as number | null,
  );
  let sequencerPendingKntq: number | null = null;
  if (feeNow !== null && feeAtStart !== null) {
    sequencerPendingKntq = sequencerAccrualKntq(feeNow - feeAtStart, a.sequencer.kntqShare, hypeUsd, kntqUsd) * a.sequencer.burnedShare;
    const days = daysBetween(a.modelStartMs, nowMs);
    if (days > 0) estimates.push({ source: 'sequencer', tier: 'derived', kntqPerDay: sequencerPendingKntq / days, fromMs: a.modelStartMs, toMs: nowMs });
  }

  const partnerFeed = await safe('Kinetiq partner feed', () => f.getJson(f.KINETIQ_ECOSYSTEM_FEED), null as any);
  const supplyFeed = await safe('Kinetiq supply feed', () => f.getJson(f.KINETIQ_SUPPLY_FEED), null as any);

  return {
    inputs: { nowMs, kntqUsd, sinkBalances, sinkInflows, pendingBurns, estimates, observedUnlocks, releases, purchases },
    extra: { hypeUsd, supply, afOutflows, contrib, invest, foundation, growth, feeNow, feeAtStart, sequencerPendingKntq, ascendTreasury, ascendAllocator, partnerFeed, supplyFeed },
  };
}

async function main() {
  const a = loadAssumptions(readFileSync(new URL('../../config/assumptions.yaml', import.meta.url), 'utf8'));
  const nowMs = Date.now();
  const st = argVal('--sell-through');
  const sellThrough = st === undefined ? a.sellThrough : { global: Number(st), overrides: a.sellThrough.overrides };
  const { inputs, extra } = await gather(a, nowMs);
  const h = computeHeadline(inputs, a, sellThrough);

  if (args.includes('--json')) {
    console.log(JSON.stringify({ headline: h, extra: { ...extra, partnerFeed: undefined }, notes }, null, 2));
    return;
  }

  console.log(`\nKNTQ burn vs unlock — ${formatIct(nowMs)} (${formatUtc(nowMs)})`);
  console.log(`Price $${h.kntqUsd.toFixed(4)} (HyperCore ${a.tokens.kntqSpotPair})   HYPE $${n2(extra.hypeUsd)}   sell-through ${(sellThrough.global * 100).toFixed(0)}%\n`);

  console.log('SUPPLY LENS (KNTQ)');
  row('', ...h.windows.map((w) => (w.clamped ? `${w.label} (${w.days.toFixed(2)}d)` : w.label)));
  row('Burned (actual)', ...h.windows.map((w) => n0(w.burnedActual)));
  for (const src of [...new Set(h.windows.flatMap((w) => Object.keys(w.burnedBySource)))]) row(`  of which ${src}`, ...h.windows.map((w) => n0(w.burnedBySource[src] ?? 0)));
  row('Pending burn (Ascend treasury)', ...h.windows.map((w) => n0(w.pendingBurn)));
  row('Estimate (sequencer accrual)', ...h.windows.map((w) => n0(w.estimated)));
  row('Burned incl. pending + estimates', ...h.windows.map((w) => n0(w.burnedInclEstimates)));
  row(`Unlocked (${h.windows[0]!.unlocked.kind})`, ...h.windows.map((w) => n0(w.unlockedForComparison)));
  row('Released (Foundation/Growth)', ...h.windows.map((w) => n0(w.released)));
  row('Net supply change (actual)', ...h.windows.map((w) => n0(w.netSupplyChangeActual)));
  row('Net supply change (incl. projected)', ...h.windows.map((w) => n0(w.netSupplyChangeInclProjected)));
  row('Burn coverage (actual)', ...h.windows.map((w) => pct(w.coverageActual)));
  row('Burn coverage (incl. est.)', ...h.windows.map((w) => pct(w.coverageInclEstimates)));

  console.log('\nBURNED TO DATE');
  for (const r of h.sinkReconciliation) row(`Sink ${r.sink}`, n2(r.balance), r.ok ? 'matches ledger' : `residual ${n2(r.residual)}`);
  row('Total burned (all sinks)', n2(h.totalBurnedAllTime));
  row('Supply destroyed at protocol level', n2(extra.supply.maxSupply - extra.supply.totalSupply), '(not in total)');
  if (extra.supplyFeed) row('Kinetiq feed: amountBurned', n2(Number(extra.supplyFeed.amountBurned)), 'cross-check');
  row(`Run-rate (${h.runRate.daysUsed.toFixed(0)}d)`, `${n0(h.runRate.kntqPerDay)}/day`, `${usd(h.runRate.kntqPerDay * h.kntqUsd)}/day`);

  console.log('\nFIRST TRANCHE');
  row('When', formatIct(h.firstTranche.timeMs), h.firstTranche.unverified ? 'UNVERIFIED' : '');
  row('Countdown', `${(h.firstTranche.msUntil / DAY_MS).toFixed(2)} days`);
  row('Size', `${n0(h.tranche.kntq)} KNTQ`, usd(h.tranche.usd));
  row('Contributors wallet', n0(extra.contrib), extra.contrib === a.unlock.contributorsKntq ? 'untouched' : 'MOVED');
  row('Investors wallet', n0(extra.invest), extra.invest === a.unlock.investorsKntq ? 'untouched' : 'MOVED');
  row('Crossover (lasting)', h.crossover.lastingMs ? formatIct(h.crossover.lastingMs) : `none within ${a.crossoverHorizonYears}y of last tranche`);

  console.log(`\nFLOW LENS (USD/day, last ${h.flow.windowDays} days)`);
  row('Open-market buying', usd(h.flow.buyUsdPerDay));
  row('Sell pressure', usd(h.flow.sellUsdPerDay));
  for (const [k, v] of Object.entries(h.flow.sellBySource)) row(`  of which ${k}`, usd(v));
  row('Break-even buybacks needed', usd(h.breakEven.requiredUsdPerDay));
  row('Current open-market buying', usd(h.breakEven.currentUsdPerDay), `${pct(h.breakEven.covered)} of need`);
  row('Gap', usd(h.breakEven.gapUsdPerDay));

  console.log('\nOVERHANG');
  row('Foundation wallet', n0(extra.foundation));
  row('Growth & Rewards wallet', n0(extra.growth));
  row('Ascend burn treasury (pending)', n2(extra.ascendTreasury));
  row('Ascend ecosystem allocator', n2(extra.ascendAllocator));
  if (extra.feeNow !== null) row('Sequencer fee account', `${n2(extra.feeNow)} HYPE`, extra.feeAtStart === null ? '' : `+${n2(extra.feeNow - extra.feeAtStart)} since 11 Nov`);

  if (extra.partnerFeed?.projects) {
    console.log('\nPARTNERS (Kinetiq feed)');
    for (const p of extra.partnerFeed.projects) if (p.totals) row(p.title, `${n0(p.totals.kntqAmount)} bought`, `${n0(p.totals.burnedKntqAmount)} burned`);
  }

  const flags = [...h.flags, ...(extra.afOutflows.length ? [`AF outflows seen: ${extra.afOutflows.length}`] : [])];
  console.log(`\nFLAGS: ${flags.length ? flags.join(', ') : 'none'}`);
  console.log(`UNVERIFIED in config: ${a.unverified.join(', ')}`);
  if (notes.length) console.log(`DATA HEALTH:\n  ${notes.join('\n  ')}`);
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
