import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Ban, CheckCircle2, Eye, FileSpreadsheet, Landmark, Loader2, Pencil, Printer, RefreshCw, RotateCcw, Search, Send, Trash2, Wallet } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../ui/card';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Badge } from '../../ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/table';
import { toast } from 'sonner';
import { hrApi } from '../../../lib/api';
import { useAuth } from '../../../contexts/AuthContext';
import { formatDate } from '../../../lib/dates';
import { PayrollConfig } from '../../../lib/payrollCalc';
import type { Employee, PayrollEntry, PayrollRun, Setting } from './types';
import { EntryEditor } from './PayrollEditors';
import PayslipDialog, { payrollStatusClass } from './PayslipDialog';
import { payslipHtml, payslipNumber, printDocument } from './print';
import { escapeHtml } from '../../../lib/html';
import {
  bankPaymentFile, casualLabourReport, casualPaymentSheet, casualWhtSchedule, payeSchedule, payrollRegister, ssnitReport,
} from './statutory';
import { PAYROLL_APPROVE_ROLES, currencySymbol, errorMessage, getSetting, money, parseBreakdown, periodText } from './utils';

const STEPS: PayrollRun['status'][] = ['Draft', 'Reviewed', 'Approved', 'Paid'];
type Action = 'review' | 'reopen' | 'approve' | 'mark-paid' | 'cancel';

const CONFIRM: Record<Action, { title: string; body: string; button: string }> = {
  review: { title: 'Send for approval?', body: 'The run is locked for approval. Editing any entry afterwards returns it to draft.', button: 'Mark reviewed' },
  reopen: { title: 'Reopen for editing?', body: 'The run goes back to draft and has to be reviewed again.', button: 'Reopen' },
  approve: { title: 'Approve and post to the ledger?', body: 'One journal is posted for the whole run: salary expense and employer SSNIT are debited; net pay (bank), PAYE, SSNIT and other deductions are credited.', button: 'Approve & post' },
  'mark-paid': { title: 'Mark salaries as paid?', body: 'Confirms the bank transfers have been made. Staff are notified and can see their payslips.', button: 'Mark paid' },
  cancel: { title: 'Cancel this run?', body: 'All entries in the run are deleted. If it was approved, its journal is reversed.', button: 'Cancel run' },
};

export default function PayrollRunDetail({ runId, settings, config, employees, onBack }: {
  runId: number;
  settings: Setting[];
  config: PayrollConfig;
  employees: Employee[];
  onBack: () => void;
}) {
  const { user } = useAuth();
  const canApprove = PAYROLL_APPROVE_ROLES.includes(user?.role || '');
  const symbol = currencySymbol(settings);
  const company = getSetting(settings, 'company_name') || 'Company';

  const [run, setRun] = useState<PayrollRun | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<PayrollEntry | null>(null);
  const [viewing, setViewing] = useState<PayrollEntry | null>(null);
  const [removing, setRemoving] = useState<PayrollEntry | null>(null);
  const [confirm, setConfirm] = useState<Action | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const load = async () => {
    try {
      const res = await hrApi.getPayrollRun(runId);
      setRun(res.data);
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to load payroll run'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { setIsLoading(true); load(); }, [runId]);

  const entries = run?.entries || [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? entries.filter(e => `${e.name} ${e.employee_id} ${e.department}`.toLowerCase().includes(q)) : entries;
  }, [entries, search]);

  const totals = useMemo(() => {
    const t = { basic: 0, allowances: 0, gross: 0, ssnit: 0, employer: 0, paye: 0, wht: 0, other: 0, net: 0, days: 0, overtime: 0 };
    for (const e of entries) {
      t.basic += Number(e.base_salary) || 0;
      t.allowances += Number(e.allowances) || 0;
      t.gross += Number(e.gross) || 0;
      t.ssnit += Number(e.ssnit_employee) || 0;
      t.employer += Number(e.ssnit_employer) || 0;
      t.paye += Number(e.paye) || 0;
      t.wht += Number(e.wht) || 0;
      t.other += Number(e.other_deductions) || 0;
      t.net += Number(e.net_pay) || 0;
      t.days += Number(e.days_worked) || 0;
      t.overtime += Number(e.overtime_hours) || 0;
    }
    return t;
  }, [entries]);

  const projectCount = useMemo(() => new Set(entries.flatMap(e => {
    const shares = parseBreakdown(e.project_breakdown);
    return shares.length ? shares.map(s => s.project_id || '') : [e.project_id || ''];
  })).size, [entries]);

  const warnings = useMemo(() => ({
    noSsnit: entries.filter(e => e.pay_type !== 'casual' && !e.employee_ssnit).length,
    noBank: entries.filter(e => e.pay_type !== 'casual' && (!e.bank_name || !e.account_number)).length,
    noHours: entries.filter(e => e.wage_type === 'Hourly' && !Number(e.hours_worked)).length,
    noPhone: entries.filter(e => e.pay_type === 'casual' && !e.employee_phone).length,
    noRate: entries.filter(e => e.pay_type === 'casual' && !Number(e.daily_rate)).length,
    highRate: entries.filter(e => e.pay_type === 'casual' && Number(e.daily_rate) > 1000).length,
    noDays: entries.filter(e => e.pay_type === 'casual' && !Number(e.days_worked) && !Number(e.overtime_hours)).length,
  }), [entries]);

  if (isLoading || !run) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  }

  const casual = run.run_type === 'casual';
  const fileLabel = casual ? periodText(run.period_start, run.period_end) : `${run.month} ${run.year}`;
  const editable = run.status === 'Draft' || run.status === 'Reviewed';
  const stepIndex = STEPS.indexOf(run.status);
  const rateFor = (employeeId: string) => Number(employees.find(e => e.id === employeeId)?.salary) || 0;

  const runAction = async (action: Action) => {
    setIsBusy(true);
    try {
      const res = await hrApi.payrollRunAction(run.id, action);
      toast.success(res.data.message);
      setConfirm(null);
      if (action === 'cancel') onBack();
      else load();
    } catch (error) {
      toast.error(errorMessage(error, 'Action failed'));
    } finally {
      setIsBusy(false);
    }
  };

  const refresh = async () => {
    setIsBusy(true);
    try {
      const res = await hrApi.refreshPayrollRun(run.id);
      toast.success(res.data.message);
      load();
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to refresh from attendance'));
    } finally {
      setIsBusy(false);
    }
  };

  const removeEntry = async () => {
    if (!removing) return;
    setIsBusy(true);
    try {
      await hrApi.removePayrollRunEntry(run.id, removing.id);
      toast.success(`${removing.name} removed from this run`);
      setRemoving(null);
      load();
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to remove entry'));
    } finally {
      setIsBusy(false);
    }
  };

  const printAll = () => {
    if (!entries.length) return;
    printDocument({
      title: casual ? `Casual pay slips - ${fileLabel}` : `Payslips - ${run.month} ${run.year}`,
      bodyHtml: entries.map(e => `<div style="page-break-after: always;"><h3>${escapeHtml(e.name)} &middot; ${escapeHtml(payslipNumber(e))}</h3>${payslipHtml(e, symbol)}</div>`).join(''),
      settings,
      docNumber: `RUN-${run.year}-${String(run.id).padStart(4, '0')}`,
      printedBy: user?.name || user?.email,
    });
  };

  const stat = (title: string, value: number | string, cls = '') => (
    <div className="p-3 bg-[#F5F5F5] rounded-xl">
      <p className="text-[10px] font-bold uppercase text-[#8E9299]">{title}</p>
      <p className={`font-black ${cls}`}>{typeof value === 'number' ? money(value, symbol) : value}</p>
    </div>
  );
  const confirmBody = (action: Action) => {
    if (!casual) return CONFIRM[action].body;
    if (action === 'approve') {
      return `Site labour expense is debited${projectCount > 1 ? `, one journal per project (${projectCount})` : ''}; net pay is credited to the casual cash / mobile money account and withholding tax to WHT payable. Attendance for these workers in this period is locked.`;
    }
    if (action === 'mark-paid') return 'Confirms every worker has been paid (cash or mobile money) and signed the pay sheet. Workers are notified by SMS.';
    return CONFIRM[action].body;
  };

  return (
    <div className="space-y-4">
      <Button variant="ghost" onClick={onBack} className="gap-2 rounded-xl"><ArrowLeft className="w-4 h-4" /> All payroll runs</Button>

      <Card className="border-none shadow-sm rounded-2xl">
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              {casual ? `Casual pay: ${periodText(run.period_start, run.period_end)}` : `${run.month} ${run.year} payroll`}
              {casual && <Badge className="border-none bg-orange-100 text-orange-800 text-[10px] uppercase">{run.frequency === 'Daily' ? 'Daily' : 'Weekly'}</Badge>}
              <Badge className={payrollStatusClass(run.status)}>{run.status}</Badge>
            </CardTitle>
            <CardDescription>
              {entries.length} {casual ? 'worker(s)' : 'employee(s)'}{run.payment_date ? ` · payment date ${formatDate(run.payment_date)}` : ''}
              {run.project_id ? ` · charged to project ${run.project_id}` : ''}{run.journal_id ? ` · journal #${run.journal_id}` : ''}
            </CardDescription>
            {run.notes && <p className="text-xs text-[#8E9299] mt-1">{run.notes}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {casual && editable && (
              <Button variant="outline" onClick={refresh} disabled={isBusy} className="rounded-xl gap-2" title="Re-price from the attendance register">
                <RefreshCw className={`w-4 h-4 ${isBusy ? 'animate-spin' : ''}`} /> Refresh from attendance
              </Button>
            )}
            {run.status === 'Draft' && <Button onClick={() => setConfirm('review')} className="bg-[#141414] text-white rounded-xl gap-2"><Send className="w-4 h-4" /> Send for approval</Button>}
            {run.status === 'Reviewed' && <Button variant="outline" onClick={() => setConfirm('reopen')} className="rounded-xl gap-2"><RotateCcw className="w-4 h-4" /> Reopen</Button>}
            {run.status === 'Reviewed' && canApprove && <Button onClick={() => setConfirm('approve')} className="bg-green-600 hover:bg-green-700 text-white rounded-xl gap-2"><CheckCircle2 className="w-4 h-4" /> Approve & post</Button>}
            {run.status === 'Reviewed' && !canApprove && <span className="text-xs text-[#8E9299] self-center">Waiting for an admin or accountant to approve</span>}
            {run.status === 'Approved' && canApprove && <Button onClick={() => setConfirm('mark-paid')} className="bg-[#141414] text-white rounded-xl gap-2"><Wallet className="w-4 h-4" /> Mark paid</Button>}
            {(editable || (run.status === 'Approved' && canApprove)) && (
              <Button variant="ghost" onClick={() => setConfirm('cancel')} className="rounded-xl gap-2 text-red-600 hover:bg-red-50"><Ban className="w-4 h-4" /> Cancel run</Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            {STEPS.map((s, i) => (
              <React.Fragment key={s}>
                <div className={`flex items-center gap-2 text-xs font-bold uppercase ${i <= stepIndex ? 'text-[#141414]' : 'text-[#C4C4C4]'}`}>
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] ${i <= stepIndex ? 'bg-[#141414] text-white' : 'bg-[#F5F5F5]'}`}>{i + 1}</span>
                  {s}
                </div>
                {i < STEPS.length - 1 && <div className={`flex-1 h-px ${i < stepIndex ? 'bg-[#141414]' : 'bg-[#E5E5E5]'}`} />}
              </React.Fragment>
            ))}
          </div>
          {casual ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {stat('Days worked', `${Math.round(totals.days * 100) / 100} days`)}
              {stat('Overtime', `${Math.round(totals.overtime * 100) / 100} h`)}
              {stat('Gross pay', totals.gross)}
              {stat(`Withholding tax (${config.casual_wht_rate}%)`, totals.wht + totals.paye, 'text-red-600')}
              {stat('Other deductions', totals.other + totals.ssnit, 'text-red-600')}
              {stat('Net pay (cash / MoMo)', totals.net, 'text-green-700')}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
              {stat('Gross pay', totals.gross)}
              {stat('SSNIT (employee)', totals.ssnit, 'text-red-600')}
              {stat('SSNIT (employer)', totals.employer, 'text-orange-600')}
              {stat('PAYE', totals.paye, 'text-red-600')}
              {stat('Other deductions', totals.other, 'text-red-600')}
              {stat('Net pay (bank)', totals.net, 'text-green-700')}
              {stat('Total employer cost', totals.gross + totals.employer)}
            </div>
          )}
          {Object.values(warnings).some(Boolean) && (
            <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl text-sm text-amber-800 flex gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                {warnings.noSsnit > 0 && <div>{warnings.noSsnit} employee(s) have no SSNIT number and will show as MISSING on the SSNIT report.</div>}
                {warnings.noBank > 0 && <div>{warnings.noBank} employee(s) have no bank account and are left out of the bank payment file.</div>}
                {warnings.noHours > 0 && <div>{warnings.noHours} hourly employee(s) have no hours this month. Record attendance or edit their hours.</div>}
                {warnings.noRate > 0 && <div>{warnings.noRate} worker(s) have no daily rate on their employee file, so they are paid nothing.</div>}
                {warnings.highRate > 0 && <div>{warnings.highRate} worker(s) have a daily rate above {symbol}1,000, which looks like a monthly salary.</div>}
                {warnings.noDays > 0 && <div>{warnings.noDays} worker(s) have no attendance in this period.</div>}
                {warnings.noPhone > 0 && <div>{warnings.noPhone} worker(s) have no phone number for mobile money or SMS.</div>}
              </div>
            </div>
          )}
          {casual ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="rounded-xl gap-2" onClick={() => {
              const noPhone = casualPaymentSheet(entries, fileLabel, company);
              if (noPhone) toast.warning(`${noPhone} worker(s) have no phone number`);
            }} disabled={!entries.length}><Wallet className="w-4 h-4" /> Cash / MoMo pay sheet</Button>
            <Button variant="outline" size="sm" className="rounded-xl gap-2" onClick={() => casualLabourReport(entries, fileLabel, company)} disabled={!entries.length}><FileSpreadsheet className="w-4 h-4" /> Labour cost by project</Button>
            <Button variant="outline" size="sm" className="rounded-xl gap-2" onClick={() => casualWhtSchedule(entries, fileLabel, company)} disabled={!entries.length}><FileSpreadsheet className="w-4 h-4" /> WHT schedule</Button>
            <Button variant="outline" size="sm" className="rounded-xl gap-2" onClick={() => payrollRegister(entries)} disabled={!entries.length}><FileSpreadsheet className="w-4 h-4" /> Register</Button>
            <Button variant="outline" size="sm" className="rounded-xl gap-2" onClick={printAll} disabled={!entries.length}><Printer className="w-4 h-4" /> Print pay slips</Button>
          </div>
          ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="rounded-xl gap-2" onClick={() => payrollRegister(entries)} disabled={!entries.length}><FileSpreadsheet className="w-4 h-4" /> Payroll register</Button>
            <Button variant="outline" size="sm" className="rounded-xl gap-2" onClick={() => {
              const missing = ssnitReport(entries, config, company);
              if (missing) toast.warning(`${missing} employee(s) have no SSNIT number`);
            }} disabled={!entries.length}><FileSpreadsheet className="w-4 h-4" /> SSNIT report</Button>
            <Button variant="outline" size="sm" className="rounded-xl gap-2" onClick={() => payeSchedule(entries, company)} disabled={!entries.length}><FileSpreadsheet className="w-4 h-4" /> GRA PAYE schedule</Button>
            <Button variant="outline" size="sm" className="rounded-xl gap-2" onClick={() => {
              const missing = bankPaymentFile(entries, run.payment_date);
              if (missing) toast.warning(`${missing} employee(s) left out: no bank details or zero net pay`);
            }} disabled={!entries.length}><Landmark className="w-4 h-4" /> Bank payment file</Button>
            {(run.status === 'Approved' || run.status === 'Paid') && (
              <Button variant="outline" size="sm" className="rounded-xl gap-2" onClick={printAll} disabled={!entries.length}><Printer className="w-4 h-4" /> Print all payslips</Button>
            )}
          </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-none shadow-sm rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-[#F5F5F5]">
          <div className="relative max-w-sm">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#8E9299]" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search employees..." className="pl-9 rounded-xl" />
          </div>
        </div>
        {casual ? (
          <Table>
            <TableHeader>
              <TableRow className="bg-[#F5F5F5]/50">
                <TableHead>Worker</TableHead><TableHead className="text-right">Days</TableHead><TableHead className="text-right">Daily rate</TableHead>
                <TableHead className="text-right">OT (h × rate)</TableHead><TableHead className="text-right">Gross</TableHead><TableHead className="text-right">WHT</TableHead>
                <TableHead className="text-right">Other</TableHead><TableHead className="text-right">Net pay</TableHead><TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={9} className="text-center py-10 text-[#8E9299]">No workers in this run.</TableCell></TableRow>
              )}
              {filtered.map(e => {
                const sites = parseBreakdown(e.project_breakdown);
                return (
                  <TableRow key={e.id}>
                    <TableCell>
                      <div className="font-bold">{e.name}</div>
                      <div className="text-[10px] text-slate-500 uppercase">
                        {e.employee_id}{e.employee_phone ? ` · ${e.employee_phone}` : ''}
                        {e.tax_treatment && e.tax_treatment !== 'casual_wht' && ` · ${e.tax_treatment === 'paye' ? 'PAYE + SSNIT' : 'no tax'}`}
                      </div>
                      {sites.length > 0 && (
                        <div className="text-[10px] text-[#8E9299]">
                          {sites.map(s => `${s.project_name || s.project_id || 'General'}: ${s.days}d${s.overtime_hours ? ` + ${s.overtime_hours}h` : ''}`).join(' · ')}
                        </div>
                      )}
                      {e.notes && <div className="text-[10px] text-amber-700">{e.notes}</div>}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-bold">{Number(e.days_worked) || 0}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{money(e.daily_rate, symbol)}</TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {Number(e.overtime_hours) ? <>{Number(e.overtime_hours)} × {money(e.overtime_rate, symbol)}<div className="text-[#8E9299]">{money(e.overtime_pay, symbol)}</div></> : '-'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-bold">{money(e.gross, symbol)}</TableCell>
                    <TableCell className="text-right font-mono text-xs text-red-600">{money(Number(e.wht || 0) + Number(e.paye || 0), symbol)}</TableCell>
                    <TableCell className="text-right font-mono text-xs text-red-600">{money(Number(e.other_deductions || 0) + Number(e.ssnit_employee || 0), symbol)}</TableCell>
                    <TableCell className="text-right font-mono text-sm font-black text-green-700">{money(e.net_pay, symbol)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-full" title="Pay slip" onClick={() => setViewing(e)}><Eye className="w-3.5 h-3.5" /></Button>
                      {editable && (
                        <>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-full" title="Edit days / overtime" onClick={() => setEditing(e)}><Pencil className="w-3.5 h-3.5" /></Button>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-full text-red-600" title="Remove from run" onClick={() => setRemoving(e)}><Trash2 className="w-3.5 h-3.5" /></Button>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {entries.length > 0 && (
                <TableRow className="bg-[#F5F5F5]/50 font-bold">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right font-mono text-xs">{Math.round(totals.days * 100) / 100}</TableCell>
                  <TableCell />
                  <TableCell className="text-right font-mono text-xs">{Math.round(totals.overtime * 100) / 100} h</TableCell>
                  <TableCell className="text-right font-mono text-xs">{money(totals.gross, symbol)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{money(totals.wht + totals.paye, symbol)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{money(totals.other + totals.ssnit, symbol)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{money(totals.net, symbol)}</TableCell>
                  <TableCell />
                </TableRow>
              )}
            </TableBody>
          </Table>
        ) : (
        <Table>
          <TableHeader>
            <TableRow className="bg-[#F5F5F5]/50">
              <TableHead>Employee</TableHead><TableHead className="text-right">Basic</TableHead><TableHead className="text-right">Allowances</TableHead>
              <TableHead className="text-right">Gross</TableHead><TableHead className="text-right">SSNIT</TableHead><TableHead className="text-right">PAYE</TableHead>
              <TableHead className="text-right">Other</TableHead><TableHead className="text-right">Net pay</TableHead><TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow><TableCell colSpan={9} className="text-center py-10 text-[#8E9299]">No employees in this run.</TableCell></TableRow>
            )}
            {filtered.map(e => (
              <TableRow key={e.id}>
                <TableCell>
                  <div className="font-bold">{e.name}</div>
                  <div className="text-[10px] text-slate-500 uppercase">
                    {e.employee_id} · {e.department}
                    {e.wage_type === 'Hourly' && ` · ${Number(e.hours_worked) || 0}h${Number(e.overtime_hours) ? ` + ${Number(e.overtime_hours)} OT` : ''}`}
                  </div>
                  {e.notes && <div className="text-[10px] text-amber-700">{e.notes}</div>}
                </TableCell>
                <TableCell className="text-right font-mono text-xs">{money(e.base_salary, symbol)}</TableCell>
                <TableCell className="text-right font-mono text-xs">{money(e.allowances, symbol)}</TableCell>
                <TableCell className="text-right font-mono text-xs font-bold">{money(e.gross, symbol)}</TableCell>
                <TableCell className="text-right font-mono text-xs text-red-600">{money(e.ssnit_employee, symbol)}</TableCell>
                <TableCell className="text-right font-mono text-xs text-red-600">{money(e.paye, symbol)}</TableCell>
                <TableCell className="text-right font-mono text-xs text-red-600">{money(e.other_deductions, symbol)}</TableCell>
                <TableCell className="text-right font-mono text-sm font-black text-green-700">{money(e.net_pay, symbol)}</TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-full" title="Payslip" onClick={() => setViewing(e)}><Eye className="w-3.5 h-3.5" /></Button>
                  {editable && (
                    <>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-full" title="Edit pay" onClick={() => setEditing(e)}><Pencil className="w-3.5 h-3.5" /></Button>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-full text-red-600" title="Remove from run" onClick={() => setRemoving(e)}><Trash2 className="w-3.5 h-3.5" /></Button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {entries.length > 0 && (
              <TableRow className="bg-[#F5F5F5]/50 font-bold">
                <TableCell>Total</TableCell>
                <TableCell className="text-right font-mono text-xs">{money(totals.basic, symbol)}</TableCell>
                <TableCell className="text-right font-mono text-xs">{money(totals.allowances, symbol)}</TableCell>
                <TableCell className="text-right font-mono text-xs">{money(totals.gross, symbol)}</TableCell>
                <TableCell className="text-right font-mono text-xs">{money(totals.ssnit, symbol)}</TableCell>
                <TableCell className="text-right font-mono text-xs">{money(totals.paye, symbol)}</TableCell>
                <TableCell className="text-right font-mono text-xs">{money(totals.other, symbol)}</TableCell>
                <TableCell className="text-right font-mono text-sm">{money(totals.net, symbol)}</TableCell>
                <TableCell />
              </TableRow>
            )}
          </TableBody>
        </Table>
        )}
      </Card>

      <EntryEditor
        open={Boolean(editing)}
        onOpenChange={o => !o && setEditing(null)}
        runId={run.id}
        entry={editing}
        rate={editing ? rateFor(editing.employee_id) : 0}
        config={config}
        symbol={symbol}
        onSaved={load}
      />
      <PayslipDialog entry={viewing} settings={settings} onClose={() => setViewing(null)} showVoucher />

      <Dialog open={Boolean(confirm)} onOpenChange={o => !o && setConfirm(null)}>
        <DialogContent>
          {confirm && (
            <>
              <DialogHeader>
                <DialogTitle>{CONFIRM[confirm].title}</DialogTitle>
                <DialogDescription>{confirmBody(confirm)}</DialogDescription>
              </DialogHeader>
              {confirm === 'approve' && casual && (
                <div className="text-sm space-y-1 p-3 bg-[#F5F5F5] rounded-xl">
                  <div className="flex justify-between"><span>Dr Site labour expense{projectCount > 1 ? ` (${projectCount} projects)` : ''}</span><span className="font-mono">{money(totals.gross, symbol)}</span></div>
                  {totals.employer > 0 && <div className="flex justify-between"><span>Dr Employer SSNIT</span><span className="font-mono">{money(totals.employer, symbol)}</span></div>}
                  <div className="flex justify-between"><span>Cr Casual cash / mobile money (net pay)</span><span className="font-mono">{money(totals.net, symbol)}</span></div>
                  <div className="flex justify-between"><span>Cr Withholding tax payable</span><span className="font-mono">{money(totals.wht, symbol)}</span></div>
                  {totals.paye > 0 && <div className="flex justify-between"><span>Cr PAYE payable</span><span className="font-mono">{money(totals.paye, symbol)}</span></div>}
                  {totals.ssnit + totals.employer > 0 && <div className="flex justify-between"><span>Cr SSNIT payable</span><span className="font-mono">{money(totals.ssnit + totals.employer, symbol)}</span></div>}
                  {totals.other > 0 && <div className="flex justify-between"><span>Cr Other deductions</span><span className="font-mono">{money(totals.other, symbol)}</span></div>}
                </div>
              )}
              {confirm === 'approve' && !casual && (
                <div className="text-sm space-y-1 p-3 bg-[#F5F5F5] rounded-xl">
                  <div className="flex justify-between"><span>Dr Salary expense</span><span className="font-mono">{money(totals.gross, symbol)}</span></div>
                  <div className="flex justify-between"><span>Dr Employer SSNIT</span><span className="font-mono">{money(totals.employer, symbol)}</span></div>
                  <div className="flex justify-between"><span>Cr Bank (net pay)</span><span className="font-mono">{money(totals.net, symbol)}</span></div>
                  <div className="flex justify-between"><span>Cr PAYE payable</span><span className="font-mono">{money(totals.paye, symbol)}</span></div>
                  <div className="flex justify-between"><span>Cr SSNIT payable</span><span className="font-mono">{money(totals.ssnit + totals.employer, symbol)}</span></div>
                  {totals.other > 0 && <div className="flex justify-between"><span>Cr Other deductions</span><span className="font-mono">{money(totals.other, symbol)}</span></div>}
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirm(null)} className="rounded-xl">Back</Button>
                <Button onClick={() => runAction(confirm)} disabled={isBusy} className={`rounded-xl gap-2 text-white ${confirm === 'cancel' ? 'bg-red-600 hover:bg-red-700' : 'bg-[#141414]'}`}>
                  {isBusy && <Loader2 className="w-4 h-4 animate-spin" />} {CONFIRM[confirm].button}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(removing)} onOpenChange={o => !o && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {removing?.name}?</DialogTitle>
            <DialogDescription>They won't be paid in this run. You can pay them later with a one-off payment.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)} className="rounded-xl">Back</Button>
            <Button onClick={removeEntry} disabled={isBusy} className="bg-red-600 hover:bg-red-700 text-white rounded-xl">Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
