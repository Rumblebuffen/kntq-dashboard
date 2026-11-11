// File store for the data branch. Everything is plain JSON or JSON Lines so it can be read on GitHub.

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface Snapshot {
  t: number;
  kntqUsd: number | null;
  hypeUsd: number | null;
  /** burn-sink balances, keyed as in config */
  sinks: Record<string, number | null>;
  /** contributors, investors, foundation, growth (HyperEVM) and deployer (HyperCore) */
  wallets: Record<string, number | null>;
  ascend: { treasury: number | null; allocator: number | null };
  /** HYPE held by Elysium's sequencer fee account */
  feeHype: number | null;
  totalSupply: number | null;
  kinetiq: { burned: number | null; circulating: number | null; staked: number | null };
  /** true for rows reconstructed by the backfill rather than observed live */
  backfilled?: boolean;
}

export interface SinkInflowEvent {
  id: string;
  t: number;
  sink: string;
  from: string;
  kntq: number;
  usd: number;
}

export interface PurchaseEvent {
  id: string;
  t: number;
  source: string;
  kntq: number;
  usd: number;
}

export interface PendingBurnEvent {
  id: string;
  t: number;
  source: string;
  kntq: number;
}

export interface WalletMoveEvent {
  id: string;
  t: number;
  wallet: string;
  /** negative = left the wallet */
  kntq: number;
  /** how it was detected: "balance" (hourly balance change) or "log" (on-chain transfer) */
  via: 'balance' | 'log';
  counterparty?: string;
}

export interface Alert {
  id: string;
  t: number;
  type: string;
  title: string;
  body: string;
}

export interface State {
  afLedgerCursorMs: number;
  fillsCursorMs: number;
  elysiumBlock: number;
}

export interface SourceHealth {
  lastOkMs: number | null;
  lastErrorMs: number | null;
  lastError: string | null;
  consecutiveFailures: number;
}
export type Health = Record<string, SourceHealth>;

export const FILES = {
  state: 'state.json',
  health: 'health.json',
  sinkInflows: 'events/sink_inflows.jsonl',
  purchases: 'events/purchases.jsonl',
  pendingBurns: 'events/pending_burns.jsonl',
  walletMoves: 'events/wallet_moves.jsonl',
  prices: 'prices/1h.jsonl',
  alerts: 'alerts.jsonl',
  kpoints: 'kpoints/daily.jsonl',
  commitments: 'commitments/current.json',
  commitmentChanges: 'commitments/changes.jsonl',
  modelInputs: 'derived/model-inputs.json',
  headline: 'derived/headline.json',
  daily: 'derived/daily.json',
} as const;

export const monthKey = (tMs: number) => new Date(tMs).toISOString().slice(0, 7);
export const snapshotFile = (tMs: number) => `snapshots/${monthKey(tMs)}.jsonl`;

export class Store {
  constructor(readonly dir: string) {}

  private path(rel: string) {
    return join(this.dir, rel);
  }
  private ensure(rel: string) {
    mkdirSync(dirname(this.path(rel)), { recursive: true });
  }

  readJson<T>(rel: string, fallback: T): T {
    return existsSync(this.path(rel)) ? (JSON.parse(readFileSync(this.path(rel), 'utf8')) as T) : fallback;
  }
  writeJson(rel: string, value: unknown, pretty = true) {
    this.ensure(rel);
    writeFileSync(this.path(rel), JSON.stringify(value, null, pretty ? 1 : undefined) + '\n');
  }
  readJsonl<T>(rel: string): T[] {
    if (!existsSync(this.path(rel))) return [];
    return readFileSync(this.path(rel), 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as T);
  }
  appendJsonl(rel: string, rows: unknown[]) {
    if (!rows.length) return;
    this.ensure(rel);
    appendFileSync(this.path(rel), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  }
  writeJsonl(rel: string, rows: unknown[]) {
    this.ensure(rel);
    writeFileSync(this.path(rel), rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  }
  /** Append only rows whose id is not already in the file. Returns the rows that were new. */
  appendUnique<T extends { id: string }>(rel: string, rows: T[]): T[] {
    const seen = new Set(this.readJsonl<{ id: string }>(rel).map((r) => r.id));
    const fresh: T[] = [];
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      fresh.push(r);
    }
    this.appendJsonl(rel, fresh);
    return fresh;
  }
  readSnapshots(): Snapshot[] {
    const dir = this.path('snapshots');
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .sort()
      .flatMap((f) => this.readJsonl<Snapshot>(`snapshots/${f}`))
      .sort((a, b) => a.t - b.t);
  }
}

export function markOk(health: Health, source: string, nowMs: number) {
  const h = (health[source] ??= { lastOkMs: null, lastErrorMs: null, lastError: null, consecutiveFailures: 0 });
  h.lastOkMs = nowMs;
  h.consecutiveFailures = 0;
}

export function markError(health: Health, source: string, nowMs: number, err: unknown) {
  const h = (health[source] ??= { lastOkMs: null, lastErrorMs: null, lastError: null, consecutiveFailures: 0 });
  h.lastErrorMs = nowMs;
  h.lastError = String(err).slice(0, 300);
  h.consecutiveFailures += 1;
}
