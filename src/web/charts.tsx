import { BarController, BarElement, CategoryScale, Chart, type ChartConfiguration, Filler, LineController, LineElement, LinearScale, type Plugin, PointElement, Tooltip } from 'chart.js';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { compact } from './ui';

Chart.register(BarController, BarElement, LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Filler);

export interface Theme {
  surface: string;
  ink: string;
  ink2: string;
  muted: string;
  grid: string;
  axis: string;
  s: [string, string, string, string, string];
}

const readTheme = (): Theme => {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return { surface: v('--surface'), ink: v('--ink'), ink2: v('--ink2'), muted: v('--muted'), grid: v('--grid'), axis: v('--axis'), s: [v('--s1'), v('--s2'), v('--s3'), v('--s4'), v('--s5')] };
};

/** Chart colours read from the page's CSS variables; re-read when the system switches between light and dark. */
export function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setTheme(readTheme());
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return theme;
}

/** A lighter step of a series colour, for pending and estimated amounts. */
export const lighter = (hex: string, surface: string) => `color-mix(in srgb, ${hex} 55%, ${surface})`;

export interface LegendItem {
  label: string;
  color: string;
  kind?: 'bar' | 'line' | 'dashed';
  tag?: string;
}

export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink2">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          {i.kind === 'line' || i.kind === 'dashed' ? (
            <span aria-hidden className="inline-block w-4" style={{ borderTop: `2px ${i.kind === 'dashed' ? 'dashed' : 'solid'} ${i.color}` }} />
          ) : (
            <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />
          )}
          <span>{i.label}</span>
          {i.tag && <span className="rounded-full border border-dashed border-line px-1.5 text-[10px] text-ink2">{i.tag}</span>}
        </li>
      ))}
    </ul>
  );
}

export function ChartBox({ config, height = 260, label }: { config: ChartConfiguration; height?: number; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = new Chart(ref.current, config);
    return () => chart.destroy();
  }, [config]);
  return (
    <div className="relative w-full" style={{ height }}>
      <canvas ref={ref} role="img" aria-label={label} />
    </div>
  );
}

/** The same data as a table, so no value is readable only by hovering. */
export function DataTable({ head, rows, caption }: { head: string[]; rows: (string | number)[][]; caption: string }) {
  return (
    <details className="mt-3 text-sm">
      <summary className="text-ink2">Show as table</summary>
      <div className="mt-2 max-h-72 overflow-auto rounded-lg border border-line">
        <table className="num w-full text-left text-xs">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 bg-surface text-ink2">
            <tr>
              {head.map((h) => (
                <th key={h} className="px-2 py-1.5 font-medium whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j} className="px-2 py-1 whitespace-nowrap">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

const baseOptions = (t: Theme, yFormat: (v: number) => string) => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: false as const,
  interaction: { mode: 'index' as const, intersect: false },
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: t.ink,
      titleColor: t.surface,
      bodyColor: t.surface,
      padding: 10,
      boxWidth: 8,
      boxHeight: 8,
      usePointStyle: true,
      callbacks: { label: (c: any) => ` ${c.dataset.label}: ${c.parsed.y === null ? '—' : yFormat(c.parsed.y)}` },
    },
  },
});

/** Round an axis maximum up to the next tidy step (1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8) times a power of ten. */
export const niceCeil = (v: number) => {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return ([1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((step) => m <= step) ?? 10) * p;
};

/** Axis ticks read 500K and 100M, not 500.0K and 100.00M. */
const tidy = (label: string) => label.replace(/\.0+(?=[KMB]|$)/, '').replace(/(\.\d*?)0+(?=[KMB])/, '$1');

const axis = (t: Theme) => ({ grid: { color: t.grid, lineWidth: 1, drawTicks: false }, border: { color: t.axis }, ticks: { color: t.muted, font: { size: 11 }, padding: 6 } });

// ---------- stacked bars against a comparison line (daily burns vs unlock, daily buying vs sell pressure) ----------

export interface BarSeries {
  label: string;
  color: string;
  values: number[];
}

export function useBarLineConfig(args: { theme: Theme; labels: string[]; bars: BarSeries[]; line: { label: string; values: (number | null)[]; dashed?: boolean }; zoom: boolean; yFormat: (v: number) => string }): ChartConfiguration {
  const { theme: t, labels, bars, line, zoom, yFormat } = args;
  return useMemo(() => {
    const stackMax = Math.max(1, ...labels.map((_, i) => bars.reduce((s, b) => s + (b.values[i] ?? 0), 0)));
    return {
      type: 'bar',
      data: {
        labels,
        datasets: [
          ...bars.map((b) => ({
            type: 'bar' as const,
            label: b.label,
            data: b.values,
            backgroundColor: b.color,
            stack: 'a',
            maxBarThickness: 24,
            borderRadius: 3,
            // a 2px gap in the surface colour separates stacked segments
            borderColor: t.surface,
            borderWidth: { top: 2, right: 0, bottom: 0, left: 0 },
            order: 2,
          })),
          { type: 'line' as const, label: line.label, data: line.values, borderColor: t.ink2, backgroundColor: t.ink2, borderWidth: 2, borderDash: line.dashed ? [6, 4] : [], pointRadius: line.values.filter((x) => x !== null).length <= 2 ? 4 : 0, pointBorderColor: t.surface, pointBorderWidth: 2, pointHoverRadius: 5, spanGaps: false, order: 1 },
        ],
      },
      options: {
        ...baseOptions(t, yFormat),
        scales: {
          x: { ...axis(t), stacked: true, grid: { display: false }, ticks: { ...axis(t).ticks, maxRotation: 0, autoSkip: true, maxTicksLimit: 7 } },
          y: { ...axis(t), stacked: true, beginAtZero: true, max: zoom ? niceCeil(stackMax * 1.05) : undefined, ticks: { ...axis(t).ticks, maxTicksLimit: 6, callback: (v: any) => tidy(yFormat(Number(v))) } },
        },
      },
    } as ChartConfiguration;
  }, [t, labels, bars, line, zoom, yFormat]);
}

// ---------- cumulative lines over time ----------

export interface TimeLine {
  label: string;
  color: string;
  points: { x: number; y: number }[];
  dashed?: boolean;
  stepped?: boolean;
  width?: number;
}

export interface Marker {
  x: number;
  label: string;
}

const markerPlugin = (markers: Marker[], t: Theme): Plugin => ({
  id: 'markers',
  afterDatasetsDraw(chart) {
    const { ctx, chartArea, scales } = chart;
    const xs = scales.x;
    if (!xs) return;
    ctx.save();
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    markers.forEach((m, i) => {
      const px = xs.getPixelForValue(m.x);
      if (px < chartArea.left || px > chartArea.right) return;
      ctx.strokeStyle = t.axis;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, chartArea.top);
      ctx.lineTo(px, chartArea.bottom);
      ctx.stroke();
      const w = ctx.measureText(m.label).width;
      const left = px + 4 + w > chartArea.right;
      ctx.fillStyle = t.ink2;
      ctx.textAlign = left ? 'right' : 'left';
      ctx.fillText(m.label, left ? px - 4 : px + 4, chartArea.top + 2 + i * 14);
    });
    ctx.restore();
  },
});

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (ms: number) => {
  const d = new Date(ms + 7 * 3_600_000);
  return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
};

export function useTimeLinesConfig(args: { theme: Theme; lines: TimeLine[]; markers: Marker[]; xMin: number; xMax: number; yMax?: number }): ChartConfiguration {
  const { theme: t, lines, markers, xMin, xMax, yMax } = args;
  return useMemo(() => {
    // one tick every six months, on the first of the month
    const ticks: number[] = [];
    const d = new Date(xMin);
    d.setUTCDate(1);
    d.setUTCHours(0, 0, 0, 0);
    while (d.getTime() <= xMax) {
      if (d.getTime() >= xMin && d.getUTCMonth() % 6 === 0) ticks.push(d.getTime());
      d.setUTCMonth(d.getUTCMonth() + 1);
    }
    return {
      type: 'line',
      data: {
        datasets: lines.map((l) => ({
          label: l.label,
          data: l.points,
          borderColor: l.color,
          backgroundColor: l.color,
          borderWidth: l.width ?? 2,
          borderDash: l.dashed ? [6, 4] : [],
          stepped: l.stepped ? ('after' as const) : false,
          pointRadius: 0,
          pointHoverRadius: 4,
          parsing: false as const,
        })),
      },
      options: {
        ...baseOptions(t, compact),
        interaction: { mode: 'nearest' as const, axis: 'x' as const, intersect: false },
        plugins: {
          ...baseOptions(t, compact).plugins,
          tooltip: { ...baseOptions(t, compact).plugins.tooltip, callbacks: { title: (items: any[]) => (items[0] ? new Date(items[0].parsed.x + 7 * 3_600_000).toISOString().slice(0, 10) : ''), label: (c: any) => ` ${c.dataset.label}: ${compact(c.parsed.y)} KNTQ` } },
        },
        scales: {
          x: { ...axis(t), type: 'linear', min: xMin, max: xMax, grid: { display: false }, afterBuildTicks: (scale: any) => (scale.ticks = ticks.map((value) => ({ value }))), ticks: { ...axis(t).ticks, maxRotation: 0, autoSkip: true, maxTicksLimit: 8, callback: (v: any) => monthLabel(Number(v)) } },
          y: { ...axis(t), beginAtZero: true, max: yMax === undefined ? undefined : niceCeil(yMax), ticks: { ...axis(t).ticks, maxTicksLimit: 6, callback: (v: any) => tidy(compact(Number(v))) } },
        },
      },
      plugins: [markerPlugin(markers, t)],
    } as ChartConfiguration;
  }, [t, lines, markers, xMin, xMax, yMax]);
}

export function ChartNote({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-xs text-ink2">{children}</p>;
}
