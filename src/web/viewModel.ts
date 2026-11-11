// Turns loaded data plus the current scenario into everything the views show. No rendering here.

import type { Assumptions, Confidence } from '../model/assumptions';
import { buildAttributionMap, burnedBySource } from '../model/burn';
import { estimatedInWindow } from '../model/estimate';
import { type SellPressureLine, sellThroughFor } from '../model/flow';
import { type Headline, computeHeadline } from '../model/headline';
import { type Crossover, findCrossover, projectedBurnedAt } from '../model/projection';
import { DAY_MS, ictDayKey, ictDayStartMs } from '../model/time';
import { type Tranche, preUnlockDailyRate, trancheSchedule, unlockedInWindow } from '../model/unlock';
import type { KpointsRow, PageData } from './data';
import { type Scenario, toSellThrough } from './urlState';

export interface DayRow {
  day: string;
  t0: number;
  buyback: number;
  fees: number;
  other: number;
  pending: number;
  estimated: number;
  /** KNTQ per day; null before the model start */
  unlockRate: number | null;
  unlockKind: 'projected' | 'actual' | null;
  buyUsdBuyback: number;
  buyUsdAscend: number;
  sellUsd: number | null;
}

export type SourceStatus = 'Live' | 'Estimated' | 'Pending burn' | 'No data' | 'Excluded';

export interface SourceRow {
  name: string;
  tier: 'A' | 'B';
  commitment: string;
  burnedShare: string;
  status: SourceStatus;
  kntq7d: number | null;
  kntq7dNote?: string;
  confidence: Confidence;
  source: string;
  verified: string;
  flag?: string;
}

export interface View {
  a: Assumptions;
  h: Headline;
  nowMs: number;
  schedule: Tranche[];
  projectedRate: number;
  crossover: Crossover;
  days: DayRow[];
  cumulative: { t: number; burned: number; inclEstimates: number }[];
  projectionEndMs: number;
  projectedBurnedAtEnd: number;
  sources: SourceRow[];
  kpoints: KpointsRow | null;
  kpointsPerDay: number | null;
  firstTrancheIsAlt: boolean;
}

/** kPoints holders moving tokens out, as KNTQ per day between the last two daily readings. */
function kpointsRate(rows: KpointsRow[]): number | null {
  if (rows.length < 2) return null;
  const a = rows[rows.length - 2]!;
  const b = rows[rows.length - 1]!;
  const days = (b.t - a.t) / DAY_MS;
  return days > 0 ? Math.max(0, (b.movedOut - a.movedOut) / days) : null;
}

const pctText = (v: number) => `${Math.round(v * 1000) / 10}%`;

export function buildView(d: PageData, sc: Scenario): View {
  const firstTrancheIsAlt = sc.altFirstTranche && d.a.firstTrancheAltMs !== null;
  const a: Assumptions = firstTrancheIsAlt ? { ...d.a, unlock: { ...d.a.unlock, firstTrancheMs: d.a.firstTrancheAltMs! } } : d.a;
  const st = toSellThrough(sc, a.sellThrough);
  const kpPerDay = kpointsRate(d.kpoints);
  const extraSellLines: SellPressureLine[] = kpPerDay !== null ? [{ source: 'kpoints', kntqPerDay: kpPerDay }] : [];
  const inputs = { ...d.inputs, extraSellLines };
  const nowMs = inputs.nowMs;
  const h = computeHeadline(inputs, a, st);
  const schedule = trancheSchedule(a.unlock);
  const since = h.windows[h.windows.length - 1]!;

  const projectedRate = h.runRate.kntqPerDay * sc.burnScenario;
  const lastTranche = schedule[schedule.length - 1]!.timeMs;
  const proj = { nowMs, burnedSinceStart: since.burnedActual, burnRatePerDay: projectedRate, schedule };
  const crossover = findCrossover(proj, lastTranche + a.crossoverHorizonYears * 365.25 * DAY_MS);
  const projectionEndMs = lastTranche + 60 * DAY_MS;

  // ----- per-day rows -----
  const historyByDay = new Map(d.history.map((r) => [r.day, r.burned]));
  const derivedByDay = new Map(d.days.map((r) => [r.day, r]));
  const buyByDay = new Map<string, { buyback: number; ascend: number }>();
  for (const p of inputs.purchases) {
    const k = ictDayKey(p.timeMs);
    const e = buyByDay.get(k) ?? { buyback: 0, ascend: 0 };
    if (p.source === 'protocol_buyback') e.buyback += p.usd;
    else e.ascend += p.usd;
    buyByDay.set(k, e);
  }
  const today0 = ictDayStartMs(nowMs);
  const firstHistory = d.history.length ? Date.parse(`${d.history[0]!.day}T00:00:00+07:00`) : a.modelStartMs;
  const span = sc.range === 'all' ? Math.round((today0 - firstHistory) / DAY_MS) + 1 : Number(sc.range);
  const days: DayRow[] = [];
  for (let i = span - 1; i >= 0; i--) {
    const d0 = today0 - i * DAY_MS;
    const day = ictDayKey(d0);
    const burned = historyByDay.get(day) ?? {};
    const der = derivedByDay.get(day);
    let unlockRate: number | null = null;
    let unlockKind: DayRow['unlockKind'] = null;
    let released = 0;
    if (d0 + DAY_MS > a.modelStartMs) {
      const t0 = Math.max(d0, a.modelStartMs);
      const t1 = Math.min(d0 + DAY_MS, nowMs);
      const u = unlockedInWindow(a.unlock, inputs.observedUnlocks, t0, t1, nowMs);
      const amount = u.kind === 'projected' ? u.kntq : (u.smoothedKntq ?? 0);
      unlockRate = t1 > t0 ? amount / ((t1 - t0) / DAY_MS) : 0;
      unlockKind = u.kind;
      released = inputs.releases.reduce((s, r) => (r.timeMs > t0 && r.timeMs <= t1 ? s + r.kntq : s), 0);
    }
    const buy = buyByDay.get(day) ?? { buyback: 0, ascend: 0 };
    const price = der?.priceClose ?? inputs.kntqUsd;
    const known = (burned.protocol_buyback ?? 0) + (burned.fees ?? 0);
    const total = Object.values(burned).reduce((s, v) => s + v, 0);
    days.push({
      day,
      t0: d0,
      buyback: burned.protocol_buyback ?? 0,
      fees: burned.fees ?? 0,
      other: total - known,
      pending: der?.pendingBurn ?? 0,
      estimated: der?.estimated ?? 0,
      unlockRate,
      unlockKind,
      buyUsdBuyback: buy.buyback,
      buyUsdAscend: buy.ascend,
      sellUsd: unlockRate === null ? null : (unlockRate * sellThroughFor('unlocks', st) + released * sellThroughFor('growth_foundation', st) + (kpPerDay ?? 0) * sellThroughFor('kpoints', st)) * price,
    });
  }

  // ----- cumulative burned since the model start, day by day -----
  const cumulative: View['cumulative'] = [{ t: a.modelStartMs, burned: 0, inclEstimates: 0 }];
  let cb = 0;
  let ce = 0;
  for (const r of d.days) {
    cb += r.burnedTotal;
    ce += r.burnedTotal + r.pendingBurn + r.estimated;
    cumulative.push({ t: Math.min(r.t1, nowMs), burned: cb, inclEstimates: ce });
  }

  // ----- sources table -----
  const map = buildAttributionMap(a.attribution);
  const week0 = nowMs - 7 * DAY_MS;
  const by7 = burnedBySource(inputs.sinkInflows, map, week0, nowMs);
  const meta = (path: string) => a.meta.find((m) => m.path === path);
  const coreRow = (name: string, key: string, commitment: string, metaPath: string, sourceUrl: string): SourceRow => ({
    name,
    tier: 'A',
    commitment,
    burnedShare: '100%',
    status: (by7[key] ?? 0) > 0 ? 'Live' : 'No data',
    kntq7d: by7[key] ?? 0,
    confidence: meta(metaPath)?.confidence ?? 'moderate',
    source: sourceUrl,
    verified: meta(metaPath)?.retrieved ?? '',
  });
  const pending7 = inputs.pendingBurns.reduce((s, p) => (p.timeMs > week0 ? s + p.kntq : s), 0);
  const est7 = estimatedInWindow(inputs.estimates, week0, nowMs);
  const sources: SourceRow[] = [
    coreRow('KNTQ spot trading fees', 'fees', '100% of spot fees', 'attribution.fees', 'https://kinetiq.xyz/docs/kntq'),
    coreRow('Protocol buybacks', 'protocol_buyback', '70% of protocol revenue; 100% of validator, Markets and Launch shares', 'attribution.protocol_buyback', 'https://kinetiq.xyz/docs/kntq'),
    {
      name: 'Elysium sequencer fees',
      tier: 'A',
      commitment: pctText(a.sequencer.kntqShare) + ' of sequencer revenue',
      burnedShare: pctText(a.sequencer.burnedShare),
      status: est7 > 0 ? 'Estimated' : 'No data',
      kntq7d: est7,
      kntq7dNote: 'fees collected, not yet spent on buybacks',
      confidence: meta('sequencer.kntq_share')?.confidence ?? 'high',
      source: 'https://kinetiq.xyz/docs/kntq',
      verified: meta('sequencer.kntq_share')?.retrieved ?? '',
    },
    {
      name: 'Other burns (dead address on Elysium)',
      tier: 'A',
      commitment: 'none',
      burnedShare: '100%',
      status: (by7.unattributed ?? 0) > 0 ? 'Live' : 'No data',
      kntq7d: by7.unattributed ?? 0,
      confidence: 'high',
      source: `https://elysium.kinetiq.xyz/address/${a.sinks.elysium_dead?.address ?? ''}`,
      verified: meta('sinks.elysium_dead')?.retrieved ?? '',
    },
  ];
  const feed = new Map(d.partners.map((p) => [p.slug, p]));
  for (const p of Object.values(a.partners)) {
    const f = feed.get(p.slug);
    const reported = f?.totals?.burnedKntqAmount ?? 0;
    const isAscend = p.slug === 'ascend';
    let status: SourceStatus = 'No data';
    if (p.confidence === 'UNVERIFIED') status = 'Excluded';
    else if (reported > 0) status = 'Live';
    else if (isAscend && pending7 > 0) status = 'Pending burn';
    const alts = [p.altCommitment !== undefined ? `alternative commitment ${pctText(p.altCommitment)}` : null, p.altBurnedShare !== undefined ? `alternative burned share ${pctText(p.altBurnedShare)}` : null].filter(Boolean);
    sources.push({
      name: f?.title ?? p.slug,
      tier: 'B',
      commitment: `${pctText(p.commitment)} of ${p.revenueBase}`,
      burnedShare: pctText(p.burnedShare),
      status,
      kntq7d: status === 'Excluded' ? null : isAscend ? pending7 : reported,
      kntq7dNote: isAscend && pending7 > 0 ? 'held in its burn treasury, not yet burned' : undefined,
      confidence: p.confidence,
      source: p.source,
      verified: meta(`partners.${p.slug}`)?.retrieved ?? '',
      flag: alts.length ? `Sources conflict: ${alts.join(', ')}. The conservative figure is used.` : undefined,
    });
  }

  return {
    a,
    h,
    nowMs,
    schedule,
    projectedRate,
    crossover,
    days,
    cumulative,
    projectionEndMs,
    projectedBurnedAtEnd: projectedBurnedAt(proj, projectionEndMs),
    sources,
    kpoints: d.kpoints[d.kpoints.length - 1] ?? null,
    kpointsPerDay: kpPerDay,
    firstTrancheIsAlt,
  };
}

export const preUnlockRate = (a: Assumptions) => preUnlockDailyRate(a.unlock);
