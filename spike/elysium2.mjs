const E = 'https://rpc.elysium.kinetiq.xyz', T = '0xe45a355d9e9cad2ad85f2d03e3ee3102a036acf0', TR = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const pad = a => '0x' + a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
const rpc = async (m, p) => { const j = await (await fetch(E, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: p }) })).json(); if (j.error) throw new Error(JSON.stringify(j.error)); return j.result; };
const amt = d => Number(BigInt(d) / 10n ** 10n) / 1e8, addr = t => '0x' + t.slice(26);
const head = Number(BigInt(await rpc('eth_blockNumber', [])));
const FEE = '0x6cbb552855ce5eb70af49b76a8048be8e3799a05';
console.log('fee account HYPE', Number(BigInt(await rpc('eth_getBalance', [FEE, 'latest']))) / 1e18, 'codeBytes', ((await rpc('eth_getCode', [FEE, 'latest'])).length - 2) / 2, 'nonce', parseInt(await rpc('eth_getTransactionCount', [FEE, 'latest'])));
const get = async topics => { const out = []; for (let b = 0; b <= head; b += 1000001) out.push(...await rpc('eth_getLogs', [{ address: T, fromBlock: '0x' + b.toString(16), toBlock: '0x' + Math.min(b + 1000000, head).toString(16), topics }])); return out; };
const dead = await get([TR, null, pad('0x000000000000000000000000000000000000dead')]);
console.log('to 0xdead:', dead.map(l => [parseInt(l.blockNumber), addr(l.topics[1]), amt(l.data)]));
const zero = await get([TR, null, pad('0x0')]);
const by = {}; for (const l of zero) { const f = addr(l.topics[1]); by[f] = by[f] ?? { n: 0, k: 0 }; by[f].n++; by[f].k += amt(l.data); }
console.log('to 0x0 (burn/withdraw):', zero.length, 'total', zero.reduce((s, l) => s + amt(l.data), 0)); console.log(Object.entries(by).sort((a, b) => b[1].k - a[1].k).slice(0, 8));
const mint = await get([TR, pad('0x0')]);
console.log('mints (bridge deposits):', mint.length, 'total', mint.reduce((s, l) => s + amt(l.data), 0), 'first block', mint[0] && parseInt(mint[0].blockNumber));
const blk = async n => new Date(Number(BigInt((await rpc('eth_getBlockByNumber', ['0x' + n.toString(16), false])).timestamp)) * 1000).toISOString();
if (mint[0]) console.log('first KNTQ mint time', await blk(parseInt(mint[0].blockNumber)));
