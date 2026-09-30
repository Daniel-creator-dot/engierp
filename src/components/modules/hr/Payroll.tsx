import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronRight, Eye, Loader2, Plus, Settings2, Trash2, Wallet, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../ui/card';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Textarea } from '../../ui/textarea';
import { Badge } from '../../ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/table';
import { toast } from 'sonner';
import { hrApi, projectsApi } from '../../../lib/api';
import { useAuth } from '../../../contexts/AuthContext';
import { formatDate, todayIso } from '../../../lib/dates';
import { MONTHS, PayrollConfig, normalisePayrollConfig } from '../../../lib/payrollCalc';
import type { Employee, PayrollEntry, PayrollRun, Setting } from './types';
import PayrollRunDetail from './PayrollRunDetail';
import PayrollSettings from './PayrollSettings';
import PayslipDialog, { payrollStatusClass } from './PayslipDialog';
import { OneOffPaymentDialog } from './PayrollEditors';
import { PAYROLL_APPROVE_ROLES, PAYROLL_PREPARE_ROLES, currencySymbol, errorMessage, getSetting, money, yearOptions } from './utils';

type Tab = 'runs' | 'one-off' | 'mine' | 'settings';

function MyPayslips({ settings }: { settings: Setting[] }) {
  const { user } = useAuth();
  const symbol = currencySymbol(settings);
  const [entries, setEntries] = useState<PayrollEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [viewing, setViewing] = useState<PayrollEntry | null>(null);

  useEffect(() => {
    hrApi.getPayroll({ mine: true })
      .then(res => setEntries(res.data))
      .catch(error => toast.error(errorMessage(error, 'Failed to load your payslips')))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <Card className="border-none shadow-sm rounded-2xl overflow-hidden">
      <CardHeader className="border-b border-[#F5F5F5] bg-[#F5F5F5]/30">
        <CardTitle>My payslips</CardTitle>
        <CardDescription>Approved and paid salaries.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="flex items-center justify-center h-32"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : !user?.employee_id ? (
          <p className="p-8 text-center text-sm text-[#8E9299]">Your login isn't linked to an employee record yet. Ask HR to link it to see your payslips.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-[#F5F5F5]/50"><TableHead>Period</TableHead><TableHead className="text-right">Gross</TableHead><TableHead className="text-right">Deductions</TableHead><TableHead className="text-right">Net pay</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Payslip</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {entries.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-10 text-[#8E9299]">No payslips yet.</TableCell></TableRow>}
              {entries.map(e => (
                <TableRow key={e.id}>
                  <TableCell className="font-bold">{e.month} {e.year}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{money(e.gross, symbol)}</TableCell>
                  <TableCell className="text-right font-mono text-xs text-red-600">{money(e.deductions, symbol)}</TableCell>
                  <TableCell className="text-right font-mono font-black text-green-700">{money(e.net_pay, symbol)}</TableCell>
                  <TableCell><Badge className={payrollStatusClass(e.status)}>{e.status}</Badge></TableCell>
                  <TableCell className="text-right"><Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-full" onClick={() => setViewing(e)}><Eye className="w-3.5 h-3.5" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <PayslipDialog entry={viewing} settings={settings} onClose={() => setViewing(null)} />
    </Card>
  );
}

export default function Payroll({ settings }: { settings: Setting[] }) {
  const { user } = useAuth();
  const role = user?.role || '';
  const canPrepare = PAYROLL_PREPARE_ROLES.includes(role);
  const canApprove = PAYROLL_APPROVE_ROLES.includes(role);
  const symbol = currencySymbol(settings);

  const [tab, setTab] = useState<Tab>('runs');
  const [config, setConfig] = useState<PayrollConfig>(() => normalisePayrollConfig(getSetting(settings, 'payroll_config')));
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [oneOffs, setOneOffs] = useState<PayrollEntry[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);
  const [newRunOpen, setNewRunOpen] = useState(false);
  const [oneOffOpen, setOneOffOpen] = useState(false);
  const [viewing, setViewing] = useState<PayrollEntry | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const now = new Date();
  const [runForm, setRunForm] = useState({ month: MONTHS[now.getMonth()], year: now.getFullYear(), payment_date: todayIso(), project_id: 'none', notes: '' });
  const [isCreating, setIsCreating] = useState(false);

  const load = async () => {
    const loaders: [string, () => Promise<any>, (data: any) => void][] = [
      ['payroll runs', hrApi.getPayrollRuns, setRuns],
      ['one-off payments', () => hrApi.getPayroll({ standalone: true }), setOneOffs],
      ['employees', hrApi.getEmployees, setEmployees],
      ['payroll settings', hrApi.getPayrollSettings, d => setConfig(normalisePayrollConfig(d.config))],
      ['projects', projectsApi.getProjects, d => setProjects(Array.isArray(d) ? d : [])],
    ];
    const results = await Promise.allSettled(loaders.map(([, fn]) => fn()));
    const failures: string[] = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') loaders[i][2](r.value.data);
      else if (loaders[i][0] !== 'projects') failures.push(`${loaders[i][0]}: ${errorMessage(r.reason, 'request failed')}`);
    });
    if (failures.length) toast.error(`Some payroll data could not be loaded (${failures.join('; ')})`);
    setIsLoading(false);
  };

  useEffect(() => {
    if (canPrepare) load();
    else setIsLoading(false);
  }, [canPrepare]);

  const visibleRuns = useMemo(() => runs.filter(r => showCancelled || r.status !== 'Cancelled'), [runs, showCancelled]);
  const pendingOneOffs = oneOffs.filter(e => e.status === 'Pending').length;
  const awaitingApproval = runs.filter(r => r.status === 'Reviewed').length;

  if (!canPrepare) return <MyPayslips settings={settings} />;
  if (isLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  if (selectedRunId) {
    return (
      <PayrollRunDetail
        runId={selectedRunId}
        settings={settings}
        config={config}
        employees={employees}
        onBack={() => { setSelectedRunId(null); load(); }}
      />
    );
  }

  const createRun = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    try {
      const res = await hrApi.createPayrollRun({ ...runForm, project_id: runForm.project_id === 'none' ? undefined : runForm.project_id });
      toast.success(res.data.message);
      setNewRunOpen(false);
      setSelectedRunId(res.data.id);
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to create payroll run'));
    } finally {
      setIsCreating(false);
    }
  };

  const decideOneOff = async (entry: PayrollEntry, status: 'Approved' | 'Rejected') => {
    setBusyId(entry.id);
    try {
      const res = await hrApi.approvePayroll(entry.id, status);
      toast.success(res.data.message);
      load();
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to update payment'));
    } finally {
      setBusyId(null);
    }
  };

  const deleteOneOff = async (entry: PayrollEntry) => {
    setBusyId(entry.id);
    try {
      await hrApi.deletePayroll(entry.id);
      toast.success('Payment deleted');
      load();
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to delete payment'));
    } finally {
      setBusyId(null);
    }
  };

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'runs', label: 'Payroll runs', badge: canApprove ? awaitingApproval : undefined },
    { id: 'one-off', label: 'One-off payments', badge: canApprove ? pendingOneOffs : undefined },
    ...(user?.employee_id ? [{ id: 'mine' as Tab, label: 'My payslips' }] : []),
    { id: 'settings', label: 'Settings' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {tabs.map(t => (
          <Button key={t.id} variant={tab === t.id ? 'default' : 'outline'} onClick={() => setTab(t.id)} className={`rounded-xl gap-2 ${tab === t.id ? 'bg-[#141414] text-white' : ''}`}>
            {t.id === 'settings' && <Settings2 className="w-4 h-4" />}{t.label}
            {!!t.badge && <span className="ml-1 px-1.5 rounded-full bg-amber-400 text-[#141414] text-[10px] font-black">{t.badge}</span>}
          </Button>
        ))}
      </div>

      {tab === 'runs' && (
        <Card className="border-none shadow-sm rounded-2xl overflow-hidden">
          <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between border-b border-[#F5F5F5] bg-[#F5F5F5]/30">
            <div>
              <CardTitle>Payroll runs</CardTitle>
              <CardDescription>Draft → Reviewed → Approved (posted to the ledger) → Paid</CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-xs text-[#8E9299] flex items-center gap-1">
                <input type="checkbox" checked={showCancelled} onChange={e => setShowCancelled(e.target.checked)} /> Show cancelled
              </label>
              <Button className="bg-[#141414] text-white rounded-xl gap-2" onClick={() => setNewRunOpen(true)}><Plus className="w-4 h-4" /> New payroll run</Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-[#F5F5F5]/50">
                  <TableHead>Period</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Staff</TableHead>
                  <TableHead className="text-right">Gross</TableHead><TableHead className="text-right">PAYE</TableHead>
                  <TableHead className="text-right">SSNIT (both)</TableHead><TableHead className="text-right">Net pay</TableHead><TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRuns.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center py-12 text-[#8E9299]">No payroll runs yet. Start one for the month to generate draft pay for every active employee.</TableCell></TableRow>
                )}
                {visibleRuns.map(r => (
                  <TableRow key={r.id} className="cursor-pointer hover:bg-blue-50/30" onClick={() => setSelectedRunId(r.id)}>
                    <TableCell>
                      <div className="font-bold">{r.month} {r.year}</div>
                      <div className="text-[10px] text-slate-500 uppercase">{r.payment_date ? `Pay date ${formatDate(r.payment_date)}` : 'No pay date'}{r.project_id ? ` · ${r.project_id}` : ''}</div>
                    </TableCell>
                    <TableCell><Badge className={payrollStatusClass(r.status)}>{r.status === 'Reviewed' ? 'Awaiting approval' : r.status}</Badge></TableCell>
                    <TableCell className="text-right">{r.employee_count ?? 0}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{money(r.total_gross, symbol)}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{money(r.total_paye, symbol)}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{money(Number(r.total_ssnit_employee || 0) + Number(r.total_ssnit_employer || 0), symbol)}</TableCell>
                    <TableCell className="text-right font-mono font-black text-green-700">{money(r.total_net, symbol)}</TableCell>
                    <TableCell className="text-right"><ChevronRight className="w-4 h-4 inline text-[#8E9299]" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {tab === 'one-off' && (
        <Card className="border-none shadow-sm rounded-2xl overflow-hidden">
          <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between border-b border-[#F5F5F5] bg-[#F5F5F5]/30">
            <div>
              <CardTitle>One-off payments</CardTitle>
              <CardDescription>Individual payments outside the monthly run. Approving posts them to the ledger and marks them paid.</CardDescription>
            </div>
            <Button className="bg-[#141414] text-white rounded-xl gap-2" onClick={() => setOneOffOpen(true)}><Wallet className="w-4 h-4" /> New payment</Button>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-[#F5F5F5]/50">
                  <TableHead>Employee</TableHead><TableHead>Period</TableHead><TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Deductions</TableHead><TableHead className="text-right">Net pay</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {oneOffs.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-10 text-[#8E9299]">No one-off payments.</TableCell></TableRow>}
                {oneOffs.map(e => (
                  <TableRow key={e.id}>
                    <TableCell><div className="font-bold">{e.name}</div><div className="text-[10px] text-slate-500 uppercase">{e.employee_id}{e.notes ? ` · ${e.notes}` : ''}</div></TableCell>
                    <TableCell>{e.month} {e.year}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{money(e.gross, symbol)}</TableCell>
                    <TableCell className="text-right font-mono text-xs text-red-600">{money(e.deductions, symbol)}</TableCell>
                    <TableCell className="text-right font-mono font-black text-green-700">{money(e.net_pay, symbol)}</TableCell>
                    <TableCell><Badge className={payrollStatusClass(e.status)}>{e.status}</Badge></TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-full" title="Payslip" onClick={() => setViewing(e)}><Eye className="w-3.5 h-3.5" /></Button>
                      {e.status === 'Pending' && canApprove && (
                        <>
                          <Button variant="ghost" size="sm" disabled={busyId === e.id} className="h-8 w-8 p-0 rounded-full text-green-600" title="Approve & post" onClick={() => decideOneOff(e, 'Approved')}><CheckCircle2 className="w-4 h-4" /></Button>
                          <Button variant="ghost" size="sm" disabled={busyId === e.id} className="h-8 w-8 p-0 rounded-full text-red-600" title="Reject" onClick={() => decideOneOff(e, 'Rejected')}><XCircle className="w-4 h-4" /></Button>
                        </>
                      )}
                      {(e.status === 'Pending' || e.status === 'Rejected') && (
                        <Button variant="ghost" size="sm" disabled={busyId === e.id} className="h-8 w-8 p-0 rounded-full" title="Delete" onClick={() => deleteOneOff(e)}><Trash2 className="w-3.5 h-3.5" /></Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {tab === 'mine' && <MyPayslips settings={settings} />}
      {tab === 'settings' && <PayrollSettings onSaved={load} />}

      <Dialog open={newRunOpen} onOpenChange={setNewRunOpen}>
        <DialogContent>
          <form onSubmit={createRun}>
            <DialogHeader>
              <DialogTitle>New payroll run</DialogTitle>
              <DialogDescription>Creates draft pay for every active employee. Salaried staff get their monthly basic; hourly staff are paid for the hours recorded in attendance.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label>Month</Label>
                  <Select value={runForm.month} onValueChange={v => setRunForm(f => ({ ...f, month: v }))}>
                    <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>{MONTHS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Year</Label>
                  <Select value={String(runForm.year)} onValueChange={v => setRunForm(f => ({ ...f, year: Number(v) }))}>
                    <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>{yearOptions().map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-2"><Label>Payment date</Label><Input type="date" value={runForm.payment_date} onChange={e => setRunForm(f => ({ ...f, payment_date: e.target.value }))} required /></div>
              <div className="grid gap-2">
                <Label>Charge labour to project (optional)</Label>
                <Select value={runForm.project_id} onValueChange={v => setRunForm(f => ({ ...f, project_id: v }))}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Office / overhead (salaries expense)</SelectItem>
                    {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.id} - {p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2"><Label>Notes</Label><Textarea value={runForm.notes} onChange={e => setRunForm(f => ({ ...f, notes: e.target.value }))} rows={2} /></div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={isCreating} className="bg-[#141414] text-white rounded-xl gap-2 w-full">
                {isCreating && <Loader2 className="w-4 h-4 animate-spin" />} Generate draft payroll
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <OneOffPaymentDialog
        open={oneOffOpen}
        onOpenChange={setOneOffOpen}
        employees={employees}
        projects={projects}
        config={config}
        symbol={symbol}
        onSaved={load}
      />
      <PayslipDialog entry={viewing} settings={settings} onClose={() => setViewing(null)} showVoucher />
    </div>
  );
}
