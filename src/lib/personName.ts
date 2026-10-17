/** The name as it is stored. Casing is left alone so the same person reads the same on every screen. */
export function personName(user?: { name?: string | null; email?: string | null } | null): string {
  const stored = (user?.name || '').trim();
  if (stored) return stored;
  return (user?.email || '').split('@')[0]?.trim() || '';
}
