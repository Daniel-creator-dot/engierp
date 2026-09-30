import { useEffect, useState } from 'react';
import { Loader2, Lock, Percent, Plus, ShieldCheck, Trash2, Unlock } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Badge } from '../../ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { accountingApi } from '../../../lib/api';
import { formatDate } from '../../../lib/dates';
import { errorText } from './print';
import { formatWithSymbol } from '../../../lib/currency';

type TaxComponent = { code: string; name: string; rate: number; account_code: string };
const NONE = '__none__';

export function TaxSettingsCard({ coa }: { coa: any[] }) {
  const [components, setComponents] = useState<TaxComponent[]>([]);
  const [incomeAccountId, setIncomeAccountId] = useState(NONE);
  const [whtRate, setWhtRate] = useState('7.5');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    accountingApi.getTaxSettings()
      .then(res => {
        setComponents((res.data.tax_components || []).map((c: any) => ({ code: c.code, name: c.name, rate: Number(c.rate), account_code: c.account_code || '' })));
        setIncomeAccountId(res.data.default_income_account_id ? String(res.data.default_income_account_id) : NONE);
        setWhtRate(String(res.data.wht_rate ?? 7.5));
      })
      .catch((error) => toast.error(errorText(error, 'Failed to load tax settings')))
      .finally(() => setLoading(false));
  }, []);

  const update = (idx: number, patch: Partial<TaxComponent>) => setComponents(components.map((c, i) => (i === idx ? { ...c, ...patch } : c)));

  const save = async () => {
    setSaving(true);
    try {
      await accountingApi.updateTaxSettings({
        tax_components: components,
        default_income_account_id: incomeAccountId !== NONE ? Number(incomeAccountId) : null,
        wht_rate: Number(whtRate),
      });
      toast.success('Tax settings saved');
    } catch (error: any) {
      toast.error(errorText(error, 'Failed to save tax settings'));
    } finally {
      setSaving(false);
    }
  };

  const liabilities = coa.filter(a => a.type === 'Liability');
  const totalRate = components.reduce((s, c) => s + (Number(c.rate) || 0), 0);

  return (
    <Card className="border-none shadow-sm rounded-2xl overflow-hidden">
      <CardHeader className="bg-[#F5F5F5]/30 border-b border-[#F5F5F5]">
        <CardTitle className="text-xl font-black text-[#141414] flex items-center gap-2"><Percent className="w-5 h-5 text-blue-600" /> Taxes</CardTitle>
        <CardDescription>Sales taxes charged on invoices, each posted to its own liability account. All rates apply to the invoice value before tax.</CardDescription>
      </CardHeader>
      <CardContent className="p-8 space-y-5">
        {loading ? <p className="text-sm text-[#8E9299] flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p> : (
          <>
            <div className="space-y-2">
              <div className="grid grid-cols-12 gap-2 text-[10px] font-black uppercase text-[#8E9299]"><div className="col-span-4">Tax</div><div className="col-span-2 text-right">Rate %</div><div className="col-span-5">Liability account</div></div>
              {components.map((c, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <Input className="col-span-4 bg-[#F5F5F5] border-none h-10" value={c.name} placeholder="e.g. VAT" onChange={(e) => update(idx, { name: e.target.value, code: c.code || e.target.value.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 10) })} />
                  <Input className="col-span-2 bg-[#F5F5F5] border-none h-10 text-right" type="number" step="0.01" value={c.rate} onChange={(e) => update(idx, { rate: Number(e.target.value) })} />
                  <div className="col-span-5">
                    <Select value={c.account_code || undefined} onValueChange={(v) => update(idx, { account_code: v })}>
                      <SelectTrigger className="bg-[#F5F5F5] border-none h-10"><SelectValue placeholder="Account" /></SelectTrigger>
                      <SelectContent>{liabilities.map(a => <SelectItem key={a.id} value={a.code}>{a.code} - {a.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <Button variant="ghost" size="icon" className="col-span-1 text-red-500" onClick={() => setComponents(components.filter((_, i) => i !== idx))}><Trash2 className="w-4 h-4" /></Button>
                </div>
              ))}
              <div className="flex justify-between items-center">
                <Button variant="ghost" size="sm" className="gap-1" onClick={() => setComponents([...components, { code: '', name: '', rate: 0, account_code: '' }])}><Plus className="w-4 h-4" /> Add tax</Button>
                <span className="text-xs font-bold text-[#8E9299]">Total {totalRate.toFixed(2)}%</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="font-bold text-xs uppercase text-[#8E9299]">Default revenue account</Label>
                <Select value={incomeAccountId} onValueChange={setIncomeAccountId}>
                  <SelectTrigger className="bg-[#F5F5F5] border-none h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>First income account</SelectItem>
                    {coa.filter(a => a.type === 'Income').map(a => <SelectItem key={a.id} value={String(a.id)}>{a.code} - {a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-[#8E9299]">Used for invoice lines without a catalogue service category.</p>
              </div>
              <div className="space-y-2">
                <Label className="font-bold text-xs uppercase text-[#8E9299]">Default withholding tax %</Label>
                <Input type="number" step="0.01" value={whtRate} onChange={(e) => setWhtRate(e.target.value)} className="bg-[#F5F5F5] border-none h-10" />
                <p className="text-[10px] text-[#8E9299]">Suggested when paying suppliers (e.g. 7.5% services, 3% goods).</p>
              </div>
            </div>
            <Button className="w-full bg-blue-600 text-white rounded-xl h-12 font-black" disabled={saving} onClick={save}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'SAVE TAX SETTINGS'}</Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function ApprovalLimitCard({ isAdmin, currSym }: { isAdmin: boolean; currSym: string }) {
  const money = (value: unknown) => formatWithSymbol(value, currSym);
  const [saved, setSaved] = useState(0);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    accountingApi.getApprovalSettings()
      .then(res => { const v = Number(res.data.bill_approval_threshold || 0); setSaved(v); setDraft(v > 0 ? String(v) : ''); })
      .catch((error) => toast.error(errorText(error, 'Failed to load the approval limit')));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const res = await accountingApi.updateApprovalSettings(draft === '' ? 0 : Number(draft));
      const v = Number(res.data.bill_approval_threshold || 0);
      setSaved(v);
      setDraft(v > 0 ? String(v) : '');
      toast.success(v > 0 ? `Bills above ${money(v)} now need admin approval` : 'Approval limit turned off');
    } catch (error: any) {
      toast.error(errorText(error, 'Failed to save the approval limit'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-none shadow-sm rounded-2xl overflow-hidden">
      <CardHeader className="bg-[#F5F5F5]/30 border-b border-[#F5F5F5]">
        <CardTitle className="text-xl font-black text-[#141414] flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-blue-600" /> Bill Approval Limit</CardTitle>
        <CardDescription>New bills above this amount wait for an admin before they reach Accounts Payable. Corrections and voids always need approval, whatever the amount.</CardDescription>
      </CardHeader>
      <CardContent className="p-8 space-y-5">
        <div className="p-5 rounded-2xl bg-[#F5F5F5]">
          {saved > 0
            ? <><Badge className="bg-blue-100 text-blue-700 border-none font-bold">ON</Badge><p className="mt-2 font-bold">Bills above {money(saved)} need approval</p></>
            : <><Badge className="bg-gray-100 text-gray-600 border-none font-bold">OFF</Badge><p className="mt-2 font-bold">New bills post immediately</p></>}
        </div>
        <div className="space-y-2">
          <Label className="font-bold text-xs uppercase text-[#8E9299]">Approval limit ({currSym})</Label>
          <Input type="number" min="0" step="0.01" value={draft} placeholder="Blank or 0 turns it off" disabled={!isAdmin} onChange={(e) => setDraft(e.target.value)} className="bg-[#F5F5F5] border-none h-11" />
          {!isAdmin && <p className="text-xs text-orange-600 font-medium">Only an admin can change the approval limit.</p>}
        </div>
        {isAdmin && <Button className="w-full bg-[#141414] text-white h-11 font-bold" disabled={saving || Number(draft || 0) === saved} onClick={save}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'SAVE LIMIT'}</Button>}
      </CardContent>
    </Card>
  );
}

export function PeriodLockCard({ isAdmin }: { isAdmin: boolean }) {
  const [closedThrough, setClosedThrough] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    accountingApi.getPeriodLock()
      .then(res => { setClosedThrough(res.data.closed_through || null); setDraft(res.data.closed_through || ''); })
      .catch((error) => toast.error(errorText(error, 'Failed to load period lock')));
  }, []);

  const save = async (value: string | null) => {
    if (value && !window.confirm(`Close the books through ${formatDate(value)}? Nobody will be able to post, edit or delete entries dated on or before that day.`)) return;
    setSaving(true);
    try {
      const res = await accountingApi.updatePeriodLock(value);
      setClosedThrough(res.data.closed_through || null);
      setDraft(res.data.closed_through || '');
      toast.success(res.data.message);
    } catch (error: any) {
      toast.error(errorText(error, 'Failed to update period lock'));
    } finally {
      setSaving(false);
    }
  };

  const reopening = !!closedThrough && (!draft || draft < closedThrough);

  return (
    <Card className="border-none shadow-sm rounded-2xl overflow-hidden">
      <CardHeader className="bg-[#F5F5F5]/30 border-b border-[#F5F5F5]">
        <CardTitle className="text-xl font-black text-[#141414] flex items-center gap-2"><Lock className="w-5 h-5 text-blue-600" /> Period Lock</CardTitle>
        <CardDescription>After a month is reviewed or a return is filed, close it so its figures cannot change.</CardDescription>
      </CardHeader>
      <CardContent className="p-8 space-y-5">
        <div className="p-5 rounded-2xl bg-[#F5F5F5]">
          {closedThrough
            ? <><Badge className="bg-red-100 text-red-700 border-none font-bold">CLOSED</Badge><p className="mt-2 font-bold">Books closed through {formatDate(closedThrough)}</p></>
            : <><Badge className="bg-green-100 text-green-700 border-none font-bold">OPEN</Badge><p className="mt-2 font-bold">No period is locked</p></>}
        </div>
        <div className="space-y-2">
          <Label className="font-bold text-xs uppercase text-[#8E9299]">Close books through</Label>
          <Input type="date" value={draft} onChange={(e) => setDraft(e.target.value)} className="bg-[#F5F5F5] border-none h-11" />
          {reopening && !isAdmin && <p className="text-xs text-orange-600 font-medium">Only an admin can reopen a closed period.</p>}
        </div>
        <div className="flex gap-2">
          <Button className="flex-1 bg-[#141414] text-white h-11 font-bold gap-2" disabled={saving || !draft || draft === closedThrough || (reopening && !isAdmin)} onClick={() => save(draft)}><Lock className="w-4 h-4" /> {reopening ? 'MOVE LOCK BACK' : 'CLOSE PERIOD'}</Button>
          {closedThrough && isAdmin && <Button variant="outline" className="h-11 font-bold gap-2" disabled={saving} onClick={() => save(null)}><Unlock className="w-4 h-4" /> REMOVE LOCK</Button>}
        </div>
      </CardContent>
    </Card>
  );
}
