import type { ReactNode } from 'react';
import { formatIct, formatUtc } from '../model/time';

// ---------- formatting (British English, en-GB grouping) ----------

export const n0 = (v: number) => Math.round(v).toLocaleString('en-GB');

/** Compact amount: 3,618 / 430.6K / 12.92M / 1.00B */
export function compact(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(1)}K`;
  return n0(v);
}
export const kntq = (v: number) => compact(v);
export const usd = (v: number) => `${v < 0 ? '−' : ''}$${compact(Math.abs(v))}`;
export const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${compact(Math.abs(v))}`;
export function pct(v: number | null, digits = 1): string {
  if (v === null || !Number.isFinite(v)) return 'n/a';
  const p = v * 100;
  return `${p.toFixed(p !== 0 && Math.abs(p) < 10 ? 2 : digits)}%`;
}
export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export const hypurrscan = (addr: string) => `https://hypurrscan.io/address/${addr}`;
export const hyperevmscan = (addr: string) => `https://hyperevmscan.io/address/${addr}`;
export const elysiumScan = (addr: string) => `https://elysium.kinetiq.xyz/address/${addr}`;

// ---------- small components ----------

/** A time shown in ICT, with UTC in the tooltip. */
export function Time({ ms, dateOnly = false }: { ms: number; dateOnly?: boolean }) {
  const ict = formatIct(ms);
  return (
    <time dateTime={new Date(ms).toISOString()} title={formatUtc(ms)}>
      {dateOnly ? ict.slice(0, 10) : ict}
    </time>
  );
}

/** Link from a number or label to where it comes from. */
export function Src({ href, label = 'source' }: { href: string; label?: string }) {
  return (
    <a className="src" href={href} target="_blank" rel="noreferrer" aria-label={label} title={label}>
      ↗
    </a>
  );
}

export function Card({ title, sub, children, id, aside }: { title: string; sub?: ReactNode; children: ReactNode; id?: string; aside?: ReactNode }) {
  return (
    <section id={id} className="rounded-xl border border-line bg-surface p-4 sm:p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          {sub && <p className="mt-0.5 text-sm text-ink2">{sub}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

export type TagTone = 'neutral' | 'estimate' | 'warn' | 'good' | 'bad';
const TAG: Record<TagTone, string> = {
  neutral: 'border-line text-ink2',
  estimate: 'border-line text-ink2 border-dashed',
  warn: 'border-line text-ink',
  good: 'border-line text-ink',
  bad: 'border-line text-ink',
};
const DOT: Partial<Record<TagTone, string>> = { warn: 'var(--warning)', good: 'var(--good)', bad: 'var(--critical)' };

/** A small label. Status tones carry a coloured dot plus the word, never colour alone. */
export function Tag({ children, tone = 'neutral', title }: { children: ReactNode; tone?: TagTone; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs whitespace-nowrap ${TAG[tone]}`}>
      {DOT[tone] && <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: DOT[tone] }} />}
      {children}
    </span>
  );
}

export function Stat({ label, value, sub, tag, src }: { label: string; value: ReactNode; sub?: ReactNode; tag?: ReactNode; src?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-sm text-ink2">
        <span>
          {label}
          {src && <Src href={src} />}
        </span>
        {tag}
      </div>
      <div className="mt-1 text-2xl font-semibold text-ink">{value}</div>
      {sub && <div className="mt-0.5 text-sm text-ink2">{sub}</div>}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-line bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={`min-h-9 rounded-md px-3 text-sm ${o.value === value ? 'bg-ink text-surface font-medium' : 'text-ink2 hover:bg-wash'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Label: value rows. */
export function Rows({ rows }: { rows: { label: ReactNode; value: ReactNode; note?: ReactNode }[] }) {
  return (
    <dl className="divide-y divide-line text-sm">
      {rows.map((r, i) => (
        <div key={i} className="flex items-baseline justify-between gap-3 py-2">
          <dt className="text-ink2">{r.label}</dt>
          <dd className="num text-right text-ink">
            {r.value}
            {r.note && <div className="text-xs text-muted">{r.note}</div>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Thin meter: how much of a whole. The track is a lighter step of the fill. */
export function Meter({ share, label }: { share: number; label: string }) {
  const w = `${Math.min(100, Math.max(0, share * 100)).toFixed(1)}%`;
  return (
    <div role="img" aria-label={label} className="h-2 w-full overflow-hidden rounded-full" style={{ background: 'color-mix(in srgb, var(--s1) 18%, var(--surface))' }}>
      <div className="h-full rounded-full" style={{ width: w, background: 'var(--s1)' }} />
    </div>
  );
}
