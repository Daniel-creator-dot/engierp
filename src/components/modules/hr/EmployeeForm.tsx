import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Textarea } from '../../ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { toast } from 'sonner';
import { hrApi } from '../../../lib/api';
import { GHANA_BANKS } from '../../../lib/constants';
import { todayIso } from '../../../lib/dates';
import {
  casualOvertimeRate, DEFAULT_PAYROLL_CONFIG, isValidSsnit, normaliseSsnit, PayrollConfig, TAX_TREATMENTS,
} from '../../../lib/payrollCalc';
import type { Employee } from './types';
import { EMPLOYMENT_TYPES, FIXED_TERM_TYPES, WAGE_TYPE_LABELS, errorMessage, money, payRateWarning } from './utils';

type FormState = Record<string, string>;

const TEXT_FIELDS = [
  'name', 'role', 'department', 'salary', 'joinDate', 'status', 'ssnit', 'ghana_card', 'phone', 'address',
  'bank_name', 'account_name', 'account_number', 'branch', 'wage_type', 'date_of_birth', 'employment_type',
  'probation_end_date', 'contract_end_date', 'exit_date', 'annual_leave_days',
  'overtime_rate', 'pay_frequency', 'tax_treatment',
];
const DEFAULT_TAX = 'default';

const toForm = (employee?: Employee | null): FormState => {
  const base: FormState = Object.fromEntries(TEXT_FIELDS.map(f => [f, '']));
  if (!employee) {
    return { ...base, joinDate: todayIso(), status: 'active', wage_type: 'Salaried', employment_type: 'Permanent' };
  }
  for (const field of TEXT_FIELDS) {
    const value = (employee as any)[field];
    base[field] = value == null ? '' : field.endsWith('date') || field === 'joinDate' ? String(value).slice(0, 10) : String(value);
  }
  return base;
};

interface EmployeeFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee?: Employee | null;
  departments: string[];
  defaultLeaveDays: number;
  payrollConfig?: PayrollConfig;
  onSaved: () => void;
}

export default function EmployeeForm({
  open, onOpenChange, employee, departments, defaultLeaveDays, payrollConfig = DEFAULT_PAYROLL_CONFIG, onSaved,
}: EmployeeFormProps) {
  const [form, setForm] = useState<FormState>(() => toForm(employee));
  const [isSaving, setIsSaving] = useState(false);
  const isEdit = Boolean(employee);

  useEffect(() => {
    if (open) setForm(toForm(employee));
  }, [open, employee]);

  const set = (field: string) => (value: string) => setForm(prev => ({ ...prev, [field]: value }));
  const bind = (field: string) => ({
    value: form[field],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(field)(e.target.value),
  });

  const ssnitError = form.ssnit && !isValidSsnit(form.ssnit)
    ? 'Use a letter + 12 digits (e.g. C018012345678) or a Ghana Card PIN (GHA-123456789-0)'
    : '';
  const isFixedTerm = FIXED_TERM_TYPES.includes(form.employment_type);
  const isDaily = form.wage_type === 'Daily';
  const rateWarning = payRateWarning({ wage_type: form.wage_type, salary: Number(form.salary) || 0 });
  const defaultOtRate = casualOvertimeRate(Number(form.salary) || 0, null, payrollConfig);

  // Casual staff are normally daily-rated; switching the employment type moves the pay basis with it.
  const setEmploymentType = (value: string) => setForm(prev => ({
    ...prev,
    employment_type: value,
    ...(value === 'Casual' && prev.wage_type !== 'Daily' ? { wage_type: 'Daily', pay_frequency: prev.pay_frequency || 'Weekly' } : {}),
    ...(value !== 'Casual' && prev.employment_type === 'Casual' && prev.wage_type === 'Daily' ? { wage_type: 'Salaried' } : {}),
  }));
  const setWageType = (value: string) => setForm(prev => ({
    ...prev, wage_type: value, ...(value === 'Daily' && !prev.pay_frequency ? { pay_frequency: 'Weekly' } : {}),
  }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (ssnitError) {
      toast.error(`SSNIT number: ${ssnitError}`);
      return;
    }
    const payload: Record<string, unknown> = { ...form };
    payload.salary = Number(form.salary) || 0;
    payload.ssnit = form.ssnit ? normaliseSsnit(form.ssnit) : null;
    payload.annual_leave_days = form.annual_leave_days === '' ? null : Number(form.annual_leave_days);
    payload.overtime_rate = isDaily && form.overtime_rate !== '' ? Number(form.overtime_rate) : null;
    payload.pay_frequency = isDaily ? (form.pay_frequency || 'Weekly') : null;
    payload.tax_treatment = form.tax_treatment && form.tax_treatment !== DEFAULT_TAX ? form.tax_treatment : null;
    if (!isFixedTerm) payload.contract_end_date = null;
    if (form.status !== 'terminated') payload.exit_date = null;
    for (const key of Object.keys(payload)) if (payload[key] === '') payload[key] = null;

    setIsSaving(true);
    try {
      if (employee) {
        await hrApi.updateEmployee(employee.id, payload);
        toast.success('Employee record updated');
      } else {
        const res = await hrApi.addEmployee(payload);
        toast.success(`Employee registered as ${res.data?.id ?? 'new staff'}`);
      }
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(errorMessage(error, isEdit ? 'Failed to update employee' : 'Failed to add employee'));
    } finally {
      setIsSaving(false);
    }
  };

  const selectClass = 'bg-white border-slate-200 rounded-xl';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? `Edit ${employee?.name}` : 'Personnel Onboarding'}</DialogTitle>
            <DialogDescription>
              {isEdit ? `Staff ID ${employee?.id}` : 'A staff ID is assigned automatically when the record is saved.'}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="grid gap-2"><Label>Full Name</Label><Input {...bind('name')} required /></div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="grid gap-2"><Label>Primary Role</Label><Input {...bind('role')} required /></div>
              <div className="grid gap-2">
                <Label>Department</Label>
                <Input {...bind('department')} list="hr-departments" required />
                <datalist id="hr-departments">{departments.map(d => <option key={d} value={d} />)}</datalist>
              </div>
            </div>

            <div className="space-y-4 p-4 bg-[#F5F5F5]/60 rounded-2xl">
              <p className="text-xs font-black uppercase tracking-widest text-[#141414]">Employment</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="grid gap-2"><Label>Commencement Date</Label><Input type="date" {...bind('joinDate')} required className="bg-white" /></div>
                <div className="grid gap-2">
                  <Label>Employment Type</Label>
                  <Select value={form.employment_type || 'Permanent'} onValueChange={setEmploymentType}>
                    <SelectTrigger className={selectClass}><SelectValue /></SelectTrigger>
                    <SelectContent>{EMPLOYMENT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="grid gap-2"><Label>Date of Birth</Label><Input type="date" max={todayIso()} {...bind('date_of_birth')} className="bg-white" /></div>
                <div className="grid gap-2"><Label>Probation End Date</Label><Input type="date" {...bind('probation_end_date')} className="bg-white" /></div>
              </div>
              {isFixedTerm && (
                <div className="grid gap-2">
                  <Label>Contract End Date{form.employment_type === 'Casual' ? ' (optional)' : ''}</Label>
                  <Input type="date" {...bind('contract_end_date')} required={form.employment_type !== 'Casual'} className="bg-white" />
                </div>
              )}
              {isEdit && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>Status</Label>
                    <Select value={form.status || 'active'} onValueChange={set('status')}>
                      <SelectTrigger className={selectClass}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="on-leave">On leave</SelectItem>
                        <SelectItem value="terminated">Terminated</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {form.status === 'terminated' && (
                    <div className="grid gap-2"><Label>Exit Date</Label><Input type="date" {...bind('exit_date')} required className="bg-white" /></div>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-4 p-4 bg-[#F5F5F5]/60 rounded-2xl">
              <p className="text-xs font-black uppercase tracking-widest text-[#141414]">Pay Setup</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="grid gap-2">
                  <Label>Pay Basis</Label>
                  <Select value={form.wage_type || 'Salaried'} onValueChange={setWageType}>
                    <SelectTrigger className={selectClass}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(WAGE_TYPE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>{isDaily ? 'Daily Rate (GH₵)' : form.wage_type === 'Hourly' ? 'Hourly Rate (GH₵)' : 'Monthly Basic Salary (GH₵)'}</Label>
                  <Input type="number" min="0" step="0.01" {...bind('salary')} required className="bg-white" />
                  {rateWarning && Number(form.salary) > 0 && (
                    <p className="text-[11px] text-amber-700">
                      {rateWarning}. {isDaily ? 'Casual workers are paid days worked × this rate.' : 'Hourly staff are paid hours × rate.'}
                    </p>
                  )}
                </div>
                <div className="grid gap-2">
                  <Label>Annual Leave Days</Label>
                  <Input type="number" min="0" max="60" step="1" placeholder={`Default (${defaultLeaveDays})`} {...bind('annual_leave_days')} className="bg-white" />
                </div>
              </div>
              {isDaily && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>Paid</Label>
                    <Select value={form.pay_frequency || 'Weekly'} onValueChange={set('pay_frequency')}>
                      <SelectTrigger className={selectClass}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Weekly">Weekly (Monday to Saturday, paid Saturday)</SelectItem>
                        <SelectItem value="Daily">Daily (paid at the end of each day)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Overtime Rate per Hour (GH₵)</Label>
                    <Input type="number" min="0" step="0.01" {...bind('overtime_rate')} className="bg-white"
                      placeholder={`Default ${money(defaultOtRate)} (${payrollConfig.casual_overtime_multiplier}× of rate ÷ ${payrollConfig.casual_hours_per_day}h)`} />
                  </div>
                </div>
              )}
              <div className="grid gap-2">
                <Label>Tax Treatment</Label>
                <Select value={form.tax_treatment || DEFAULT_TAX} onValueChange={set('tax_treatment')}>
                  <SelectTrigger className={selectClass}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DEFAULT_TAX}>
                      Default: {isDaily ? `${payrollConfig.casual_wht_rate}% final withholding tax, no SSNIT` : 'PAYE and SSNIT'}
                    </SelectItem>
                    {TAX_TREATMENTS.map(t => (
                      <SelectItem key={t.value} value={t.value}>{t.value === 'casual_wht' ? `Casual: ${payrollConfig.casual_wht_rate}% final withholding tax, no SSNIT` : t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {isDaily && (
                  <p className="text-[11px] text-[#8E9299]">
                    Casual workers are paid from site attendance: days worked × daily rate + overtime hours × overtime rate, through a casual pay run.
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-4 p-4 bg-[#F5F5F5]/60 rounded-2xl">
              <p className="text-xs font-black uppercase tracking-widest text-[#141414]">Statutory & Contact</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>SSNIT Number</Label>
                  <Input {...bind('ssnit')} placeholder="C018012345678 or GHA-123456789-0" className={`bg-white ${ssnitError ? 'border-red-400' : ''}`} />
                  {ssnitError && <p className="text-[11px] text-red-600">{ssnitError}</p>}
                </div>
                <div className="grid gap-2"><Label>Ghana Card ID</Label><Input {...bind('ghana_card')} placeholder="GHA-123456789-0" className="bg-white" /></div>
              </div>
              <div className="grid gap-2"><Label>Phone Number</Label><Input {...bind('phone')} placeholder="+233..." className="bg-white" /></div>
              <div className="grid gap-2"><Label>Residential Address</Label><Textarea {...bind('address')} placeholder="Street name, City..." className="bg-white" /></div>
            </div>

            <div className="space-y-4 p-4 bg-[#F5F5F5]/60 rounded-2xl">
              <p className="text-xs font-black uppercase tracking-widest text-[#141414]">Salary Bank Account</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Bank Name</Label>
                  <Select value={form.bank_name || undefined} onValueChange={set('bank_name')}>
                    <SelectTrigger className={selectClass}><SelectValue placeholder="Select bank..." /></SelectTrigger>
                    <SelectContent>
                      {Array.from(new Set([...(form.bank_name ? [form.bank_name] : []), ...GHANA_BANKS])).map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2"><Label>Account Name</Label><Input {...bind('account_name')} className="bg-white" /></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="grid gap-2"><Label>Account Number</Label><Input {...bind('account_number')} className="bg-white" /></div>
                <div className="grid gap-2"><Label>Branch</Label><Input {...bind('branch')} className="bg-white" /></div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isSaving} className="bg-[#141414] text-white w-full rounded-xl gap-2">
              {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
              {isEdit ? 'Save Changes' : 'Register Staff'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
