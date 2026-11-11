// The collector's jobs. Each source is fetched independently: one failing source is recorded in health.json
// and never stops the others or loses data already stored.

import { readFileSync } from 'node:fs';
import { type Assumptions, loadAssumptions } from '../model/assumptions.js';
import { computeHeadline } from '../model/headline.js';
import { DAY_MS } from '../model/time.js';
import * as f from '../sources/fetch.js';
import { type CommitmentState, alertsFromSnapshots, baselineWallets, buildBurnHistory, buildDaily, buildModelInputs, collapseOld, diffCommitments, sitemapSlugs, walletMovesFromBalances } from './derive.js';
import { type Alert, FILES, type Health, type PendingBurnEvent, type PurchaseEvent, type SinkInflowEvent, type Snapshot, type State, Store, type WalletMoveEvent, markError, markOk, snapshotFile } from './store.js';

export const loadConfig = (): Assumptions => loadAssumptions(readFileSync(new URL('../../config/assumptions.yaml', import.meta.url), 'utf8'));

export const defaultState = (a: Assumptions): State => ({ afLedgerCursorMs: a.genesisMs - DAY_MS, fillsCursorMs: Date.parse('2026-09-15T00:00:00Z'), elysiumBlock: 0 });

type Ctx = { store: Store; a: Assumptions; nowMs: number; health: Health };

async function source<T>(ctx: Ctx, name: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    const v = await fn();
    markOk(ctx.health, name, ctx.nowMs);
    return v;
  } catch (e) {
    markError(ctx.health, name, ctx.nowMs, e);
    console.error(`[${name}] failed: ${String(e).slice(0, 200)}`);
    return null;
  }
}

const ledgerToInflows = (rows: f.LedgerTransfer[], af: string): SinkInflowEvent[] =>
  rows.filter((t) => t.to === af).map((t) => ({ id: `hc:${t.hash}:${t.from}:${t.kntq}`, t: t.timeMs, sink: 'hypercore_af', from: t.from, kntq: t.kntq, usd: t.usd }));

/** Pull new AF ledger rows since the cursor. Returns outflows too, which should never exist. */
export async function syncAfLedger(ctx: Ctx, state: State) {
  const af = ctx.a.sinks.hypercore_af!.address;
  const rows = await f.fetchKntqLedger(af, state.afLedgerCursorMs);
  const fresh = ctx.store.appendUnique(FILES.sinkInflows, ledgerToInflows(rows, af));
  if (rows.length) state.afLedgerCursorMs = Math.max(state.afLedgerCursorMs, ...rows.map((r) => r.timeMs));
  return { fresh, outflows: rows.filter((t) => t.from === af) };
}

/** Pull new Elysium transfers into the dead address and Ascend's two contracts. */
export async function syncElysium(ctx: Ctx, state: State, priceAt: (tMs: number) => number) {
  const { a, store } = ctx;
  const dead = a.sinks.elysium_dead!.address;
  const treasury = a.partners.ascend?.burnTreasury;
  const allocator = a.partners.ascend?.ecosystemAllocator;
  const head = await f.blockNumber(f.ELYSIUM_RPC);
  const from = state.elysiumBlock + 1;
  if (from > head) return;
  const transfers = await f.fetchTransfersInto(f.ELYSIUM_RPC, a.tokens.kntqElysium, [dead, treasury, allocator].filter((x): x is string => !!x), from, head);
  const inflows: SinkInflowEvent[] = [];
  const pending: PendingBurnEvent[] = [];
  const purchases: PurchaseEvent[] = [];
  for (const t of transfers) {
    const usd = t.kntq * priceAt(t.timeMs);
    if (t.to === dead) inflows.push({ id: `ely:${t.tx}`, t: t.timeMs, sink: 'elysium_dead', from: t.from, kntq: t.kntq, usd });
    if (t.to === treasury) pending.push({ id: `ely:${t.tx}`, t: t.timeMs, source: 'partner:ascend', kntq: t.kntq });
    if (t.to === treasury || t.to === allocator) purchases.push({ id: `ely:${t.tx}`, t: t.timeMs, source: 'partner:ascend', kntq: t.kntq, usd });
  }
  store.appendUnique(FILES.sinkInflows, inflows);
  store.appendUnique(FILES.pendingBurns, pending);
  store.appendUnique(FILES.purchases, purchases);
  state.elysiumBlock = head;
}

/** Pull the buyback wallet's new KNTQ buys. */
export async function syncFills(ctx: Ctx, state: State) {
  const fills = await f.fetchFills(ctx.a.wallets.buyback!.address, state.fillsCursorMs);
  const rows: PurchaseEvent[] = fills
    .filter((x) => x.coin === ctx.a.tokens.kntqSpotPair && x.side === 'B')
    .map((x) => ({ id: `fill:${x.timeMs}:${x.sz}:${x.px}`, t: x.timeMs, source: 'protocol_buyback', kntq: x.sz, usd: x.sz * x.px }));
  ctx.store.appendUnique(FILES.purchases, rows);
  if (fills.length) state.fillsCursorMs = Math.max(state.fillsCursorMs, ...fills.map((x) => x.timeMs));
}

/** Hourly prices for KNTQ and HYPE, appended from the last stored hour. Also returns a lookup. */
export async function syncPrices(ctx: Ctx, sinceIfEmptyMs: number) {
  const stored = ctx.store.readJsonl<[number, number, number]>(FILES.prices);
  const last = stored.length ? stored[stored.length - 1]![0] : sinceIfEmptyMs - 1;
  const [k, h] = await Promise.all([f.fetchHourlyCloses(ctx.a.tokens.kntqSpotPair, last + 1, ctx.nowMs), f.fetchHourlyCloses(ctx.a.tokens.hypeSpotPair, last + 1, ctx.nowMs)]);
  const hype = new Map(h);
  // Skip the hour still in progress so stored closes are final.
  const fresh = k.filter(([t]) => t > last && t + 3_600_000 <= ctx.nowMs && hype.has(t)).map(([t, c]) => [t, c, hype.get(t)!] as [number, number, number]);
  ctx.store.appendJsonl(FILES.prices, fresh);
  return [...stored, ...fresh];
}

export const priceLookup = (prices: [number, number, number][], fallback: number) => (tMs: number) => {
  let px = fallback;
  for (const [t, c] of prices) {
    if (t <= tMs) px = c;
    else break;
  }
  return px;
};

/** Rebuild everything under derived/ from what is stored. */
export function rebuildDerived(store: Store, a: Assumptions, nowMs: number) {
  const stored = {
    snapshots: store.readSnapshots(),
    sinkInflows: store.readJsonl<SinkInflowEvent>(FILES.sinkInflows),
    purchases: store.readJsonl<PurchaseEvent>(FILES.purchases),
    pendingBurns: store.readJsonl<PendingBurnEvent>(FILES.pendingBurns),
    walletMoves: store.readJsonl<WalletMoveEvent>(FILES.walletMoves),
  };
  const inputs = buildModelInputs(stored, a, nowMs);
  if (!inputs) return null;
  const headline = computeHeadline(inputs, a);
  const latest = stored.snapshots[stored.snapshots.length - 1]!;
  const cutoff = nowMs - 8 * DAY_MS;
  const compact = {
    ...inputs,
    sinkInflows: collapseOld(inputs.sinkInflows, cutoff, (r) => `${r.sink}|${r.from}`),
    purchases: collapseOld(inputs.purchases, cutoff, (r) => r.source),
  };
  store.writeJson(FILES.modelInputs, { generatedAt: nowMs, inputs: compact, latest, walletMoves: stored.walletMoves }, false);
  store.writeJson(FILES.headline, { generatedAt: nowMs, headline });
  store.writeJson(FILES.daily, { generatedAt: nowMs, days: buildDaily(inputs, stored.snapshots, a), history: buildBurnHistory(inputs.sinkInflows, a) }, false);
  return headline;
}

/** The hourly job. */
export async function collect(store: Store, a: Assumptions, nowMs: number): Promise<Alert[]> {
  const health = store.readJson<Health>(FILES.health, {});
  const state = store.readJson<State>(FILES.state, defaultState(a));
  const ctx: Ctx = { store, a, nowMs, health };
  const prevSnapshots = store.readSnapshots();
  const prev = prevSnapshots[prevSnapshots.length - 1] ?? null;
  const alerts: Alert[] = [];

  const spot = await source(ctx, 'hyperliquid_prices', () => f.fetchSpotPrices([a.tokens.kntqSpotPair, a.tokens.hypeSpotPair]));
  const kntqUsd = spot?.[a.tokens.kntqSpotPair] ?? null;
  const hypeUsd = spot?.[a.tokens.hypeSpotPair] ?? null;
  const prices = (await source(ctx, 'hyperliquid_candles', () => syncPrices(ctx, a.modelStartMs - 35 * DAY_MS))) ?? store.readJsonl<[number, number, number]>(FILES.prices);
  const priceAt = priceLookup(prices, kntqUsd ?? prev?.kntqUsd ?? 0);

  const af = a.sinks.hypercore_af!.address;
  const afBalance = await source(ctx, 'af_balance', () => f.fetchSpotBalance(af, 'KNTQ'));
  const ledger = await source(ctx, 'af_ledger', () => syncAfLedger(ctx, state));
  for (const o of ledger?.outflows ?? []) {
    alerts.push({ id: `afout:${o.hash}`, t: o.timeMs, type: 'af_outflow', title: `${Math.round(o.kntq).toLocaleString('en-GB')} KNTQ left the Assistance Fund`, body: `To ${o.to}. Tokens in the AF are meant to be permanently removed; check this.` });
  }
  await source(ctx, 'buyback_fills', () => syncFills(ctx, state));
  await source(ctx, 'elysium_transfers', () => syncElysium(ctx, state, priceAt));

  const ely = (holder: string) => f.erc20Balance(f.ELYSIUM_RPC, a.tokens.kntqElysium, holder);
  const evm = (holder: string) => f.erc20Balance(f.HYPEREVM_RPC, a.tokens.kntqHyperEvm, holder);
  const deadBalance = await source(ctx, 'elysium_dead_balance', () => ely(a.sinks.elysium_dead!.address));
  const ascend = await source(ctx, 'ascend_balances', async () => ({ treasury: await ely(a.partners.ascend!.burnTreasury!), allocator: await ely(a.partners.ascend!.ecosystemAllocator!) }));
  const feeHype = await source(ctx, 'sequencer_fee_account', () => f.nativeBalance(f.ELYSIUM_RPC, a.sequencer.feeAccount));
  const wallets = await source(ctx, 'hyperevm_wallets', async () => ({
    contributors: await evm(a.wallets.contributors!.address),
    investors: await evm(a.wallets.investors!.address),
    foundation: await evm(a.wallets.foundation!.address),
    growth: await evm(a.wallets.growth!.address),
  }));
  const deployer = await source(ctx, 'deployer_balance', () => f.fetchSpotBalance(a.wallets.deployer!.address, 'KNTQ'));
  const supply = await source(ctx, 'hyperliquid_supply', () => f.fetchTokenSupply(a.tokens.kntqTokenId));
  const kinetiq = await source(ctx, 'kinetiq_supply_feed', () => f.getJson(f.KINETIQ_SUPPLY_FEED));
  const partnerFeed = await source(ctx, 'kinetiq_partner_feed', () => f.getJson(f.KINETIQ_ECOSYSTEM_FEED));
  if (partnerFeed) store.writeJson('partners/latest.json', { t: nowMs, projects: partnerFeed.projects });

  const snap: Snapshot = {
    t: nowMs,
    kntqUsd,
    hypeUsd,
    sinks: { hypercore_af: afBalance, elysium_dead: deadBalance },
    wallets: { contributors: wallets?.contributors ?? null, investors: wallets?.investors ?? null, foundation: wallets?.foundation ?? null, growth: wallets?.growth ?? null, deployer },
    ascend: { treasury: ascend?.treasury ?? null, allocator: ascend?.allocator ?? null },
    feeHype,
    totalSupply: supply?.totalSupply ?? null,
    kinetiq: { burned: kinetiq ? Number(kinetiq.amountBurned) : null, circulating: kinetiq ? Number(kinetiq.circulatingSupply) : null, staked: kinetiq ? Number(kinetiq.amountStaked) : null },
  };

  // Wallet movements: compare with the last known balance of each wallet (config baseline before any snapshot).
  const lastKnown = baselineWallets(a);
  for (const s of prevSnapshots) for (const k of Object.keys(lastKnown)) if (typeof s.wallets[k] === 'number') lastKnown[k] = s.wallets[k]!;
  const { deployer: _d, ...watched } = snap.wallets;
  const moves = walletMovesFromBalances(lastKnown, watched, nowMs);
  store.appendUnique(FILES.walletMoves, moves);
  store.appendJsonl(snapshotFile(nowMs), [snap]);
  alerts.push(...alertsFromSnapshots(prev, snap, moves));

  store.writeJson(FILES.state, state);
  store.writeJson(FILES.health, health);
  const headline = rebuildDerived(store, a, nowMs);
  if (headline) for (const r of headline.sinkReconciliation) if (!r.ok) console.error(`[reconcile] ${r.sink}: balance ${r.balance} vs ledger ${r.ledgerSum}`);
  return store.appendUnique(FILES.alerts, alerts);
}

/** The daily job: re-read the whole AF ledger to catch anything an hourly run missed, snapshot kPoints holders, rebuild. */
export async function daily(store: Store, a: Assumptions, nowMs: number, kpointsWallets: { address: string; claimed: number }[], totalClaimed: number) {
  const health = store.readJson<Health>(FILES.health, {});
  const ctx: Ctx = { store, a, nowMs, health };
  const af = a.sinks.hypercore_af!.address;
  await source(ctx, 'af_ledger_full', async () => {
    const rows = await f.fetchKntqLedger(af, a.genesisMs - DAY_MS);
    const fresh = store.appendUnique(FILES.sinkInflows, ledgerToInflows(rows, af));
    if (fresh.length) console.error(`[daily] recovered ${fresh.length} AF ledger rows missed by hourly runs`);
  });
  await source(ctx, 'kpoints_holders', async () => {
    let held = 0;
    let claimed = 0;
    let checked = 0;
    for (let i = 0; i < kpointsWallets.length; i += 4) {
      const batch = kpointsWallets.slice(i, i + 4);
      const balances = await Promise.all(
        batch.map(async (w) => (await f.erc20Balance(f.HYPEREVM_RPC, a.tokens.kntqHyperEvm, w.address)) + (await f.fetchSpotBalance(w.address, 'KNTQ'))),
      );
      batch.forEach((w, j) => {
        held += Math.min(w.claimed, balances[j]!);
        claimed += w.claimed;
        checked += 1;
      });
    }
    store.appendJsonl(FILES.kpoints, [{ t: nowMs, wallets: checked, claimed, held, movedOut: claimed - held, shareOfAllClaimed: totalClaimed > 0 ? claimed / totalClaimed : null }]);
  });
  store.writeJson(FILES.health, health);
  rebuildDerived(store, a, nowMs);
}

/** The weekly job: diff Kinetiq's partner feed and the Elysium sitemap against last week. Returns a Markdown summary, or null if nothing changed. */
export async function weekly(store: Store, nowMs: number): Promise<string | null> {
  const feed = await f.getJson(f.KINETIQ_ECOSYSTEM_FEED);
  const xml = await f.getText(f.ELYSIUM_SITEMAP);
  const cur: CommitmentState = {
    projects: Object.fromEntries((feed.projects as any[]).map((p) => [p.slug, { title: p.title, commitment: p.commitment, share: p.share ?? null, burnShare: p.burnShare ?? null }])),
    sitemapSlugs: sitemapSlugs(xml),
  };
  const prev = store.readJson<CommitmentState | null>(FILES.commitments, null);
  store.writeJson(FILES.commitments, cur);
  if (!prev) return null; // first run only records the starting point
  const changes = diffCommitments(prev, cur);
  if (!changes.length) return null;
  store.appendJsonl(FILES.commitmentChanges, changes.map((c) => ({ t: nowMs, ...c })));
  const order = ['new_commitment', 'changed_commitment', 'removed_commitment', 'new_project', 'removed_project'];
  const lines = [...changes].sort((x, y) => order.indexOf(x.kind) - order.indexOf(y.kind)).map((c) => `- **${c.kind.replace(/_/g, ' ')}** — \`${c.slug}\`: ${c.detail}`);
  return `Changes since the last weekly check (${new Date(nowMs).toISOString().slice(0, 10)}):\n\n${lines.join('\n')}\n\nNew ecosystem pages are listed so you can check them for a KNTQ commitment; only projects in Kinetiq's buyback feed are compared word for word.\nTo act on a change, edit \`config/assumptions.yaml\` (section \`partners\`).`;
}
