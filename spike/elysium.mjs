// Throwaway: probe the Elysium public RPC and the HyperEVM side of its bridge.
const E = 'https://rpc.elysium.kinetiq.xyz', H = 'https://rpc.purroofgroup.com';
const KNTQ_EVM = '0x000000000000780555bd0bca3791f89f9542c2d6';
const pad = a => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
async function rpc(url, method, params) { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }); const t = await r.text(); try { const j = JSON.parse(t); return j.error ? { error: j.error } : j.result; } catch { return { error: r.status + ' ' + t.slice(0, 120) }; } }
const call = (url, to, data) => rpc(url, 'eth_call', [{ to, data }, 'latest']);
const num = h => typeof h === 'string' ? Number(BigInt(h)) : h;
const tok = h => typeof h === 'string' && h.length >= 66 ? Number(BigInt(h) / 10n ** 10n) / 1e8 : h;
console.log('elysium chainId', num(await rpc(E, 'eth_chainId', [])), 'block', num(await rpc(E, 'eth_blockNumber', [])));
// HyperEVM gateway router -> which gateway handles KNTQ, and its Elysium address
const ROUTER_H = '0x5D24f760DD7664b4214bDD4B04a3f62B9edd68c0';
const gw = await call(H, ROUTER_H, '0xbda009fe' + pad(KNTQ_EVM)); // getGateway(address)
const l2 = await call(H, ROUTER_H, '0xa7e28d48' + pad(KNTQ_EVM)); // calculateL2TokenAddress(address)
console.log('HyperEVM getGateway(KNTQ)', gw, '\ncalculateL2TokenAddress(KNTQ)', l2);
const gwAddr = typeof gw === 'string' ? '0x' + gw.slice(26) : null, l2Addr = typeof l2 === 'string' ? '0x' + l2.slice(26) : null;
if (gwAddr) console.log('KNTQ locked in HyperEVM gateway', gwAddr, tok(await call(H, KNTQ_EVM, '0x70a08231' + pad(gwAddr))));
for (const cand of [...new Set([l2Addr, '0xe45a355d9e9cad2ad85f2d03e3ee3102a036acf0'])].filter(Boolean)) {
  const code = await rpc(E, 'eth_getCode', [cand, 'latest']);
  console.log('\nElysium token candidate', cand, 'codeBytes', typeof code === 'string' ? (code.length - 2) / 2 : code);
  const sym = await call(E, cand, '0x95d89b41'); console.log(' symbol raw', typeof sym === 'string' ? Buffer.from(sym.slice(2), 'hex').toString().replace(/[^\x20-\x7e]/g, '') : sym);
  console.log(' decimals', num(await call(E, cand, '0x313ce567')), 'totalSupply', tok(await call(E, cand, '0x18160ddd')), 'l1Address', await call(E, cand, '0xc2eeeebd'));
  for (const b of ['0x000000000000000000000000000000000000dead', '0x0000000000000000000000000000000000000000', '0xfefefefefefefefefefefefefefefefefefefefe']) console.log(' balanceOf', b, tok(await call(E, cand, '0x70a08231' + pad(b))));
}
// Arbitrum fee accounts (ArbOwnerPublic 0x6b) and log-range limit
console.log('\nnetworkFeeAccount', await call(E, '0x000000000000000000000000000000000000006b', '0x2d9125e9'), 'infraFeeAccount', await call(E, '0x000000000000000000000000000000000000006b', '0xee95a824'));
const head = num(await rpc(E, 'eth_blockNumber', []));
for (const span of [1000000, 100000, 10000, 1000]) { const r = await rpc(E, 'eth_getLogs', [{ address: l2Addr ?? '0xe45a355d9e9cad2ad85f2d03e3ee3102a036acf0', fromBlock: '0x' + (head - span).toString(16), toBlock: 'latest', topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', null, '0x' + pad('0x000000000000000000000000000000000000dead')] }]); console.log('getLogs span', span, Array.isArray(r) ? 'ok, burns to 0xdead: ' + r.length : JSON.stringify(r).slice(0, 140)); if (Array.isArray(r)) break; }
const b1 = await rpc(E, 'eth_getBlockByNumber', ['0x1', false]); console.log('block 1 time', b1?.timestamp ? new Date(num(b1.timestamp) * 1000).toISOString() : b1);
