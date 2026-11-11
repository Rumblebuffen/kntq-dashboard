# Data schema

All collected data lives on the `data` branch, as plain JSON and JSON Lines (one JSON object per line). Code lives on `main`. The page reads the files under `derived/` at runtime, so a data commit never needs a rebuild.

Times are UTC milliseconds (`t`). Amounts are whole KNTQ unless a field name says otherwise.

## What runs when

| Job | When | What it does |
|---|---|---|
| Collect | Hourly at minute 17 | Reads every source, appends a snapshot and any new events, rebuilds `derived/`, opens a GitHub issue for each new alert |
| Daily rebuild | 01:43 ICT | Re-reads the whole AF ledger to recover anything an hourly run missed, snapshots the kPoints top-200 holders, rebuilds `derived/` |
| Weekly commitments check | Mondays 09:23 ICT | Compares Kinetiq's buyback feed and the Elysium sitemap with last week and opens an issue listing changes |
| Tests | Every push to `main` | Type-check and unit tests; also validates `config/assumptions.yaml` |

A missed or late run loses time resolution, not data: balances are read fresh each time and event ledgers are pulled from a saved cursor.

## Files

### `snapshots/YYYY-MM.jsonl` — one row per run

| Field | Meaning |
|---|---|
| `t` | When the snapshot was taken |
| `kntqUsd`, `hypeUsd` | HyperCore spot mid prices |
| `sinks` | Balance of each burn sink: `hypercore_af`, `elysium_dead` |
| `wallets` | Balances of `contributors`, `investors`, `foundation`, `growth` (HyperEVM) and `deployer` (HyperCore) |
| `ascend` | KNTQ in Ascend's `treasury` (pending burn) and `allocator` |
| `feeHype` | HYPE in Elysium's sequencer fee account |
| `totalSupply` | Hyperliquid's total supply figure |
| `kinetiq` | Kinetiq's own feed: `burned`, `circulating`, `staked` (cross-check only) |
| `backfilled` | `true` for rows reconstructed by the backfill |

A field is `null` when its source failed on that run.

### `events/` — append-only ledgers, each row has a unique `id`

| File | Row | Source |
|---|---|---|
| `sink_inflows.jsonl` | `t, sink, from, kntq, usd` | AF: Hyperliquid ledger since genesis. Dead address: Elysium transfers. |
| `purchases.jsonl` | `t, source, kntq, usd` | `protocol_buyback`: the buyback wallet's fills (exact USD). `partner:ascend`: transfers into Ascend's two contracts, valued at that hour's price. |
| `pending_burns.jsonl` | `t, source, kntq` | Transfers into Ascend's burn treasury. Never part of the burned total. |
| `wallet_moves.jsonl` | `t, wallet, kntq, via` | Balance changes of the watched wallets. Negative = left the wallet. `via: "log"` rows are the Growth wallet's history before 11 Nov. |

### Other

| File | Contents |
|---|---|
| `prices/1h.jsonl` | `[hourStart, kntqClose, hypeClose]` |
| `kpoints/daily.jsonl` | `t, wallets, claimed, held, movedOut, shareOfAllClaimed` for the top-200 claimants |
| `commitments/current.json`, `commitments/changes.jsonl` | Last seen partner commitments and the log of changes |
| `partners/latest.json` | Kinetiq's buyback feed as last fetched |
| `alerts.jsonl` | Every alert raised |
| `state.json` | Cursors: last AF ledger time, last fill time, last Elysium block scanned |
| `health.json` | Per source: last success, last error, consecutive failures |

### `derived/` — rebuilt on every run, safe to delete

| File | Contents |
|---|---|
| `model-inputs.json` | Everything the model needs, so the page can recompute when a slider moves. Rows older than 8 days are merged per day. |
| `headline.json` | The headline metrics at default assumptions |
| `daily.json` | `days`: one row per ICT day from 11 Nov. `history`: burns per day and source since genesis. |

## Alerts

An issue is opened when: tokens leave the contributor, investor, Foundation or Growth wallet; a burn sink's balance falls; anything leaves the AF; the sequencer fee account spends HYPE; Ascend's burn treasury sends tokens out.

## Rebuilding from nothing

```bash
npm run backfill -- --data-dir data
```

This needs an empty data directory. The Growth wallet's pre-November history and the kPoints claimant list come from the Phase 1 traces in `spike/out/`, because the official HyperEVM RPC only allows 1,000-block log queries.
