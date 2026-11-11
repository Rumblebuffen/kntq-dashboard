# KNTQ burn vs unlock

**Live page: https://rumblebuffen.github.io/kntq-dashboard/**

How much KNTQ supply is permanently removed by burns, compared with how much is released to the team and investors. A second view compares open-market buying with sell pressure in USD per day.

Everything here can be done in GitHub's website. You never need to run anything on your own computer.

## How it works

- Every hour a GitHub job reads the chains and Kinetiq's public feeds and saves what it finds to the [`data` branch](https://github.com/Rumblebuffen/kntq-dashboard/tree/data).
- The page reads that data each time you open it, and re-reads it every ten minutes while open.
- Every constant the model uses is in one file: [`config/assumptions.yaml`](config/assumptions.yaml). The page reads that file live too.

**Total burned is the balance of the burn addresses and nothing else.** Sources (fees, buybacks, partners) only label where the burned tokens came from, so nothing can be counted twice. Amounts that are bought or set aside but not yet at a burn address are shown separately as "pending" or "estimate" and are never folded into the burned figure.

## Changing an assumption

1. Open [`config/assumptions.yaml`](https://github.com/Rumblebuffen/kntq-dashboard/edit/main/config/assumptions.yaml) (the page's Assumptions panel has an "Edit the defaults on GitHub" button that goes to the same place).
2. Change the `value` line of the constant. Update `retrieved` to today's date, and `source` and `confidence` if they changed.
3. Click **Commit changes**.

The page picks the change up within about five minutes. GitHub then runs the tests: a green tick on the [commits list](https://github.com/Rumblebuffen/kntq-dashboard/commits/main) means the file is valid. A red cross means the edit was malformed (the test output names the line); the page keeps using the last good copy until you fix it.

Common edits:

| To change | Edit |
|---|---|
| The first-tranche date, once Kinetiq confirms it | `vesting.first_tranche_utc` → `value`, and set `confidence: high` |
| The default sell-through | `sell_through.global` → `value` (0 to 1) |
| A partner's commitment or burned share | `partners.<name>` → `commitment`, `burned_share` (both 0 to 1) |
| The burn scenarios | `scenarios.bear` / `base` / `bull` |

Sliders on the page change a scenario for whoever is looking and are saved in the page address, so you can share a scenario as a link. They do not change the defaults in this file.

## Adding a new burn source

There are three cases.

### 1. A new wallet starts sending KNTQ to a burn address

This is the common case: for example, the sequencer-fee buyback wallet when it first buys, or a partner that burns into the Assistance Fund. Until you label it, its burns still count in the total and show as "Other burns".

In `config/assumptions.yaml`, under `attribution`, add a block. For Kinetiq's sequencer buybacks:

```yaml
  sequencer_buyback:
    value: ["0x…the full wallet address…"]
    source: Where you learned this is the sequencer buyback wallet
    retrieved: 2026-12-01
    confidence: high
```

For a partner, name the block `"partner:<name>"` using the partner's name from the `partners` section, with the quotation marks:

```yaml
  "partner:ascend":
    value: ["0x…the full wallet address…"]
    source: Where you learned this
    retrieved: 2026-12-01
    confidence: high
```

The Burn sources table then shows that source as Live with its real seven-day figure. Always paste the full 42-character address from a block explorer. Never copy a shortened one.

### 2. A new partner announces a commitment

Add a block under `partners`, copying an existing one:

```yaml
  newpartner:
    commitment: 0.3 # share of its revenue that buys KNTQ
    burned_share: 1.0 # share of the KNTQ bought that is burned
    revenue_base: net revenue
    benchmark_revenue_usd_per_day: null
    source: https://link-to-the-announcement
    retrieved: 2026-12-01
    confidence: moderate
```

It appears in the Burn sources table as "No data" until burns are seen. If sources disagree, put the more conservative figure in `commitment` or `burned_share` and the other in `alt_commitment` or `alt_burned_share`; the page flags the conflict. Use `confidence: UNVERIFIED` for anything without a primary source; it is then shown as Excluded.

### 3. Tokens are burned at a new address

A new burn address (a partner burning to its own dead address, say) needs a small code change so the collector reads it every hour. Open an issue describing the address and where you found it, or ask Claude to add it.

## Alerts

GitHub opens an issue, and emails you, when:

- tokens leave the contributor, investor, Foundation or Growth wallet
- a burn address's balance falls, or anything leaves the Assistance Fund
- the Elysium sequencer fee account spends HYPE (probably its first buyback: find the buying wallet and add it as in case 1)
- Ascend's burn treasury sends tokens out (if they reach a burn address, add the sender as `"partner:ascend"`)
- the weekly check finds a new or changed partner commitment, or a new project page on Elysium

## If something looks wrong

- **Data health** at the bottom of the page shows each source's last successful read. "Stale" means no success for over two hours.
- The [Actions tab](https://github.com/Rumblebuffen/kntq-dashboard/actions) shows every run. One failed run is harmless: the next one catches up, because balances are read fresh and ledgers resume from a saved position.
- GitHub sometimes delays or skips hourly jobs, and pauses them after 60 days with no activity in the repository. The daily job makes a keep-alive commit to prevent that. If runs have stopped, open Actions, pick the workflow and click **Enable workflow**, then **Run workflow**.

## What is not verified

The page marks these as unverified; `DATA_SOURCES.md` has the detail.

- **The first-tranche date.** Kinetiq's docs say "1 year cliff, then monthly" and nothing more exact, and there is no vesting contract on-chain. The page defaults to 27 Nov 2026 with 27 Dec 2026 as the alternative. The real signal will be tokens leaving the two vesting wallets, which raises an alert.
- **Wallet labels.** The contributor, investor, Foundation and Growth wallets are identified by their genesis amounts, which match the published allocation exactly and reproduce CoinGecko's circulating supply. Kinetiq has not published the labels.
- **Boxa and Hyperbook** have no primary source for a commitment and are excluded.
- **Ascend's purchases** are measured as KNTQ arriving in its two treasuries. Some of that may be fees it received in KNTQ, not market purchases.

## Checking the numbers

```bash
npm run verify
```

compares the Assistance Fund balance with Hypurrscan, burned and circulating supply with Kinetiq's own feed and CoinGecko, and tranche sizes with DefiLlama. On 11 Nov 2026 nine checks agreed; the one known difference is DefiLlama's first-tranche date (27 Oct 2026), which the untouched vesting wallets contradict.

## For developers

| Command | What it does |
|---|---|
| `npm test` | Unit tests: tranche maths, run-rate, unit conversions, the double-counting guard, config validation |
| `npm run today` | Print today's headline numbers from live sources |
| `npm run verify` | Cross-check against independent sources |
| `npm run dev` | Run the page locally |
| `npm run collect -- --data-dir data` | Run the hourly job against a checkout of the `data` branch |

Layout: `src/model` is the calculation engine (shared by the page, the collector and the CLI), `src/collector` the scheduled jobs, `src/sources` the data fetchers, `src/web` the page. `DATA_SCHEMA.md` describes every data file. `DATA_SOURCES.md` records what was verified and how.

Not financial advice.
