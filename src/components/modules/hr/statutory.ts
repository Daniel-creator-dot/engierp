import { PayrollConfig, round2 } from '../../../lib/payrollCalc';
import type { PayrollEntry, Setting } from './types';
import { downloadWorkbook, getSetting, otherDeductionItems, parseBreakdown, parseItems, periodText } from './utils';

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

const payeRows = (entries: PayrollEntry[], title: string): Row[] => {
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
  return [[title], [], header, ...rows, totals];
};

/** GRA monthly PAYE schedule. */
export function payeSchedule(entries: PayrollEntry[], company: string) {
  const title = `${company} - PAYE schedule ${period(entries).replace('_', ' ')}`;
  downloadWorkbook(`PAYE_${period(entries)}.xlsx`, [{ name: 'PAYE', rows: payeRows(entries, title) }]);
}

// ---------------------------------------------------------------- Casual workers

const isCasual = (e: PayrollEntry) => e.pay_type === 'casual';
const entryPeriod = (e: PayrollEntry) => isCasual(e) ? periodText(e.period_start, e.period_end) : `${e.month} ${e.year}`;
const fileLabel = (label: string) => label.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');

const casualWhtRows = (entries: PayrollEntry[], title: string): Row[] => {
  const rows = entries.filter(e => n(e.wht) > 0);
  const header: Row = ['Worker ID', 'Name', 'Ghana Card / TIN', 'Phone', 'Pay Period', 'Days Worked', 'Gross Pay', 'WHT Rate', 'WHT Deducted (final)'];
  return [
    [title], [],
    header,
    ...rows.map(e => [e.employee_id, e.name, e.employee_ghana_card || '', e.employee_phone || '', entryPeriod(e), n(e.days_worked), n(e.gross),
      n(e.gross) ? `${round2(n(e.wht) / n(e.gross) * 100)}%` : '', n(e.wht)]),
    ['', 'TOTAL', '', '', '', sum(rows, e => n(e.days_worked)), sum(rows, e => n(e.gross)), '', sum(rows, e => n(e.wht))],
  ];
};

/** Cash / mobile money pay sheet for a casual run, with a column for each worker to sign or thumbprint. */
export function casualPaymentSheet(entries: PayrollEntry[], label: string, company: string) {
  const header: Row = ['#', 'Worker ID', 'Name', 'Phone (MoMo)', 'Days', 'OT Hours', 'Daily Rate', 'Gross', 'WHT', 'Other Deductions', 'Net Pay', 'Paid By (Cash / MoMo)', 'Signature / Thumbprint'];
  const rows = entries.map((e, i) => [i + 1, e.employee_id, e.name, e.employee_phone || '', n(e.days_worked), n(e.overtime_hours), n(e.daily_rate),
    n(e.gross), n(e.wht), n(e.other_deductions), n(e.net_pay), '', '']);
  const totals: Row = ['', '', 'TOTAL', '', sum(entries, e => n(e.days_worked)), sum(entries, e => n(e.overtime_hours)), '',
    sum(entries, e => n(e.gross)), sum(entries, e => n(e.wht)), sum(entries, e => n(e.other_deductions)), sum(entries, e => n(e.net_pay)), '', ''];
  const noPhone = entries.filter(e => !e.employee_phone).length;
  downloadWorkbook(`Casual_Pay_Sheet_${fileLabel(label)}.xlsx`, [{
    name: 'Pay sheet',
    rows: [[`${company} - Casual workers pay sheet ${label}`], [], header, ...rows, totals, [], ['Prepared by:', '', '', 'Approved by:', '', '', '', 'Paid by:']],
  }]);
  return noPhone;
}

/** Labour cost by project for casual pay, split the same way the ledger posting splits it. */
export function casualLabourReport(entries: PayrollEntry[], label: string, company: string) {
  const byProject = new Map<string, { name: string; workers: Set<string>; days: number; overtime: number; cost: number }>();
  const detail: Row[] = [];
  for (const e of entries) {
    const shares = parseBreakdown(e.project_breakdown).filter(s => s.amount > 0 || s.days > 0 || s.overtime_hours > 0);
    const list = shares.length ? shares : [{ project_id: e.project_id || null, project_name: null, days: n(e.days_worked), overtime_hours: n(e.overtime_hours), amount: n(e.gross) }];
    const weight = list.reduce((s, x) => s + x.amount, 0);
    list.forEach(s => {
      const cost = round2(weight ? n(e.gross) * s.amount / weight : n(e.gross) / list.length);
      const key = s.project_id || '';
      const p = byProject.get(key) || { name: s.project_name || s.project_id || 'No project (general)', workers: new Set<string>(), days: 0, overtime: 0, cost: 0 };
      p.workers.add(e.employee_id); p.days += s.days; p.overtime += s.overtime_hours; p.cost += cost;
      byProject.set(key, p);
      detail.push([s.project_id || '', s.project_name || '', e.employee_id, e.name, entryPeriod(e), s.days, s.overtime_hours, cost]);
    });
  }
  const projects = [...byProject.entries()].sort((a, b) => b[1].cost - a[1].cost);
  downloadWorkbook(`Casual_Labour_Cost_${fileLabel(label)}.xlsx`, [
    {
      name: 'By project',
      rows: [
        [`${company} - Casual labour cost by project ${label}`], [],
        ['Project', 'Project Name', 'Workers', 'Days', 'OT Hours', 'Labour Cost (gross)'],
        ...projects.map(([id, p]) => [id, p.name, p.workers.size, round2(p.days), round2(p.overtime), round2(p.cost)]),
        ['', 'TOTAL', new Set(entries.map(e => e.employee_id)).size, round2(projects.reduce((s, [, p]) => s + p.days, 0)),
          round2(projects.reduce((s, [, p]) => s + p.overtime, 0)), round2(projects.reduce((s, [, p]) => s + p.cost, 0))],
      ],
    },
    { name: 'Detail', rows: [['Project', 'Project Name', 'Worker ID', 'Name', 'Period', 'Days', 'OT Hours', 'Cost'], ...detail] },
  ]);
}

/** Withholding tax schedule for one casual run. */
export function casualWhtSchedule(entries: PayrollEntry[], label: string, company: string) {
  downloadWorkbook(`Casual_WHT_${fileLabel(label)}.xlsx`, [{ name: 'Casual WHT', rows: casualWhtRows(entries, `${company} - Casual workers withholding tax ${label}`) }]);
}

/** GRA monthly return: PAYE for staff, and casual workers' final withholding tax as its own schedule. */
export function graMonthlyReturn(entries: PayrollEntry[], label: string, settings: Setting[]) {
  const company = getSetting(settings, 'company_name') || 'Company';
  const tin = getSetting(settings, 'company_tin');
  const paye = entries.filter(e => !isCasual(e) || n(e.paye) > 0);
  const casual = entries.filter(e => isCasual(e) && n(e.wht) > 0);
  const totalPaye = sum(paye, e => n(e.paye));
  const totalWht = sum(casual, e => n(e.wht));
  downloadWorkbook(`GRA_Return_${fileLabel(label)}.xlsx`, [
    {
      name: 'Summary',
      rows: [
        [`${company} - GRA monthly return ${label}`], [`Employer TIN: ${tin || 'not set (Settings > Company)'}`], [],
        ['Schedule', 'Employees', 'Gross Pay', 'Tax Deducted'],
        ['PAYE (staff)', paye.length, sum(paye, e => n(e.gross)), totalPaye],
        ['Casual workers final withholding tax', casual.length, sum(casual, e => n(e.gross)), totalWht],
        ['TOTAL TO REMIT', paye.length + casual.length, sum([...paye, ...casual], e => n(e.gross)), round2(totalPaye + totalWht)],
      ],
    },
    { name: 'PAYE', rows: payeRows(paye, `${company} - PAYE schedule ${label}`) },
    { name: 'Casual WHT', rows: casualWhtRows(casual, `${company} - Casual workers withholding tax ${label}`) },
  ]);
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
