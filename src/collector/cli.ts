// Entry point for the scheduled jobs.
// usage: tsx src/collector/cli.ts <collect|daily|weekly|rebuild> [--data-dir data]
// New alerts (collect) or the weekly summary are written to the path in ALERTS_OUT so the workflow can open an issue.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { collect, daily, loadConfig, rebuildDerived, weekly } from './run.js';
import { Store } from './store.js';

const [job, ...rest] = process.argv.slice(2);
const dirIdx = rest.indexOf('--data-dir');
const dataDir = dirIdx >= 0 ? rest[dirIdx + 1]! : 'data';
const store = new Store(dataDir);
const a = loadConfig();
const nowMs = Date.now();
const out = process.env.ALERTS_OUT;

if (job === 'collect') {
  const alerts = await collect(store, a, nowMs);
  if (out) writeFileSync(out, JSON.stringify(alerts.map((x) => ({ title: x.title, body: x.body }))));
  console.log(`collected at ${new Date(nowMs).toISOString()}; ${alerts.length} new alert(s)`);
} else if (job === 'daily') {
  const path = new URL('../../config/kpoints-top200.json', import.meta.url);
  const kp = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { wallets: [], totalClaimed: 0 };
  await daily(store, a, nowMs, kp.wallets, kp.totalClaimed);
  console.log('daily job done');
} else if (job === 'weekly') {
  const summary = await weekly(store, nowMs);
  if (out) writeFileSync(out, JSON.stringify(summary ? [{ title: 'KNTQ commitments: changes to review', body: summary }] : []));
  console.log(summary ?? 'no commitment changes');
} else if (job === 'rebuild') {
  rebuildDerived(store, a, nowMs);
  console.log('derived files rebuilt');
} else {
  console.error('usage: tsx src/collector/cli.ts <collect|daily|weekly|rebuild> [--data-dir data]');
  process.exit(2);
}
