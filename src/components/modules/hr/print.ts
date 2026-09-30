import { escapeHtml as esc } from '../../../lib/html';
import { formatDate } from '../../../lib/dates';
import type { PayrollEntry, Setting } from './types';
import { getSetting, money, otherDeductionItems, parseItems } from './utils';

interface PrintOptions {
  title: string;
  bodyHtml: string;        // already escaped by the caller
  settings: Setting[];
  docNumber: string;
  printedBy?: string;
}

// Only data: URLs are allowed for the logo/signature so a stored value can't point the print window elsewhere.
const safeImage = (value: string) => (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(value) ? value : '');

export function printDocument({ title, bodyHtml, settings, docNumber, printedBy }: PrintOptions) {
  const setting = (key: string) => getSetting(settings, key);
  const logo = safeImage(setting('company_logo'));
  const signature = safeImage(setting('company_signature'));
  const companyName = setting('company_name') || 'ENGINEERING ERP';
  const win = window.open('', '_blank');
  if (!win) return false;

  win.document.write(`<!doctype html>
    <html>
      <head>
        <title>${esc(title)}</title>
        <style>
          body { font-family: 'Inter', Arial, sans-serif; padding: 40px; color: #141414; line-height: 1.5; }
          .header { border-bottom: 2px solid #141414; padding-bottom: 20px; margin-bottom: 32px; }
          .logo-container { text-align: center; margin-bottom: 24px; }
          .logo { max-height: 110px; max-width: 380px; }
          .meta-header { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; }
          table.grid { width: 100%; border-collapse: collapse; margin-top: 12px; }
          table.grid td, table.grid th { padding: 8px 10px; border: 1px solid #E4E3E0; text-align: left; font-size: 0.9rem; }
          table.grid th { background: #F5F5F5; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; }
          td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
          tr.total td { font-weight: bold; border-top: 2px solid #141414; }
          h3 { margin: 28px 0 6px; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.06em; }
          .footer { margin-top: 56px; border-top: 1px solid #E4E3E0; padding-top: 20px; }
          .footer-grid { display: flex; justify-content: space-between; align-items: flex-end; }
          .signature { max-height: 60px; }
          .doc-meta { text-align: right; color: #6B7280; font-size: 0.75rem; }
          .footer-note { margin-top: 24px; padding: 16px; background: #F5F5F5; border-radius: 12px; font-size: 0.85rem; text-align: center; font-style: italic; color: #4B5563; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="logo-container">
            ${logo ? `<img src="${logo}" class="logo" />` : `<h1>${esc(companyName)}</h1>`}
          </div>
          <div class="meta-header">
            <div>
              <strong>${esc(companyName)}</strong><br/>
              ${esc(setting('company_address'))}
              ${setting('company_tin') ? `<br/>TIN: ${esc(setting('company_tin'))}` : ''}
            </div>
            <div style="text-align: right">
              <h2 style="margin: 0">${esc(title)}</h2>
              <p style="margin: 4px 0 0">No. ${esc(docNumber)}</p>
            </div>
          </div>
        </div>
        ${bodyHtml}
        <div class="footer">
          <div class="footer-grid">
            <div>
              <p>Authorized Signature</p>
              ${signature ? `<img src="${signature}" class="signature" />` : '<div style="height: 60px; width: 200px; border-bottom: 1px solid #000;"></div>'}
            </div>
            <div class="doc-meta">
              <p>Document ${esc(docNumber)}</p>
              <p>Printed ${esc(new Date().toLocaleString())}${printedBy ? ` by ${esc(printedBy)}` : ''}</p>
            </div>
          </div>
          ${setting('company_footer_note') ? `<div class="footer-note">${esc(setting('company_footer_note'))}</div>` : ''}
        </div>
      </body>
    </html>`);
  win.document.close();
  setTimeout(() => win.print(), 500);
  return true;
}

const row = (label: string, value: string, cls = '') => `<tr class="${cls}"><td>${esc(label)}</td><td class="num">${esc(value)}</td></tr>`;

export const payslipNumber = (p: PayrollEntry) => `PS-${p.year}-${String(p.id).padStart(5, '0')}`;
export const voucherNumber = (p: PayrollEntry) => `PV-${p.year}-${String(p.id).padStart(5, '0')}`;

export function payslipHtml(p: PayrollEntry, symbol = 'GH₵') {
  const allowances = parseItems(p.detailed_allowances);
  const deductions = otherDeductionItems(p.detailed_deductions);
  const gross = p.gross ?? Number(p.base_salary) + Number(p.allowances || 0);
  const hours = p.hours_worked != null && Number(p.hours_worked) > 0
    ? `<tr><th>Hours worked</th><td>${esc(Number(p.hours_worked))}${Number(p.overtime_hours) ? ` + ${esc(Number(p.overtime_hours))} overtime` : ''}</td></tr>` : '';
  return `
    <table class="grid">
      <tr><th>Employee</th><td>${esc(p.name)}</td><th>Employee ID</th><td>${esc(p.employee_id)}</td></tr>
      <tr><th>Department</th><td>${esc(p.department || '')}</td><th>Position</th><td>${esc(p.employee_role || '')}</td></tr>
      <tr><th>SSNIT No.</th><td>${esc(p.employee_ssnit || 'Not recorded')}</td><th>Pay period</th><td>${esc(`${p.month} ${p.year}`)}</td></tr>
      <tr><th>Bank</th><td>${esc([p.bank_name, p.branch].filter(Boolean).join(', ') || 'Not recorded')}</td><th>Account No.</th><td>${esc(p.account_number || 'Not recorded')}</td></tr>
      ${hours}
    </table>
    <h3>Earnings</h3>
    <table class="grid">
      ${row('Basic pay', money(p.base_salary, symbol))}
      ${allowances.map(a => row(`${a.type}${a.taxable === false ? ' (non-taxable)' : ''}`, money(a.amount, symbol))).join('')}
      ${row('Gross pay', money(gross, symbol), 'total')}
    </table>
    <h3>Deductions</h3>
    <table class="grid">
      ${row('SSNIT employee contribution', money(p.ssnit_employee, symbol))}
      ${row(`PAYE income tax (taxable income ${money(p.taxable_income, symbol)})`, money(p.paye, symbol))}
      ${deductions.map(d => row(d.type, money(d.amount, symbol))).join('')}
      ${row('Total deductions', money(p.deductions, symbol), 'total')}
    </table>
    <h3>Net pay</h3>
    <table class="grid">
      ${row('Net pay', money(p.net_pay, symbol), 'total')}
      ${row('Employer SSNIT contribution (not deducted from pay)', money(p.ssnit_employer, symbol))}
    </table>`;
}

export function voucherHtml(p: PayrollEntry, symbol = 'GH₵') {
  return `
    <table class="grid">
      <tr><th>Payee</th><td>${esc(p.name)} (${esc(p.employee_id)})</td><th>Voucher No.</th><td>${esc(voucherNumber(p))}</td></tr>
      <tr><th>Period</th><td>${esc(`${p.month} ${p.year}`)}</td><th>Payment date</th><td>${esc(formatDate(p.payment_date || p.paid_at || undefined, 'Not set'))}</td></tr>
      <tr><th>Pay to</th><td colspan="3">${esc([p.bank_name, p.branch, p.account_name, p.account_number].filter(Boolean).join(' / ') || 'Bank details not recorded')}</td></tr>
    </table>
    <h3>Authorization</h3>
    <p>Being payment of salary for ${esc(`${p.month} ${p.year}`)}.</p>
    <table class="grid">
      ${row('Gross pay', money(p.gross ?? p.base_salary, symbol))}
      ${row('Total deductions', `(${money(p.deductions, symbol)})`)}
      ${row('Net amount to disburse', money(p.net_pay, symbol), 'total')}
    </table>
    <div style="margin-top: 56px; display: flex; gap: 40px;">
      <div style="flex: 1; border-top: 1px solid #141414; padding-top: 8px; text-align: center; font-size: 0.8rem; font-weight: bold;">PREPARED BY</div>
      <div style="flex: 1; border-top: 1px solid #141414; padding-top: 8px; text-align: center; font-size: 0.8rem; font-weight: bold;">APPROVED BY</div>
      <div style="flex: 1; border-top: 1px solid #141414; padding-top: 8px; text-align: center; font-size: 0.8rem; font-weight: bold;">RECEIVED BY</div>
    </div>`;
}
