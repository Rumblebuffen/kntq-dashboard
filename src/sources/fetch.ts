// Live data fetchers used by the CLI (and, from Phase 3, the collector). No API keys.

import { EVM_DECIMALS, fromBaseUnits } from '../model/units.js';

export const HL_INFO = 'https://api.hyperliquid.xyz/info';
export const HYPEREVM_RPC = 'https://rpc.hyperliquid.xyz/evm';
export const ELYSIUM_RPC = 'https://rpc.elysium.kinetiq.xyz';
export const KINETIQ_ECOSYSTEM_FEED = 'https://kinetiq.xyz/api/kntq-data/ecosystem-buybacks';
export const KINETIQ_SUPPLY_FEED = 'https://kinetiq.xyz/api/kntq-data/supply-breakdown?chainId=999';

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pad = (a: string) => '0x' + a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
const hex = (n: number) => '0x' + n.toString(16);

async function postJson(url: string, body: unknown, tries = 4): Promise<any> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return await r.json();
    } catch (e) {
      lastErr = e;
      await sleep(800 * (i + 1));
    }
  }
  throw new Error(`${url}: ${String(lastErr)}`);
}

export async function getJson(url: string): Promise<any> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

// ---------- Hyperliquid ----------

export const hl = (body: unknown) => postJson(HL_INFO, body);

export interface LedgerTransfer {
  timeMs: number;
  from: string;
  to: string;
  kntq: number;
  usd: number;
  hash: string;
}

/** Every KNTQ transfer into or out of `user` on HyperCore since `sinceMs`, oldest first. */
export async function fetchKntqLedger(user: string, sinceMs: number): Promise<LedgerTransfer[]> {
  const out: LedgerTransfer[] = [];
  let start = sinceMs;
  for (let page = 0; page < 200; page++) {
    const rows: any[] = await hl({ type: 'userNonFundingLedgerUpdates', user, startTime: start });
    if (!rows.length) break;
    for (const x of rows) {
      const d = x.delta;
      if (d?.token !== 'KNTQ' || !d.user || !d.destination) continue;
      out.push({ timeMs: x.time, from: String(d.user).toLowerCase(), to: String(d.destination).toLowerCase(), kntq: Number(d.amount), usd: Number(d.usdcValue ?? 0), hash: x.hash });
    }
    const last = rows[rows.length - 1].time as number;
    if (rows.length < 2000 || last + 1 <= start) break;
    start = last + 1;
  }
  return out;
}

export async function fetchSpotBalance(user: string, coin: string): Promise<number> {
  const s = await hl({ type: 'spotClearinghouseState', user });
  const b = (s.balances as any[]).find((x) => x.coin === coin);
  return b ? Number(b.total) : 0;
}

/** Mid price (mark if there is no mid) for spot pairs such as "@334". */
export async function fetchSpotPrices(pairs: string[]): Promise<Record<string, number>> {
  const [, ctxs] = await hl({ type: 'spotMetaAndAssetCtxs' });
  const out: Record<string, number> = {};
  for (const p of pairs) {
    const c = (ctxs as any[]).find((x) => x.coin === p);
    if (!c) throw new Error(`pair ${p} not found`);
    out[p] = Number(c.midPx ?? c.markPx);
  }
  return out;
}

export async function fetchTokenSupply(tokenId: string): Promise<{ maxSupply: number; totalSupply: number }> {
  const d = await hl({ type: 'tokenDetails', tokenId });
  return { maxSupply: Number(d.maxSupply), totalSupply: Number(d.totalSupply) };
}

export interface Fill {
  timeMs: number;
  coin: string;
  side: 'B' | 'A';
  sz: number;
  px: number;
}

export async function fetchFills(user: string, sinceMs: number): Promise<Fill[]> {
  const out: Fill[] = [];
  let start = sinceMs;
  for (let page = 0; page < 50; page++) {
    const rows: any[] = await hl({ type: 'userFillsByTime', user, startTime: start });
    if (!rows.length) break;
    const sorted = [...rows].sort((a, b) => a.time - b.time);
    for (const f of sorted) out.push({ timeMs: f.time, coin: f.coin, side: f.side, sz: Number(f.sz), px: Number(f.px) });
    const last = sorted[sorted.length - 1].time as number;
    if (rows.length < 2000 || last + 1 <= start) break;
    start = last + 1;
  }
  return out;
}

/** Hourly closes for a spot pair: [openTimeMs, close][] */
export async function fetchHourlyCloses(pair: string, sinceMs: number, untilMs: number): Promise<[number, number][]> {
  const rows: any[] = await hl({ type: 'candleSnapshot', req: { coin: pair, interval: '1h', startTime: sinceMs, endTime: untilMs } });
  return rows.map((c) => [c.t as number, Number(c.c)]);
}

export function priceAt(closes: [number, number][], tMs: number, fallback: number): number {
  let px = fallback;
  for (const [t, c] of closes) {
    if (t <= tMs) px = c;
    else break;
  }
  return px;
}

// ---------- EVM (HyperEVM and Elysium) ----------

export async function rpc(url: string, method: string, params: unknown[]): Promise<any> {
  const j = await postJson(url, { jsonrpc: '2.0', id: 1, method, params });
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
  return j.result;
}

export async function erc20Balance(url: string, token: string, holder: string, block: number | 'latest' = 'latest'): Promise<number> {
  const raw = await rpc(url, 'eth_call', [{ to: token, data: '0x70a08231' + pad(holder).slice(2) }, block === 'latest' ? 'latest' : hex(block)]);
  return fromBaseUnits(raw, EVM_DECIMALS);
}

export async function nativeBalance(url: string, holder: string, block: number | 'latest' = 'latest'): Promise<number> {
  const raw = await rpc(url, 'eth_getBalance', [holder, block === 'latest' ? 'latest' : hex(block)]);
  return fromBaseUnits(raw, EVM_DECIMALS);
}

export const blockNumber = async (url: string): Promise<number> => Number(BigInt(await rpc(url, 'eth_blockNumber', [])));

export async function blockTimeMs(url: string, n: number): Promise<number> {
  const b = await rpc(url, 'eth_getBlockByNumber', [hex(n), false]);
  return Number(BigInt(b.timestamp)) * 1000;
}

/** First block whose timestamp is at or after tMs. */
export async function blockAtTime(url: string, tMs: number): Promise<number> {
  let lo = 1;
  let hi = await blockNumber(url);
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((await blockTimeMs(url, mid)) < tMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export interface TokenTransfer {
  timeMs: number;
  block: number;
  from: string;
  to: string;
  kntq: number;
  tx: string;
}

/**
 * ERC-20 transfers of `token` into any of `recipients` between two blocks (inclusive), with block times.
 * Suits chains whose RPC allows wide log ranges (Elysium allows 1,000,000 blocks).
 */
export async function fetchTransfersInto(url: string, token: string, recipients: string[], fromBlock: number, toBlock: number, chunk = 1_000_000): Promise<TokenTransfer[]> {
  const logs: any[] = [];
  for (let b = fromBlock; b <= toBlock; b += chunk + 1) {
    logs.push(...(await rpc(url, 'eth_getLogs', [{ address: token, fromBlock: hex(b), toBlock: hex(Math.min(b + chunk, toBlock)), topics: [TRANSFER_TOPIC, null, recipients.map(pad)] }])));
  }
  const blocks = [...new Set(logs.map((l) => Number(BigInt(l.blockNumber))))];
  const times = new Map<number, number>();
  for (let i = 0; i < blocks.length; i += 8) {
    await Promise.all(blocks.slice(i, i + 8).map(async (n) => times.set(n, await blockTimeMs(url, n))));
  }
  return logs.map((l) => {
    const block = Number(BigInt(l.blockNumber));
    return {
      block,
      timeMs: times.get(block)!,
      from: '0x' + String(l.topics[1]).slice(26),
      to: '0x' + String(l.topics[2]).slice(26),
      kntq: fromBaseUnits(l.data, EVM_DECIMALS),
      tx: `${l.transactionHash}:${Number(BigInt(l.logIndex))}`,
    };
  });
}

/** The same over the whole chain, for one recipient. */
export async function fetchTransfersTo(url: string, token: string, to: string): Promise<TokenTransfer[]> {
  return fetchTransfersInto(url, token, [to], 0, await blockNumber(url));
}

export async function getText(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.text();
}

export const ELYSIUM_SITEMAP = 'https://elysium.kinetiq.xyz/sitemap.xml';
