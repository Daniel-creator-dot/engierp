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
import { isValidSsnit, normaliseSsnit } from '../../../lib/payrollCalc';
import type { Employee } from './types';
import { EMPLOYMENT_TYPES, FIXED_TERM_TYPES, errorMessage } from './utils';

type FormState = Record<string, string>;

const TEXT_FIELDS = [
  'name', 'role', 'department', 'salary', 'joinDate', 'status', 'ssnit', 'ghana_card', 'phone', 'address',
  'bank_name', 'account_name', 'account_number', 'branch', 'wage_type', 'date_of_birth', 'employment_type',
  'probation_end_date', 'contract_end_date', 'exit_date', 'annual_leave_days',
];

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
  onSaved: () => void;
}

export default function EmployeeForm({ open, onOpenChange, employee, departments, defaultLeaveDays, onSaved }: EmployeeFormProps) {
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
                  <Select value={form.employment_type || 'Permanent'} onValueChange={set('employment_type')}>
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
                <div className="grid gap-2"><Label>Contract End Date</Label><Input type="date" {...bind('contract_end_date')} required className="bg-white" /></div>
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

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="grid gap-2">
                <Label>Wage Type</Label>
                <Select value={form.wage_type || 'Salaried'} onValueChange={set('wage_type')}>
                  <SelectTrigger className={selectClass}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Salaried">Salaried</SelectItem>
                    <SelectItem value="Hourly">Hourly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>{form.wage_type === 'Hourly' ? 'Hourly Rate (GH₵)' : 'Monthly Basic Salary (GH₵)'}</Label>
                <Input type="number" min="0" step="0.01" {...bind('salary')} required />
                {form.wage_type === 'Hourly' && Number(form.salary) > 500 && (
                  <p className="text-[11px] text-amber-700">This looks like a monthly figure. Hourly staff are paid hours × rate.</p>
                )}
              </div>
              <div className="grid gap-2">
                <Label>Annual Leave Days</Label>
                <Input type="number" min="0" max="60" step="1" placeholder={`Default (${defaultLeaveDays})`} {...bind('annual_leave_days')} />
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
