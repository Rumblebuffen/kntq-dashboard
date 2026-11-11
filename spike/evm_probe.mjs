import { rpc, blockAt, logs, balanceOf, TRANSFER, pad, amt, addr } from './evm.mjs';
const DEPLOYER = '0x51172933b60847085e2a959e860e2ec9e240ac09';
const t0 = Date.UTC(2025, 10, 27, 12, 7, 0) / 1000;
const b0 = await blockAt(t0);
console.log('block at 2025-11-27T12:07Z =', b0, 'latest =', Number(await rpc('eth_blockNumber', [])));
console.log('deployer EVM balance now:', await balanceOf(DEPLOYER));
// find max log range the RPC allows
for (const span of [50000, 10000, 1000]) {
  try { const l = await logs(b0, b0 + span, [TRANSFER, null, pad(DEPLOYER)]); console.log('span', span, 'ok, transfers TO deployer:', l.map(x => [parseInt(x.blockNumber), addr(x.topics[1]), amt(x.data)])); break; }
  catch (e) { console.log('span', span, 'failed:', e.message.slice(0, 160)); }
}
