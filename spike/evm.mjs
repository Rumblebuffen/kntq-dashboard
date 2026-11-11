// Throwaway helpers for HyperEVM JSON-RPC (public endpoint, no key).
export const RPC = process.env.RPC ?? 'https://rpc.hyperliquid.xyz/evm';
export const KNTQ = '0x000000000000780555bd0bca3791f89f9542c2d6';
export const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export const pad = a => '0x' + a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
export async function rpc(method, params, tries = 5) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    if (r.status === 429) { await new Promise(s => setTimeout(s, 1500 * (i + 1))); continue; }
    const j = await r.json();
    if (j.error) { if (/rate/i.test(j.error.message) && i < tries - 1) { await new Promise(s => setTimeout(s, 1500 * (i + 1))); continue; } throw new Error(method + ': ' + JSON.stringify(j.error)); }
    return j.result;
  }
  throw new Error('rate limited: ' + method);
}
export const blockTs = async n => Number((await rpc('eth_getBlockByNumber', ['0x' + n.toString(16), false])).timestamp);
export async function blockAt(ts) { // first block with timestamp >= ts
  let lo = 1, hi = Number(await rpc('eth_blockNumber', []));
  while (lo < hi) { const mid = (lo + hi) >> 1; if (await blockTs(mid) < ts) lo = mid + 1; else hi = mid; }
  return lo;
}
export async function logs(from, to, topics, address = KNTQ) {
  return rpc('eth_getLogs', [{ address, fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16), topics }]);
}
export const balanceOf = async (a, tag = 'latest') => Number(BigInt(await rpc('eth_call', [{ to: KNTQ, data: '0x70a08231' + pad(a).slice(2) }, tag])) / 10n ** 10n) / 1e8;
export const amt = d => Number(BigInt(d) / 10n ** 10n) / 1e8;
export const addr = t => '0x' + t.slice(26);
