/**
 * Chooses an existing ledger account for a system role.
 * The stored code and name are never rewritten: a code is accepted only when
 * the account's current name still belongs to that role.
 */

export interface AccountRow {
  id: number;
  code: string;
  name: string;
  type: string;
}

export interface AccountSpec {
  key: string;
  type: string;
  label: string;
  /** Tried in order. The first hint that matches an account of this type wins. */
  nameHints: string[];
  /** Tried only when that code's stored name still fits the role. */
  codes: string[];
  /** A stored name matching this is a different account and must not be used. */
  contradicts?: RegExp;
  /**
   * hint-only: a code is used only when its name contains a hint.
   * hint-or-safe: a code is also used when the name was customised but does not contradict the role.
   */
  codePolicy: 'hint-only' | 'hint-or-safe';
  /** code: keep today's default codes when the name still fits. name: trust the stored name over the code. */
  prefer: 'name' | 'code';
}

export function nameMatchesHints(name: string, hints: string[]) {
  const normalised = String(name || '').toLowerCase();
  return hints.some(hint => normalised.includes(hint.toLowerCase()));
}

export function nameContradicts(name: string, contradicts?: RegExp) {
  return !!contradicts && contradicts.test(String(name || ''));
}

export function pickAccount(accounts: AccountRow[], spec: AccountSpec): AccountRow | null {
  const typed = accounts.filter(a => a.type === spec.type && !nameContradicts(a.name, spec.contradicts));
  const byName = () => {
    for (const hint of spec.nameHints) {
      const hits = typed.filter(a => String(a.name || '').toLowerCase().includes(hint.toLowerCase()));
      if (hits.length) return [...hits].sort((a, b) => String(a.code).localeCompare(String(b.code)))[0];
    }
    return null;
  };
  const byCode = () => {
    for (const code of spec.codes) {
      const acc = typed.find(a => a.code === code);
      if (!acc) continue;
      if (spec.codePolicy === 'hint-only' && !nameMatchesHints(acc.name, spec.nameHints)) continue;
      return acc;
    }
    return null;
  };
  return spec.prefer === 'code' ? (byCode() || byName()) : (byName() || byCode());
}
