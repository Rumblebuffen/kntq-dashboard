// Pure functions that turn stored events and snapshots into model inputs, daily aggregates and alerts.
// No network and no file access here, so all of it is unit-tested.

import type { Assumptions } from '../model/assumptions.js';
import { buildAttributionMap, burnedBySource } from '../model/burn.js';
import type { SinkInflow } from '../model/burn.js';
import { type EstimateSeries, estimatedInWindow, sequencerAccrualKntq } from '../model/estimate.js';
import type { Purchase } from '../model/flow.js';
import type { ModelInputs, PendingBurn, Release } from '../model/headline.js';
import { DAY_MS, ictDayKey, ictDayStartMs } from '../model/time.js';
import { type ObservedUnlock, unlockedInWindow } from '../model/unlock.js';
import type { Alert, PendingBurnEvent, PurchaseEvent, SinkInflowEvent, Snapshot, WalletMoveEvent } from './store.js';

const EPS = 1e-6;

/** Balance changes between two snapshots of the watched wallets. Negative = left the wallet. */
export function walletMovesFromBalances(prev: Record<string, number | null>, cur: Record<string, number | null>, tMs: number): WalletMoveEvent[] {
  const out: WalletMoveEvent[] = [];
  for (const [wallet, now] of Object.entries(cur)) {
    const before = prev[wallet];
    if (typeof now !== 'number' || typeof before !== 'number') continue;
    const delta = now - before;
    if (Math.abs(delta) > EPS) out.push({ id: `bal:${wallet}:${tMs}`, t: tMs, wallet, kntq: delta, via: 'balance' });
  }
  return out;
}

/** The wallet balances the model assumes before the first snapshot exists. */
export function baselineWallets(a: Assumptions): Record<string, number | null> {
  return {
    contributors: a.unlock.contributorsKntq,
    investors: a.unlock.investorsKntq,
    foundation: a.wallets.foundation?.baselineKntq ?? null,
    growth: a.wallets.growth?.baselineKntq ?? null,
  };
}

/**
 * Sequencer estimate: HYPE that accrued in the fee account between consecutive snapshots, converted to the KNTQ
 * its buyback share would buy at that hour's prices, grouped into one flat-rate series per ICT day.
 * A fall in the balance (fees being spent) is ignored here; the spend shows up as a real purchase instead.
 */
export function sequencerEstimates(snapshots: Snapshot[], a: Assumptions, fromMs: number, untilMs = Number.POSITIVE_INFINITY): EstimateSeries[] {
  const rows = snapshots.filter((s) => s.t >= fromMs && s.t <= untilMs && s.feeHype !== null).sort((x, y) => x.t - y.t);
  const perDay = new Map<number, { kntq: number; from: number; to: number }>();
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1]!;
    const cur = rows[i]!;
    const delta = cur.feeHype! - prev.feeHype!;
    if (delta <= 0 || !cur.hypeUsd || !cur.kntqUsd) continue;
    const kntq = sequencerAccrualKntq(delta, a.sequencer.kntqShare, cur.hypeUsd, cur.kntqUsd) * a.sequencer.burnedShare;
    const day = ictDayStartMs(cur.t - 1);
    const d = perDay.get(day) ?? { kntq: 0, from: Math.max(day, prev.t), to: cur.t };
    d.kntq += kntq;
    d.to = cur.t;
    perDay.set(day, d);
  }
  return [...perDay.values()]
    .filter((d) => d.to > d.from)
    .map((d) => ({ source: 'sequencer', tier: 'derived' as const, kntqPerDay: d.kntq / ((d.to - d.from) / DAY_MS), fromMs: d.from, toMs: d.to }));
}

/** Merge old rows into one per (ICT day, key) to keep the file the page downloads small. Recent rows stay exact. */
export function collapseOld<T extends { timeMs: number; kntq: number; usd?: number }>(rows: T[], cutoffMs: number, keyOf: (r: T) => string): T[] {
  const merged = new Map<string, T>();
  const recent: T[] = [];
  for (const r of rows) {
    if (r.timeMs >= cutoffMs) {
      recent.push(r);
      continue;
    }
    const k = `${ictDayKey(r.timeMs)}|${keyOf(r)}`;
    const m = merged.get(k);
    if (!m) merged.set(k, { ...r });
    else {
      m.kntq += r.kntq;
      if (r.usd !== undefined) m.usd = (m.usd ?? 0) + r.usd;
      m.timeMs = Math.max(m.timeMs, r.timeMs);
    }
  }
  return [...merged.values(), ...recent].sort((x, y) => x.timeMs - y.timeMs);
}

export interface Stored {
  snapshots: Snapshot[];
  sinkInflows: SinkInflowEvent[];
  purchases: PurchaseEvent[];
  pendingBurns: PendingBurnEvent[];
  walletMoves: WalletMoveEvent[];
}

/** Assemble the model's inputs from what is stored. Returns null until there is at least one usable snapshot. */
export function buildModelInputs(s: Stored, a: Assumptions, nowMs: number): ModelInputs | null {
  const latest = [...s.snapshots].reverse().find((x) => x.kntqUsd !== null);
  if (!latest) return null;
  // Use the newest non-null reading of each sink, so one failed read does not zero the total.
  const sinkBalances: Record<string, number> = {};
  for (const snap of s.snapshots) for (const [k, v] of Object.entries(snap.sinks)) if (typeof v === 'number') sinkBalances[k] = v;

  const sinkInflows: SinkInflow[] = s.sinkInflows.map((e) => ({ timeMs: e.t, sink: e.sink, from: e.from, kntq: e.kntq, usd: e.usd }));
  const purchases: Purchase[] = s.purchases.map((e) => ({ timeMs: e.t, source: e.source, kntq: e.kntq, usd: e.usd }));
  const pendingBurns: PendingBurn[] = s.pendingBurns.map((e) => ({ timeMs: e.t, source: e.source, kntq: e.kntq }));
  const observedUnlocks: ObservedUnlock[] = s.walletMoves
    .filter((m) => (m.wallet === 'contributors' || m.wallet === 'investors') && m.kntq < 0)
    .map((m) => ({ timeMs: m.t, kntq: -m.kntq, wallet: m.wallet as 'contributors' | 'investors' }));
  const releases: Release[] = s.walletMoves
    .filter((m) => (m.wallet === 'foundation' || m.wallet === 'growth') && m.kntq < 0 && m.t > a.modelStartMs)
    .map((m) => ({ timeMs: m.t, kntq: -m.kntq, wallet: m.wallet as 'foundation' | 'growth' }));

  return {
    nowMs,
    kntqUsd: latest.kntqUsd!,
    sinkBalances,
    sinkInflows,
    pendingBurns,
    estimates: sequencerEstimates(s.snapshots, a, a.modelStartMs),
    observedUnlocks,
    releases,
    purchases,
  };
}

export interface DailyRow {
  day: string; // ICT date
  t0: number;
  t1: number;
  burned: Record<string, number>;
  burnedTotal: number;
  pendingBurn: number;
  estimated: number;
  unlockedKind: 'projected' | 'actual';
  /** projected rate before the first tranche, 30-day smoothed rate after it */
  unlockedDaily: number;
  /** real steps falling in the day (zero before the first tranche) */
  unlockedStep: number;
  released: number;
  purchasesUsd: Record<string, number>;
  priceClose: number | null;
}

/** One row per ICT day from the model start to today (the last day is partial). */
export function buildDaily(inp: ModelInputs, snapshots: Snapshot[], a: Assumptions): DailyRow[] {
  const map = buildAttributionMap(a.attribution);
  const rows: DailyRow[] = [];
  for (let d0 = ictDayStartMs(a.modelStartMs); d0 < inp.nowMs; d0 += DAY_MS) {
    const t0 = Math.max(d0, a.modelStartMs);
    const t1 = Math.min(d0 + DAY_MS, inp.nowMs);
    const burned = burnedBySource(inp.sinkInflows, map, t0, t1);
    const u = unlockedInWindow(a.unlock, inp.observedUnlocks, t0, t1, inp.nowMs);
    const purchasesUsd: Record<string, number> = {};
    for (const p of inp.purchases) if (p.timeMs > t0 && p.timeMs <= t1) purchasesUsd[p.source] = (purchasesUsd[p.source] ?? 0) + p.usd;
    const lastPriced = [...snapshots].reverse().find((s) => s.t > t0 && s.t <= t1 && s.kntqUsd !== null);
    rows.push({
      day: ictDayKey(t0),
      t0,
      t1,
      burned,
      burnedTotal: Object.values(burned).reduce((x, y) => x + y, 0),
      pendingBurn: inp.pendingBurns.reduce((x, p) => (p.timeMs > t0 && p.timeMs <= t1 ? x + p.kntq : x), 0),
      estimated: estimatedInWindow(inp.estimates, t0, t1),
      unlockedKind: u.kind,
      unlockedDaily: u.kind === 'projected' ? u.kntq : (u.smoothedKntq ?? 0),
      unlockedStep: u.kind === 'actual' ? u.kntq : 0,
      released: inp.releases.reduce((x, r) => (r.timeMs > t0 && r.timeMs <= t1 ? x + r.kntq : x), 0),
      purchasesUsd,
      priceClose: lastPriced?.kntqUsd ?? null,
    });
  }
  return rows;
}

export interface HistoryRow {
  day: string;
  burned: Record<string, number>;
}

/** Burns per ICT day and source for the whole history, so the burn line starts at the first burn. */
export function buildBurnHistory(inflows: SinkInflow[], a: Assumptions): HistoryRow[] {
  const map = buildAttributionMap(a.attribution);
  const days = new Map<string, Record<string, number>>();
  for (const x of inflows) {
    const day = ictDayKey(x.timeMs);
    const src = map[x.from.toLowerCase()] ?? 'unattributed';
    const d = days.get(day) ?? {};
    d[src] = (d[src] ?? 0) + x.kntq;
    days.set(day, d);
  }
  return [...days.entries()].sort(([x], [y]) => (x < y ? -1 : 1)).map(([day, burned]) => ({ day, burned }));
}

/** Alerts raised by comparing the newest snapshot with the one before it. */
export function alertsFromSnapshots(prev: Snapshot | null, cur: Snapshot, moves: WalletMoveEvent[]): Alert[] {
  const out: Alert[] = [];
  const fmt = (v: number) => Math.round(v).toLocaleString('en-GB');
  for (const m of moves) {
    if (m.kntq >= 0) continue;
    const vesting = m.wallet === 'contributors' || m.wallet === 'investors';
    out.push({
      id: `move:${m.id}`,
      t: m.t,
      type: vesting ? 'vesting_wallet_moved' : 'treasury_outflow',
      title: `${fmt(-m.kntq)} KNTQ left the ${m.wallet} wallet`,
      body: `Detected ${new Date(m.t).toISOString()} by ${m.via === 'balance' ? 'an hourly balance change' : 'an on-chain transfer'}.${vesting ? ' This may be the first sign of a tranche being released.' : ' Counted as newly circulating.'}`,
    });
  }
  if (!prev) return out;
  for (const [sink, bal] of Object.entries(cur.sinks)) {
    const before = prev.sinks[sink];
    if (typeof bal === 'number' && typeof before === 'number' && bal < before - 0.01) {
      out.push({ id: `sink:${sink}:${cur.t}`, t: cur.t, type: 'sink_outflow', title: `Burn sink ${sink} fell by ${fmt(before - bal)} KNTQ`, body: 'A burn sink should only ever grow. Check whether the address is really a permanent sink.' });
    }
  }
  if (typeof cur.feeHype === 'number' && typeof prev.feeHype === 'number' && cur.feeHype < prev.feeHype - 0.01) {
    out.push({ id: `fee:${cur.t}`, t: cur.t, type: 'sequencer_fees_spent', title: `Elysium fee account spent ${(prev.feeHype - cur.feeHype).toFixed(2)} HYPE`, body: 'This may be the first sequencer-fee buyback. Find the wallet that bought KNTQ, add it to attribution in config/assumptions.yaml, and the estimate will be replaced by actuals.' });
  }
  if (typeof cur.ascend.treasury === 'number' && typeof prev.ascend.treasury === 'number' && cur.ascend.treasury < prev.ascend.treasury - 0.01) {
    out.push({ id: `ascend:${cur.t}`, t: cur.t, type: 'ascend_treasury_outflow', title: `Ascend's burn treasury sent out ${fmt(prev.ascend.treasury - cur.ascend.treasury)} KNTQ`, body: 'Check where it went. If it reached the AF or a dead address it is now burned, and the sender should be attributed to partner:ascend.' });
  }
  return out;
}

export interface Commitment {
  title: string;
  commitment: string;
  share: number | null;
  burnShare: number | null;
}

export interface CommitmentState {
  projects: Record<string, Commitment>;
  sitemapSlugs: string[];
}

export interface CommitmentChange {
  kind: 'new_commitment' | 'removed_commitment' | 'changed_commitment' | 'new_project' | 'removed_project';
  slug: string;
  detail: string;
}

/** Weekly diff of Kinetiq's partner feed and the Elysium sitemap against what was stored last time. */
export function diffCommitments(prev: CommitmentState, cur: CommitmentState): CommitmentChange[] {
  const out: CommitmentChange[] = [];
  for (const [slug, c] of Object.entries(cur.projects)) {
    const p = prev.projects[slug];
    if (!p) out.push({ kind: 'new_commitment', slug, detail: `${c.title}: "${c.commitment}" (share ${c.share ?? '?'}%, burn share ${c.burnShare ?? 'not stated'})` });
    else if (p.commitment !== c.commitment || p.share !== c.share || p.burnShare !== c.burnShare) {
      out.push({ kind: 'changed_commitment', slug, detail: `${c.title}: was "${p.commitment}" (share ${p.share ?? '?'}%, burn share ${p.burnShare ?? 'not stated'}), now "${c.commitment}" (share ${c.share ?? '?'}%, burn share ${c.burnShare ?? 'not stated'})` });
    }
  }
  for (const slug of Object.keys(prev.projects)) if (!cur.projects[slug]) out.push({ kind: 'removed_commitment', slug, detail: `${prev.projects[slug]!.title} is no longer in Kinetiq's buyback feed` });
  const before = new Set(prev.sitemapSlugs);
  const after = new Set(cur.sitemapSlugs);
  for (const slug of after) if (!before.has(slug)) out.push({ kind: 'new_project', slug, detail: `New ecosystem page: https://elysium.kinetiq.xyz/ecosystem/${slug}` });
  for (const slug of before) if (!after.has(slug)) out.push({ kind: 'removed_project', slug, detail: 'Ecosystem page removed from the sitemap' });
  return out;
}

/** Mainnet project slugs from the Elysium sitemap XML. */
export function sitemapSlugs(xml: string): string[] {
  const out = new Set<string>();
  for (const m of xml.matchAll(/<loc>https:\/\/elysium\.kinetiq\.xyz\/ecosystem\/([^<\/]+)<\/loc>/g)) out.add(m[1]!);
  return [...out].sort();
}
