import { useEffect, useState, type FormEvent } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Textarea } from '../../ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { accountingApi } from '../../../lib/api';
import { errorText } from './print';

export type CorrectionTarget = { kind: 'bill' | 'invoice'; record: any } | null;

const NO_PROJECT = 'none';
const dateInput = (v: any) => (v ? String(v).slice(0, 10) : '');
const parseItems = (items: any) => {
  if (Array.isArray(items)) return items;
  try { return JSON.parse(items || '[]'); } catch { return []; }
};

interface Props {
  target: CorrectionTarget;
  coa: any[];
  suppliers: any[];
  projects: any[];
  currSym: string;
  onClose: () => void;
  onSubmitted: () => void;
}

/** Proposes a correction to a posted bill or invoice. Nothing changes until an admin approves it. */
export default function CorrectionDialog({ target, coa, suppliers, projects, currSym, onClose, onSubmitted }: Props) {
  const [form, setForm] = useState<any>({});
  const [items, setItems] = useState<{ description: string; quantity: number; unitPrice: number; service_id?: number | null }[]>([]);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!target) return;
    const r = target.record;
    setReason('');
    if (target.kind === 'bill') {
      setForm({
        supplier_id: String(r.supplier_id ?? ''), account_id: String(r.account_id ?? ''), quantity: Number(r.quantity || 1),
        unit_price: Number(r.unit_price ?? r.amount ?? 0), date: dateInput(r.date || r.created_at), due_date: dateInput(r.due_date),
        category: r.category || '', project_id: r.project_id || NO_PROJECT, reference: r.reference || '', description: r.description || '',
      });
    } else {
      let breakdown: any[] = [];
      try { breakdown = typeof r.tax_breakdown === 'string' ? JSON.parse(r.tax_breakdown) : r.tax_breakdown || []; } catch { breakdown = []; }
      setForm({
        client: r.client || '', project_id: r.project_id || NO_PROJECT, date: dateInput(r.date || r.created_at), dueDate: dateInput(r.dueDate),
        apply_tax: breakdown.length > 0 || Number(r.tax_amount) > 0,
      });
      setItems(parseItems(r.items).map((it: any) => ({ description: it.description || '', quantity: Number(it.quantity) || 0, unitPrice: Number(it.unitPrice) || 0, service_id: it.service_id ?? null })));
    }
  }, [target]);

  if (!target) return null;
  const set = (patch: any) => setForm((f: any) => ({ ...f, ...patch }));
  const isBill = target.kind === 'bill';
  const label = isBill ? `Bill #${target.record.id} (${target.record.supplier_name || ''})` : `Invoice ${target.record.id}`;
  const billTotal = Number(form.quantity || 0) * Number(form.unit_price || 0);
  const invoiceSubtotal = items.reduce((s, it) => s + Number(it.quantity || 0) * Number(it.unitPrice || 0), 0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 3) {
      toast.error('Explain why this correction is needed');
      return;
    }
    const project_id = form.project_id && form.project_id !== NO_PROJECT ? form.project_id : null;
    const proposed = isBill
      ? { ...form, project_id, account_id: Number(form.account_id), quantity: Number(form.quantity), unit_price: Number(form.unit_price), due_date: form.due_date || undefined }
      : { ...form, project_id, items: items.filter(it => it.description.trim() && Number(it.quantity) > 0), dueDate: form.dueDate || undefined };
    setSaving(true);
    try {
      const res = await accountingApi.requestApproval({ entity_type: target.kind, entity_id: target.record.id, action: 'correct', reason: reason.trim(), proposed });
      toast.success(res.data.message);
      onSubmitted();
      onClose();
    } catch (error: any) {
      toast.error(errorText(error, 'Failed to submit the correction'));
    } finally {
      setSaving(false);
    }
  };

  const field = 'bg-[#F5F5F5] border-none';
  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="rounded-2xl max-w-2xl max-h-[90vh] overflow-y-auto">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Correct {label}</DialogTitle>
            <DialogDescription>
              Change what is wrong and say why. An admin reviews the change; once approved, the original posting is reversed and the corrected one is posted. Until then nothing changes.
            </DialogDescription>
          </DialogHeader>

          {isBill ? (
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Supplier</Label>
                  <Select value={form.supplier_id} onValueChange={(v) => set({ supplier_id: v })}>
                    <SelectTrigger className={field}><SelectValue /></SelectTrigger>
                    <SelectContent>{suppliers.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Expense / Asset account</Label>
                  <Select value={form.account_id} onValueChange={(v) => set({ account_id: v })}>
                    <SelectTrigger className={field}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {coa.filter(a => a.type === 'Expense' || a.type === 'Asset').map(a => <SelectItem key={a.id} value={String(a.id)}>{a.code} - {a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2"><Label>Quantity</Label><Input type="number" min="0.01" step="any" required value={form.quantity ?? ''} onChange={(e) => set({ quantity: e.target.value })} className={field} /></div>
                <div className="space-y-2"><Label>Unit price</Label><Input type="number" min="0" step="0.01" required value={form.unit_price ?? ''} onChange={(e) => set({ unit_price: e.target.value })} className={field} /></div>
                <div className="space-y-2"><Label>Total ({currSym})</Label><Input readOnly value={billTotal.toFixed(2)} className="bg-blue-50 border-none font-bold" /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Bill date</Label><Input type="date" required value={form.date || ''} onChange={(e) => set({ date: e.target.value })} className={field} /></div>
                <div className="space-y-2"><Label>Due date</Label><Input type="date" value={form.due_date || ''} onChange={(e) => set({ due_date: e.target.value })} className={field} /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Category</Label><Input value={form.category || ''} onChange={(e) => set({ category: e.target.value })} className={field} /></div>
                <div className="space-y-2"><Label>Supplier invoice no.</Label><Input value={form.reference || ''} onChange={(e) => set({ reference: e.target.value })} className={field} /></div>
              </div>
              <div className="space-y-2">
                <Label>Project</Label>
                <Select value={form.project_id || NO_PROJECT} onValueChange={(v) => set({ project_id: v })}>
                  <SelectTrigger className={field}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_PROJECT}>General Office / No Project</SelectItem>
                    {projects.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.id} - {p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Description</Label><Input value={form.description || ''} onChange={(e) => set({ description: e.target.value })} className={field} /></div>
            </div>
          ) : (
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Client</Label><Input required value={form.client || ''} onChange={(e) => set({ client: e.target.value })} className={field} /></div>
                <div className="space-y-2">
                  <Label>Project</Label>
                  <Select value={form.project_id || NO_PROJECT} onValueChange={(v) => set({ project_id: v })}>
                    <SelectTrigger className={field}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_PROJECT}>No project</SelectItem>
                      {projects.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.id} - {p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Invoice date</Label><Input type="date" required value={form.date || ''} onChange={(e) => set({ date: e.target.value })} className={field} /></div>
                <div className="space-y-2"><Label>Due date</Label><Input type="date" value={form.dueDate || ''} onChange={(e) => set({ dueDate: e.target.value })} className={field} /></div>
              </div>
              <div className="space-y-2">
                <Label>Line items</Label>
                {items.map((it, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2">
                    <Input className={`col-span-6 ${field}`} placeholder="Description" value={it.description} onChange={(e) => setItems(items.map((x, i) => (i === idx ? { ...x, description: e.target.value } : x)))} />
                    <Input className={`col-span-2 ${field}`} type="number" step="any" min="0" placeholder="Qty" value={it.quantity} onChange={(e) => setItems(items.map((x, i) => (i === idx ? { ...x, quantity: Number(e.target.value) } : x)))} />
                    <Input className={`col-span-3 ${field}`} type="number" step="0.01" min="0" placeholder="Unit price" value={it.unitPrice} onChange={(e) => setItems(items.map((x, i) => (i === idx ? { ...x, unitPrice: Number(e.target.value) } : x)))} />
                    <Button type="button" variant="ghost" size="icon" className="col-span-1 text-red-500" disabled={items.length <= 1} onClick={() => setItems(items.filter((_, i) => i !== idx))}><Trash2 className="w-4 h-4" /></Button>
                  </div>
                ))}
                <div className="flex justify-between items-center">
                  <Button type="button" variant="ghost" size="sm" className="gap-1" onClick={() => setItems([...items, { description: '', quantity: 1, unitPrice: 0 }])}><Plus className="w-4 h-4" /> Add line</Button>
                  <span className="text-xs font-bold text-[#8E9299]">Subtotal {currSym}{invoiceSubtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={!!form.apply_tax} onChange={(e) => set({ apply_tax: e.target.checked })} />
                Apply sales taxes (current rates from Foundation &amp; Setup)
              </label>
            </div>
          )}

          <div className="space-y-2 pb-4">
            <Label>Reason for the correction <span className="text-red-500">*</span></Label>
            <Textarea required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong supplier selected; amount keyed as 12,000 instead of 1,200" className={field} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={saving} className="w-full bg-[#141414] text-white h-11 font-bold">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'SEND FOR APPROVAL'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
