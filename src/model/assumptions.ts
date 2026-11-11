// Loads config/assumptions.yaml into a typed object and rejects malformed edits with a readable message.
// Works in Node and in the browser (it takes the YAML text, it does not read files).

import { parse } from 'yaml';
import type { SellSource, SellThrough } from './flow.js';
import type { UnlockParams } from './unlock.js';

export type Confidence = 'high' | 'moderate' | 'low' | 'UNVERIFIED';
const CONFIDENCES: Confidence[] = ['high', 'moderate', 'low', 'UNVERIFIED'];
const SELL_SOURCES: SellSource[] = ['unlocks', 'growth_foundation', 'kpoints', 'incentives'];

export interface Meta {
  path: string;
  source: string;
  retrieved: string;
  confidence: Confidence;
}

export interface AddressEntry {
  address: string;
  chain: string;
  baselineKntq?: number;
}

export interface Partner {
  slug: string;
  commitment: number;
  burnedShare: number;
  altCommitment?: number;
  altBurnedShare?: number;
  revenueBase: string;
  benchmarkRevenueUsdPerDay: number | null;
  burnTreasury?: string;
  ecosystemAllocator?: string;
  confidence: Confidence;
  source: string;
}

export interface Assumptions {
  maxSupplyKntq: number;
  genesisMs: number;
  modelStartMs: number;
  runRateDays: number;
  crossoverHorizonYears: number;
  unlock: UnlockParams;
  firstTrancheAltMs: number | null;
  wallets: Record<string, AddressEntry>;
  sinks: Record<string, AddressEntry>;
  attribution: Record<string, string[]>;
  tokens: { kntqTokenId: string; kntqSpotPair: string; hypeSpotPair: string; kntqHyperEvm: string; kntqElysium: string };
  sellThrough: SellThrough;
  scenarios: { bear: number; base: number; bull: number };
  sequencer: { feeAccount: string; kntqShare: number; burnedShare: number };
  partners: Record<string, Partner>;
  meta: Meta[];
  /** paths of every constant marked UNVERIFIED, for display */
  unverified: string[];
}

type Raw = Record<string, any>;

class ConfigError extends Error {}
const fail = (path: string, msg: string): never => {
  throw new ConfigError(`assumptions.yaml: ${path}: ${msg}`);
};

export function loadAssumptions(yamlText: string): Assumptions {
  const raw = parse(yamlText) as Raw;
  if (!raw || typeof raw !== 'object') fail('(root)', 'file is empty or not a mapping');
  const meta: Meta[] = [];

  const entry = (path: string): Raw => {
    const e = path.split('.').reduce<any>((o, k) => (o && typeof o === 'object' ? o[k] : undefined), raw);
    if (!e || typeof e !== 'object') fail(path, 'missing');
    if (typeof e.source !== 'string' || !e.source.trim()) fail(path, 'needs a source');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(e.retrieved))) fail(path, 'needs a retrieved date (YYYY-MM-DD)');
    if (!CONFIDENCES.includes(e.confidence)) fail(path, `confidence must be one of ${CONFIDENCES.join(', ')}`);
    meta.push({ path, source: e.source, retrieved: String(e.retrieved), confidence: e.confidence });
    return e;
  };
  const num = (path: string, v: unknown, lo = Number.NEGATIVE_INFINITY, hi = Number.POSITIVE_INFINITY): number => {
    if (typeof v !== 'number' || !Number.isFinite(v)) fail(path, `expected a number, got ${JSON.stringify(v)}`);
    if ((v as number) < lo || (v as number) > hi) fail(path, `must be between ${lo} and ${hi}, got ${v}`);
    return v as number;
  };
  const value = (path: string) => entry(path).value;
  const numAt = (path: string, lo?: number, hi?: number) => num(path, value(path), lo, hi);
  const date = (path: string, v: unknown): number => {
    const ms = Date.parse(String(v));
    if (Number.isNaN(ms)) fail(path, `expected an ISO date, got ${JSON.stringify(v)}`);
    return ms;
  };
  const address = (path: string, v: unknown): string => {
    if (typeof v !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(v)) fail(path, `expected a 0x address of 40 hex characters, got ${JSON.stringify(v)}`);
    return (v as string).toLowerCase();
  };
  const str = (path: string, v: unknown): string => {
    if (typeof v !== 'string' || !v) fail(path, 'expected text');
    return v as string;
  };
  const section = (name: string): Raw => {
    const s = raw[name];
    if (!s || typeof s !== 'object') fail(name, 'section missing');
    return s;
  };

  const addressSection = (name: string): Record<string, AddressEntry> =>
    Object.fromEntries(
      Object.keys(section(name)).map((k) => {
        const e = entry(`${name}.${k}`);
        const out: AddressEntry = { address: address(`${name}.${k}`, e.value), chain: str(`${name}.${k}.chain`, e.chain) };
        if (e.baseline_kntq !== undefined) out.baselineKntq = num(`${name}.${k}.baseline_kntq`, e.baseline_kntq, 0);
        return [k, out];
      }),
    );

  const firstTranche = entry('vesting.first_tranche_utc');
  const unlock: UnlockParams = {
    contributorsKntq: numAt('vesting.contributors_kntq', 0),
    investorsKntq: numAt('vesting.investors_kntq', 0),
    trancheCount: numAt('vesting.tranche_count', 1, 1000),
    firstTrancheMs: date('vesting.first_tranche_utc', firstTranche.value),
    modelStartMs: date('model.start_utc', value('model.start_utc')),
    preUnlockSmoothingDays: numAt('model.pre_unlock_smoothing_days', 1, 366),
    unlockSmoothingDays: numAt('model.unlock_smoothing_days', 1, 366),
  };
  if (!Number.isInteger(unlock.trancheCount)) fail('vesting.tranche_count', 'must be a whole number');

  const overridesRaw = value('sell_through.overrides') ?? {};
  const overrides: SellThrough['overrides'] = {};
  for (const [k, v] of Object.entries(overridesRaw as Raw)) {
    if (!SELL_SOURCES.includes(k as SellSource)) fail(`sell_through.overrides.${k}`, `unknown source; use one of ${SELL_SOURCES.join(', ')}`);
    overrides[k as SellSource] = num(`sell_through.overrides.${k}`, v, 0, 1);
  }

  const attribution: Record<string, string[]> = {};
  for (const k of Object.keys(section('attribution'))) {
    const v = value(`attribution.${k}`);
    if (!Array.isArray(v)) fail(`attribution.${k}`, 'expected a list of addresses');
    attribution[k] = (v as unknown[]).map((a, i) => address(`attribution.${k}[${i}]`, a));
  }

  const partners: Record<string, Partner> = {};
  for (const slug of Object.keys(section('partners'))) {
    const path = `partners.${slug}`;
    const e = entry(path);
    const bench = e.benchmark_revenue_usd_per_day;
    const p: Partner = {
      slug,
      commitment: num(`${path}.commitment`, e.commitment, 0, 1),
      burnedShare: num(`${path}.burned_share`, e.burned_share, 0, 1),
      revenueBase: str(`${path}.revenue_base`, e.revenue_base),
      benchmarkRevenueUsdPerDay: bench === null || bench === undefined ? null : num(`${path}.benchmark_revenue_usd_per_day`, bench, 0),
      confidence: e.confidence,
      source: e.source,
    };
    if (e.alt_commitment !== undefined) p.altCommitment = num(`${path}.alt_commitment`, e.alt_commitment, 0, 1);
    if (e.alt_burned_share !== undefined) p.altBurnedShare = num(`${path}.alt_burned_share`, e.alt_burned_share, 0, 1);
    if (e.burn_treasury !== undefined) p.burnTreasury = address(`${path}.burn_treasury`, e.burn_treasury);
    if (e.ecosystem_allocator !== undefined) p.ecosystemAllocator = address(`${path}.ecosystem_allocator`, e.ecosystem_allocator);
    partners[slug] = p;
  }

  const a: Assumptions = {
    maxSupplyKntq: numAt('supply.max_supply_kntq', 1),
    genesisMs: date('supply.genesis_utc', value('supply.genesis_utc')),
    modelStartMs: unlock.modelStartMs,
    runRateDays: numAt('model.run_rate_days', 1, 366),
    crossoverHorizonYears: numAt('model.crossover_horizon_years', 0, 1000),
    unlock,
    firstTrancheAltMs: firstTranche.alt === undefined ? null : date('vesting.first_tranche_utc.alt', firstTranche.alt),
    wallets: addressSection('wallets'),
    sinks: addressSection('sinks'),
    attribution,
    tokens: {
      kntqTokenId: str('tokens.kntq_hypercore_token_id', value('tokens.kntq_hypercore_token_id')),
      kntqSpotPair: str('tokens.kntq_spot_pair', value('tokens.kntq_spot_pair')),
      hypeSpotPair: str('tokens.hype_spot_pair', value('tokens.hype_spot_pair')),
      kntqHyperEvm: address('tokens.kntq_hyperevm', value('tokens.kntq_hyperevm')),
      kntqElysium: address('tokens.kntq_elysium', value('tokens.kntq_elysium')),
    },
    sellThrough: { global: numAt('sell_through.global', 0, 1), overrides },
    scenarios: { bear: numAt('scenarios.bear', 0), base: numAt('scenarios.base', 0), bull: numAt('scenarios.bull', 0) },
    sequencer: {
      feeAccount: address('sequencer.fee_account', value('sequencer.fee_account')),
      kntqShare: numAt('sequencer.kntq_share', 0, 1),
      burnedShare: numAt('sequencer.burned_share', 0, 1),
    },
    partners,
    meta,
    unverified: [],
  };
  if (a.unlock.firstTrancheMs <= a.genesisMs) fail('vesting.first_tranche_utc', 'must be after genesis');
  a.unverified = [...new Set(meta.filter((m) => m.confidence === 'UNVERIFIED').map((m) => m.path))];
  return a;
}
