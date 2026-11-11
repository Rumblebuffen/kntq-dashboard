import { useMemo } from 'react';
import type { SellSource } from '../model/flow';
import { DAY_MS, formatIct } from '../model/time';
import { preUnlockDailyRate } from '../model/unlock';
import { ChartBox, ChartNote, DataTable, Legend, type TimeLine, lighter, useBarLineConfig, useTheme, useTimeLinesConfig } from './charts';
import { CONFIG_EDIT_URL, CONFIG_VIEW_URL, type PageData, dataFileUrl } from './data';
import { Card, Meter, Rows, Segmented, Src, Stat, Tag, type TagTone, Time, compact, elysiumScan, hyperevmscan, hypurrscan, kntq, n0, pct, shortAddr, signed, usd } from './ui';
import type { Scenario } from './urlState';
import type { SourceStatus, View } from './viewModel';

type Update = (patch: Partial<Scenario>) => void;
const WINDOW_INDEX = { '24h': 0, '7d': 1, all: 2 } as const;

// ---------- 1. headline strip ----------

export function Headline({ v, sc, update }: { v: View; sc: Scenario; update: Update }) {
  const w = v.h.windows[WINDOW_INDEX[sc.window]]!;
  const projected = w.unlocked.kind === 'projected';
  const until = v.h.firstTranche.msUntil;
  const countdown = until > 0 ? `${Math.floor(until / DAY_MS)}d ${Math.floor((until % DAY_MS) / 3_600_000)}h` : 'due';
  const price = v.h.kntqUsd;
  return (
    <section aria-label="Headline figures" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented label="Period" value={sc.window} onChange={(window) => update({ window })} options={[{ value: '24h', label: '24h' }, { value: '7d', label: '7d' }, { value: 'all', label: 'Since 11 Nov' }]} />
        {w.clamped && <p className="text-xs text-ink2">Tracking starts 11 Nov, so this period covers {w.days.toFixed(1)} days.</p>}
      </div>

      <div className="rounded-xl border border-line bg-surface p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2 text-sm text-ink2">
          <span>Burn coverage: burned ÷ unlocked</span>
          {projected && <Tag tone="estimate" title="No tranche has been released yet. Unlocks are a projected line at one tranche per 30 days.">Unlock projected</Tag>}
        </div>
        <div className="mt-1 text-5xl font-semibold text-ink sm:text-6xl">{pct(w.coverageActual)}</div>
        <p className="mt-2 text-sm text-ink2">
          Actual burns only. Including pending and estimated burns: <span className="text-ink">{pct(w.coverageInclEstimates)}</span> <Tag tone="estimate">Estimate</Tag>
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Burned" src={dataFileUrl('events/sink_inflows.jsonl')} value={kntq(w.burnedActual)} sub={`${usd(w.burnedActual * price)} · actual`} />
        <Stat label="Burned incl. estimates" tag={<Tag tone="estimate">Estimate</Tag>} value={kntq(w.burnedInclEstimates)} sub={`${kntq(w.pendingBurn)} pending + ${kntq(w.estimated)} estimated`} />
        <Stat label="Unlocked" tag={<Tag tone={projected ? 'estimate' : 'neutral'}>{projected ? 'Projected' : 'Actual'}</Tag>} value={kntq(w.unlockedForComparison)} sub={usd(w.unlockedForComparison * price)} />
        <Stat label="Net supply change" value={signed(w.netSupplyChangeInclProjected)} sub={projected ? `${signed(w.netSupplyChangeActual)} without the projection` : `incl. ${kntq(w.released)} released`} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Stat
          label="First tranche"
          tag={v.h.firstTranche.unverified ? <Tag tone="warn" title="Kinetiq has not published the date and there is no vesting contract on-chain.">Unverified date</Tag> : undefined}
          value={countdown}
          sub={
            <>
              {kntq(v.h.tranche.kntq)} KNTQ · {usd(v.h.tranche.usd)} · <Time ms={v.h.firstTranche.timeMs} />
            </>
          }
        />
        <Stat label="Burned to date" src={hypurrscan(v.a.sinks.hypercore_af!.address)} value={kntq(v.h.totalBurnedAllTime)} sub={`${pct(v.h.totalBurnedAllTime / v.a.maxSupplyKntq)} of max supply · KNTQ $${price.toFixed(4)}`} />
      </div>
    </section>
  );
}

// ---------- shared chart controls ----------

export function ChartControls({ sc, update }: { sc: Scenario; update: Update }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented label="Date range" value={sc.range} onChange={(range) => update({ range })} options={[{ value: '30', label: '30 days' }, { value: '90', label: '90 days' }, { value: 'all', label: 'All' }]} />
      <Segmented label="Chart scale" value={sc.scale} onChange={(scale) => update({ scale })} options={[{ value: 'true', label: 'To scale' }, { value: 'zoom', label: 'Zoom on burns' }]} />
    </div>
  );
}

const dayLabel = (day: string) => `${Number(day.slice(8))} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(day.slice(5, 7)) - 1]}`;

// ---------- 2. daily chart ----------

export function DailyChart({ v, sc }: { v: View; sc: Scenario }) {
  const t = useTheme();
  const labels = useMemo(() => v.days.map((d) => dayLabel(d.day)), [v.days]);
  const bars = useMemo(
    () => [
      { label: 'Protocol buybacks', color: t.s[0], values: v.days.map((d) => d.buyback) },
      { label: 'Trading fees', color: t.s[1], values: v.days.map((d) => d.fees) },
      { label: 'Other burns', color: t.s[2], values: v.days.map((d) => d.other) },
      { label: 'Ascend, pending burn', color: lighter(t.s[3], t.surface), values: v.days.map((d) => d.pending) },
      { label: 'Sequencer fees, estimate', color: lighter(t.s[4], t.surface), values: v.days.map((d) => d.estimated) },
    ],
    [t, v.days],
  );
  const projected = v.days.some((d) => d.unlockKind === 'projected');
  const line = useMemo(() => ({ label: projected ? 'Unlock rate (projected)' : 'Unlock rate (30-day smoothed)', values: v.days.map((d) => d.unlockRate), dashed: projected }), [v.days, projected]);
  const config = useBarLineConfig({ theme: t, labels, bars, line, zoom: sc.scale === 'zoom', yFormat: compact });
  const rate = preUnlockDailyRate(v.a.unlock);
  return (
    <Card title="Daily burns vs unlock rate" sub="KNTQ per day, by where the burn came from">
      <Legend
        items={[
          { label: 'Protocol buybacks', color: t.s[0] },
          { label: 'Trading fees', color: t.s[1] },
          { label: 'Other burns', color: t.s[2] },
          { label: 'Ascend, pending burn', color: lighter(t.s[3], t.surface), tag: 'Not yet burned' },
          { label: 'Sequencer fees', color: lighter(t.s[4], t.surface), tag: 'Estimate' },
          { label: line.label, color: t.ink2, kind: projected ? 'dashed' : 'line' },
        ]}
      />
      <ChartBox config={config} label="Stacked bars of KNTQ burned per day by source, with the unlock rate as a line" />
      <ChartNote>
        {sc.scale === 'zoom'
          ? `Zoomed to the burn bars. The unlock rate (${n0(rate)} KNTQ a day) is off the top of this view.`
          : `Drawn to scale: the unlock rate is ${n0(rate)} KNTQ a day, so burns are barely visible. Use "Zoom on burns" to see their make-up.`}{' '}
        Days are ICT days; today is a part day.
      </ChartNote>
      <DataTable
        caption="Daily burns by source and unlock rate"
        head={['Day (ICT)', 'Buybacks', 'Fees', 'Other', 'Pending', 'Estimate', 'Unlock rate']}
        rows={[...v.days].reverse().map((d) => [d.day, n0(d.buyback), n0(d.fees), n0(d.other), n0(d.pending), n0(d.estimated), d.unlockRate === null ? '—' : n0(d.unlockRate)])}
      />
    </Card>
  );
}

// ---------- 3. cumulative chart ----------

export function CumulativeChart({ v, sc }: { v: View; sc: Scenario }) {
  const t = useTheme();
  const start = v.a.modelStartMs;
  const first = v.a.unlock.firstTrancheMs;
  const beforeFirst = v.nowMs < first && v.h.windows[2]!.unlocked.kind === 'projected';
  const lines = useMemo<TimeLine[]>(() => {
    let cum = 0;
    const steps = [{ x: start, y: 0 }, ...v.schedule.map((tr) => ({ x: tr.timeMs, y: (cum += tr.kntq) })), { x: v.projectionEndMs, y: cum }];
    const last = v.cumulative[v.cumulative.length - 1]!;
    const out: TimeLine[] = [
      { label: 'Unlocked (schedule)', color: t.ink2, points: steps, stepped: true },
      { label: 'Burned', color: t.s[0], points: v.cumulative.map((c) => ({ x: c.t, y: c.burned })) },
      { label: 'Burned, projected at run-rate', color: t.s[0], dashed: true, points: [{ x: last.t, y: last.burned }, { x: v.projectionEndMs, y: v.projectedBurnedAtEnd }] },
      { label: 'Burned incl. pending and estimates', color: lighter(t.s[4], t.surface), points: v.cumulative.map((c) => ({ x: c.t, y: c.inclEstimates })) },
    ];
    if (beforeFirst) out.push({ label: 'Unlocked, projected (pre-unlock)', color: t.muted, dashed: true, points: [{ x: start, y: 0 }, { x: first, y: (preUnlockDailyRate(v.a.unlock) * (first - start)) / DAY_MS }] });
    return out;
  }, [t, v, start, first, beforeFirst]);
  const markers = useMemo(() => [{ x: v.nowMs, label: 'Today' }, ...(v.crossover.lastingMs ? [{ x: v.crossover.lastingMs, label: 'Crossover' }] : [])], [v.nowMs, v.crossover.lastingMs]);
  const zoom = sc.scale === 'zoom';
  const zoomMax = Math.max(v.projectedBurnedAtEnd, v.cumulative[v.cumulative.length - 1]!.inclEstimates, 1) * 1.05;
  const config = useTimeLinesConfig({ theme: t, lines, markers, xMin: start, xMax: v.projectionEndMs, yMax: zoom ? zoomMax : undefined });
  const totalUnlock = v.schedule.reduce((s, tr) => s + tr.kntq, 0);
  return (
    <Card title="Cumulative burned vs unlocked" sub={`From 11 Nov, projected across all ${v.schedule.length} tranches`}>
      <Legend
        items={[
          { label: 'Unlocked (schedule)', color: t.ink2, kind: 'line' },
          ...(beforeFirst ? [{ label: 'Projected (pre-unlock)', color: t.muted, kind: 'dashed' as const }] : []),
          { label: 'Burned', color: t.s[0], kind: 'line' },
          { label: `Projected at ${n0(v.projectedRate)}/day`, color: t.s[0], kind: 'dashed' },
          { label: 'Incl. pending and estimates', color: lighter(t.s[4], t.surface), kind: 'line', tag: 'Estimate' },
        ]}
      />
      <ChartBox config={config} label="Lines of cumulative KNTQ burned and unlocked over time" height={280} />
      <ChartNote>
        {v.crossover.lastingMs
          ? `At this burn rate, cumulative burns catch cumulative unlocks on ${formatIct(v.crossover.lastingMs).slice(0, 10)}.`
          : `No crossover: at ${n0(v.projectedRate)} KNTQ a day, burns reach ${compact(v.projectedBurnedAtEnd)} by the end of vesting, ${pct(v.projectedBurnedAtEnd / totalUnlock)} of the ${compact(totalUnlock)} unlocked.`}
        {sc.burnScenario !== 1 && ` Burn scenario ×${sc.burnScenario} applied to the ${v.h.runRate.daysUsed.toFixed(0)}-day run-rate.`}
        {zoom && ' Zoomed to the burn lines; the unlock steps are off the top.'}
      </ChartNote>
      <DataTable caption="Tranche schedule and projected burns" head={['Tranche', 'Date (ICT)', 'Cumulative unlocked', 'Burned, projected']} rows={v.schedule.map((tr, i) => [tr.index, formatIct(tr.timeMs).slice(0, 10), n0(tr.kntq * (i + 1)), n0(v.h.windows[2]!.burnedActual + (v.projectedRate * Math.max(0, tr.timeMs - v.nowMs)) / DAY_MS)])} />
    </Card>
  );
}

// ---------- 4. break-even ----------

export function BreakEvenPanel({ v }: { v: View }) {
  const b = v.h.breakEven;
  return (
    <Card title="Break-even" sub="Daily buying needed to absorb one tranche sold over 30 days">
      <div className="mb-3">
        <div className="mb-1 flex justify-between text-sm text-ink2">
          <span>Current buying covers</span>
          <span className="text-ink">{pct(b.covered)}</span>
        </div>
        <Meter share={b.covered} label={`Current buying covers ${pct(b.covered)} of break-even`} />
      </div>
      <Rows
        rows={[
          { label: 'Buybacks needed', value: `${usd(b.requiredUsdPerDay)} / day`, note: `${compact(v.h.tranche.kntq)} KNTQ × $${v.h.kntqUsd.toFixed(4)} × ${pct(v.h.breakEven.requiredUsdPerDay / ((v.h.tranche.usd || 1) / 30), 0)} sell-through ÷ 30` },
          { label: 'Current open-market buying', value: `${usd(b.currentUsdPerDay)} / day`, note: `last ${v.h.flow.windowDays} days, burned or not` },
          { label: 'Gap', value: `${usd(b.gapUsdPerDay)} / day` },
        ]}
      />
    </Card>
  );
}

// ---------- 5. flow lens ----------

export function FlowChart({ v, sc }: { v: View; sc: Scenario }) {
  const t = useTheme();
  const labels = useMemo(() => v.days.map((d) => dayLabel(d.day)), [v.days]);
  const bars = useMemo(
    () => [
      { label: 'Kinetiq buybacks', color: t.s[0], values: v.days.map((d) => d.buyUsdBuyback) },
      { label: 'Ascend purchases', color: t.s[3], values: v.days.map((d) => d.buyUsdAscend) },
    ],
    [t, v.days],
  );
  const line = useMemo(() => ({ label: 'Sell pressure', values: v.days.map((d) => d.sellUsd) }), [v.days]);
  const config = useBarLineConfig({ theme: t, labels, bars, line, zoom: sc.scale === 'zoom', yFormat: usd });
  const f = v.h.flow;
  return (
    <Card title="Flow lens: buying vs sell pressure" sub="USD per day. Buying counts every open-market purchase, burned or not.">
      <div className="mb-3 grid grid-cols-2 gap-3">
        <Stat label="Buying" value={`${usd(f.buyUsdPerDay)}/d`} sub={`last ${f.windowDays} days`} src={dataFileUrl('events/purchases.jsonl')} />
        <Stat label="Sell pressure" value={`${usd(f.sellUsdPerDay)}/d`} sub="at the sell-through below" />
      </div>
      <Legend items={[{ label: 'Kinetiq buybacks', color: t.s[0] }, { label: 'Ascend purchases', color: t.s[3] }, { label: 'Sell pressure', color: t.ink2, kind: 'line' }]} />
      <ChartBox config={config} label="Stacked bars of USD of KNTQ bought per day, with modelled sell pressure as a line" height={240} />
      <ChartNote>{sc.scale === 'zoom' && `Zoomed to the buying bars; sell pressure (${usd(f.sellUsdPerDay)} a day) is off the top. `}Sell pressure = unlock rate × sell-through × price, plus Foundation and Growth outflows{v.kpointsPerDay !== null ? ' and kPoints holders moving tokens out' : ''}. Ascend's figure is KNTQ arriving in its two treasuries; some may be fees it received in KNTQ, not market purchases. Fees paid into the AF are burns but not purchases, so they are not here.</ChartNote>
      <DataTable caption="Daily buying and sell pressure in USD" head={['Day (ICT)', 'Kinetiq buybacks', 'Ascend', 'Sell pressure']} rows={[...v.days].reverse().map((d) => [d.day, usd(d.buyUsdBuyback), usd(d.buyUsdAscend), d.sellUsd === null ? '—' : usd(d.sellUsd)])} />
    </Card>
  );
}

// ---------- 6. sources table ----------

const STATUS_TONE: Record<SourceStatus, TagTone> = { Live: 'good', Estimated: 'estimate', 'Pending burn': 'warn', 'No data': 'neutral', Excluded: 'bad' };

export function SourcesTable({ v }: { v: View }) {
  return (
    <Card title="Burn sources" sub="What each source has committed, and what has actually been seen">
      {/* Phones: one block per source, so status and the 7-day figure are never off-screen. */}
      <ul className="divide-y divide-line md:hidden">
        {v.sources.map((s) => (
          <li key={s.name} className="py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="text-sm text-ink">
                {s.name}
                {s.source.startsWith('http') ? <Src href={s.source} /> : <span className="ml-1 cursor-help text-xs text-muted" title={s.source}>ⓘ</span>}
                <div className="text-xs text-muted">{s.tier === 'A' ? 'Kinetiq core' : 'Elysium partner'}</div>
              </div>
              <Tag tone={STATUS_TONE[s.status]}>{s.status}</Tag>
            </div>
            <p className="mt-1 text-sm text-ink2">{s.commitment} · {s.burnedShare} burned</p>
            {s.flag && <p className="mt-0.5 text-xs text-ink2">⚠ {s.flag}</p>}
            <p className="num mt-1 text-xs text-ink2">
              7d: <span className="text-ink">{s.kntq7d === null ? '—' : `${n0(s.kntq7d)} KNTQ`}</span>
              {s.kntq7dNote ? ` (${s.kntq7dNote})` : ''} · confidence {s.confidence === 'UNVERIFIED' ? 'unverified' : s.confidence} · checked {s.verified}
            </p>
          </li>
        ))}
      </ul>
      <div className="hidden md:block">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-ink2">
            <tr className="border-b border-line">
              {['Source', 'Commitment', 'Burned share', 'Status', '7d KNTQ', 'Confidence', 'Verified'].map((h) => (
                <th key={h} className="py-2 pr-3 font-medium whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {v.sources.map((s) => (
              <tr key={s.name} className="align-top">
                <td className="py-2 pr-3 text-ink">
                  {s.name}
                  {s.source.startsWith('http') ? <Src href={s.source} /> : <span className="ml-1 cursor-help text-xs text-muted" title={s.source}>ⓘ</span>}
                  <div className="text-xs text-muted">{s.tier === 'A' ? 'Kinetiq core' : 'Elysium partner'}</div>
                </td>
                <td className="py-2 pr-3 text-ink2">
                  {s.commitment}
                  {s.flag && <div className="mt-0.5 text-xs text-ink2">⚠ {s.flag}</div>}
                </td>
                <td className="num py-2 pr-3 text-ink2">{s.burnedShare}</td>
                <td className="py-2 pr-3">
                  <Tag tone={STATUS_TONE[s.status]}>{s.status}</Tag>
                </td>
                <td className="num py-2 pr-3 text-ink">
                  {s.kntq7d === null ? '—' : n0(s.kntq7d)}
                  {s.kntq7dNote && <div className="max-w-40 text-xs text-muted">{s.kntq7dNote}</div>}
                </td>
                <td className="py-2 pr-3 text-ink2">{s.confidence === 'UNVERIFIED' ? <Tag tone="bad">Unverified</Tag> : s.confidence}</td>
                <td className="num py-2 pr-3 whitespace-nowrap text-ink2">{s.verified}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-ink2">
        Total burned is the balance of the burn addresses. Sources only label where it came from, so nothing is counted twice. Partners with no activity on Elysium show "No data", not an estimate.
      </p>
    </Card>
  );
}

// ---------- 7. overhang ----------

export function OverhangPanel({ v, d }: { v: View; d: PageData }) {
  const w = d.latest.wallets;
  const a = v.a;
  const growthMoves = d.walletMoves.filter((m) => m.wallet === 'growth' || m.wallet === 'foundation').sort((x, y) => y.t - x.t);
  const kp = v.kpoints;
  const bal = (x: number | null | undefined) => (typeof x === 'number' ? n0(x) : 'unavailable');
  return (
    <Card title="Overhang" sub="Tokens that could still reach the market">
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <h3 className="mb-1 text-sm font-medium text-ink">Team and treasury wallets</h3>
          <Rows
            rows={[
              { label: <>Contributors<Src href={hyperevmscan(a.wallets.contributors!.address)} /></>, value: bal(w.contributors), note: w.contributors === a.unlock.contributorsKntq ? 'untouched' : 'has moved' },
              { label: <>Investors<Src href={hyperevmscan(a.wallets.investors!.address)} /></>, value: bal(w.investors), note: w.investors === a.unlock.investorsKntq ? 'untouched' : 'has moved' },
              { label: <>Foundation<Src href={hyperevmscan(a.wallets.foundation!.address)} /></>, value: bal(w.foundation), note: 'no published schedule' },
              { label: <>Growth &amp; Rewards<Src href={hyperevmscan(a.wallets.growth!.address)} /></>, value: bal(w.growth), note: 'no published schedule' },
            ]}
          />
          <details className="mt-2 text-sm">
            <summary className="text-ink2">Foundation and Growth movements ({growthMoves.length})</summary>
            <ul className="num mt-2 space-y-1 text-xs text-ink2">
              {growthMoves.map((m) => (
                <li key={m.id} className="flex justify-between gap-3">
                  <span>
                    <Time ms={m.t} dateOnly /> · {m.wallet}
                    {m.counterparty ? ` ${m.kntq < 0 ? '→' : '←'} ${shortAddr(m.counterparty)}` : ''}
                  </span>
                  <span className="text-ink">{signed(m.kntq)}</span>
                </li>
              ))}
              {!growthMoves.length && <li>None recorded.</li>}
            </ul>
          </details>
        </div>
        <div>
          <h3 className="mb-1 text-sm font-medium text-ink">kPoints claim (October 2026)</h3>
          {kp ? (
            <>
              <div className="mb-1 flex justify-between text-sm text-ink2">
                <span>Top {kp.wallets} claimants still hold</span>
                <span className="text-ink">{pct(kp.held / kp.claimed)}</span>
              </div>
              <Meter share={kp.held / kp.claimed} label={`Top ${kp.wallets} claimants still hold ${pct(kp.held / kp.claimed)} of what they claimed`} />
              <Rows
                rows={[
                  { label: <>Claimed by these wallets<Src href={hyperevmscan(a.wallets.kpoints_claim!.address)} /></>, value: n0(kp.claimed), note: kp.shareOfAllClaimed ? `${pct(kp.shareOfAllClaimed, 0)} of all KNTQ claimed` : undefined },
                  { label: 'Still held', value: n0(kp.held) },
                  { label: 'Moved out (sold, staked or transferred)', value: n0(kp.movedOut) },
                ]}
              />
            </>
          ) : (
            <p className="text-sm text-ink2">No reading yet. The daily job records one each night.</p>
          )}
          <h3 className="mt-4 mb-1 text-sm font-medium text-ink">Bought but not burned</h3>
          <Rows
            rows={[
              { label: <>Ascend burn treasury<Src href={elysiumScan(a.partners.ascend!.burnTreasury!)} /></>, value: bal(d.latest.ascend.treasury), note: 'pending burn' },
              { label: <>Ascend ecosystem allocator<Src href={elysiumScan(a.partners.ascend!.ecosystemAllocator!)} /></>, value: bal(d.latest.ascend.allocator), note: 'liquidity and points; may be paid out' },
              { label: <>Sequencer fee account<Src href={elysiumScan(a.sequencer.feeAccount)} /></>, value: typeof d.latest.feeHype === 'number' ? `${n0(d.latest.feeHype)} HYPE` : 'unavailable', note: `${pct(a.sequencer.kntqShare, 0)} is due to buy KNTQ` },
            ]}
          />
          <p className="mt-2 text-xs text-ink2">Incentive payouts in KNTQ (Ascend points, Nest locker rewards) are not yet observable and are not counted.</p>
        </div>
      </div>
    </Card>
  );
}

// ---------- 8. assumptions ----------

const SOURCE_LABEL: Record<SellSource, string> = { unlocks: 'Team and investor unlocks', growth_foundation: 'Foundation and Growth outflows', kpoints: 'kPoints claim tokens', incentives: 'Incentive payouts' };

function PctSlider({ id, label, value, onChange, hint }: { id: string; label: string; value: number; onChange: (v: number) => void; hint?: string }) {
  return (
    <div>
      <label htmlFor={id} className="flex justify-between text-sm text-ink2">
        <span>{label}</span>
        <span className="num text-ink">{Math.round(value * 100)}%</span>
      </label>
      <input id={id} type="range" min={0} max={100} step={5} value={Math.round(value * 100)} onChange={(e) => onChange(Number(e.target.value) / 100)} />
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function AssumptionsPanel({ v, d, sc, update, reset }: { v: View; d: PageData; sc: Scenario; update: Update; reset: () => void }) {
  const globalSt = sc.st ?? d.a.sellThrough.global;
  const copy = () => navigator.clipboard?.writeText(window.location.href);
  return (
    <Card title="Assumptions" sub="Changes here are saved in the page address, so you can share a scenario as a link." id="assumptions">
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-4">
          <PctSlider id="st" label="Sell-through (all sources)" value={globalSt} onChange={(st) => update({ st })} hint="Share of released tokens assumed sold. 100% is the worst case." />
          <details>
            <summary className="text-sm text-ink2">Per-source overrides</summary>
            <div className="mt-3 space-y-3">
              {(Object.keys(SOURCE_LABEL) as SellSource[]).map((src) => {
                const on = sc.overrides[src] !== undefined;
                return (
                  <div key={src}>
                    <label className="flex items-center gap-2 text-sm text-ink2">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) => {
                          const o = { ...sc.overrides };
                          if (e.target.checked) o[src] = globalSt;
                          else delete o[src];
                          update({ overrides: o });
                        }}
                      />
                      Override for {SOURCE_LABEL[src].toLowerCase()}
                    </label>
                    {on && <PctSlider id={`st-${src}`} label={SOURCE_LABEL[src]} value={sc.overrides[src]!} onChange={(x) => update({ overrides: { ...sc.overrides, [src]: x } })} />}
                  </div>
                );
              })}
            </div>
          </details>
        </div>
        <div className="space-y-4">
          <div>
            <p className="mb-1 text-sm text-ink2">Burn scenario for the projection</p>
            <Segmented
              label="Burn scenario"
              value={String(sc.burnScenario)}
              onChange={(x) => update({ burnScenario: Number(x) })}
              options={[{ value: String(d.a.scenarios.bear), label: `Bear ${d.a.scenarios.bear}×` }, { value: String(d.a.scenarios.base), label: `Base ${d.a.scenarios.base}×` }, { value: String(d.a.scenarios.bull), label: `Bull ${d.a.scenarios.bull}×` }]}
            />
            <p className="mt-1 text-xs text-muted">Multiplies the {v.h.runRate.daysUsed.toFixed(0)}-day burn run-rate ({n0(v.h.runRate.kntqPerDay)} KNTQ a day) used in the cumulative chart.</p>
          </div>
          {d.a.firstTrancheAltMs !== null && (
            <div>
              <p className="mb-1 text-sm text-ink2">First tranche date <Tag tone="warn">Unverified</Tag></p>
              <Segmented
                label="First tranche date"
                value={sc.altFirstTranche ? 'alt' : 'main'}
                onChange={(x) => update({ altFirstTranche: x === 'alt' })}
                options={[{ value: 'main', label: formatIct(d.a.unlock.firstTrancheMs).slice(0, 10) }, { value: 'alt', label: formatIct(d.a.firstTrancheAltMs).slice(0, 10) }]}
              />
              <p className="mt-1 text-xs text-muted">Kinetiq's docs say "1 year cliff, then monthly". Neither date is confirmed; the earlier one is the default.</p>
            </div>
          )}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        <button type="button" onClick={copy} className="min-h-9 rounded-lg border border-line px-3 text-ink hover:bg-wash">Copy link to this scenario</button>
        <button type="button" onClick={reset} className="min-h-9 rounded-lg border border-line px-3 text-ink2 hover:bg-wash">Reset to defaults</button>
        <a href={CONFIG_EDIT_URL} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center rounded-lg border border-line px-3 text-ink2 hover:bg-wash">Edit the defaults on GitHub ↗</a>
      </div>
      <details className="mt-4 text-sm">
        <summary className="text-ink2">Every constant, with its source ({d.a.meta.length})</summary>
        <div className="mt-2 max-h-80 overflow-auto rounded-lg border border-line">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-surface text-ink2">
              <tr>
                {['Constant', 'Confidence', 'Checked', 'Source'].map((h) => (
                  <th key={h} className="px-2 py-1.5 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {d.a.meta.map((m) => (
                <tr key={m.path} className="align-top">
                  <td className="px-2 py-1 font-mono text-[11px] text-ink">{m.path}</td>
                  <td className="px-2 py-1 whitespace-nowrap text-ink2">{m.confidence === 'UNVERIFIED' ? <Tag tone="bad">Unverified</Tag> : m.confidence}</td>
                  <td className="num px-2 py-1 whitespace-nowrap text-ink2">{m.retrieved}</td>
                  <td className="px-2 py-1 break-words text-ink2">{m.source.startsWith('http') ? <a className="underline" href={m.source.split(' ')[0]} target="_blank" rel="noreferrer">{m.source}</a> : m.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">
          Read from <a className="underline" href={CONFIG_VIEW_URL} target="_blank" rel="noreferrer">config/assumptions.yaml</a>{d.configSource === 'bundled' ? ' (the copy built into the page; the live file could not be read)' : ''}.
        </p>
      </details>
    </Card>
  );
}

// ---------- 9. data health ----------

const SOURCE_NAMES: Record<string, string> = {
  hyperliquid_prices: 'Prices (Hyperliquid)',
  hyperliquid_candles: 'Hourly prices (Hyperliquid)',
  af_balance: 'Assistance Fund balance',
  af_ledger: 'Assistance Fund inflows',
  af_ledger_full: 'Assistance Fund full re-check (daily)',
  buyback_fills: 'Buyback wallet trades',
  elysium_transfers: 'Elysium transfers',
  elysium_dead_balance: 'Elysium dead-address balance',
  ascend_balances: 'Ascend treasuries',
  sequencer_fee_account: 'Sequencer fee account',
  hyperevm_wallets: 'Team and treasury wallets (HyperEVM)',
  deployer_balance: 'Deployer balance',
  hyperliquid_supply: 'Supply (Hyperliquid)',
  kinetiq_supply_feed: "Kinetiq's supply feed",
  kinetiq_partner_feed: "Kinetiq's partner buyback feed",
  kpoints_holders: 'kPoints holders (daily)',
};
const DAILY = new Set(['af_ledger_full', 'kpoints_holders']);

export function HealthPanel({ v, d }: { v: View; d: PageData }) {
  const now = Date.now();
  const rows = Object.entries(d.health).map(([key, h]) => {
    const limit = DAILY.has(key) ? 26 * 3_600_000 : 2.25 * 3_600_000;
    const failing = h.consecutiveFailures > 0;
    const stale = h.lastOkMs === null || now - h.lastOkMs > limit;
    return { key, h, failing, stale };
  });
  const bad = rows.filter((r) => r.failing || r.stale).length;
  const age = (now - d.generatedAt) / 3_600_000;
  return (
    <Card title="Data health" sub={bad ? `${bad} source${bad === 1 ? '' : 's'} need attention` : 'All sources reporting'} aside={<Tag tone={bad || age > 2.25 ? 'warn' : 'good'}>{age > 2.25 ? `Data ${age.toFixed(1)}h old` : 'Up to date'}</Tag>}>
      <ul className="divide-y divide-line text-sm">
        {rows.map(({ key, h, failing, stale }) => (
          <li key={key} className="flex items-start justify-between gap-3 py-2">
            <div>
              <div className="text-ink">{SOURCE_NAMES[key] ?? key}</div>
              {failing && h.lastError && <div className="text-xs break-all text-ink2">Last error: {h.lastError}</div>}
            </div>
            <div className="text-right whitespace-nowrap">
              <Tag tone={failing ? 'bad' : stale ? 'warn' : 'good'}>{failing ? `Failing ×${h.consecutiveFailures}` : stale ? 'Stale' : 'OK'}</Tag>
              <div className="num mt-0.5 text-xs text-muted">{h.lastOkMs ? <Time ms={h.lastOkMs} /> : 'never'}</div>
            </div>
          </li>
        ))}
      </ul>
      {v.h.flags.length > 0 && <p className="mt-3 text-sm text-ink">⚠ Model flags: {v.h.flags.join(', ')}</p>}
      <p className="mt-3 text-xs text-ink2">
        Burn addresses vs recorded inflows: {v.h.sinkReconciliation.map((r) => `${r.sink} ${r.ok ? 'matches' : `differs by ${n0(r.residual)} KNTQ`}`).join('; ')}.{' '}
        <a className="underline" href={dataFileUrl('health.json')} target="_blank" rel="noreferrer">Raw health file</a>
      </p>
    </Card>
  );
}
