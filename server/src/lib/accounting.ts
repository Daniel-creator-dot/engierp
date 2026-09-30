import type { Knex } from 'knex';
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

async function firstAccount(conn: Conn, codes: string[], nameLike: string | null, type?: string) {
  for (const code of codes) {
    const acc = await conn('chart_of_accounts').where({ code }).first();
    if (acc) return acc;
  }
  if (nameLike) {
    const q = conn('chart_of_accounts').where('name', 'ilike', nameLike);
    if (type) q.where({ type });
    const acc = await q.orderBy('code').first();
    if (acc) return acc;
  }
  return null;
}

export async function receivableAccount(conn: Conn) {
  const acc = await firstAccount(conn, ['1104', '1003'], '%accounts receivable%', 'Asset');
  if (!acc) throw new LedgerError('Accounts Receivable account (1104) not found in the chart of accounts');
  return acc;
}

export async function payableAccount(conn: Conn) {
  const acc = await firstAccount(conn, ['2001'], '%accounts payable%', 'Liability');
  if (!acc) throw new LedgerError('Accounts Payable account (2001) not found in the chart of accounts');
  return acc;
}

export async function cashOnHandAccount(conn: Conn) {
  const acc = await firstAccount(conn, ['1101', '1001'], '%cash on hand%', 'Asset');
  if (!acc) throw new LedgerError('Cash on Hand account (1101) not found in the chart of accounts');
  return acc;
}

export async function whtPayableAccount(conn: Conn) {
  const acc = await firstAccount(conn, ['2102'], '%withholding tax payable%', 'Liability');
  if (!acc) throw new LedgerError('Withholding Tax Payable account (2102) not found in the chart of accounts');
  return acc;
}

export async function whtReceivableAccount(conn: Conn) {
  const acc = await firstAccount(conn, ['1108'], '%withholding tax receivable%', 'Asset');
  if (!acc) throw new LedgerError('Withholding Tax Receivable account (1108) not found in the chart of accounts');
  return acc;
}

export async function defaultIncomeAccount(conn: Conn, config?: AccountingConfig) {
  const cfg = config || (await getAccountingConfig(conn));
  if (cfg.default_income_account_id) {
    const acc = await conn('chart_of_accounts').where({ id: cfg.default_income_account_id, type: 'Income' }).first();
    if (acc) return acc;
  }
  const acc = (await firstAccount(conn, ['4101', '4001'], null)) || (await conn('chart_of_accounts').where({ type: 'Income' }).orderBy('code').first());
  if (!acc || acc.type !== 'Income') throw new LedgerError('No income account found in the chart of accounts');
  return acc;
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
  if (String(current || '').toLowerCase() === 'void') return 'void';
  if (amount > 0 && settled >= amount - 0.005) return 'paid';
  if (settled > 0) return 'partially_paid';
  return 'unpaid';
}
