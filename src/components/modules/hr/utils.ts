import * as XLSX from 'xlsx';
import { apiErrorMessage } from '../../../lib/api';
import { PayItem } from '../../../lib/payrollCalc';
import type { Setting } from './types';

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

export const money = (value: unknown, symbol = 'GH₵') =>
  `${symbol}${(Number(value) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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

/** Deductions other than the statutory SSNIT/PAYE lines the server adds. */
export const otherDeductionItems = (value: unknown) => parseItems(value).filter(d => !/^SSNIT employee|^PAYE/.test(d.type));

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
