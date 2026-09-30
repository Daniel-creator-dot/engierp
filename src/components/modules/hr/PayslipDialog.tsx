import React from 'react';
import { Printer } from 'lucide-react';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../ui/dialog';
import { useAuth } from '../../../contexts/AuthContext';
import { formatDate } from '../../../lib/dates';
import type { PayrollEntry, Setting } from './types';
import { payslipHtml, payslipNumber, printDocument, voucherHtml, voucherNumber } from './print';
import { currencySymbol, money, otherDeductionItems, parseBreakdown, parseItems, periodText } from './utils';

export const payrollStatusClass = (status: string) =>
  status === 'Paid' ? 'bg-green-100 text-green-700'
    : status === 'Approved' ? 'bg-blue-100 text-blue-700'
      : status === 'Rejected' || status === 'Cancelled' ? 'bg-red-100 text-red-700'
        : status === 'Reviewed' ? 'bg-purple-100 text-purple-700'
          : 'bg-yellow-100 text-yellow-700';

const periodOf = (p: PayrollEntry) => p.pay_type === 'casual' ? periodText(p.period_start, p.period_end) : `${p.month} ${p.year}`;

export function printPayslip(p: PayrollEntry, settings: Setting[], printedBy?: string) {
  printDocument({
    title: `${p.pay_type === 'casual' ? 'Casual pay slip' : 'Payslip'} - ${periodOf(p)}`,
    bodyHtml: payslipHtml(p, currencySymbol(settings)), settings, docNumber: payslipNumber(p), printedBy,
  });
}

export function printVoucher(p: PayrollEntry, settings: Setting[], printedBy?: string) {
  printDocument({ title: 'Payment Voucher', bodyHtml: voucherHtml(p, currencySymbol(settings)), settings, docNumber: voucherNumber(p), printedBy });
}

export default function PayslipDialog({ entry, settings, onClose, showVoucher }: {
  entry: PayrollEntry | null;
  settings: Setting[];
  onClose: () => void;
  showVoucher?: boolean;
}) {
  const { user } = useAuth();
  const symbol = currencySymbol(settings);
  if (!entry) return null;
  const casual = entry.pay_type === 'casual';
  const allowances = parseItems(entry.detailed_allowances).filter(a => !casual || !/^Overtime/i.test(a.type));
  const deductions = otherDeductionItems(entry.detailed_deductions);
  const gross = entry.gross ?? Number(entry.base_salary) + Number(entry.allowances || 0);
  const row = (label: string, value: unknown, cls = '') => (
    <div className={`flex justify-between py-1 ${cls}`}><span>{label}</span><span className="font-mono">{money(value, symbol)}</span></div>
  );
  const info = (label: string, value: React.ReactNode) => (
    <div><p className="text-[10px] font-bold uppercase text-[#8E9299]">{label}</p><p className="font-medium text-sm">{value || '—'}</p></div>
  );

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">{entry.name} <Badge className={payrollStatusClass(entry.status)}>{entry.status}</Badge></DialogTitle>
          <DialogDescription>{payslipNumber(entry)} · {periodOf(entry)}{entry.payment_date ? ` · paid ${formatDate(entry.payment_date)}` : ''}</DialogDescription>
        </DialogHeader>
        {casual ? (
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 p-3 bg-[#F5F5F5] rounded-xl">
            {info('Worker ID', <span className="font-mono">{entry.employee_id}</span>)}
            {info('Phone', entry.employee_phone)}
            {info('Tax', entry.tax_treatment === 'paye' ? 'PAYE + SSNIT' : entry.tax_treatment === 'none' ? 'Exempt' : 'Final withholding tax')}
          </div>
          {parseBreakdown(entry.project_breakdown).length > 0 && (
            <p className="text-xs text-[#8E9299]">
              {parseBreakdown(entry.project_breakdown).map(s => `${s.project_name || s.project_id || 'General'}: ${s.days} day(s)${s.overtime_hours ? ` + ${s.overtime_hours} h OT` : ''}`).join(' · ')}
            </p>
          )}
          <div className="text-sm">
            <p className="text-[10px] font-bold uppercase text-[#8E9299] mb-1">Earnings</p>
            {row(`${Number(entry.days_worked) || 0} day(s) × ${money(entry.daily_rate, symbol)}`, entry.base_salary)}
            {Number(entry.overtime_hours) > 0 && row(`Overtime ${Number(entry.overtime_hours)} h × ${money(entry.overtime_rate, symbol)}`, entry.overtime_pay)}
            {allowances.map((a, i) => <React.Fragment key={i}>{row(a.type, a.amount)}</React.Fragment>)}
            {row('Gross pay', gross, 'font-bold border-t')}
          </div>
          <div className="text-sm">
            <p className="text-[10px] font-bold uppercase text-[#8E9299] mb-1">Deductions</p>
            {Number(entry.wht) > 0 && row('Withholding tax (final)', entry.wht, 'text-red-600')}
            {Number(entry.ssnit_employee) > 0 && row('SSNIT employee', entry.ssnit_employee, 'text-red-600')}
            {Number(entry.paye) > 0 && row('PAYE', entry.paye, 'text-red-600')}
            {deductions.map((d, i) => <React.Fragment key={i}>{row(d.type, d.amount, 'text-red-600')}</React.Fragment>)}
            {row('Total deductions', entry.deductions ?? 0, 'font-bold border-t text-red-600')}
          </div>
          {row('Net pay', entry.net_pay, 'text-lg font-black border-t-2 border-[#141414] pt-2 text-green-700')}
          {entry.notes && <p className="text-xs text-[#8E9299]">Note: {entry.notes}</p>}
        </div>
        ) : (
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 p-3 bg-[#F5F5F5] rounded-xl">
            {info('Staff ID', <span className="font-mono">{entry.employee_id}</span>)}
            {info('Department', entry.department)}
            {info('SSNIT No.', entry.employee_ssnit || <span className="text-red-600">Missing</span>)}
            {info('Bank', entry.bank_name)}
            {info('Account', entry.account_number ? <span className="font-mono">{entry.account_number}</span> : null)}
            {info('Branch', entry.branch)}
          </div>
          {entry.hours_worked != null && (
            <p className="text-xs text-[#8E9299]">{Number(entry.hours_worked)} hours worked{Number(entry.overtime_hours) ? ` + ${Number(entry.overtime_hours)} overtime hours` : ''}</p>
          )}
          <div className="text-sm">
            <p className="text-[10px] font-bold uppercase text-[#8E9299] mb-1">Earnings</p>
            {row('Basic', entry.base_salary)}
            {allowances.map((a, i) => <React.Fragment key={i}>{row(`${a.type}${a.taxable === false ? ' (non-taxable)' : ''}`, a.amount)}</React.Fragment>)}
            {row('Gross pay', gross, 'font-bold border-t')}
          </div>
          <div className="text-sm">
            <p className="text-[10px] font-bold uppercase text-[#8E9299] mb-1">Deductions</p>
            {row('SSNIT employee', entry.ssnit_employee ?? 0, 'text-red-600')}
            {row(`PAYE (on ${money(entry.taxable_income ?? 0, symbol)})`, entry.paye ?? 0, 'text-red-600')}
            {deductions.map((d, i) => <React.Fragment key={i}>{row(d.type, d.amount, 'text-red-600')}</React.Fragment>)}
            {row('Total deductions', entry.deductions ?? 0, 'font-bold border-t text-red-600')}
          </div>
          {row('Net pay', entry.net_pay, 'text-lg font-black border-t-2 border-[#141414] pt-2 text-green-700')}
          {row('Employer SSNIT (not deducted)', entry.ssnit_employer ?? 0, 'text-xs text-[#8E9299]')}
          {entry.notes && <p className="text-xs text-[#8E9299]">Note: {entry.notes}</p>}
        </div>
        )}
        <DialogFooter className="gap-2">
          {showVoucher && (
            <Button variant="outline" className="rounded-xl gap-2" onClick={() => printVoucher(entry, settings, (user?.name || user?.email))}><Printer className="w-4 h-4" /> Voucher</Button>
          )}
          <Button className="bg-[#141414] text-white rounded-xl gap-2" onClick={() => printPayslip(entry, settings, (user?.name || user?.email))}><Printer className="w-4 h-4" /> Print payslip</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
