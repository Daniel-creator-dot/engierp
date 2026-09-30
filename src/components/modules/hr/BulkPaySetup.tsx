import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { toast } from 'sonner';
import { hrApi } from '../../../lib/api';
import { TAX_TREATMENTS } from '../../../lib/payrollCalc';
import type { Employee } from './types';
import { EMPLOYMENT_TYPES, WAGE_TYPE_LABELS, errorMessage, money, payRateWarning, rateUnit } from './utils';

const KEEP = 'keep';
const DEFAULT_TAX = 'default';

interface BulkPaySetupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employees: Employee[];
  symbol: string;
  onSaved: () => void;
}

/** Sets pay basis, rate and employment type on the selected employees in one go (e.g. fixing mis-keyed hourly rates). */
export default function BulkPaySetup({ open, onOpenChange, employees, symbol, onSaved }: BulkPaySetupProps) {
  const [wageType, setWageType] = useState(KEEP);
  const [employmentType, setEmploymentType] = useState(KEEP);
  const [rate, setRate] = useState('');
  const [frequency, setFrequency] = useState(KEEP);
  const [taxTreatment, setTaxTreatment] = useState(KEEP);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) { setWageType(KEEP); setEmploymentType(KEEP); setRate(''); setFrequency(KEEP); setTaxTreatment(KEEP); }
  }, [open]);

  const becomesDaily = wageType === 'Daily' || (wageType === KEEP && employees.every(e => e.wage_type === 'Daily'));
  const updates: Record<string, unknown> = {};
  if (wageType !== KEEP) updates.wage_type = wageType;
  if (employmentType !== KEEP) updates.employment_type = employmentType;
  if (rate !== '') updates.salary = Number(rate);
  if (becomesDaily && frequency !== KEEP) updates.pay_frequency = frequency;
  if (taxTreatment !== KEEP) updates.tax_treatment = taxTreatment === DEFAULT_TAX ? null : taxTreatment;

  const preview = employees.map(e => {
    const next = { wage_type: String(updates.wage_type ?? e.wage_type ?? 'Salaried'), salary: Number(updates.salary ?? e.salary) || 0 };
    return { e, next, warning: payRateWarning(next) };
  });
  const warnings = preview.filter(p => p.warning).length;

  const save = async () => {
    if (Object.keys(updates).length === 0) return toast.error('Choose at least one thing to change');
    if (rate !== '' && !(Number(rate) >= 0)) return toast.error('Rate must be zero or more');
    setIsSaving(true);
    try {
      const res = await hrApi.bulkUpdatePaySetup(employees.map(e => e.id), updates);
      toast.success(res.data?.message || 'Pay setup updated');
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to update pay setup'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Pay setup for {employees.length} employee(s)</DialogTitle>
          <DialogDescription>Only the fields you change are updated; everything else on each file stays as it is. The change is recorded in the audit log.</DialogDescription>
        </DialogHeader>
        <div className="py-2 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="grid gap-2">
              <Label>Pay Basis</Label>
              <Select value={wageType} onValueChange={setWageType}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={KEEP}>Keep current</SelectItem>
                  {Object.entries(WAGE_TYPE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Rate / Salary (GH₵)</Label>
              <Input type="number" min="0" step="0.01" value={rate} onChange={e => setRate(e.target.value)} placeholder="Keep current" className="rounded-xl" />
            </div>
            <div className="grid gap-2">
              <Label>Employment Type</Label>
              <Select value={employmentType} onValueChange={setEmploymentType}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={KEEP}>Keep current</SelectItem>
                  {EMPLOYMENT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {becomesDaily && (
              <div className="grid gap-2">
                <Label>Paid</Label>
                <Select value={frequency} onValueChange={setFrequency}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={KEEP}>{wageType === 'Daily' ? 'Weekly (default)' : 'Keep current'}</SelectItem>
                    <SelectItem value="Weekly">Weekly</SelectItem>
                    <SelectItem value="Daily">Daily</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-2">
              <Label>Tax Treatment</Label>
              <Select value={taxTreatment} onValueChange={setTaxTreatment}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={KEEP}>Keep current</SelectItem>
                  <SelectItem value={DEFAULT_TAX}>Default for the pay basis</SelectItem>
                  {TAX_TREATMENTS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="border rounded-xl max-h-60 overflow-y-auto divide-y text-sm">
            {preview.map(({ e, next, warning }) => (
              <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span><span className="font-bold">{e.name}</span> <span className="text-[#8E9299] text-xs">{e.id}</span></span>
                <span className="text-xs">
                  <span className="text-[#8E9299]">{e.wage_type || 'Salaried'} {money(e.salary, symbol)}{rateUnit(e.wage_type)}</span>
                  {' → '}
                  <span className={warning ? 'text-amber-700 font-bold' : 'font-bold'}>{next.wage_type} {money(next.salary, symbol)}{rateUnit(next.wage_type)}</span>
                </span>
              </div>
            ))}
          </div>
          {warnings > 0 && <p className="text-xs text-amber-700">{warnings} employee(s) would still have a rate that looks wrong for the pay basis.</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="bg-[#141414] text-white rounded-xl gap-2" onClick={save} disabled={isSaving || Object.keys(updates).length === 0}>
            {isSaving && <Loader2 className="w-4 h-4 animate-spin" />} Update {employees.length} employee(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
