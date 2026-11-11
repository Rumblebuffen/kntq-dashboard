// Throwaway: page through the AF's non-funding ledger updates and keep KNTQ entries.
// usage: node spike/af_ledger.mjs [startMs]
import { writeFileSync } from 'node:fs';
const AF = '0xfefefefefefefefefefefefefefefefefefefefe';
let start = Number(process.argv[2] ?? Date.UTC(2025, 10, 27));
const end = Date.now();
const all = []; let pages = 0; const types = {};
while (start < end && pages < 400) {
  const r = await fetch('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'userNonFundingLedgerUpdates', user: AF, startTime: start, endTime: end }) });
  if (!r.ok) { console.error('http', r.status, await r.text()); if (r.status === 429) { await new Promise(s => setTimeout(s, 5000)); continue; } break; }
  const rows = await r.json(); pages++;
  if (!rows.length) break;
  for (const x of rows) { types[x.delta.type + ':' + (x.delta.token ?? 'usdc')] = (types[x.delta.type + ':' + (x.delta.token ?? 'usdc')] ?? 0) + 1; if (x.delta.token === 'KNTQ') all.push(x); }
  const last = rows[rows.length - 1].time;
  console.error(`page ${pages}: ${rows.length} rows, ${new Date(rows[0].time).toISOString()} -> ${new Date(last).toISOString()}, KNTQ so far ${all.length}`);
  if (rows.length < 500 && last >= end - 1) break;
  if (last + 1 <= start) break;
  start = last + 1;
  if (rows.length < 100) break;
}
writeFileSync(new URL('./out/af_kntq_ledger.json', import.meta.url), JSON.stringify(all));
console.log(JSON.stringify({ pages, kntqRows: all.length, types }, null, 1));
