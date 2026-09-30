import { PayrollConfig, round2 } from '../../../lib/payrollCalc';
import type { PayrollEntry } from './types';
import { downloadWorkbook, otherDeductionItems, parseItems } from './utils';

type Row = (string | number | null | undefined)[];

const n = (v: unknown) => Number(v) || 0;
const sum = (rows: PayrollEntry[], pick: (e: PayrollEntry) => number) => round2(rows.reduce((s, e) => s + pick(e), 0));
const period = (entries: PayrollEntry[]) => (entries[0] ? `${entries[0].month}_${entries[0].year}` : 'Payroll');

const taxableAllowances = (e: PayrollEntry) =>
  round2(Math.max(0, n(e.taxable_income) - n(e.base_salary) + n(e.ssnit_employee)));

/** SSNIT contribution report: Tier 1 goes to SSNIT, Tier 2 to the occupational trustee; both on basic pay. */
export function ssnitReport(entries: PayrollEntry[], config: PayrollConfig, company: string) {
  const header: Row = ['Staff ID', 'Name', 'SSNIT Number', 'Ghana Card', 'Basic Salary',
    `Employee (${config.ssnit_employee}%)`, `Employer (${config.ssnit_employer}%)`, 'Total Contribution',
    `Tier 1 (${config.ssnit_tier1}%)`, `Tier 2 (${config.ssnit_tier2}%)`];
  const rows = entries.map(e => {
    const basic = n(e.base_salary);
    return [e.employee_id, e.name, e.employee_ssnit || 'MISSING', e.employee_ghana_card || '', basic,
      n(e.ssnit_employee), n(e.ssnit_employer), round2(n(e.ssnit_employee) + n(e.ssnit_employer)),
      round2(basic * config.ssnit_tier1 / 100), round2(basic * config.ssnit_tier2 / 100)];
  });
  const totals: Row = ['', 'TOTAL', '', '', sum(entries, e => n(e.base_salary)), sum(entries, e => n(e.ssnit_employee)),
    sum(entries, e => n(e.ssnit_employer)), sum(entries, e => n(e.ssnit_employee) + n(e.ssnit_employer)),
    sum(entries, e => n(e.base_salary) * config.ssnit_tier1 / 100), sum(entries, e => n(e.base_salary) * config.ssnit_tier2 / 100)];
  const title = `${company} - SSNIT contributions ${period(entries).replace('_', ' ')}`;
  downloadWorkbook(`SSNIT_${period(entries)}.xlsx`, [{ name: 'SSNIT', rows: [[title], [], header, ...rows, totals] }]);
  return entries.filter(e => !e.employee_ssnit).length;
}

/** GRA monthly PAYE schedule. */
export function payeSchedule(entries: PayrollEntry[], company: string) {
  const header: Row = ['Staff ID', 'Name', 'Ghana Card / TIN', 'Position', 'Basic Salary', 'Taxable Allowances',
    'Non-taxable Allowances', 'Gross Pay', 'SSNIT Relief (Employee)', 'Chargeable Income', 'PAYE Deducted'];
  const rows = entries.map(e => {
    const taxable = taxableAllowances(e);
    return [e.employee_id, e.name, e.employee_ghana_card || '', e.employee_role || '', n(e.base_salary), taxable,
      round2(Math.max(0, n(e.allowances) - taxable)), n(e.gross), n(e.ssnit_employee), n(e.taxable_income), n(e.paye)];
  });
  const totals: Row = ['', 'TOTAL', '', '', sum(entries, e => n(e.base_salary)), sum(entries, taxableAllowances),
    sum(entries, e => Math.max(0, n(e.allowances) - taxableAllowances(e))), sum(entries, e => n(e.gross)),
    sum(entries, e => n(e.ssnit_employee)), sum(entries, e => n(e.taxable_income)), sum(entries, e => n(e.paye))];
  const title = `${company} - PAYE schedule ${period(entries).replace('_', ' ')}`;
  downloadWorkbook(`PAYE_${period(entries)}.xlsx`, [{ name: 'PAYE', rows: [[title], [], header, ...rows, totals] }]);
}

/** Salary transfer file for the bank. Staff without bank details are listed on a second sheet. */
export function bankPaymentFile(entries: PayrollEntry[], paymentDate?: string | null) {
  const ready = entries.filter(e => e.bank_name && e.account_number && n(e.net_pay) > 0);
  const missing = entries.filter(e => !ready.includes(e));
  const narration = entries[0] ? `Salary ${entries[0].month} ${entries[0].year}` : 'Salary';
  const sheets = [{
    name: 'Payments',
    rows: [
      ['Staff ID', 'Beneficiary Name', 'Bank', 'Branch', 'Account Number', 'Amount (GHS)', 'Narration', 'Payment Date'] as Row,
      ...ready.map(e => [e.employee_id, e.account_name || e.name, e.bank_name, e.branch || '', String(e.account_number), n(e.net_pay), narration, paymentDate || e.payment_date?.slice(0, 10) || '']),
      ['', 'TOTAL', '', '', '', sum(ready, e => n(e.net_pay)), '', ''] as Row,
    ],
  }];
  if (missing.length) {
    sheets.push({
      name: 'Missing bank details',
      rows: [['Staff ID', 'Name', 'Net Pay'] as Row, ...missing.map(e => [e.employee_id, e.name, n(e.net_pay)])],
    });
  }
  downloadWorkbook(`Bank_Payments_${period(entries)}.xlsx`, sheets);
  return missing.length;
}

/** Full payroll register with every earning and deduction line. */
export function payrollRegister(entries: PayrollEntry[]) {
  const allowanceTypes = Array.from(new Set(entries.flatMap(e => parseItems(e.detailed_allowances).map(a => a.type))));
  const deductionTypes = Array.from(new Set(entries.flatMap(e => otherDeductionItems(e.detailed_deductions).map(d => d.type))));
  const header: Row = ['Staff ID', 'Name', 'Department', 'Wage Type', 'Hours', 'Overtime Hours', 'Basic',
    ...allowanceTypes, 'Gross', 'SSNIT Employee', 'PAYE', ...deductionTypes, 'Total Deductions', 'Net Pay', 'SSNIT Employer', 'Status'];
  const rows = entries.map(e => {
    const allowances = parseItems(e.detailed_allowances);
    const deductions = otherDeductionItems(e.detailed_deductions);
    const amount = (items: { type: string; amount: number }[], type: string) => round2(items.filter(i => i.type === type).reduce((s, i) => s + n(i.amount), 0));
    return [e.employee_id, e.name, e.department || '', e.wage_type || '', e.hours_worked ?? '', e.overtime_hours ?? '', n(e.base_salary),
      ...allowanceTypes.map(t => amount(allowances, t)), n(e.gross), n(e.ssnit_employee), n(e.paye),
      ...deductionTypes.map(t => amount(deductions, t)), n(e.deductions), n(e.net_pay), n(e.ssnit_employer), e.status];
  });
  downloadWorkbook(`Payroll_Register_${period(entries)}.xlsx`, [{ name: 'Register', rows: [header, ...rows] }]);
}
