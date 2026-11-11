// Scenario state lives in the URL query string so a scenario can be shared as a link.

import { useCallback, useEffect, useState } from 'react';
import type { SellSource, SellThrough } from '../model/flow';

export type WindowKey = '24h' | '7d' | 'all';
export type ScaleKey = 'true' | 'zoom';
export type RangeKey = '30' | '90' | 'all';

export interface Scenario {
  window: WindowKey;
  scale: ScaleKey;
  range: RangeKey;
  /** global sell-through, 0..1; null = config default */
  st: number | null;
  /** per-source sell-through overrides, 0..1 */
  overrides: Partial<Record<SellSource, number>>;
  /** multiplier on the forward burn run-rate: bear 0.25, base 1, bull 3 */
  burnScenario: number;
  /** use the alternative first-tranche date from config */
  altFirstTranche: boolean;
}

const OVERRIDE_KEYS: Record<SellSource, string> = { unlocks: 'st_unlocks', growth_foundation: 'st_treasury', kpoints: 'st_kpoints', incentives: 'st_incentives' };
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const pick = <T extends string>(v: string | null, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d);

export function parseScenario(search: string): Scenario {
  const q = new URLSearchParams(search);
  const pct = (k: string) => (q.has(k) && q.get(k) !== '' && Number.isFinite(Number(q.get(k))) ? clamp01(Number(q.get(k)) / 100) : null);
  const overrides: Scenario['overrides'] = {};
  for (const [src, key] of Object.entries(OVERRIDE_KEYS) as [SellSource, string][]) {
    const v = pct(key);
    if (v !== null) overrides[src] = v;
  }
  const sc = Number(q.get('burn'));
  return {
    window: pick(q.get('w'), ['24h', '7d', 'all'] as const, 'all'),
    scale: pick(q.get('scale'), ['true', 'zoom'] as const, 'true'),
    range: pick(q.get('range'), ['30', '90', 'all'] as const, '30'),
    st: pct('st'),
    overrides,
    burnScenario: q.has('burn') && Number.isFinite(sc) && sc > 0 && sc <= 100 ? sc : 1,
    altFirstTranche: q.get('first') === 'alt',
  };
}

export function serialiseScenario(s: Scenario): string {
  const q = new URLSearchParams();
  if (s.window !== 'all') q.set('w', s.window);
  if (s.scale !== 'true') q.set('scale', s.scale);
  if (s.range !== '30') q.set('range', s.range);
  if (s.st !== null) q.set('st', String(Math.round(s.st * 100)));
  for (const [src, key] of Object.entries(OVERRIDE_KEYS) as [SellSource, string][]) {
    const v = s.overrides[src];
    if (v !== undefined) q.set(key, String(Math.round(v * 100)));
  }
  if (s.burnScenario !== 1) q.set('burn', String(s.burnScenario));
  if (s.altFirstTranche) q.set('first', 'alt');
  const out = q.toString();
  return out ? `?${out}` : '';
}

export const toSellThrough = (s: Scenario, configDefault: SellThrough): SellThrough => ({
  global: s.st ?? configDefault.global,
  overrides: { ...configDefault.overrides, ...s.overrides },
});

export function useScenario(): [Scenario, (patch: Partial<Scenario>) => void, () => void] {
  const [s, setS] = useState<Scenario>(() => parseScenario(window.location.search));
  useEffect(() => {
    const url = `${window.location.pathname}${serialiseScenario(s)}${window.location.hash}`;
    window.history.replaceState(null, '', url);
  }, [s]);
  const update = useCallback((patch: Partial<Scenario>) => setS((prev) => ({ ...prev, ...patch })), []);
  const reset = useCallback(() => setS(parseScenario('')), []);
  return [s, update, reset];
}
