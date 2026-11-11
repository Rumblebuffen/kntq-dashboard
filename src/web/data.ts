// Loads everything the page needs at runtime from the data branch, so a data commit never needs a rebuild.

import bundledYaml from '../../config/assumptions.yaml?raw';
import type { DailyRow, HistoryRow } from '../collector/derive';
import type { Health, Snapshot, WalletMoveEvent } from '../collector/store';
import { type Assumptions, loadAssumptions } from '../model/assumptions';
import type { ModelInputs } from '../model/headline';

export const REPO = 'Rumblebuffen/kntq-dashboard';
const RAW = `https://raw.githubusercontent.com/${REPO}`;
export const DATA_BASE: string = import.meta.env.VITE_DATA_BASE ?? `${RAW}/data`;
export const CONFIG_URL = `${RAW}/main/config/assumptions.yaml`;
export const dataFileUrl = (file: string) => `https://github.com/${REPO}/blob/data/${file}`;
export const CONFIG_EDIT_URL = `https://github.com/${REPO}/edit/main/config/assumptions.yaml`;
export const CONFIG_VIEW_URL = `https://github.com/${REPO}/blob/main/config/assumptions.yaml`;

export interface KpointsRow {
  t: number;
  wallets: number;
  claimed: number;
  held: number;
  movedOut: number;
  shareOfAllClaimed: number | null;
}

export interface PartnerFeedProject {
  slug: string;
  title: string;
  commitment: string;
  share: number | null;
  burnShare: number | null;
  totals: { kntqAmount: number; burnedKntqAmount: number; usdValue: number; lastTime: number | null } | null;
}

export interface PageData {
  a: Assumptions;
  configSource: 'live' | 'bundled';
  generatedAt: number;
  inputs: ModelInputs;
  latest: Snapshot;
  walletMoves: WalletMoveEvent[];
  days: DailyRow[];
  history: HistoryRow[];
  health: Health;
  kpoints: KpointsRow[];
  partners: PartnerFeedProject[];
}

async function json<T>(file: string): Promise<T> {
  const r = await fetch(`${DATA_BASE}/${file}`, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

async function jsonl<T>(file: string): Promise<T[]> {
  const r = await fetch(`${DATA_BASE}/${file}`, { cache: 'no-cache' });
  if (!r.ok) return [];
  return (await r.text())
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);
}

export async function loadPageData(): Promise<PageData> {
  let yamlText = bundledYaml;
  let configSource: PageData['configSource'] = 'bundled';
  try {
    const r = await fetch(CONFIG_URL, { cache: 'no-cache' });
    if (r.ok) {
      const live = await r.text();
      loadAssumptions(live); // a malformed live edit falls back to the bundled copy
      yamlText = live;
      configSource = 'live';
    }
  } catch {
    /* keep the bundled copy */
  }
  const a = loadAssumptions(yamlText);
  const [mi, daily, health, kpoints, partners] = await Promise.all([
    json<{ generatedAt: number; inputs: ModelInputs; latest: Snapshot; walletMoves: WalletMoveEvent[] }>('derived/model-inputs.json'),
    json<{ days: DailyRow[]; history: HistoryRow[] }>('derived/daily.json'),
    json<Health>('health.json').catch(() => ({}) as Health),
    jsonl<KpointsRow>('kpoints/daily.jsonl'),
    json<{ projects: PartnerFeedProject[] }>('partners/latest.json').catch(() => ({ projects: [] })),
  ]);
  return { a, configSource, generatedAt: mi.generatedAt, inputs: mi.inputs, latest: mi.latest, walletMoves: mi.walletMoves ?? [], days: daily.days, history: daily.history, health, kpoints, partners: partners.projects };
}
