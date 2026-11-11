// Unit conversions between on-chain base units and whole KNTQ.

export const HYPERCORE_DECIMALS = 8;
export const EVM_DECIMALS = 18;

/**
 * Base units (as bigint or 0x-hex / decimal string) to a JS number of whole tokens.
 * Precision is kept to 8 decimal places, which is HyperCore's own precision for KNTQ.
 */
export function fromBaseUnits(raw: bigint | string, decimals: number): number {
  const v = typeof raw === 'bigint' ? raw : BigInt(raw);
  const keep = 8;
  if (decimals <= keep) return Number(v) / 10 ** decimals;
  const scaled = v / 10n ** BigInt(decimals - keep);
  return Number(scaled) / 10 ** keep;
}

export const kntqToUsd = (kntq: number, priceUsd: number): number => kntq * priceUsd;
export const usdToKntq = (usd: number, priceUsd: number): number => {
  if (!(priceUsd > 0)) throw new Error('price must be positive');
  return usd / priceUsd;
};
