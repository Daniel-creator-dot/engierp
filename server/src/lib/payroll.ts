import type { Knex } from 'knex';
import { AccountSpec, nameContradicts, pickAccount } from './accountIdentity';
import { Conn, LedgerError, JournalLine, postJournal, round2 } from './ledger';
import {
  casualOvertimeRate, casualWhtLabel, computeCasualPay, computePay, effectiveTaxTreatment, isCasualWage,
  normalisePayrollConfig, PayItem, PayrollConfig, PayResult, CasualPayResult, TaxTreatment,
} from '../../../src/lib/payrollCalc';

export { casualOvertimeRate, computeCasualPay, computePay, effectiveTaxTreatment, isCasualWage, normalisePayrollConfig };
export type { PayItem, PayrollConfig, PayResult, TaxTreatment };

export interface PayrollAccounts {
  salary_expense_account_id: number | null;
  site_labour_account_id: number | null;
  employer_ssnit_account_id: number | null;
  paye_payable_account_id: number | null;
  ssnit_payable_account_id: number | null;
  other_deductions_account_id: number | null;
  bank_account_id: number | null;
  casual_wht_payable_account_id: number | null;
  casual_payment_account_id: number | null;
}

export const PAYROLL_ACCOUNT_DEFAULT_CODES: Record<keyof PayrollAccounts, string> = {
  salary_expense_account_id: '6101',
  site_labour_account_id: '5102',
  employer_ssnit_account_id: '6101',
  paye_payable_account_id: '2103',
  ssnit_payable_account_id: '2104',
  other_deductions_account_id: '2106',
  bank_account_id: '1103',
  casual_wht_payable_account_id: '2102',
  casual_payment_account_id: '1101',
};

const NOT_AN_EXPENSE_ROLE = /payable|receivable|depreciat|cash on hand|bank/i;
const NOT_A_LIABILITY_ROLE = /receivable|cash|revenue|depreciat/i;
const NOT_CASH = /depreciat|receivable|inventory|equipment|vehicle|building|furniture|prepay|withholding|payable|vat input|staff advance/i;

/** Default codes are kept only when the account's stored name still matches the role. */
const PAYROLL_ACCOUNT_SPECS: Record<keyof PayrollAccounts, AccountSpec> = {
  salary_expense_account_id: {
    key: 'salary_expense', type: 'Expense', label: 'Salaries expense',
    nameHints: ['salaries – office', 'salaries - office', 'salaries & wages', 'salaries and wages', 'office staff', 'salaries'],
    codes: ['6101', '5105'], contradicts: NOT_AN_EXPENSE_ROLE, codePolicy: 'hint-only', prefer: 'code',
  },
  site_labour_account_id: {
    key: 'site_labour', type: 'Expense', label: 'Site labour',
    nameHints: ['labour – site', 'labour - site', 'site workers', 'direct labour', 'site labour', 'labour'],
    codes: ['5102', '5001'], contradicts: NOT_AN_EXPENSE_ROLE, codePolicy: 'hint-only', prefer: 'code',
  },
  employer_ssnit_account_id: {
    key: 'employer_ssnit', type: 'Expense', label: 'Employer SSNIT',
    nameHints: ['salaries – office', 'salaries - office', 'salaries & wages', 'salaries and wages', 'employer ssnit', 'ssnit expense', 'salaries'],
    codes: ['6101', '5105'], contradicts: NOT_AN_EXPENSE_ROLE, codePolicy: 'hint-only', prefer: 'code',
  },
  paye_payable_account_id: {
    key: 'paye_payable', type: 'Liability', label: 'PAYE payable',
    nameHints: ['paye payable', 'paye tax', 'paye'],
    codes: ['2103', '2004'], contradicts: NOT_A_LIABILITY_ROLE, codePolicy: 'hint-only', prefer: 'code',
  },
  ssnit_payable_account_id: {
    key: 'ssnit_payable', type: 'Liability', label: 'SSNIT payable',
    nameHints: ['ssnit payable', 'ssnit'],
    codes: ['2104', '2005'], contradicts: NOT_A_LIABILITY_ROLE, codePolicy: 'hint-only', prefer: 'code',
  },
  other_deductions_account_id: {
    key: 'other_deductions', type: 'Liability', label: 'Other payroll deductions',
    nameHints: ['accrued expenses', 'other deductions', 'accrued'],
    codes: ['2106', '2002'], contradicts: NOT_A_LIABILITY_ROLE, codePolicy: 'hint-only', prefer: 'code',
  },
  bank_account_id: {
    key: 'payroll_bank', type: 'Asset', label: 'Payroll bank',
    nameHints: ['bank – salary', 'bank - salary', 'salary account', 'bank –', 'bank -', 'bank'],
    codes: ['1103', '1102', '1002'], contradicts: NOT_CASH, codePolicy: 'hint-only', prefer: 'code',
  },
  casual_wht_payable_account_id: {
    key: 'casual_wht', type: 'Liability', label: 'Casual withholding tax',
    nameHints: ['withholding tax payable', 'withholding tax'],
    codes: ['2102'], contradicts: NOT_A_LIABILITY_ROLE, codePolicy: 'hint-only', prefer: 'code',
  },
  casual_payment_account_id: {
    key: 'casual_payment', type: 'Asset', label: 'Casual payment',
    nameHints: ['cash on hand', 'petty cash', 'mobile money', 'cash'],
    codes: ['1101', '1001'], contradicts: NOT_CASH, codePolicy: 'hint-or-safe', prefer: 'name',
  },
};

export const PAYROLL_ACCOUNT_LABELS: Record<keyof PayrollAccounts, string> = {
  salary_expense_account_id: 'Salaries expense (office staff)',
  site_labour_account_id: 'Site labour expense (project payroll and casual workers)',
  employer_ssnit_account_id: 'Employer SSNIT expense',
  paye_payable_account_id: 'PAYE payable',
  ssnit_payable_account_id: 'SSNIT payable',
  other_deductions_account_id: 'Other payroll deductions (loans, advances, ...)',
  bank_account_id: 'Bank / cash account salaries are paid from',
  casual_wht_payable_account_id: 'Casual workers withholding tax payable',
  casual_payment_account_id: 'Cash / mobile money account casual workers are paid from',
};

export async function loadPayrollConfig(conn: Conn): Promise<PayrollConfig> {
  const row = await conn('settings').where({ key: 'payroll_config' }).first();
  return normalisePayrollConfig(row?.value);
}

/**
 * Stored payroll account ids. A missing id is filled from the live chart only
 * when that account's name still matches the role, then saved so a later code
 * change cannot retarget the posting. A saved id is kept, including after the
 * company renames that account. Nothing in the chart is renamed.
 */
export async function loadPayrollAccounts(conn: Conn): Promise<PayrollAccounts> {
  const row = await conn('settings').where({ key: 'payroll_accounts' }).first();
  let stored: Record<string, any> = {};
  try { stored = row?.value ? JSON.parse(row.value) : {}; } catch { stored = {}; }
  const chart = await conn('chart_of_accounts').select('id', 'code', 'name', 'type');
  const byId = new Map(chart.map((a: any) => [Number(a.id), a]));
  const accounts = {} as PayrollAccounts;
  let changed = false;

  for (const key of Object.keys(PAYROLL_ACCOUNT_SPECS) as (keyof PayrollAccounts)[]) {
    const spec = PAYROLL_ACCOUNT_SPECS[key];
    const id = Number(stored[key]);
    const current = Number.isInteger(id) && id > 0 ? byId.get(id) : undefined;
    if (current && current.type === spec.type && !nameContradicts(current.name, spec.contradicts)) {
      accounts[key] = Number(current.id);
      continue;
    }
    const chosen = pickAccount(chart, spec);
    if (chosen) {
      accounts[key] = Number(chosen.id);
      if (Number(stored[key]) !== Number(chosen.id)) {
        stored[key] = Number(chosen.id);
        changed = true;
      }
    } else if (current) {
      accounts[key] = Number(current.id);
    } else {
      accounts[key] = null;
    }
  }

  if (changed) {
    const value = JSON.stringify(stored);
    if (row) await conn('settings').where({ key: 'payroll_accounts' }).update({ value, updated_at: conn.fn.now() });
    else await conn('settings').insert({ key: 'payroll_accounts', value });
  }
  return accounts;
}

export const parseItems = (value: unknown): PayItem[] => {
  let parsed: any = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { return []; }
  }
  return Array.isArray(parsed)
    ? parsed.map((i: any) => ({ type: String(i.type || i.name || 'Item'), amount: round2(i.amount), ...(i.taxable === false ? { taxable: false } : {}) }))
      .filter((i: PayItem) => i.amount !== 0)
    : [];
};

/** The statutory lines that computePay adds, so detailed_deductions shows the full breakdown. */
export function statutoryItems(pay: PayResult, config: PayrollConfig): PayItem[] {
  return [
    { type: `SSNIT employee (${config.ssnit_employee}%)`, amount: pay.ssnit_employee },
    { type: 'PAYE (income tax)', amount: pay.paye },
  ];
}

/** Column values for a payroll row from its inputs. */
export function payrollRowValues(input: { basic: number; allowances: PayItem[]; deductions: PayItem[] }, config: PayrollConfig) {
  const pay = computePay({ basic: input.basic, allowances: input.allowances, deductions: input.deductions }, config);
  return {
    pay,
    values: {
      base_salary: pay.basic,
      allowances: pay.allowances,
      gross: pay.gross,
      ssnit_employee: pay.ssnit_employee,
      ssnit_employer: pay.ssnit_employer,
      taxable_income: pay.taxable_income,
      paye: pay.paye,
      other_deductions: pay.other_deductions,
      deductions: pay.total_deductions,
      net_pay: pay.net_pay,
      detailed_allowances: JSON.stringify(input.allowances),
      detailed_deductions: JSON.stringify([...statutoryItems(pay, config), ...input.deductions]),
    },
  };
}

export interface ProjectShare { project_id: string | null; project_name?: string | null; days: number; overtime_hours: number; amount: number }

export const parseBreakdown = (value: unknown): ProjectShare[] => {
  let parsed: any = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { return []; }
  }
  return Array.isArray(parsed)
    ? parsed.map((p: any) => ({
      project_id: p.project_id ? String(p.project_id) : null, project_name: p.project_name ?? null,
      days: round2(p.days), overtime_hours: round2(p.overtime_hours), amount: round2(p.amount),
    }))
    : [];
};

/** Column values for a casual worker's payroll row: days x daily rate + overtime, then the worker's tax treatment. */
export function casualRowValues(input: {
  days: number; dailyRate: number; overtimeHours: number; overtimeRate: number; taxTreatment: TaxTreatment;
  allowances: PayItem[]; deductions: PayItem[];
}, config: PayrollConfig): { pay: CasualPayResult; values: Record<string, any> } {
  const pay = computeCasualPay(input, config);
  const statutory: PayItem[] = input.taxTreatment === 'paye'
    ? statutoryItems(pay, config)
    : input.taxTreatment === 'casual_wht' ? [{ type: casualWhtLabel(config), amount: pay.wht }] : [];
  return {
    pay,
    values: {
      pay_type: 'casual',
      days_worked: round2(input.days),
      daily_rate: round2(input.dailyRate),
      overtime_hours: round2(input.overtimeHours),
      overtime_rate: round2(input.overtimeRate),
      overtime_pay: pay.overtime_pay,
      tax_treatment: input.taxTreatment,
      base_salary: pay.basic,
      allowances: pay.allowances,
      gross: pay.gross,
      ssnit_employee: pay.ssnit_employee,
      ssnit_employer: pay.ssnit_employer,
      taxable_income: pay.taxable_income,
      paye: pay.paye,
      wht: pay.wht,
      other_deductions: pay.other_deductions,
      deductions: pay.total_deductions,
      net_pay: pay.net_pay,
      detailed_allowances: JSON.stringify(pay.allowance_items),
      detailed_deductions: JSON.stringify([...statutory, ...input.deductions]),
    },
  };
}

type Num = number | string | null | undefined;
interface PostablePayrollRow {
  id: number;
  base_salary: Num;
  allowances?: Num;
  gross?: Num;
  ssnit_employee?: Num;
  ssnit_employer?: Num;
  paye?: Num;
  wht?: Num;
  other_deductions?: Num;
  net_pay: Num;
  project_id?: string | null;
  pay_type?: string | null;
  project_breakdown?: unknown;
}

interface Bucket { expense: Map<number, number>; payment: Map<number, number>; er: number; ee: number; paye: number; wht: number; other: number }

const addTo = (map: Map<number, number>, key: number, amount: number) => map.set(key, round2((map.get(key) || 0) + amount));

/** Splits an amount over weights, rounding to the cent and giving the remainder to the last share. */
function allocate(amount: number, weights: number[]): number[] {
  const total = weights.reduce((s, w) => s + w, 0);
  let left = round2(amount);
  return weights.map((w, i) => {
    if (i === weights.length - 1) return left;
    const part = round2(amount * (total ? w / total : 1 / weights.length));
    left = round2(left - part);
    return part;
  });
}

/**
 * Posts payroll to the ledger, one journal per project so job costing picks up the labour:
 *   Dr salary / site labour expense (gross)   Dr employer SSNIT expense
 *   Cr bank or casual cash account (net)   Cr PAYE   Cr SSNIT (employee + employer)   Cr casual WHT   Cr other deductions
 * Casual workers and rows with a project charge site labour; the rest charge office salaries. A casual worker who
 * worked on several projects is split across them in proportion to the pay earned on each.
 * Returns the journal ids (the first is the one to store on the payroll row/run).
 */
export async function postPayroll(trx: Knex.Transaction, opts: {
  rows: PostablePayrollRow[];
  date: string | Date | null | undefined;
  description: string;
  referenceType: 'payroll' | 'payroll_run';
  referenceId: string | number;
  projectId?: string | null;
}): Promise<number[]> {
  if (opts.rows.length === 0) throw new LedgerError('There are no payroll entries to post');
  const accounts = await loadPayrollAccounts(trx);
  const hasCasual = opts.rows.some(r => r.pay_type === 'casual');
  const required = (Object.keys(PAYROLL_ACCOUNT_DEFAULT_CODES) as (keyof PayrollAccounts)[])
    .filter(k => hasCasual || !k.startsWith('casual_'));
  const missing = required.filter(k => !accounts[k]);
  if (missing.length) {
    throw new LedgerError(`Payroll accounts are not configured: ${missing.map(k => PAYROLL_ACCOUNT_LABELS[k]).join(', ')}. Set them under HR > Payroll > Settings.`);
  }

  const runProject = opts.projectId && opts.projectId !== 'none' ? opts.projectId : null;
  const buckets = new Map<string, Bucket>();
  const bucket = (project: string | null) => {
    const key = project ?? '';
    if (!buckets.has(key)) buckets.set(key, { expense: new Map(), payment: new Map(), er: 0, ee: 0, paye: 0, wht: 0, other: 0 });
    return buckets.get(key)!;
  };

  for (const row of opts.rows) {
    const casual = row.pay_type === 'casual';
    const gross = round2(row.gross ?? Number(row.base_salary) + Number(row.allowances || 0));
    const parts = { er: Number(row.ssnit_employer || 0), ee: Number(row.ssnit_employee || 0), paye: Number(row.paye || 0), wht: Number(row.wht || 0), other: Number(row.other_deductions || 0) };
    const shares = parseBreakdown(row.project_breakdown).filter(s => s.amount > 0);
    const targets = shares.length ? shares.map(s => s.project_id) : [row.project_id || runProject || null];
    const weights = shares.length ? shares.map(s => s.amount) : [1];
    const split = {
      gross: allocate(gross, weights), er: allocate(parts.er, weights), ee: allocate(parts.ee, weights),
      paye: allocate(parts.paye, weights), wht: allocate(parts.wht, weights), other: allocate(parts.other, weights),
    };
    targets.forEach((project, i) => {
      const b = bucket(project);
      const expenseAccount = casual || project ? accounts.site_labour_account_id! : accounts.salary_expense_account_id!;
      const paymentAccount = casual ? accounts.casual_payment_account_id! : accounts.bank_account_id!;
      addTo(b.expense, expenseAccount, split.gross[i]);
      addTo(b.payment, paymentAccount, round2(split.gross[i] - split.ee[i] - split.paye[i] - split.wht[i] - split.other[i]));
      b.er += split.er[i]; b.ee += split.ee[i]; b.paye += split.paye[i]; b.wht += split.wht[i]; b.other += split.other[i];
    });
  }

  const ids: number[] = [];
  for (const [key, b] of buckets) {
    const totalExpense = [...b.expense.values()].reduce((s, v) => s + v, 0);
    if (round2(totalExpense + b.er) === 0) continue;
    const lines: JournalLine[] = [
      ...[...b.expense].map(([account_id, debit]) => ({ account_id, debit, credit: 0 })),
      { account_id: accounts.employer_ssnit_account_id!, debit: round2(b.er), credit: 0 },
      ...[...b.payment].map(([account_id, credit]) => ({ account_id, debit: 0, credit })),
      { account_id: accounts.paye_payable_account_id!, debit: 0, credit: round2(b.paye) },
      { account_id: accounts.ssnit_payable_account_id!, debit: 0, credit: round2(b.ee + b.er) },
      { account_id: accounts.other_deductions_account_id!, debit: 0, credit: round2(b.other) },
      ...(b.wht ? [{ account_id: accounts.casual_wht_payable_account_id!, debit: 0, credit: round2(b.wht) }] : []),
    ];
    ids.push(await postJournal(trx, {
      date: opts.date,
      description: buckets.size > 1 ? `${opts.description} (${key ? `project ${key}` : 'no project'})` : opts.description,
      reference_type: opts.referenceType,
      reference_id: opts.referenceId,
      project_id: key || null,
      lines,
    }));
  }
  if (ids.length === 0) throw new LedgerError('Payroll total is zero; nothing to post');
  return ids;
}
