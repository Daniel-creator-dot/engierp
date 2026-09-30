/**
 * Copy only the listed fields from a request body, so clients cannot write
 * columns such as ids, statuses or audit fields they were never meant to set.
 */
export function pick<K extends string>(source: unknown, fields: readonly K[]): Partial<Record<K, any>> {
  const out: Partial<Record<K, any>> = {};
  if (!source || typeof source !== 'object') return out;
  for (const field of fields) {
    const value = (source as Record<string, unknown>)[field];
    if (value !== undefined) out[field] = value;
  }
  return out;
}

/** Turn '' and undefined into null for optional foreign keys and dates. */
export const orNull = (value: unknown) => (value === '' || value === undefined || value === 'none' ? null : value);

export const toNumber = (value: unknown, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
