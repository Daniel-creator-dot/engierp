import * as XLSX from 'xlsx';
import { apiErrorMessage } from '../../../lib/api';
import { isStatutoryDeduction, PayItem } from '../../../lib/payrollCalc';
import type { Employee, ProjectShare, Setting } from './types';

export const errorMessage = apiErrorMessage;

export const HR_ADMIN_ROLES = ['admin', 'hr'];
export const PAYROLL_PREPARE_ROLES = ['admin', 'hr', 'accountant'];
export const PAYROLL_APPROVE_ROLES = ['admin', 'accountant'];
export const LEAVE_APPROVE_ROLES = ['admin', 'hr'];
export const ATTENDANCE_EDIT_ROLES = ['admin', 'hr', 'pm'];
export const ATTENDANCE_VIEW_ROLES = ['admin', 'hr', 'pm', 'accountant'];

export const EMPLOYMENT_TYPES = ['Permanent', 'Contract', 'Casual', 'Intern', 'National Service'];
export const FIXED_TERM_TYPES = ['Contract', 'Casual', 'Intern', 'National Service'];
export const LEAVE_TYPES = ['Annual', 'Sick', 'Casual', 'Study', 'Maternity', 'Paternity', 'Compassionate', 'Unpaid'];

export const getSetting = (settings: Setting[], key: string) => settings.find(s => s.key === key)?.value || '';

export const currencySymbol = (settings: Setting[]) => (getSetting(settings, 'currency') === 'USD' ? '$' : 'GH₵');

export const money = (value: unknown, symbol = 'GH₵') => {
  const n = Number(value) || 0;
  const digits = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 && Math.abs(n) >= 0.005 ? '-' : ''}${symbol}${symbol === '$' ? '' : ' '}${digits}`;
};

export const parseItems = (value: unknown): PayItem[] => {
  if (Array.isArray(value)) return value as PayItem[];
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((i: any) => ({ type: String(i.type || i.name || 'Item'), amount: Number(i.amount) || 0, taxable: i.taxable })) : [];
  } catch {
    return [];
  }
};

/** Deductions other than the statutory SSNIT/PAYE/withholding lines the server adds. */
export const otherDeductionItems = (value: unknown) => parseItems(value).filter(d => !isStatutoryDeduction(d.type));

export const parseBreakdown = (value: unknown): ProjectShare[] => {
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((p: any) => ({
      project_id: p.project_id ?? null, project_name: p.project_name ?? null,
      days: Number(p.days) || 0, overtime_hours: Number(p.overtime_hours) || 0, amount: Number(p.amount) || 0,
    })) : [];
  } catch {
    return [];
  }
};

export const WAGE_TYPE_LABELS: Record<string, string> = {
  Salaried: 'Salaried (monthly)',
  Hourly: 'Hourly',
  Daily: 'Daily-rated casual',
};
export const rateUnit = (wageType?: string | null) => wageType === 'Daily' ? '/day' : wageType === 'Hourly' ? '/hr' : '/month';

/** Rates that look like a monthly salary typed into an hourly or daily rate field. */
export function payRateWarning(emp: Pick<Employee, 'wage_type' | 'salary'>): string | null {
  const rate = Number(emp.salary) || 0;
  if (emp.wage_type === 'Hourly' && rate > 500) return `An hourly rate of ${rate.toLocaleString()} looks like a monthly salary`;
  if (emp.wage_type === 'Daily' && rate > 1000) return `A daily rate of ${rate.toLocaleString()} looks like a monthly salary`;
  if (emp.wage_type === 'Daily' && rate === 0) return 'No daily rate set';
  return null;
}

export const shortDate = (value: unknown) => {
  const s = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return new Date(`${s}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
export const periodText = (start: unknown, end: unknown) => {
  const s = String(start || '').slice(0, 10), e = String(end || '').slice(0, 10);
  return !e || s === e ? shortDate(s) : `${shortDate(s)} – ${shortDate(e)}`;
};

export const yearOptions = (around = new Date().getFullYear(), back = 3, forward = 1) =>
  Array.from({ length: back + forward + 1 }, (_, i) => around + forward - i);

/** Writes one or more sheets (arrays of rows, first row = headers) to an .xlsx download. */
export function downloadWorkbook(fileName: string, sheets: { name: string; rows: (string | number | null | undefined)[][] }[]) {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(sheet.rows);
    ws['!cols'] = (sheet.rows[0] || []).map((_, col) => ({
      wch: Math.min(40, Math.max(10, ...sheet.rows.map(r => String(r[col] ?? '').length + 2))),
    }));
    XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31));
  }
  XLSX.writeFile(wb, fileName);
}

export function downloadCsv(fileName: string, rows: (string | number | null | undefined)[][]) {
  const csv = rows.map(r => r.map(cell => {
    const s = String(cell ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/** Reads the first sheet of an .xlsx/.xls/.csv file into row objects keyed by the header row. */
export async function readSpreadsheet(file: File): Promise<Record<string, any>[]> {
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return ws ? XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '', raw: false, dateNF: 'yyyy-mm-dd' }) : [];
}
