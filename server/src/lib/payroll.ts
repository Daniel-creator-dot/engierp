import type { Knex } from 'knex';
import { Conn, LedgerError, JournalLine, postJournal, round2 } from './ledger';
import {
  computePay, normalisePayrollConfig, PayItem, PayrollConfig, PayResult,
} from '../../../src/lib/payrollCalc';

export { computePay, normalisePayrollConfig };
export type { PayItem, PayrollConfig, PayResult };

export interface PayrollAccounts {
  salary_expense_account_id: number | null;
  site_labour_account_id: number | null;
  employer_ssnit_account_id: number | null;
  paye_payable_account_id: number | null;
  ssnit_payable_account_id: number | null;
  other_deductions_account_id: number | null;
  bank_account_id: number | null;
}

export const PAYROLL_ACCOUNT_DEFAULT_CODES: Record<keyof PayrollAccounts, string> = {
  salary_expense_account_id: '6101',
  site_labour_account_id: '5102',
  employer_ssnit_account_id: '6101',
  paye_payable_account_id: '2103',
  ssnit_payable_account_id: '2104',
  other_deductions_account_id: '2106',
  bank_account_id: '1103',
};

export const PAYROLL_ACCOUNT_LABELS: Record<keyof PayrollAccounts, string> = {
  salary_expense_account_id: 'Salaries expense (office staff)',
  site_labour_account_id: 'Site labour expense (project payroll)',
  employer_ssnit_account_id: 'Employer SSNIT expense',
  paye_payable_account_id: 'PAYE payable',
  ssnit_payable_account_id: 'SSNIT payable',
  other_deductions_account_id: 'Other payroll deductions (loans, advances, ...)',
  bank_account_id: 'Bank / cash account salaries are paid from',
};

export async function loadPayrollConfig(conn: Conn): Promise<PayrollConfig> {
  const row = await conn('settings').where({ key: 'payroll_config' }).first();
  return normalisePayrollConfig(row?.value);
}

/** Stored mapping, with any missing account resolved from the default code in the live chart of accounts. */
export async function loadPayrollAccounts(conn: Conn): Promise<PayrollAccounts> {
  const row = await conn('settings').where({ key: 'payroll_accounts' }).first();
  let stored: Record<string, any> = {};
  try { stored = row?.value ? JSON.parse(row.value) : {}; } catch { stored = {}; }
  const accounts = {} as PayrollAccounts;
  for (const key of Object.keys(PAYROLL_ACCOUNT_DEFAULT_CODES) as (keyof PayrollAccounts)[]) {
    const id = Number(stored[key]);
    if (Number.isInteger(id) && id > 0) {
      accounts[key] = id;
    } else {
      const account = await conn('chart_of_accounts').where({ code: PAYROLL_ACCOUNT_DEFAULT_CODES[key] }).first();
      accounts[key] = account ? account.id : null;
    }
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

interface PostablePayrollRow {
  id: number;
  base_salary: number | string;
  allowances?: number | string | null;
  gross?: number | string | null;
  ssnit_employee?: number | string | null;
  ssnit_employer?: number | string | null;
  paye?: number | string | null;
  other_deductions?: number | string | null;
  net_pay: number | string;
  project_id?: string | null;
}

/**
 * Posts payroll to the ledger as one journal:
 *   Dr salary / site labour expense (gross)   Dr employer SSNIT expense
 *   Cr bank (net)   Cr PAYE payable   Cr SSNIT payable (employee + employer)   Cr other deductions
 * Rows with a project (or a run-level project) charge site labour; the rest charge office salaries.
 */
export async function postPayroll(trx: Knex.Transaction, opts: {
  rows: PostablePayrollRow[];
  date: string | Date | null | undefined;
  description: string;
  referenceType: 'payroll' | 'payroll_run';
  referenceId: string | number;
  projectId?: string | null;
}): Promise<number> {
  if (opts.rows.length === 0) throw new LedgerError('There are no payroll entries to post');
  const accounts = await loadPayrollAccounts(trx);
  const missing = (Object.keys(PAYROLL_ACCOUNT_DEFAULT_CODES) as (keyof PayrollAccounts)[]).filter(k => !accounts[k]);
  if (missing.length) {
    throw new LedgerError(`Payroll accounts are not configured: ${missing.map(k => PAYROLL_ACCOUNT_LABELS[k]).join(', ')}. Set them under HR > Payroll > Settings.`);
  }

  const runProject = opts.projectId && opts.projectId !== 'none' ? opts.projectId : null;
  const expense = new Map<number, number>();
  let employerSsnit = 0, net = 0, paye = 0, ssnit = 0, other = 0;
  for (const row of opts.rows) {
    const gross = round2(row.gross ?? Number(row.base_salary) + Number(row.allowances || 0));
    const account = (row.project_id || runProject) ? accounts.site_labour_account_id! : accounts.salary_expense_account_id!;
    expense.set(account, round2((expense.get(account) || 0) + gross));
    employerSsnit += Number(row.ssnit_employer || 0);
    net += Number(row.net_pay || 0);
    paye += Number(row.paye || 0);
    ssnit += Number(row.ssnit_employee || 0) + Number(row.ssnit_employer || 0);
    other += Number(row.other_deductions || 0);
  }

  const lines: JournalLine[] = [
    ...[...expense].map(([account_id, debit]) => ({ account_id, debit, credit: 0 })),
    { account_id: accounts.employer_ssnit_account_id!, debit: round2(employerSsnit), credit: 0 },
    { account_id: accounts.bank_account_id!, debit: 0, credit: round2(net) },
    { account_id: accounts.paye_payable_account_id!, debit: 0, credit: round2(paye) },
    { account_id: accounts.ssnit_payable_account_id!, debit: 0, credit: round2(ssnit) },
    { account_id: accounts.other_deductions_account_id!, debit: 0, credit: round2(other) },
  ];

  const singleProject = runProject ?? (() => {
    const projects = new Set(opts.rows.map(r => r.project_id || null));
    return projects.size === 1 ? [...projects][0] : null;
  })();

  return postJournal(trx, {
    date: opts.date,
    description: opts.description,
    reference_type: opts.referenceType,
    reference_id: opts.referenceId,
    project_id: singleProject,
    lines,
  });
}
