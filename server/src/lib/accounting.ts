import type { Knex } from 'knex';
import { AccountSpec, nameContradicts, pickAccount } from './accountIdentity';
import { Conn, LedgerError, round2, toIsoDate } from './ledger';

export const CREDIT_NOTE_METHOD = 'Credit Note';

/** Copies only the listed keys that are present (not undefined) in the body. */
export function pick<K extends string>(body: any, keys: readonly K[]): Partial<Record<K, any>> {
  const out: Partial<Record<K, any>> = {};
  if (!body || typeof body !== 'object') return out;
  for (const key of keys) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  return out;
}

export async function getSettingValue(conn: Conn, key: string): Promise<string | null> {
  const row = await conn('settings').where({ key }).first();
  return row ? row.value : null;
}

export async function saveSettingValue(conn: Conn, key: string, value: string) {
  const existing = await conn('settings').where({ key }).first();
  if (existing) await conn('settings').where({ key }).update({ value, updated_at: conn.fn.now() });
  else await conn('settings').insert({ key, value });
}

export interface TaxComponent {
  code: string;
  name: string;
  rate: number;
  account_code: string;
}

// Ghana VAT Act 2025 (Act 1151): VAT 15%, NHIL 2.5%, GETFund 2.5%, all on the taxable value.
export const DEFAULT_TAX_COMPONENTS: TaxComponent[] = [
  { code: 'VAT', name: 'VAT', rate: 15, account_code: '2105' },
  { code: 'NHIL', name: 'NHIL', rate: 2.5, account_code: '2108' },
  { code: 'GETFUND', name: 'GETFund Levy', rate: 2.5, account_code: '2109' },
];

export interface AccountingConfig {
  sales_tax_rate?: string | number;
  tax_name?: string;
  tax_components: TaxComponent[];
  default_income_account_id?: number | null;
  wht_rate?: number;
}

export async function getAccountingConfig(conn: Conn): Promise<AccountingConfig> {
  let parsed: any = {};
  try {
    parsed = JSON.parse((await getSettingValue(conn, 'accounting_config')) || '{}') || {};
  } catch {
    parsed = {};
  }
  const components: TaxComponent[] = Array.isArray(parsed.tax_components) && parsed.tax_components.length > 0
    ? parsed.tax_components
        .map((c: any) => ({ code: String(c.code || c.name || '').toUpperCase(), name: String(c.name || c.code || ''), rate: Number(c.rate) || 0, account_code: String(c.account_code || '') }))
        .filter((c: TaxComponent) => c.code && c.account_code)
    : DEFAULT_TAX_COMPONENTS;
  return {
    ...parsed,
    tax_components: components,
    default_income_account_id: parsed.default_income_account_id ? Number(parsed.default_income_account_id) : null,
    wht_rate: parsed.wht_rate !== undefined ? Number(parsed.wht_rate) : 7.5,
  };
}

const NOT_CASH = /depreciat|receivable|inventory|equipment|vehicle|building|furniture|prepay|withholding|payable|vat input|staff advance/i;
const NOT_RECEIVABLE = /depreciat|payable|cash on hand|inventory|equipment|withholding/i;
const NOT_PAYABLE = /receivable|depreciat|cash|revenue|vat output|vat payable|paye|ssnit|withholding|accrued/i;

const RECEIVABLE: AccountSpec = {
  key: 'accounts_receivable', type: 'Asset', label: 'Accounts Receivable',
  nameHints: ['accounts receivable', 'trade receivable'], codes: ['1104', '1003'],
  contradicts: NOT_RECEIVABLE, codePolicy: 'hint-or-safe', prefer: 'name',
};
const PAYABLE: AccountSpec = {
  key: 'accounts_payable', type: 'Liability', label: 'Accounts Payable',
  nameHints: ['accounts payable', 'trade payable'], codes: ['2101', '2001'],
  contradicts: NOT_PAYABLE, codePolicy: 'hint-or-safe', prefer: 'name',
};
const CASH: AccountSpec = {
  key: 'cash_on_hand', type: 'Asset', label: 'Cash on Hand',
  nameHints: ['cash on hand', 'petty cash', 'cash'], codes: ['1101', '1001'],
  contradicts: NOT_CASH, codePolicy: 'hint-or-safe', prefer: 'name',
};
const WHT_PAYABLE: AccountSpec = {
  key: 'wht_payable', type: 'Liability', label: 'Withholding Tax Payable',
  nameHints: ['withholding tax payable', 'withholding tax'], codes: ['2102'],
  contradicts: /receivable|cash|revenue/i, codePolicy: 'hint-or-safe', prefer: 'name',
};
const WHT_RECEIVABLE: AccountSpec = {
  key: 'wht_receivable', type: 'Asset', label: 'Withholding Tax Receivable',
  nameHints: ['withholding tax receivable', 'withholding tax'], codes: ['1108'],
  contradicts: /payable|depreciat|cash on hand/i, codePolicy: 'hint-or-safe', prefer: 'name',
};
const INCOME: AccountSpec = {
  key: 'default_income', type: 'Income', label: 'Income',
  nameHints: ['civil engineering revenue', 'project revenue', 'revenue', 'income', 'fees'],
  codes: ['4101', '4001'], contradicts: /expense|payable|depreciat/i, codePolicy: 'hint-or-safe', prefer: 'name',
};
const OPENING_EQUITY: AccountSpec = {
  key: 'opening_balance_equity', type: 'Equity', label: 'Opening Balance Equity',
  nameHints: ['opening balance equity'], codes: ['3900'],
  codePolicy: 'hint-or-safe', prefer: 'name',
};

const pinKey = (key: string) => `ledger_account.${key}`;

/**
 * The account already chosen for this role, or the company's existing account
 * whose name matches the role. The choice is stored by id so a later edit to
 * an account code cannot point the role at a different name.
 */
export async function resolvePinnedAccount(conn: Conn, spec: AccountSpec) {
  const accounts = await conn('chart_of_accounts').select('id', 'code', 'name', 'type');
  const pin = await getSettingValue(conn, pinKey(spec.key));
  const pinnedId = Number(pin);
  const pinned = accounts.find((a: any) => Number(a.id) === pinnedId);
  if (pinned && pinned.type === spec.type && !nameContradicts(pinned.name, spec.contradicts)) return pinned;

  const chosen = pickAccount(accounts, spec);
  if (!chosen) return pinned && pinned.type === spec.type ? pinned : null;
  if (!pinned || Number(pinned.id) !== Number(chosen.id)) {
    await saveSettingValue(conn, pinKey(spec.key), String(chosen.id));
  }
  return chosen;
}

async function requireAccount(conn: Conn, spec: AccountSpec) {
  const acc = await resolvePinnedAccount(conn, spec);
  if (!acc) {
    throw new LedgerError(`${spec.label} was not found. Add an account of type ${spec.type} with that name. Existing account names were left unchanged.`);
  }
  return acc;
}

export async function receivableAccount(conn: Conn) {
  return requireAccount(conn, RECEIVABLE);
}

export async function payableAccount(conn: Conn) {
  return requireAccount(conn, PAYABLE);
}

export async function cashOnHandAccount(conn: Conn) {
  return requireAccount(conn, CASH);
}

export async function whtPayableAccount(conn: Conn) {
  return requireAccount(conn, WHT_PAYABLE);
}

export async function whtReceivableAccount(conn: Conn) {
  return requireAccount(conn, WHT_RECEIVABLE);
}

export async function openingEquityAccount(conn: Conn) {
  return requireAccount(conn, OPENING_EQUITY);
}

export async function defaultIncomeAccount(conn: Conn, config?: AccountingConfig) {
  const cfg = config || (await getAccountingConfig(conn));
  if (cfg.default_income_account_id) {
    const acc = await conn('chart_of_accounts').where({ id: cfg.default_income_account_id, type: 'Income' }).first();
    if (acc) return acc;
  }
  return requireAccount(conn, INCOME);
}

/** Ledger account behind a bank account: the explicit link, else a best-effort name match. */
export async function bankLedgerAccount(conn: Conn, bankAccountId: number | string) {
  const bank = await conn('bank_accounts').where({ id: bankAccountId }).first();
  if (!bank) throw new LedgerError('Bank account not found');
  if (bank.coa_account_id) {
    const acc = await conn('chart_of_accounts').where({ id: bank.coa_account_id }).first();
    if (acc) return { bank, account: acc };
  }
  let acc = await conn('chart_of_accounts').where('type', 'Asset').where('name', 'ilike', `%${bank.account_name}%`).first();
  if (!acc && bank.bank_name) {
    const firstWord = String(bank.bank_name).split(' ')[0];
    if (firstWord) acc = await conn('chart_of_accounts').where('type', 'Asset').where('name', 'ilike', `%${firstWord}%`).first();
  }
  if (!acc) throw new LedgerError(`Bank account "${bank.account_name}" is not linked to a ledger account. Link it under Bank & Cash first.`);
  return { bank, account: acc };
}

/** Next sequential number like INV-2026-0001; serialised per prefix with an advisory lock. */
export async function nextDocNumber(trx: Knex.Transaction, table: string, column: string, prefix: string, date?: string) {
  const year = toIsoDate(date).slice(0, 4);
  const stem = `${prefix}-${year}-`;
  await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [stem]);
  const row: any = await trx(table)
    .where(column, 'like', `${stem}%`)
    .max({ max: trx.raw(`CAST(NULLIF(regexp_replace(??, '^.*-', ''), '') AS INTEGER)`, [column]) })
    .first();
  const next = Number(row?.max || 0) + 1;
  return `${stem}${String(next).padStart(4, '0')}`;
}

export async function paidOn(conn: Conn, targetType: 'Invoice' | 'Bill', targetId: string | number) {
  const rows: any[] = await conn('payments')
    .where({ target_type: targetType, target_id: String(targetId) })
    .select('method', 'amount');
  let paid = 0;
  let credited = 0;
  for (const r of rows) {
    if (r.method === CREDIT_NOTE_METHOD) credited += Number(r.amount || 0);
    else paid += Number(r.amount || 0);
  }
  return { paid: round2(paid), credited: round2(credited), total: round2(paid + credited) };
}

export function statusFor(amount: number, settled: number, current?: string | null) {
  const cur = String(current || '').toLowerCase();
  if (cur === 'void' || cur === 'pending_approval') return cur;
  if (amount > 0 && settled >= amount - 0.005) return 'paid';
  if (settled > 0) return 'partially_paid';
  return 'unpaid';
}
