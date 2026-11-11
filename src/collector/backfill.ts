// One-off backfill. Run once into an empty data directory:
//   npx tsx src/collector/backfill.ts --data-dir data
//
// It reconstructs history that the chains still hold:
//   - every KNTQ inflow into the Assistance Fund since genesis (so the burn line starts at the first burn)
//   - every transfer into Elysium's dead address and Ascend's two contracts
//   - the buyback wallet's KNTQ buys since KIP-5
//   - hourly prices, and an hourly snapshot from the model start to now (fee-account balance read from archive state)
// and, if the Phase 1 spike traces are present in spike/out, the Growth wallet's earlier movements and the
// kPoints top-200 claimant list (those need a HyperEVM RPC with wide log ranges, which the official one lacks).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DAY_MS, HOUR_MS } from '../model/time.js';
import * as f from '../sources/fetch.js';
import { baselineWallets } from './derive.js';
import { defaultState, loadConfig, priceLookup, rebuildDerived, syncAfLedger, syncElysium, syncFills, syncPrices } from './run.js';
import { FILES, type Health, type PendingBurnEvent, type SinkInflowEvent, type Snapshot, Store, type WalletMoveEvent, snapshotFile } from './store.js';

const rest = process.argv.slice(2);
const dirIdx = rest.indexOf('--data-dir');
const store = new Store(dirIdx >= 0 ? rest[dirIdx + 1]! : 'data');
const a = loadConfig();
const nowMs = Date.now();
const health: Health = {};
const ctx = { store, a, nowMs, health };
const state = defaultState(a);

if (store.readSnapshots().length) {
  console.error('data directory already has snapshots; backfill is for an empty directory');
  process.exit(2);
}

console.log('prices…');
const prices = await syncPrices(ctx, a.modelStartMs - 35 * DAY_MS);
const spot = await f.fetchSpotPrices([a.tokens.kntqSpotPair, a.tokens.hypeSpotPair]);
const priceAt = priceLookup(prices, spot[a.tokens.kntqSpotPair]!);
const hypeAt = (tMs: number) => {
  let px = spot[a.tokens.hypeSpotPair]!;
  for (const [t, , h] of prices) {
    if (t <= tMs) px = h;
    else break;
  }
  return px;
};

console.log('AF ledger since genesis…');
const led = await syncAfLedger(ctx, state);
console.log(`  ${led.fresh.length} inflows, ${led.outflows.length} outflows`);

console.log('Elysium transfers…');
await syncElysium(ctx, state, priceAt);

console.log('buyback fills since KIP-5…');
await syncFills(ctx, state);

console.log('hourly snapshots from the model start…');
const inflows = store.readJsonl<SinkInflowEvent>(FILES.sinkInflows);
const pending = store.readJsonl<PendingBurnEvent>(FILES.pendingBurns);
const purchases = store.readJsonl<{ t: number; source: string; kntq: number; id: string }>(FILES.purchases);
const sumTo = (rows: { t: number; kntq: number }[], t: number) => rows.reduce((s, r) => (r.t <= t ? s + r.kntq : s), 0);
const afRows = inflows.filter((r) => r.sink === 'hypercore_af');
const deadRows = inflows.filter((r) => r.sink === 'elysium_dead');
const pendingIds = new Set(pending.map((p) => p.id));
const allocatorRows = purchases.filter((p) => p.source === 'partner:ascend' && !pendingIds.has(p.id));
const snaps: Snapshot[] = [];
for (let t = a.modelStartMs; t <= nowMs - 10 * 60_000; t += HOUR_MS) {
  let feeHype: number | null = null;
  try {
    feeHype = await f.nativeBalance(f.ELYSIUM_RPC, a.sequencer.feeAccount, await f.blockAtTime(f.ELYSIUM_RPC, t));
  } catch (e) {
    console.error(`  fee account at ${new Date(t).toISOString()}: ${String(e).slice(0, 100)}`);
  }
  snaps.push({
    t,
    kntqUsd: priceAt(t - 1),
    hypeUsd: hypeAt(t - 1),
    sinks: { hypercore_af: sumTo(afRows, t), elysium_dead: sumTo(deadRows, t) },
    wallets: { ...baselineWallets(a), deployer: null },
    ascend: { treasury: sumTo(pending, t), allocator: sumTo(allocatorRows, t) },
    feeHype,
    totalSupply: null,
    kinetiq: { burned: null, circulating: null, staked: null },
    backfilled: true,
  });
}
for (const s of snaps) store.appendJsonl(snapshotFile(s.t), [s]);
console.log(`  ${snaps.length} snapshots`);

// Optional seeds from the Phase 1 spike traces.
const spike = (name: string) => new URL(`../../spike/out/${name}`, import.meta.url);
const growth = a.wallets.growth!.address;
if (existsSync(spike('evm_from_0x5bd9e7.json'))) {
  console.log('Growth wallet history from spike traces…');
  const outs: any[] = JSON.parse(readFileSync(spike('evm_from_0x5bd9e7.json'), 'utf8'));
  const ins: any[] = existsSync(spike('evm_to_0x5bd9e7.json')) ? JSON.parse(readFileSync(spike('evm_to_0x5bd9e7.json'), 'utf8')) : [];
  const moves: WalletMoveEvent[] = [];
  for (const x of [...outs.map((o) => ({ ...o, sign: -1 })), ...ins.map((i) => ({ ...i, sign: 1 }))]) {
    if (x.from !== growth && x.to !== growth) continue;
    const t = await f.blockTimeMs(f.HYPEREVM_RPC, x.block);
    if (t >= a.modelStartMs) continue; // from the model start on, hourly balance changes are the record
    moves.push({ id: `log:${x.tx}:${x.block}:${x.kntq}`, t, wallet: 'growth', kntq: x.sign * x.kntq, via: 'log', counterparty: x.sign < 0 ? x.to : x.from });
  }
  store.appendUnique(FILES.walletMoves, moves.sort((x, y) => x.t - y.t));
  console.log(`  ${moves.length} movements before the model start`);
}
if (existsSync(spike('evm_from_0x435bb7.json'))) {
  console.log('kPoints top-200 claimants from spike trace…');
  const rows: any[] = JSON.parse(readFileSync(spike('evm_from_0x435bb7.json'), 'utf8'));
  const by = new Map<string, number>();
  for (const r of rows) if (r.to !== growth) by.set(r.to, (by.get(r.to) ?? 0) + r.kntq);
  const sorted = [...by.entries()].sort((x, y) => y[1] - x[1]);
  const totalClaimed = sorted.reduce((s, [, v]) => s + v, 0);
  const wallets = sorted.slice(0, 200).map(([address, claimed]) => ({ address, claimed }));
  writeFileSync(
    new URL('../../config/kpoints-top200.json', import.meta.url),
    JSON.stringify({ source: `Transfers out of the kPoints claim contract ${a.wallets.kpoints_claim!.address} on HyperEVM, 1–12 Oct 2026`, generated: new Date(nowMs).toISOString().slice(0, 10), claimants: sorted.length, totalClaimed, wallets }, null, 1) + '\n',
  );
  console.log(`  ${sorted.length} claimants, ${Math.round(totalClaimed).toLocaleString('en-GB')} KNTQ claimed; top 200 hold ${((wallets.reduce((s, w) => s + w.claimed, 0) / totalClaimed) * 100).toFixed(1)}%`);
}

store.writeJson(FILES.state, state);
store.writeJson(FILES.health, health);
const h = rebuildDerived(store, a, nowMs);
console.log(`done. burned to date ${h ? Math.round(h.totalBurnedAllTime).toLocaleString('en-GB') : '?'} KNTQ; state ${JSON.stringify(state)}`);
