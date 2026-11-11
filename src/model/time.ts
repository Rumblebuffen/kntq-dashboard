// Time helpers. All stored times are UTC milliseconds; days are ICT days (UTC+7, no daylight saving).

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;
export const ICT_OFFSET_MS = 7 * HOUR_MS;

export const daysBetween = (fromMs: number, toMs: number): number => (toMs - fromMs) / DAY_MS;

/** UTC ms of 00:00 ICT on the ICT day containing `ms`. */
export const ictDayStartMs = (ms: number): number =>
  Math.floor((ms + ICT_OFFSET_MS) / DAY_MS) * DAY_MS - ICT_OFFSET_MS;

/** ICT calendar date, YYYY-MM-DD. */
export const ictDayKey = (ms: number): string => new Date(ms + ICT_OFFSET_MS).toISOString().slice(0, 10);

export const formatIct = (ms: number): string =>
  `${new Date(ms + ICT_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ')} ICT`;

export const formatUtc = (ms: number): string => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/** Same day-of-month and time `n` months later, in UTC. Clamps to the month's last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonthsUtc(ms: number, n: number): number {
  const d = new Date(ms);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.getTime();
}

/** Length of the overlap of [a0, a1] and [b0, b1], in ms. Zero if they do not overlap. */
export const overlapMs = (a0: number, a1: number, b0: number, b1: number): number =>
  Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
