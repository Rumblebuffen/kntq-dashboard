// Cross-checks our figures against independent sources. Usage: npm run verify
// Exit code 1 if any check fails outright; "differs (known)" rows are documented disagreements, not failures.

import { readFileSync } from 'node:fs';
import { loadAssumptions } from '../model/assumptions.js';
import { formatIct } from '../model/time.js';
import { monthlyTranche, trancheSchedule } from '../model/unlock.js';
import * as f from '../sources/fetch.js';

const a = loadAssumptions(readFileSync(new URL('../../config/assumptions.yaml', import.meta.url), 'utf8'));
type Verdict = 'OK' | 'differs (known)' | 'FAIL' | 'unavailable';
const rows: { check: string; ours: string; theirs: string; verdict: Verdict; note?: string }[] = [];
const n = (v: number, d = 2) => v.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
const close = (x: number, y: number, tol: number) => Math.abs(x - y) <= tol;
async function attempt<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

const af = a.sinks.hypercore_af!.address;
const afBalance = await f.fetchSpotBalance(af, 'KNTQ');
const supply = await f.fetchTokenSupply(a.tokens.kntqTokenId);
const dead = await f.erc20Balance(f.ELYSIUM_RPC, a.tokens.kntqElysium, a.sinks.elysium_dead!.address);
const evm = (addr: string) => f.erc20Balance(f.HYPEREVM_RPC, a.tokens.kntqHyperEvm, addr);
const held = (await Promise.all(['contributors', 'investors', 'foundation', 'growth', 'liquidity'].map((k) => evm(a.wallets[k]!.address)))).reduce((s, v) => s + v, 0);
const circulating = a.maxSupplyKntq - held;

// 1. AF balance vs Hypurrscan
const hs = await attempt(() => f.getJson('https://api.hypurrscan.io/holders/KNTQ'));
const hsAf = hs?.holders?.[af];
rows.push(typeof hsAf === 'number' ? { check: 'AF balance vs Hypurrscan', ours: n(afBalance), theirs: n(hsAf), verdict: close(afBalance, hsAf, 5000) ? 'OK' : 'FAIL', note: 'Hypurrscan refreshes periodically; small lags are normal' } : { check: 'AF balance vs Hypurrscan', ours: n(afBalance), theirs: '—', verdict: 'unavailable' });

// 2. Burned vs Kinetiq's own feed
const kq = await attempt(() => f.getJson(f.KINETIQ_SUPPLY_FEED));
if (kq) {
  const theirs = Number(kq.amountBurned);
  const ours = afBalance + (supply.maxSupply - supply.totalSupply);
  rows.push({ check: "AF + protocol-level burn vs Kinetiq's amountBurned", ours: n(ours), theirs: n(theirs), verdict: close(ours, theirs, 5000) ? 'OK' : 'FAIL', note: `our page total also adds ${n(dead)} at Elysium's dead address` });
  rows.push({ check: "Circulating (minus burned) vs Kinetiq's circulatingSupply", ours: n(circulating - theirs), theirs: n(Number(kq.circulatingSupply)), verdict: close(circulating - theirs, Number(kq.circulatingSupply), 50_000) ? 'OK' : 'FAIL' });
} else rows.push({ check: "Burned vs Kinetiq's feed", ours: n(afBalance), theirs: '—', verdict: 'unavailable' });

// 3. Supply vs CoinGecko
const cg = await attempt(() => f.getJson('https://api.coingecko.com/api/v3/coins/kinetiq?localization=false&tickers=false&community_data=false&developer_data=false'));
if (cg?.market_data) {
  const c = Number(cg.market_data.circulating_supply);
  rows.push({ check: 'Circulating (max − five team wallets) vs CoinGecko', ours: n(circulating), theirs: n(c), verdict: close(circulating, c, a.maxSupplyKntq * 0.005) ? 'OK' : 'FAIL', note: 'CoinGecko does not subtract the AF; it can lag wallet movements' });
  rows.push({ check: 'Max supply vs CoinGecko', ours: n(a.maxSupplyKntq, 0), theirs: n(Number(cg.market_data.max_supply), 0), verdict: a.maxSupplyKntq === Number(cg.market_data.max_supply) ? 'OK' : 'FAIL' });
} else rows.push({ check: 'Supply vs CoinGecko', ours: n(circulating), theirs: '—', verdict: 'unavailable', note: 'CoinGecko rate-limits keyless requests; try again in a minute' });
rows.push({ check: 'Max supply vs Hyperliquid', ours: n(a.maxSupplyKntq, 0), theirs: n(supply.maxSupply, 0), verdict: a.maxSupplyKntq === supply.maxSupply ? 'OK' : 'FAIL' });

// 4. Tranches vs DefiLlama
const dl = await attempt(() => f.getJson('https://defillama-datasets.llama.fi/emissions/kinetiq'));
const events: any[] = dl?.metadata?.events ?? [];
const insiders = events.filter((e) => e.category === 'insiders');
const priv = events.filter((e) => e.category === 'privateSale');
if (insiders.length && priv.length) {
  const t = monthlyTranche(a.unlock);
  const sched = trancheSchedule(a.unlock);
  rows.push({ check: 'Contributor tranche vs DefiLlama', ours: n(t.contributors), theirs: n(insiders[0].noOfTokens[0]), verdict: close(t.contributors, insiders[0].noOfTokens[0], 1) ? 'OK' : 'FAIL' });
  rows.push({ check: 'Investor tranche vs DefiLlama', ours: n(t.investors), theirs: n(priv[0].noOfTokens[0]), verdict: close(t.investors, priv[0].noOfTokens[0], 1) ? 'OK' : 'FAIL' });
  rows.push({ check: 'Number of tranches vs DefiLlama', ours: String(sched.length), theirs: String(insiders.length), verdict: sched.length === insiders.length ? 'OK' : 'FAIL' });
  const theirFirst = Math.min(...insiders.map((e) => e.timestamp)) * 1000;
  rows.push({ check: 'First tranche date vs DefiLlama', ours: formatIct(sched[0]!.timeMs), theirs: formatIct(theirFirst), verdict: Math.abs(sched[0]!.timeMs - theirFirst) < 86_400_000 ? 'OK' : 'differs (known)', note: "DefiLlama's dates are genesis plus multiples of 30.44 days starting at month 11; both vesting wallets are untouched on-chain" });
} else rows.push({ check: 'Tranches vs DefiLlama', ours: n(monthlyTranche(a.unlock).total), theirs: '—', verdict: 'unavailable' });

const w = [52, 22, 22, 16];
const line = (c: string[]) => c.map((x, i) => x.padEnd(w[i]!)).join(' ');
console.log(`\nCross-checks at ${formatIct(Date.now())}\n`);
console.log(line(['Check', 'Ours', 'Theirs', 'Verdict']));
console.log(line(w.map((x) => '-'.repeat(x))));
for (const r of rows) {
  console.log(line([r.check, r.ours, r.theirs, r.verdict]));
  if (r.note) console.log(`  ${r.note}`);
}
const failed = rows.filter((r) => r.verdict === 'FAIL').length;
console.log(`\n${rows.filter((r) => r.verdict === 'OK').length} OK, ${rows.filter((r) => r.verdict === 'differs (known)').length} known difference(s), ${rows.filter((r) => r.verdict === 'unavailable').length} unavailable, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
