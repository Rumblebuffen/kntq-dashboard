// Throwaway: sample the Elysium sequencer fee account's HYPE balance at several times to sanity-check the accrual rate.
import * as f from '../src/sources/fetch.js';
const FEE = '0x6cbb552855ce5eb70af49b76a8048be8e3799a05';
const start = Date.parse('2026-11-10T17:00:00Z');
const now = Date.now();
let prev: number | null = null;
for (const t of [start - 48 * 3600e3, start - 24 * 3600e3, start, start + 4 * 3600e3, start + 8 * 3600e3, start + 12 * 3600e3, now - 3600e3]) {
  const b = await f.blockAtTime(f.ELYSIUM_RPC, t);
  const bal = await f.nativeBalance(f.ELYSIUM_RPC, FEE, b);
  console.log(new Date(t).toISOString(), 'block', b, 'HYPE', bal.toFixed(3), prev === null ? '' : `(+${(bal - prev).toFixed(3)})`);
  prev = bal;
}
console.log('now', (await f.nativeBalance(f.ELYSIUM_RPC, FEE)).toFixed(3));
