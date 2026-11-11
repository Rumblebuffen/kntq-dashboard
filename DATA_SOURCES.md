# Data sources — Phase 1 spike

Retrieved 11 Nov 2026, about 09:00–09:30 UTC (16:00–16:30 ICT). Scripts are in `spike/`, raw responses in `spike/out/`. "Verified Y" means I called the source and saw the value myself. Nothing here is taken from memory.

## 1. The seven things Phase 1 had to confirm

| # | Item | Result | Verified |
|---|---|---|---|
| 1 | KNTQ token ID | HyperCore spot token index `124`, tokenId `0xbd31bd605c0a1b82c72aae3587f9061f`. Live market is pair `@334` (KNTQ/USDC). Pair `@254` (KNTQ/USDH) has no volume. | Y |
| 2 | AF KNTQ balance | **4,569,068.8942 KNTQ**. Equals the sum of all 1,325 inflows since genesis, to the last decimal, with zero outflows. Hypurrscan shows the same figure. | Y |
| 3 | Contributor / investor wallets | Contributors `0x373e0b6b57818ac2bb3a3e55e31128d5f880d90e` (235,000,000). Investors `0x9ef3b3a49ee9a2fd28a10f6e9407219e7ceca1a2` (75,000,000). Both on HyperEVM, both still hold the full amount and have never sent a transaction. Labels are inferred from the amounts, see section 3. | Y (addresses and balances); labels inferred |
| 4 | First-tranche timestamp | **Cannot be confirmed on-chain.** The wallets are plain addresses with no vesting contract, so the chain holds no schedule. What the chain does show: nothing has been released yet. See section 4. | N |
| 5 | Elysium tracker endpoint | **`GET https://kinetiq.xyz/api/kntq-data/ecosystem-buybacks`** — Kinetiq's own feed on its main site, open to scripts. Ten projects, each with commitment text, daily rows and totals (KNTQ bought, USD, KNTQ burned). Every total is currently 0. The Elysium site itself has no JSON endpoint for this and refuses non-browser clients. Section 6. | Y |
| 6 | KIP-5 effective date | **15 Sep 2026.** Kinetiq's blog (16 Sep) says "Effective immediately" and cites the announcement of 15 Sep. On-chain agrees: the first buyback transfers into the AF are 15 Sep 2026 14:25 UTC (2.51M KNTQ in four transfers), and continuous buy-and-send starts 17 Sep 07:05 UTC. No vote dates or governance index found. | Y |
| 7 | Where partners send burns | **Only Ascend is visible.** It holds 77,382.90 KNTQ in its `KntqBurnTreasury` contract on Elysium, not yet sent anywhere. No other partner has published a destination or burned anything on-chain. Section 7. | Y |

## 2. Corrections to the brief

| Brief said | Found | Effect |
|---|---|---|
| Price about $0.40 | **$0.308** at retrieval. It was $0.47 on 7 Nov and has fallen each day since. | One tranche ≈ $3.98M. Break-even at 100% sell-through ≈ **$133K/day**, not $172K. The anchor arithmetic itself is right. |
| Unclaimed kPoints tokens returned to the Foundation | Kinetiq's blog does say "returns to the Kinetiq Foundation", but on-chain they went back to the **Growth & Rewards** wallet they came from (16,289,538.96 KNTQ on 12 Oct 2026). | The 100M Foundation wallet has never moved. |
| About 35M claimed | **33,710,461.04 KNTQ** claimed by 5,238 wallets. | Exact figure from the claim contract's transfers. |
| DefiLlama first tranche 27 Nov 19:00 UTC | DefiLlama's data file puts the first tranche at **27 Oct 2026 19:19 UTC** and the second at 27 Nov 05:48 UTC. Its timestamps are genesis-midnight plus multiples of 30.44 days, so the times of day are arithmetic, not real. | DefiLlama can't be used for the timestamp. Tranche sizes do match (9,791,666.67 + 3,125,000). |
| Hyperliquid `circulatingSupply` might exclude the AF | It excludes almost nothing: 999,999,998.98. Only the zero and dead addresses are listed as non-circulating. | The page must compute its own circulating figure. |
| 100% of KNTQ spot fees go to the AF | Mechanically, fees go to the deployer wallet (`deployerTradingFeeShare` = 1.0), which forwards them to the AF by hand at irregular intervals: 56 transfers in a year, the last on 5 Nov. | Fee burns arrive in lumps. The deployer holds 37,058 KNTQ not yet forwarded. |
| Ascend burns 40% of the KNTQ it buys | Elysium's Ascend page says **60% burned**. Ascend's GitBook says 40% (28.8% of protocol fees), and so does DefiLlama's methodology. The chain settles it: Ascend's two treasuries hold 77,383 KNTQ (burn) and 114,845 KNTQ (ecosystem), a 40.3 / 59.7 split. | 40% is right in practice. The Elysium page appears out of date. |
| Elysium name service: token not named | Its page says 50% of protocol revenue buys KNTQ, 100% burned. | Can be included. |
| Oxley: token not named | 25% of revenue buys KNTQ, 100% "deployed in DeFi strategies". | Buy pressure only, 0% burned. |
| Dawn burned share unknown (50% placeholder) | Its page says 50% burned, 50% airdropped to users. | Placeholder becomes a sourced figure. |
| Ecosystem page lists about 139 projects | The sitemap lists 150 mainnet project pages. | |

Two findings that weren't in the brief:

- **The Growth & Rewards wallet has been paying out.** Besides the kPoints claim, it has sent 9,790,022 KNTQ to four addresses since 16 Oct 2026, most recently 2,500,000 on 8 Nov. Under the brief's rule these count as newly circulating.
- **Actual burns are small next to the unlock.** The AF received 411,077 KNTQ in the last 30 days, about 13,700 a day or roughly $5,400 a day. The unlock-equivalent rate is 430,556 a day.

## 3. Genesis and the allocation wallets

Genesis on HyperCore: `spotGenesis` at **27 Nov 2025 11:36:17 UTC**. The deployer `0x51172933b60847085e2a959e860e2ec9e240ac09` received 730,000,000 KNTQ, bridged 729,999,990 to HyperEVM at 12:07 UTC, and within a minute sent five round amounts:

| Label (inferred) | HyperEVM address | Sent at genesis | Balance now | Activity |
|---|---|---|---|---|
| Core contributors | `0x373e0b6b57818ac2bb3a3e55e31128d5f880d90e` | 235,000,000 | 235,000,000 | None, nonce 0 |
| Investors | `0x9ef3b3a49ee9a2fd28a10f6e9407219e7ceca1a2` | 75,000,000 | 75,000,000 | None, nonce 0 |
| Foundation | `0xf50ad63714f10f4e96eeabd43d549c8232992b36` | 100,000,000 | 100,000,000 | None, nonce 0 |
| Growth & Rewards | `0x5bd9e766c0151dcfbc4246e5f8b3193c4beeaae4` | 300,000,000 | 256,499,687.80 | 10 outflows, see section 8 |
| Liquidity (part) | `0x4664b0453c7c483e2e262ca54351ade71b6be734` | 20,000,000 | 9,476,666.43 | 11 outflows |

Why I trust the labels: the amounts match the published allocation exactly, and CoinGecko's circulating supply (324,023,645.77) equals 1,000,000,000 minus the current balances of exactly these five wallets, to the cent. That means CoinGecko's supply feed uses the same five addresses. Kinetiq has not, as far as I found, published the labels itself, so config will carry them as "inferred, high confidence".

None of the five has contract code. They are ordinary addresses, so the lock on contributor and investor tokens is a matter of policy and custody, not code.

CoinGecko does not subtract the AF. A circulating figure that also excludes burned tokens is 324,023,645.77 − 4,569,068.89 = 319,454,576.88.

## 4. First tranche: what can and can't be known

- No vesting contract exists, so no on-chain schedule or timestamp exists.
- Both wallets are untouched, so no tokens have been released as at 11 Nov 2026. This rules out a real release on 27 Oct.
- Candidates: 27 Nov 2026 at 11:36 UTC (one year from the genesis transaction), 27 Nov at some other hour, or 27 Dec 2026 if the first monthly release comes a month after the cliff.
- Kinetiq's docs give "Cliff: 1 year" and "2-year monthly linear vesting following the cliff" and nothing more precise (section 5). With 24 releases and a stated 3-year total, a first release on 27 Dec 2026 fits the arithmetic exactly; a first release on 27 Nov 2026 would finish a month early. Neither is confirmed.
- Detection plan: watch for the first outgoing transfer from either wallet. That is the only on-chain signal there will be, and it tells us when tokens moved, which may be later than when they became free to move.

Config will carry the first-tranche time as UNVERIFIED with the candidates listed.

## 5. Kinetiq documentation

Read by a research helper and the key quotes re-checked by script against the live pages (`spike/quote.py`).

| Topic | What the source says | Source |
|---|---|---|
| Vesting | "Total duration: 3 years / Cliff: 1 year / Vesting: 2-year monthly linear vesting following the cliff." Nothing on whether the first monthly release falls on the cliff date or a month after, no time of day, no wallet addresses, nothing on how the lock is enforced. | `kinetiq.xyz/docs/kntq`, last updated 17 Sep 2026 |
| Genesis | "took place on November 27th, 2025 on Hyperliquid" | Same |
| Burn mechanism | "Purchased tokens, along with any fees already paid in KNTQ, are sent to the Hyperliquid Assistance Fund, permanently removing them from supply." | Same |
| Buyback shares | Protocol revenue (KIP-2) 70%; validator commissions 100% of Kinetiq's share; Markets 100% of disposable income; Launch 100% of Kinetiq's share; "KNTQ trading fees: 100% is sent directly to the Assistance Fund"; Elysium 50% of sequencer revenue. | Same |
| KIP-5 | "Until now, purchased KNTQ was distributed to sKNTQ stakers. Effective immediately, future purchases will instead be sent to the Hyperliquid Assistance Fund". FAQ: "Is sending KNTQ to the Assistance Fund a burn? Yes." Also states 5,391,458 KNTQ had been bought before the change; those went to stakers and were not burned. | `kinetiq.xyz/blog/kip-5-kntq-buybacks-assistance-fund`, 16 Sep 2026 |
| kPoints claim | 50M KNTQ at $0.26, 10 days, no lockup, paid in USDC on HyperEVM. Unclaimed "returns to the Kinetiq Foundation". | `kinetiq.xyz/blog/kntq-kpoints-claim`, 1 Oct 2026 |
| Official contract labels | `0x435bb7eA…C03b` is listed as "CKNTQ" (the claim contract, by my on-chain reading). `0x696238e0…4d0F` is the **sKNTQ token contract**. None of the allocation wallets, the deployer or the buyback wallet is listed. | `kinetiq.xyz/docs/contracts-and-audits` |
| Elysium launch | Public mainnet opened 9 Nov 2026. Sequencer fees: 25% builders, 25% treasury, 50% buys KNTQ, sent to the AF. | Kinetiq blog posts, per the helper; not re-checked by me |
| Kinetiq's supply feed | `amountBurned` 4,569,069.90; `circulatingSupply` 319,454,575.87; `amountStaked` 61,804,875.61. Matches my own figures to within 1 KNTQ. | `kinetiq.xyz/api/kntq-data/supply-breakdown?chainId=999` |
| Ascend | "KNTQ burn 28.8%", "KNTQ strategic ecosystem allocation 43.2%" of protocol fees; of KNTQ purchased, "Burned 40%". Burn treasury and allocator addresses published. No burn schedule or destination given. A litepaper section elsewhere in the same GitBook reportedly still describes an older 50/50, 60%-burned design. | `ascendlaunch.gitbook.io/docs`, pages "protocol-revenue-allocation" and "developers/mainnet-contracts" |

Not found anywhere: KIP-5 vote dates, a governance index, KIP-4 or KIP-6, any Foundation or Growth schedule, the first-tranche date.

## 6. Elysium

| Fact | Value | Source | Verified |
|---|---|---|---|
| Chain | Arbitrum Orbit L2 settling to HyperEVM, gas token HYPE | Elysium docs, "Connecting to Elysium", updated 9 Nov 2026 | Y |
| Chain ID | 99901 | Docs and `eth_chainId` | Y |
| Public RPC | `https://rpc.elysium.kinetiq.xyz` (no key; log queries over 1,000,000 blocks work) | Docs and tested | Y |
| First block | 19 Oct 2026 12:00 UTC. First KNTQ bridged in 21 Oct. | RPC | Y |
| KNTQ on Elysium | `0xe45a355d9e9cad2ad85f2d03e3ee3102a036acf0` | Derived on-chain from the HyperEVM gateway router; the token's own `l1Address` points back to KNTQ; CoinGecko lists the same address | Y |
| KNTQ bridged to Elysium | 16,744,668.86 locked in the HyperEVM gateway `0xd97b30de0ba0c2eaee942afce77530e06c5f122c`; 16,607,983.38 supply on Elysium | RPC | Y |
| Sequencer fee account | `0x6cbb552855ce5eb70af49b76a8048be8e3799a05`, holding 1,136.997 HYPE, never spent (nonce 0) | Arbitrum `ArbOwnerPublic.getNetworkFeeAccount()` | Y |
| KNTQ at burn addresses on Elysium | `0x…dead`: 543.52 KNTQ from five wallets in seven small transfers. Zero address: 0. AF address: 0. | RPC | Y |

What this means for the build:

- **Sequencer fees:** the fee account's HYPE balance is a direct measure of fees collected, better than tx count × median fee. No buyback has been made from it yet, so the 50% KNTQ share is accrued, not burned.
- **Tracker figures:** use Kinetiq's main-site feed (`kinetiq.xyz/api/kntq-data/ecosystem-buybacks`), which is open to scripts. The Elysium site is not: it returns a Vercel bot checkpoint (HTTP 429) to scripts, including on `/api/` routes, and I won't work around bot protection. In the browser pane the page text loads but the four tracker numbers stayed as loading placeholders on every project page I opened.
- **Open to scripts:** `sitemap.xml` (150 mainnet project slugs) and `robots.txt`. The weekly job can detect new or removed projects from the sitemap. Detecting a changed commitment on an existing page needs a browser.
- 136,685 KNTQ more is locked on the HyperEVM side than exists on Elysium. 117,861 of that is tokens sent to the zero address on Elysium by 38 transactions, which is how withdrawals look; the rest is deposits in flight. To be separated properly in Phase 3.

## 7. Partner commitments and burn destinations

Commitments as shown on each project's Elysium page, read 11 Nov 2026 in a browser:

| Project | Page wording | Burned share | Burn destination | Burn seen on-chain |
|---|---|---|---|---|
| Oku | "30% of Elysium revenue will be used to buy and burn KNTQ" | 100% | Not stated | No |
| Banana Gun | "40% of net trading revenue goes to KNTQ buybacks and burns" (description only, no tracker block) | Not stated | Not stated | No |
| Dawn | "40% of net revenue generated on Elysium will be used to buy KNTQ" | 50% burned, 50% airdropped | Not stated | No |
| Windup | "50% of all revenue buys and burns $KNTQ" | 100% | Not stated | No |
| Ascend | "80% of Ascend's buybacks go to KNTQ" | 60% (page) vs 40% (GitBook, DefiLlama, and the on-chain split) | Held in `KntqBurnTreasury` on Elysium; final destination not stated | **Bought, not yet burned** |
| Cove | "20% of net revenue buys and burns KNTQ" | 100% | Not stated | No |
| Nest | "70% of protocol revenue is used to buy KNTQ" | 0%, "100% is distributed to protocol stakers" | n/a | n/a |
| Elysium name service | "50% of protocol revenue is used to buy KNTQ" | 100% | Not stated | No |
| Oxley | "25% of revenue is used to buy KNTQ" | 0%, "deployed in DeFi strategies" | n/a | n/a |
| Boxa | No buyback block on its page | — | — | UNVERIFIED |
| Hyperbook | No page in the sitemap | — | — | UNVERIFIED |

Kinetiq's own feed agrees with the pages on wording and shows zero KNTQ bought and zero burned for every project. It has no entry for Boxa or Hyperbook, and its `burnShare` field is empty for all ten.

On-chain check of the possible sinks: every AF inflow since Elysium opened comes from two Kinetiq wallets (the buyback wallet and the deployer); the Elysium dead address holds 543.52 KNTQ. So, Ascend aside, partners have either not burned yet or route through Kinetiq's buyback wallet, which would make their burns indistinguishable from Kinetiq's own. This needs an answer from Kinetiq or the partners.

**Ascend is the one live partner.** Addresses from Ascend's GitBook, balances read from the Elysium RPC:

| Contract | Address | KNTQ held | Inflows | Outflows |
|---|---|---|---|---|
| `KntqBurnTreasury` ("28.8%, for KNTQ burns") | `0xFE9846F8BCc99717547f4c0d18B7801F159aa621` | 77,382.90 | 33, from 4 Nov to 11 Nov 2026 | None |
| `EcosystemAllocator` (43.2%) | `0xEe60f5c319F57a82B868651A2f996Bb99C5A3d89` | 114,844.70 | 36, same period | None |

So Ascend has bought 192,228 KNTQ in a week. That is real buy pressure for the flow lens. For the supply lens the 77,383 is earmarked but still sitting in a contract Ascend controls, so by the brief's "permanently removed" test it is **not burned yet**. I'd show it as "pending burn", outside the burned total, until it moves to the AF or a dead address. Kinetiq's feed still shows Ascend at zero, so it lags the chain.

DefiLlama lists **Ascend Launchpad** on chain "Elysium Kinetiq" with daily fees of $188,736 (8 Nov), $101,243 (9 Nov) and $105,954 (10 Nov).

## 8. Assistance Fund inflows (the burn ledger)

`userNonFundingLedgerUpdates` for the AF returns the complete history in three pages. All 1,325 KNTQ entries are inflows.

| Sender | What it is | Transfers | KNTQ | Period |
|---|---|---|---|---|
| `0x51172933…ac09` | Deployer forwarding spot trading fees | 56 | 1,141,053 | 5 Dec 2025 → 5 Nov 2026 |
| `0xaa3b7392052d62928cc87701e3ca6fb6630bb6e2` | Buyback wallet: sells HYPE for USDC, buys KNTQ on `@334`, sends to AF | 1,257 | 888,992 | 17 Sep 2026 → now |
| `0xbcd4071d023bf2aae484d724c130b5af6f0ca0d2` | One-off transfers on 15 Sep 2026 | 2 | 1,663,332 | 15 Sep 2026 |
| `0x696238e0ca31c94e24ca4cbe7921754e172e4d0f` | The sKNTQ token contract (per Kinetiq docs), one-off transfers on KIP-5 day | 2 | 850,991 | 15 Sep 2026 |
| Five others | Small or dust | 10 | 24,701 | — |

The labels "deployer" and "sKNTQ contract" are documented. "Buyback wallet" is my reading of its behaviour; Kinetiq does not publish it.

The buyback wallet's fills are public (`userFills`), so USD spent on open-market buys is exact, not estimated. Kinetiq also publishes a daily roll-up of buyback fills going back to 26 Mar 2026 (`rpc.km.xyz/kinetiq/buyback-fills?interval=D`, 217 daily rows), which covers the pre-KIP-5 purchases too. The wallet is funded by HYPE from several addresses; which address corresponds to which revenue line (KIP-2, validators, Markets, Launch) is not yet established.

Run-rate: last 30 days 411,077 KNTQ (318,118 buybacks, 92,959 fees); last 7 days 61,163 KNTQ, about $3,800 a day.

Growth & Rewards wallet outflows (HyperEVM transfers):

| Date (UTC) | To | KNTQ |
|---|---|---|
| 1 Oct 2026 | `0x435bb7ea4eb481cb686606d089ea4dee4c6cc03b` (kPoints claim contract) | 50,000,000 |
| 12 Oct 2026 | returned from the claim contract | −16,289,538.96 |
| 16 Oct 2026 | `0x7af5d1fdbfeb917c46ebe273fd44e5d59ae0502d` | 750,000 |
| 22 Oct 2026 | `0x132213efec1f9b999c063ff5aeb5c623934e7b4b` | 125,000 |
| 22 Oct 2026 | `0x7af5d1fd…502d` | 810,000 |
| 30 Oct 2026 | `0xfc82b4225120db7c257ad8c69a8cf07319bfb88b` | 3,705,022.16 |
| 5 Nov 2026 | `0x132213ef…7b4b` | 900,000 |
| 6 Nov 2026 | `0x132213ef…7b4b` | 1,000,000 |
| 8 Nov 2026 | `0x99ed257a514d81a62c3195934d4e63a1c2c3946a` | 2,500,000 |

kPoints claim: 6,415 payouts to 5,238 wallets. The top 50 wallets hold 48% of what was claimed, the top 200 hold 70%, the top 500 hold 83%.

## 9. Source catalogue

| Source | Endpoint | Returns | Verified | Sample | Notes |
|---|---|---|---|---|---|
| Hyperliquid info | `POST api.hyperliquid.xyz/info` `{"type":"spotMeta"}` | Token list, pairs | Y | KNTQ index 124 | No key |
| Hyperliquid info | `tokenDetails` + tokenId | Supply, genesis balances, deployer | Y | totalSupply 999,999,999.05 | **Its `markPx` is from the dead USDH pair ($0.207). Don't use it for price.** |
| Hyperliquid info | `spotClearinghouseState` + user | Wallet balances | Y | AF KNTQ 4,569,068.8942 | Hourly snapshot source |
| Hyperliquid info | `userNonFundingLedgerUpdates` + user, startTime | Transfers in and out, with USD value | Y | 1,325 KNTQ rows for the AF | 2,000 rows a page; full backfill takes 3 calls |
| Hyperliquid info | `userFills` + user | Trades | Y | Buyback wallet: 1,825 KNTQ buys | Last 2,000 fills only; `userFillsByTime` for older |
| Hyperliquid info | `spotMetaAndAssetCtxs` | Price, 24h volume | Y | `@334` mid 0.30833, 24h volume $5.62M | Price source |
| Hyperliquid info | `candleSnapshot` coin `@334` | OHLCV | Y | 10 Nov close 0.34425 | Hourly candles for ICT-day averages |
| Hypurrscan | `GET api.hypurrscan.io/holders/KNTQ` | All HyperCore holders | Y | 12,296 holders; AF 4,569,068.894 | Cross-check only |
| HyperEVM RPC (official) | `rpc.hyperliquid.xyz/evm` | Balances, logs | Y | KNTQ totalSupply 1e27 | Logs limited to 1,000 blocks and rate-limited. Fine for hourly increments. |
| HyperEVM RPC (third party) | `rpc.purroofgroup.com` | Same | Y | 100,000-block log ranges | Used for the backfill. Unknown operator; one-off use only. |
| HyperEVM explorers | Blockscout / Etherscan-style APIs | — | N | — | Hyperscan now redirects to another site; Etherscan v2 needs an API key. Not needed. |
| Elysium RPC | `rpc.elysium.kinetiq.xyz` | Balances, logs, fee account | Y | block 4,657,782 | Section 6 |
| Kinetiq feed | `GET kinetiq.xyz/api/kntq-data/ecosystem-buybacks` | Partner commitments, daily buys, totals | Y | 10 projects, all totals 0 | **The tracker endpoint.** Also the simplest input for the weekly commitment diff. Lags the chain (Ascend). |
| Kinetiq feed | `GET kinetiq.xyz/api/kntq-data/supply-breakdown?chainId=999` | Burned, staked, circulating | Y | amountBurned 4,569,069.90 | Official cross-check for the headline |
| Kinetiq feed | `GET rpc.km.xyz/kinetiq/buyback-fills?interval=D` | Daily buyback fills | Y | 217 rows from 26 Mar 2026 | No wallet address in it |
| Kinetiq docs | `kinetiq.xyz/docs/kntq`, `/docs/contracts-and-audits`, `/blog/…` | Vesting wording, buyback shares, contract labels | Y | Section 5 | Plain HTML, readable by script |
| Ascend GitBook | `ascendlaunch.gitbook.io/docs/…` | Fee split, treasury addresses | Y | Burn 28.8% of protocol fees | |
| Elysium site | `elysium.kinetiq.xyz/sitemap.xml` | Project slugs | Y | 150 mainnet projects | Only part of the site open to scripts |
| Elysium site | `/ecosystem/<slug>` pages, `/api/…` | Commitment wording; tracker numbers | N for scripts | HTTP 429 checkpoint | Browser only; tracker numbers did not load |
| DefiLlama unlocks | `defillama-datasets.llama.fi/emissions/kinetiq` | Schedule, 51 events | Y | 9,791,666.67 + 3,125,000 a month | Dates unreliable (section 2). `api.llama.fi/emission/…` is paid (402). |
| DefiLlama fees | `api.llama.fi/summary/fees/<slug>?dataType=dailyFees` | Daily fees and revenue | Y | Kinetiq 24h revenue $6,922 | Kinetiq is split into kHYPE, Validators, Markets, Launch, KNTQ spot |
| DefiLlama fees | `…/summary/fees/ascend-launchpad` | Ascend on Elysium | Y | $105,954 (10 Nov) | The per-chain overview for "Elysium Kinetiq" returns empty; use per-protocol calls |
| DefiLlama price | `coins.llama.fi/prices/current/coingecko:kinetiq` | Price | Y | 0.30825 | Fallback |
| CoinGecko | `api.coingecko.com/api/v3/coins/kinetiq` | Price, supply | Y | circulating 324,023,645.77 | Keyless, rate-limited. Cross-check only. |
| kntq.pages.dev | — | Community tracker | N | — | Did not respond when tried |
| GitHub docs | Events that trigger workflows | Schedule limits | Y | — | Runs can be delayed or dropped at the start of an hour; minimum interval 5 minutes; disabled after 60 days without repository activity in a public repo |

## 10. Open questions

1. First-tranche date and hour: needs Kinetiq's own statement. Section 4.
2. Where partners send burned KNTQ, and whether any route through Kinetiq's buyback wallet. Section 7.
3. Whether KNTQ held in Ascend's burn treasury counts as burned before it moves. My default: no.
4. Which funding address of the buyback wallet maps to which revenue line.
5. What the four recipients of Growth & Rewards payouts are (market makers, incentive distributors, partners).
6. Boxa and Hyperbook commitments have no primary source.
7. Whether to count the Growth & Rewards payouts made before 11 Nov anywhere, or only those from 11 Nov on.
