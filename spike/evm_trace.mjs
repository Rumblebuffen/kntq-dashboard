// Throwaway: list KNTQ ERC-20 transfers from/to an address on HyperEVM over a block range.
// usage: RPC=... node spike/evm_trace.mjs <address> <from|to> [startBlock] [endBlock] [span]
import { rpc, logs, TRANSFER, pad, amt, addr } from './evm.mjs';
import { writeFileSync } from 'node:fs';
const [who, dir, s, e, sp] = process.argv.slice(2);
const start = Number(s ?? 20324980), end = Number(e ?? Number(await rpc('eth_blockNumber', []))), span = Number(sp ?? 50000);
const out = [];
for (let b = start; b <= end; b += span + 1) {
  const l = await logs(b, Math.min(b + span, end), dir === 'from' ? [TRANSFER, pad(who)] : [TRANSFER, null, pad(who)]);
  for (const x of l) out.push({ block: parseInt(x.blockNumber), tx: x.transactionHash, from: addr(x.topics[1]), to: addr(x.topics[2]), kntq: amt(x.data) });
}
writeFileSync(new URL(`./out/evm_${dir}_${who.slice(0, 8)}.json`, import.meta.url), JSON.stringify(out, null, 1));
console.log(`${out.length} transfers ${dir} ${who} in blocks ${start}-${end}`);
for (const x of out.slice(0, 80)) console.log(x.block, x.from, '->', x.to, x.kntq, x.tx.slice(0, 12));
