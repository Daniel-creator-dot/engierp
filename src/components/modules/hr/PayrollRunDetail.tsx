import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Ban, CheckCircle2, Eye, FileSpreadsheet, Landmark, Loader2, Pencil, Printer, RotateCcw, Search, Send, Trash2, Wallet } from 'lucide-react';
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
import { bankPaymentFile, payeSchedule, payrollRegister, ssnitReport } from './statutory';
import { PAYROLL_APPROVE_ROLES, currencySymbol, errorMessage, getSetting, money } from './utils';

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
    const t = { basic: 0, allowances: 0, gross: 0, ssnit: 0, employer: 0, paye: 0, other: 0, net: 0 };
    for (const e of entries) {
      t.basic += Number(e.base_salary) || 0;
      t.allowances += Number(e.allowances) || 0;
      t.gross += Number(e.gross) || 0;
      t.ssnit += Number(e.ssnit_employee) || 0;
      t.employer += Number(e.ssnit_employer) || 0;
      t.paye += Number(e.paye) || 0;
      t.other += Number(e.other_deductions) || 0;
      t.net += Number(e.net_pay) || 0;
    }
    return t;
  }, [entries]);

  const warnings = useMemo(() => ({
    noSsnit: entries.filter(e => !e.employee_ssnit).length,
    noBank: entries.filter(e => !e.bank_name || !e.account_number).length,
    noHours: entries.filter(e => e.wage_type === 'Hourly' && !Number(e.hours_worked)).length,
  }), [entries]);

  if (isLoading || !run) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  }

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
      title: `Payslips - ${run.month} ${run.year}`,
      bodyHtml: entries.map(e => `<div style="page-break-after: always;"><h3>${escapeHtml(e.name)} &middot; ${escapeHtml(payslipNumber(e))}</h3>${payslipHtml(e, symbol)}</div>`).join(''),
      settings,
      docNumber: `RUN-${run.year}-${String(run.id).padStart(4, '0')}`,
      printedBy: user?.name || user?.email,
    });
  };

  const stat = (label: string, value: number, cls = '') => (
    <div className="p-3 bg-[#F5F5F5] rounded-xl">
      <p className="text-[10px] font-bold uppercase text-[#8E9299]">{label}</p>
      <p className={`font-black ${cls}`}>{money(value, symbol)}</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <Button variant="ghost" onClick={onBack} className="gap-2 rounded-xl"><ArrowLeft className="w-4 h-4" /> All payroll runs</Button>

      <Card className="border-none shadow-sm rounded-2xl">
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">{run.month} {run.year} payroll <Badge className={payrollStatusClass(run.status)}>{run.status}</Badge></CardTitle>
            <CardDescription>
              {entries.length} employee(s){run.payment_date ? ` · payment date ${formatDate(run.payment_date)}` : ''}
              {run.project_id ? ` · charged to project ${run.project_id}` : ''}{run.journal_id ? ` · journal #${run.journal_id}` : ''}
            </CardDescription>
            {run.notes && <p className="text-xs text-[#8E9299] mt-1">{run.notes}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
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
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {stat('Gross pay', totals.gross)}
            {stat('SSNIT (employee)', totals.ssnit, 'text-red-600')}
            {stat('SSNIT (employer)', totals.employer, 'text-orange-600')}
            {stat('PAYE', totals.paye, 'text-red-600')}
            {stat('Other deductions', totals.other, 'text-red-600')}
            {stat('Net pay (bank)', totals.net, 'text-green-700')}
            {stat('Total employer cost', totals.gross + totals.employer)}
          </div>
          {(warnings.noSsnit > 0 || warnings.noBank > 0 || warnings.noHours > 0) && (
            <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl text-sm text-amber-800 flex gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                {warnings.noSsnit > 0 && <div>{warnings.noSsnit} employee(s) have no SSNIT number and will show as MISSING on the SSNIT report.</div>}
                {warnings.noBank > 0 && <div>{warnings.noBank} employee(s) have no bank account and are left out of the bank payment file.</div>}
                {warnings.noHours > 0 && <div>{warnings.noHours} hourly employee(s) have no hours this month. Record attendance or edit their hours.</div>}
              </div>
            </div>
          )}
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
        </CardContent>
      </Card>

      <Card className="border-none shadow-sm rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-[#F5F5F5]">
          <div className="relative max-w-sm">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#8E9299]" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search employees..." className="pl-9 rounded-xl" />
          </div>
        </div>
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
                <DialogDescription>{CONFIRM[confirm].body}</DialogDescription>
              </DialogHeader>
              {confirm === 'approve' && (
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
