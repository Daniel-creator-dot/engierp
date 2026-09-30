import React, { useEffect, useState } from 'react';
import { Loader2, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../ui/card';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/table';
import { toast } from 'sonner';
import { hrApi } from '../../../lib/api';
import { useAuth } from '../../../contexts/AuthContext';
import { DeductionType, GRA_MONTHLY_TAX_TIERS, PayrollConfig, TaxTier, calculatePAYE, normalisePayrollConfig } from '../../../lib/payrollCalc';
import { PAYROLL_APPROVE_ROLES, errorMessage, money } from './utils';

interface ChartAccount { id: number; code: string; name: string; type: string }
interface SettingsResponse {
  config: PayrollConfig;
  accounts: Record<string, number | null>;
  account_labels: Record<string, string>;
  default_codes: Record<string, string>;
  chart: ChartAccount[];
}

const RATE_FIELDS: { key: keyof PayrollConfig; label: string; hint: string }[] = [
  { key: 'ssnit_employee', label: 'SSNIT employee %', hint: 'Deducted from basic pay' },
  { key: 'ssnit_employer', label: 'SSNIT employer %', hint: 'Company cost on basic pay' },
  { key: 'ssnit_tier1', label: 'Tier 1 %', hint: 'Paid to SSNIT' },
  { key: 'ssnit_tier2', label: 'Tier 2 %', hint: 'Paid to the Tier 2 trustee' },
];

const OTHER_FIELDS: { key: keyof PayrollConfig; label: string; step: string }[] = [
  { key: 'annual_leave_days', label: 'Default annual leave (days)', step: '1' },
  { key: 'max_carry_over_days', label: 'Max leave carried into next year', step: '1' },
  { key: 'overtime_multiplier', label: 'Overtime rate (× hourly rate)', step: '0.25' },
  { key: 'standard_hours_per_day', label: 'Standard hours per day', step: '0.5' },
];

const CASUAL_FIELDS: { key: keyof PayrollConfig; label: string; step: string; hint: string }[] = [
  { key: 'casual_wht_rate', label: 'Casual withholding tax %', step: '0.5', hint: 'GRA final tax on casual workers’ gross pay (no SSNIT)' },
  { key: 'casual_overtime_multiplier', label: 'Casual overtime (× hourly)', step: '0.25', hint: 'Hourly = daily rate ÷ hours per day' },
  { key: 'casual_hours_per_day', label: 'Casual hours per day', step: '0.5', hint: 'Used to turn the daily rate into an hourly rate' },
];

export default function PayrollSettings({ onSaved }: { onSaved?: () => void }) {
  const { user } = useAuth();
  const canEditAccounts = PAYROLL_APPROVE_ROLES.includes(user?.role || '');
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [config, setConfig] = useState<PayrollConfig | null>(null);
  const [accounts, setAccounts] = useState<Record<string, number | null>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [testIncome, setTestIncome] = useState(5000);

  const load = async () => {
    try {
      const res = await hrApi.getPayrollSettings();
      setData(res.data);
      setConfig(normalisePayrollConfig(res.data.config));
      setAccounts(res.data.accounts || {});
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to load payroll settings'));
    }
  };

  useEffect(() => { load(); }, []);

  if (!data || !config) return <div className="flex items-center justify-center h-40"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  const setField = (key: keyof PayrollConfig, value: unknown) => setConfig(c => (c ? { ...c, [key]: value } : c));
  const setTier = (i: number, patch: Partial<TaxTier>) => setField('tax_tiers', config.tax_tiers.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const setDeduction = (i: number, patch: Partial<DeductionType>) => setField('deduction_types', config.deduction_types.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  const save = async () => {
    const tiers = config.tax_tiers.map(t => ({ threshold: Number(t.threshold), rate: Number(t.rate) }));
    if (!tiers.length) {
      toast.error('Add at least one PAYE band');
      return;
    }
    const missing = Object.keys(data.account_labels).filter(k => !accounts[k]);
    if (canEditAccounts && missing.length) {
      toast.error(`Choose an account for: ${missing.map(k => data.account_labels[k]).join(', ')}`);
      return;
    }
    setIsSaving(true);
    try {
      await hrApi.savePayrollSettings({
        config: {
          ...Object.fromEntries([...RATE_FIELDS, ...OTHER_FIELDS, ...CASUAL_FIELDS].map(f => [f.key, Number(config[f.key])])),
          tax_tiers: tiers,
          deduction_types: config.deduction_types.filter(d => d.name.trim()).map(d => ({ ...d, name: d.name.trim(), value: Number(d.value) })),
        },
        ...(canEditAccounts ? { accounts } : {}),
      });
      toast.success('Payroll settings saved');
      load();
      onSaved?.();
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to save payroll settings'));
    } finally {
      setIsSaving(false);
    }
  };

  let floor = 0;
  const bands = config.tax_tiers.map((t, i) => {
    const from = floor;
    floor += Number(t.threshold) || 0;
    const last = i === config.tax_tiers.length - 1;
    return { from, to: last ? null : floor };
  });

  return (
    <div className="space-y-4">
      <Card className="border-none shadow-sm rounded-2xl">
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle>PAYE bands (monthly)</CardTitle>
            <CardDescription>Each row is the width of a band. Income above the last band is taxed at the last rate. Confirm the current bands with GRA before running payroll.</CardDescription>
          </div>
          <Button variant="outline" size="sm" className="rounded-xl gap-2" onClick={() => setField('tax_tiers', GRA_MONTHLY_TAX_TIERS.map(t => ({ ...t })))}>
            <RotateCcw className="w-4 h-4" /> GRA 2024 bands
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow className="bg-[#F5F5F5]/50"><TableHead>Band width (GH₵)</TableHead><TableHead>Rate %</TableHead><TableHead>Applies to income</TableHead><TableHead /></TableRow>
            </TableHeader>
            <TableBody>
              {config.tax_tiers.map((t, i) => (
                <TableRow key={i}>
                  <TableCell><Input type="number" min="0" step="0.01" value={t.threshold} onChange={e => setTier(i, { threshold: Number(e.target.value) })} className="w-36 h-9" /></TableCell>
                  <TableCell><Input type="number" min="0" max="100" step="0.5" value={t.rate} onChange={e => setTier(i, { rate: Number(e.target.value) })} className="w-24 h-9" /></TableCell>
                  <TableCell className="text-xs text-[#8E9299]">
                    {bands[i].to === null ? `Above ${money(bands[i].from)}` : `${money(bands[i].from)} – ${money(bands[i].to)}`}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setField('tax_tiers', config.tax_tiers.filter((_, j) => j !== i))}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex flex-wrap items-center gap-4">
            <Button variant="ghost" size="sm" className="gap-1" onClick={() => setField('tax_tiers', [...config.tax_tiers, { threshold: 0, rate: 0 }])}><Plus className="w-3.5 h-3.5" /> Add band</Button>
            <div className="flex items-center gap-2 text-sm ml-auto">
              <span className="text-[#8E9299]">Test: PAYE on chargeable income of</span>
              <Input type="number" min="0" value={testIncome} onChange={e => setTestIncome(Number(e.target.value))} className="w-28 h-8" />
              <span className="font-bold">= {money(calculatePAYE(testIncome, config.tax_tiers))}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-none shadow-sm rounded-2xl">
          <CardHeader><CardTitle>SSNIT, leave & overtime</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            {RATE_FIELDS.map(f => (
              <div key={String(f.key)} className="grid gap-1">
                <Label>{f.label}</Label>
                <Input type="number" min="0" max="100" step="0.1" value={config[f.key]} onChange={e => setField(f.key, e.target.value)} />
                <span className="text-[10px] text-[#8E9299]">{f.hint}</span>
              </div>
            ))}
            {OTHER_FIELDS.map(f => (
              <div key={String(f.key)} className="grid gap-1">
                <Label>{f.label}</Label>
                <Input type="number" min="0" step={f.step} value={config[f.key]} onChange={e => setField(f.key, e.target.value)} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm rounded-2xl">
          <CardHeader>
            <CardTitle>Deduction types</CardTitle>
            <CardDescription>Offered when editing pay (loans, advances, welfare dues...). Percentages apply to basic pay.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {config.deduction_types.length === 0 && <p className="text-sm text-[#8E9299]">No deduction types yet.</p>}
            {config.deduction_types.map((d, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input value={d.name} onChange={e => setDeduction(i, { name: e.target.value })} placeholder="Name" className="flex-1 h-9" />
                <Select value={d.type} onValueChange={v => setDeduction(i, { type: v as DeductionType['type'] })}>
                  <SelectTrigger className="w-32 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="fixed">Fixed</SelectItem><SelectItem value="percentage">% of basic</SelectItem></SelectContent>
                </Select>
                <Input type="number" min="0" step="0.01" value={d.value} onChange={e => setDeduction(i, { value: Number(e.target.value) })} className="w-24 h-9" />
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setField('deduction_types', config.deduction_types.filter((_, j) => j !== i))}><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
            ))}
            <Button variant="ghost" size="sm" className="gap-1" onClick={() => setField('deduction_types', [...config.deduction_types, { name: '', type: 'fixed', value: 0 }])}><Plus className="w-3.5 h-3.5" /> Add deduction type</Button>
          </CardContent>
        </Card>
      </div>

      <Card className="border-none shadow-sm rounded-2xl">
        <CardHeader>
          <CardTitle>Casual workers</CardTitle>
          <CardDescription>
            Daily-rated casual workers are paid days worked × daily rate + overtime hours × overtime rate, from the attendance register. A worker's own overtime rate
            or tax treatment on their employee file overrides these.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          {CASUAL_FIELDS.map(f => (
            <div key={String(f.key)} className="grid gap-1">
              <Label>{f.label}</Label>
              <Input type="number" min="0" step={f.step} value={config[f.key]} onChange={e => setField(f.key, e.target.value)} />
              <span className="text-[10px] text-[#8E9299]">{f.hint}</span>
            </div>
          ))}
          <p className="md:col-span-3 text-xs text-[#8E9299]">
            Example: a {money(120)}/day worker earns {money(120 / (Number(config.casual_hours_per_day) || 8) * Number(config.casual_overtime_multiplier))}/hour overtime;
            a week of 6 days + 4 h overtime is {money(720 + 4 * 120 / (Number(config.casual_hours_per_day) || 8) * Number(config.casual_overtime_multiplier))} gross, less {config.casual_wht_rate}% withholding tax.
          </p>
        </CardContent>
      </Card>

      <Card className="border-none shadow-sm rounded-2xl">
        <CardHeader>
          <CardTitle>Ledger accounts</CardTitle>
          <CardDescription>
            Where approved payroll is posted. {canEditAccounts ? 'Defaults come from the chart of accounts codes shown.' : 'Only an admin or accountant can change these.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {Object.entries(data.account_labels).map(([key, label]) => (
            <div key={key} className="grid gap-1">
              <Label>{label}</Label>
              <Select value={accounts[key] ? String(accounts[key]) : ''} onValueChange={v => setAccounts(a => ({ ...a, [key]: Number(v) }))} disabled={!canEditAccounts}>
                <SelectTrigger className="rounded-xl"><SelectValue placeholder={`Not set (default code ${data.default_codes[key]})`} /></SelectTrigger>
                <SelectContent>
                  {data.chart.map(a => <SelectItem key={a.id} value={String(a.id)}>{a.code} - {a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={isSaving} className="bg-[#141414] text-white rounded-xl gap-2">
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save payroll settings
        </Button>
      </div>
    </div>
  );
}
