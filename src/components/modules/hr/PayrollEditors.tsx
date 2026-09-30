import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Checkbox } from '../../ui/checkbox';
import { Textarea } from '../../ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { toast } from 'sonner';
import { hrApi } from '../../../lib/api';
import { todayIso } from '../../../lib/dates';
import {
  MONTHS, PayItem, PayrollConfig, TaxTreatment, casualOvertimeRate, computeCasualPay, computePay, deductionAmount, effectiveTaxTreatment, round2,
} from '../../../lib/payrollCalc';
import type { Employee, PayrollEntry } from './types';
import { errorMessage, money, otherDeductionItems, parseItems, periodText, yearOptions } from './utils';

const CUSTOM = '__custom__';

function PayItemsEditor({ label, items, onChange, allowances, config, basic }: {
  label: string;
  items: PayItem[];
  onChange: (items: PayItem[]) => void;
  allowances?: boolean;
  config: PayrollConfig;
  basic: number;
}) {
  const update = (i: number, patch: Partial<PayItem>) => onChange(items.map((item, j) => (j === i ? { ...item, ...patch } : item)));
  const remove = (i: number) => onChange(items.filter((_, j) => j !== i));
  const types = config.deduction_types;

  const addDeduction = (name: string) => {
    if (name === CUSTOM) return onChange([...items, { type: '', amount: 0 }]);
    const type = types.find(t => t.name === name);
    onChange([...items, { type: name, amount: deductionAmount(type, basic) }]);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-[10px] font-bold uppercase text-[#8E9299]">{label}</Label>
        {allowances || types.length === 0 ? (
          <Button type="button" variant="ghost" size="sm" className="h-7 gap-1" onClick={() => onChange([...items, { type: '', amount: 0 }])}>
            <Plus className="w-3.5 h-3.5" /> Add
          </Button>
        ) : (
          <Select value="" onValueChange={addDeduction}>
            <SelectTrigger className="h-7 w-40 rounded-lg text-xs"><SelectValue placeholder="Add deduction..." /></SelectTrigger>
            <SelectContent>
              {types.map(t => (
                <SelectItem key={t.name} value={t.name}>{t.name} ({t.type === 'percentage' ? `${t.value}%` : money(t.value)})</SelectItem>
              ))}
              <SelectItem value={CUSTOM}>Other...</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>
      {items.length === 0 && <p className="text-xs text-[#8E9299]">None</p>}
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input value={item.type} onChange={e => update(i, { type: e.target.value })} placeholder={allowances ? 'e.g. Transport' : 'e.g. Staff loan'} className="flex-1 h-9" disabled={item.type === 'Overtime'} />
          <Input type="number" min="0" step="0.01" value={item.amount || ''} onChange={e => update(i, { amount: Number(e.target.value) })} className="w-32 h-9" disabled={item.type === 'Overtime'} />
          {allowances && (
            <label className="flex items-center gap-1 text-xs whitespace-nowrap" title="Taxable allowances are included in PAYE">
              <Checkbox checked={item.taxable !== false} onCheckedChange={v => update(i, { taxable: v === true ? undefined : false })} disabled={item.type === 'Overtime'} /> Taxable
            </label>
          )}
          <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => remove(i)} disabled={item.type === 'Overtime'}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}

function PayPreview({ basic, allowances, deductions, config, symbol }: { basic: number; allowances: PayItem[]; deductions: PayItem[]; config: PayrollConfig; symbol: string }) {
  const pay = computePay({ basic, allowances, deductions }, config);
  const line = (label: string, value: number, cls = '') => (
    <div className={`flex justify-between ${cls}`}><span>{label}</span><span>{money(value, symbol)}</span></div>
  );
  return (
    <div className="p-4 bg-[#F5F5F5] rounded-2xl text-sm space-y-1">
      {line('Basic', pay.basic)}
      {line('Allowances', pay.allowances)}
      {line('Gross pay', pay.gross, 'font-bold border-t pt-1')}
      {line(`SSNIT employee (${config.ssnit_employee}%)`, -pay.ssnit_employee, 'text-red-600')}
      {line(`PAYE on ${money(pay.taxable_income, symbol)}`, -pay.paye, 'text-red-600')}
      {line('Other deductions', -pay.other_deductions, 'text-red-600')}
      {line('Net pay', pay.net_pay, `font-black text-base border-t pt-1 ${pay.net_pay < 0 ? 'text-red-600' : 'text-green-700'}`)}
      {line(`Employer SSNIT (${config.ssnit_employer}%)`, pay.ssnit_employer, 'text-xs text-[#8E9299]')}
    </div>
  );
}

interface CasualPreviewProps {
  days: number; dailyRate: number; overtime: number; overtimeRate: number; taxTreatment: TaxTreatment;
  allowances: PayItem[]; deductions: PayItem[]; config: PayrollConfig; symbol: string;
}

function CasualPreview({ days, dailyRate, overtime, overtimeRate, taxTreatment, allowances, deductions, config, symbol }: CasualPreviewProps) {
  const pay = computeCasualPay({ days, dailyRate, overtimeHours: overtime, overtimeRate, taxTreatment, allowances, deductions }, config);
  const line = (label: string, value: number, cls = '') => (
    <div className={`flex justify-between ${cls}`}><span>{label}</span><span>{money(value, symbol)}</span></div>
  );
  return (
    <div className="p-4 bg-[#F5F5F5] rounded-2xl text-sm space-y-1">
      {line(`${round2(days)} day(s) × ${money(dailyRate, symbol)}`, pay.basic)}
      {line(`Overtime ${round2(overtime)} h × ${money(overtimeRate, symbol)}`, pay.overtime_pay)}
      {pay.allowances - pay.overtime_pay > 0 && line('Other allowances', round2(pay.allowances - pay.overtime_pay))}
      {line('Gross pay', pay.gross, 'font-bold border-t pt-1')}
      {taxTreatment === 'casual_wht' && line(`Withholding tax (${config.casual_wht_rate}% final)`, -pay.wht, 'text-red-600')}
      {taxTreatment === 'paye' && line(`SSNIT employee (${config.ssnit_employee}%)`, -pay.ssnit_employee, 'text-red-600')}
      {taxTreatment === 'paye' && line('PAYE', -pay.paye, 'text-red-600')}
      {line('Other deductions', -pay.other_deductions, 'text-red-600')}
      {line('Net pay', pay.net_pay, `font-black text-base border-t pt-1 ${pay.net_pay < 0 ? 'text-red-600' : 'text-green-700'}`)}
      <p className="text-xs text-[#8E9299] pt-1">
        {taxTreatment === 'casual_wht' ? 'Casual worker: final withholding tax, no SSNIT.' : taxTreatment === 'none' ? 'No tax or SSNIT (exempt).' : 'Taxed like permanent staff (PAYE and SSNIT).'}
      </p>
    </div>
  );
}

const cleanItems = (items: PayItem[]) =>
  items.filter(i => i.type.trim() && Number(i.amount) > 0).map(i => ({ ...i, type: i.type.trim(), amount: round2(i.amount) }));

/** Edit one employee's pay inside a draft/reviewed payroll run. */
export function EntryEditor({ open, onOpenChange, runId, entry, rate, config, symbol, onSaved }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runId: number;
  entry: PayrollEntry | null;
  rate: number;
  config: PayrollConfig;
  symbol: string;
  onSaved: () => void;
}) {
  const isCasual = entry?.pay_type === 'casual';
  const isHourly = !isCasual && entry?.wage_type === 'Hourly';
  const [basic, setBasic] = useState(0);
  const [hours, setHours] = useState(0);
  const [days, setDays] = useState(0);
  const [overtime, setOvertime] = useState(0);
  const [allowances, setAllowances] = useState<PayItem[]>([]);
  const [deductions, setDeductions] = useState<PayItem[]>([]);
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open || !entry) return;
    setBasic(Number(entry.base_salary) || 0);
    setHours(Number(entry.hours_worked) || 0);
    setDays(Number(entry.days_worked) || 0);
    setOvertime(Number(entry.overtime_hours) || 0);
    setAllowances(parseItems(entry.detailed_allowances).filter(a => !/^Overtime/i.test(a.type)));
    setDeductions(otherDeductionItems(entry.detailed_deductions));
    setNotes(entry.notes || '');
  }, [open, entry]);

  const effectiveBasic = isHourly ? round2(hours * rate) : basic;
  const overtimePay = isHourly ? round2(overtime * rate * config.overtime_multiplier) : 0;
  const previewAllowances = overtimePay ? [...allowances, { type: 'Overtime', amount: overtimePay }] : allowances;

  const save = async () => {
    if (!entry) return;
    setIsSaving(true);
    try {
      await hrApi.updatePayrollRunEntry(runId, entry.id, {
        ...(isCasual ? { days_worked: days, overtime_hours: overtime } : isHourly ? { hours_worked: hours, overtime_hours: overtime } : { basic }),
        allowances: cleanItems(allowances),
        deductions: cleanItems(deductions),
        notes,
      });
      toast.success(`Updated ${entry.name}`);
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to update entry'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{entry?.name}</DialogTitle>
          <DialogDescription>
            {entry?.employee_id} · {isCasual
              ? `${periodText(entry?.period_start, entry?.period_end)} · casual at ${money(entry?.daily_rate, symbol)}/day`
              : `${entry?.month} ${entry?.year} · ${isHourly ? `Hourly at ${money(rate, symbol)}/hour` : 'Salaried'}`}
          </DialogDescription>
        </DialogHeader>
        <div className="grid md:grid-cols-2 gap-6 py-2">
          <div className="space-y-4">
            {isCasual ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2"><Label>Days worked</Label><Input type="number" min="0" step="0.5" value={days} onChange={e => setDays(Number(e.target.value))} /></div>
                <div className="grid gap-2"><Label>Overtime hours</Label><Input type="number" min="0" step="0.5" value={overtime} onChange={e => setOvertime(Number(e.target.value))} /></div>
                <p className="col-span-2 text-xs text-[#8E9299]">
                  Filled from attendance (half days count as 0.5). Overtime at {money(entry?.overtime_rate, symbol)}/hour. The split across projects is scaled to match.
                </p>
              </div>
            ) : isHourly ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2"><Label>Hours worked</Label><Input type="number" min="0" step="0.5" value={hours} onChange={e => setHours(Number(e.target.value))} /></div>
                <div className="grid gap-2"><Label>Overtime hours</Label><Input type="number" min="0" step="0.5" value={overtime} onChange={e => setOvertime(Number(e.target.value))} /></div>
                <p className="col-span-2 text-xs text-[#8E9299]">Filled from attendance. Overtime is paid at {config.overtime_multiplier}× the hourly rate.</p>
              </div>
            ) : (
              <div className="grid gap-2"><Label>Basic salary for the month</Label><Input type="number" min="0" step="0.01" value={basic} onChange={e => setBasic(Number(e.target.value))} /></div>
            )}
            <PayItemsEditor label="Allowances" items={allowances} onChange={setAllowances} allowances config={config} basic={effectiveBasic} />
            <PayItemsEditor label="Deductions" items={deductions} onChange={setDeductions} config={config} basic={effectiveBasic} />
            <div className="grid gap-2"><Label>Notes</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} /></div>
          </div>
          {isCasual ? (
            <CasualPreview days={days} dailyRate={Number(entry?.daily_rate) || 0} overtime={overtime} overtimeRate={Number(entry?.overtime_rate) || 0}
              taxTreatment={effectiveTaxTreatment({ wage_type: 'Daily', tax_treatment: entry?.tax_treatment })}
              allowances={cleanItems(allowances)} deductions={cleanItems(deductions)} config={config} symbol={symbol} />
          ) : (
            <PayPreview basic={effectiveBasic} allowances={previewAllowances} deductions={cleanItems(deductions)} config={config} symbol={symbol} />
          )}
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={isSaving} className="bg-[#141414] text-white rounded-xl gap-2">
            {isSaving && <Loader2 className="w-4 h-4 animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A one-off payment for one employee outside a payroll run (final pay, arrears, ...). */
export function OneOffPaymentDialog({ open, onOpenChange, employees, projects, config, symbol, onSaved }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employees: Employee[];
  projects: { id: string; name: string }[];
  config: PayrollConfig;
  symbol: string;
  onSaved: () => void;
}) {
  const now = new Date();
  const [employeeId, setEmployeeId] = useState('');
  const [month, setMonth] = useState(MONTHS[now.getMonth()]);
  const [year, setYear] = useState(now.getFullYear());
  const [paymentDate, setPaymentDate] = useState(todayIso());
  const [projectId, setProjectId] = useState('none');
  const [basic, setBasic] = useState(0);
  const [hours, setHours] = useState(0);
  const [allowances, setAllowances] = useState<PayItem[]>([]);
  const [deductions, setDeductions] = useState<PayItem[]>([]);
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const [days, setDays] = useState(0);
  const [overtime, setOvertime] = useState(0);
  const [periodStart, setPeriodStart] = useState(todayIso());
  const [periodEnd, setPeriodEnd] = useState(todayIso());

  const employee = useMemo(() => employees.find(e => e.id === employeeId), [employees, employeeId]);
  const isCasual = employee?.wage_type === 'Daily';
  const isHourly = employee?.wage_type === 'Hourly';
  const rate = Number(employee?.salary) || 0;
  const overtimeRate = casualOvertimeRate(rate, employee?.overtime_rate, config);

  useEffect(() => {
    if (!open) return;
    setEmployeeId('');
    setBasic(0);
    setHours(0);
    setDays(0);
    setOvertime(0);
    setPeriodStart(todayIso());
    setPeriodEnd(todayIso());
    setAllowances([]);
    setDeductions([]);
    setNotes('');
    setProjectId('none');
    setPaymentDate(todayIso());
  }, [open]);

  useEffect(() => {
    if (employee && !isHourly) setBasic(Number(employee.salary) || 0);
  }, [employee, isHourly]);

  const effectiveBasic = isHourly ? round2(hours * rate) : basic;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employee) {
      toast.error('Choose an employee');
      return;
    }
    setIsSaving(true);
    try {
      await hrApi.processPayroll({
        employee_id: employee.id,
        ...(isCasual
          ? { period_start: periodStart, period_end: periodEnd, days_worked: days, overtime_hours: overtime }
          : { month, year, ...(isHourly ? { hours_worked: hours } : { basic }) }),
        payment_date: paymentDate,
        allowances: cleanItems(allowances),
        deductions: cleanItems(deductions),
        project_id: projectId,
        notes,
      });
      toast.success(`Payment for ${employee.name} submitted for approval`);
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to create payment'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <form onSubmit={save}>
          <DialogHeader>
            <DialogTitle>One-off payment</DialogTitle>
            <DialogDescription>
              For pay outside the regular runs, such as final settlements, arrears or a casual worker leaving mid-week. It is posted to the ledger when approved.
            </DialogDescription>
          </DialogHeader>
          <div className="grid md:grid-cols-2 gap-6 py-4">
            <div className="space-y-4">
              <div className="grid gap-2">
                <Label>Employee</Label>
                <Select value={employeeId} onValueChange={setEmployeeId}>
                  <SelectTrigger className="rounded-xl"><SelectValue placeholder="Select employee..." /></SelectTrigger>
                  <SelectContent>
                    {employees.map(e => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.name} ({e.id}){e.wage_type === 'Daily' ? ' · casual' : ''}{e.status === 'terminated' ? ' · terminated' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {isCasual ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2"><Label>Worked from</Label><Input type="date" value={periodStart} max={todayIso()} onChange={e => { setPeriodStart(e.target.value); if (periodEnd < e.target.value) setPeriodEnd(e.target.value); }} required /></div>
                  <div className="grid gap-2"><Label>To</Label><Input type="date" value={periodEnd} min={periodStart} onChange={e => setPeriodEnd(e.target.value)} required /></div>
                  <div className="grid gap-2"><Label>Days worked (at {money(rate, symbol)}/day)</Label><Input type="number" min="0" step="0.5" value={days} onChange={e => setDays(Number(e.target.value))} /></div>
                  <div className="grid gap-2"><Label>Overtime hours (at {money(overtimeRate, symbol)}/h)</Label><Input type="number" min="0" step="0.5" value={overtime} onChange={e => setOvertime(Number(e.target.value))} /></div>
                  <p className="col-span-2 text-xs text-[#8E9299]">The period can't overlap casual pay already made to this worker.</p>
                </div>
              ) : (
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label>Month</Label>
                  <Select value={month} onValueChange={setMonth}>
                    <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>{MONTHS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Year</Label>
                  <Select value={String(year)} onValueChange={v => setYear(Number(v))}>
                    <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>{yearOptions().map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2"><Label>Payment date</Label><Input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} required /></div>
                <div className="grid gap-2">
                  <Label>Charge to project</Label>
                  <Select value={projectId} onValueChange={setProjectId}>
                    <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Office / overhead</SelectItem>
                      {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.id} - {p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {isCasual ? null : isHourly ? (
                <div className="grid gap-2">
                  <Label>Hours worked (at {money(rate, symbol)}/hour)</Label>
                  <Input type="number" min="0" step="0.5" value={hours} onChange={e => setHours(Number(e.target.value))} />
                </div>
              ) : (
                <div className="grid gap-2"><Label>Basic pay</Label><Input type="number" min="0" step="0.01" value={basic} onChange={e => setBasic(Number(e.target.value))} /></div>
              )}
              <PayItemsEditor label="Allowances" items={allowances} onChange={setAllowances} allowances config={config} basic={effectiveBasic} />
              <PayItemsEditor label="Deductions" items={deductions} onChange={setDeductions} config={config} basic={effectiveBasic} />
              <div className="grid gap-2"><Label>Notes</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} /></div>
            </div>
            {isCasual ? (
              <CasualPreview days={days} dailyRate={rate} overtime={overtime} overtimeRate={overtimeRate} taxTreatment={effectiveTaxTreatment(employee!)}
                allowances={cleanItems(allowances)} deductions={cleanItems(deductions)} config={config} symbol={symbol} />
            ) : (
              <PayPreview basic={effectiveBasic} allowances={cleanItems(allowances)} deductions={cleanItems(deductions)} config={config} symbol={symbol} />
            )}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isSaving || !employee} className="bg-[#141414] text-white rounded-xl gap-2">
              {isSaving && <Loader2 className="w-4 h-4 animate-spin" />} Submit for approval
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
