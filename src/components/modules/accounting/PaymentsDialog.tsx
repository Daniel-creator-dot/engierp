import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Badge } from '../../ui/badge';
import { Textarea } from '../../ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { accountingApi } from '../../../lib/api';
import { formatDate } from '../../../lib/dates';
import { errorText, fmtMoney } from './print';
import { formatWithSymbol } from '../../../lib/currency';

export type PaymentsTarget = { type: 'Invoice' | 'Bill'; id: string; label: string } | null;

const METHODS = ['Bank Direct', 'Bank Transfer', 'Cheque', 'Mobile Money', 'Cash'];
const CREDIT_NOTE = 'Credit Note';

interface Props {
  target: PaymentsTarget;
  bankAccounts: any[];
  currSym: string;
  onClose: () => void;
  onChanged: () => void;
}

/** Payments on one invoice or bill, with correction and void requests that an admin approves. */
export default function PaymentsDialog({ target, bankAccounts, currSym, onClose, onChanged }: Props) {
  const money = (value: unknown) => formatWithSymbol(value, currSym);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<{ id: number; mode: 'correct' | 'void' } | null>(null);
  const [form, setForm] = useState<any>({});
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!target) return;
    setLoading(true);
    try {
      const res = await accountingApi.getPayments({ target_type: target.type, target_id: String(target.id), include_void: 1 });
      setPayments(res.data);
    } catch (error: any) {
      toast.error(errorText(error, 'Failed to load payments'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { setEditing(null); load(); }, [target]);

  if (!target) return null;

  const start = (p: any, mode: 'correct' | 'void') => {
    setEditing({ id: p.id, mode });
    setReason('');
    setForm({
      amount: Number(p.amount), date: String(p.date).slice(0, 10), method: p.method, reference: p.reference || '',
      bank_account_id: p.bank_account_id ? String(p.bank_account_id) : '', wht_rate: Number(p.wht_rate || 0),
    });
  };

  const submit = async (p: any) => {
    if (!editing) return;
    if (reason.trim().length < 3) {
      toast.error('Explain why this change is needed');
      return;
    }
    const proposed = editing.mode === 'correct'
      ? { ...form, amount: Number(form.amount), wht_rate: Number(form.wht_rate || 0), bank_account_id: form.method === 'Cash' ? null : Number(form.bank_account_id) || null }
      : {};
    setSaving(true);
    try {
      const res = await accountingApi.requestApproval({ entity_type: 'payment', entity_id: p.id, action: editing.mode, reason: reason.trim(), proposed });
      toast.success(res.data.message);
      setEditing(null);
      await load();
      onChanged();
    } catch (error: any) {
      toast.error(errorText(error, 'Failed to submit the request'));
    } finally {
      setSaving(false);
    }
  };

  const field = 'bg-[#F5F5F5] border-none';
  const set = (patch: any) => setForm((f: any) => ({ ...f, ...patch }));

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="rounded-2xl max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Payments on {target.label}</DialogTitle>
          <DialogDescription>
            A wrong payment can be corrected or voided. Both go to an admin first; once approved the original posting is reversed and, for a void, the {target.type.toLowerCase()} balance goes back up.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>
        ) : payments.length === 0 ? (
          <p className="py-8 text-center text-sm text-[#8E9299]">No payments recorded yet.</p>
        ) : (
          <div className="space-y-3 py-2">
            {payments.map((p: any) => {
              const isVoid = p.target_type === 'Void';
              const isCredit = p.method === CREDIT_NOTE;
              const open = editing?.id === p.id;
              return (
                <div key={p.id} className={`rounded-xl border border-[#F5F5F5] p-4 ${isVoid ? 'opacity-60' : ''}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-bold text-[#141414]">
                        {p.payment_id} <span className="text-[#8E9299] font-medium">· {formatDate(p.date)} · {p.method}{p.reference ? ` · ${p.reference}` : ''}</span>
                      </p>
                      <p className="text-sm font-black">
                        {money(p.amount)}
                        {Number(p.wht_amount || 0) > 0 && <span className="ml-2 text-xs font-medium text-[#8E9299]">incl. WHT {money(p.wht_amount)} ({Number(p.wht_rate)}%)</span>}
                      </p>
                      {isVoid && p.void_reason && <p className="text-xs text-[#8E9299]">Voided: {p.void_reason}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      {isVoid && <Badge className="bg-gray-100 text-gray-600 border-none font-bold">VOIDED</Badge>}
                      {isCredit && <Badge className="bg-purple-100 text-purple-700 border-none font-bold">CREDIT NOTE</Badge>}
                      {p.pending_request && <Badge className="bg-yellow-100 text-yellow-700 border-none font-bold">{p.pending_request.action === 'void' ? 'VOID PENDING' : 'CORRECTION PENDING'}</Badge>}
                      {!isVoid && !isCredit && !p.pending_request && !open && (
                        <>
                          <Button size="sm" variant="outline" className="font-bold h-8 text-xs" onClick={() => start(p, 'correct')}>Correct</Button>
                          <Button size="sm" variant="ghost" className="font-bold h-8 text-xs text-red-600" onClick={() => start(p, 'void')}>Void</Button>
                        </>
                      )}
                    </div>
                  </div>

                  {open && (
                    <div className="mt-4 space-y-3 border-t border-[#F5F5F5] pt-4">
                      {editing!.mode === 'correct' && (
                        <>
                          <div className="grid grid-cols-3 gap-3">
                            <div className="space-y-1"><Label className="text-xs">Amount (gross)</Label><Input type="number" step="0.01" min="0.01" value={form.amount} onChange={(e) => set({ amount: e.target.value })} className={field} /></div>
                            <div className="space-y-1"><Label className="text-xs">Date</Label><Input type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} className={field} /></div>
                            <div className="space-y-1"><Label className="text-xs">WHT %</Label><Input type="number" step="0.01" min="0" value={form.wht_rate} onChange={(e) => set({ wht_rate: e.target.value })} className={field} /></div>
                          </div>
                          <div className="grid grid-cols-3 gap-3">
                            <div className="space-y-1">
                              <Label className="text-xs">Method</Label>
                              <Select value={form.method} onValueChange={(v) => set({ method: v })}>
                                <SelectTrigger className={field}><SelectValue /></SelectTrigger>
                                <SelectContent>{[...new Set([...METHODS, form.method].filter(Boolean))].map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Bank account</Label>
                              <Select value={form.bank_account_id || undefined} onValueChange={(v) => set({ bank_account_id: v })} disabled={form.method === 'Cash'}>
                                <SelectTrigger className={field}><SelectValue placeholder={form.method === 'Cash' ? 'Cash on hand' : 'Select...'} /></SelectTrigger>
                                <SelectContent>{bankAccounts.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.account_name} ({b.bank_name})</SelectItem>)}</SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1"><Label className="text-xs">Reference</Label><Input value={form.reference} onChange={(e) => set({ reference: e.target.value })} className={field} /></div>
                          </div>
                        </>
                      )}
                      <div className="space-y-1">
                        <Label className="text-xs">Reason <span className="text-red-500">*</span></Label>
                        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} className={field}
                          placeholder={editing!.mode === 'void' ? 'e.g. Payment recorded against the wrong bill' : 'e.g. Amount keyed wrongly; bank statement shows 4,500'} />
                      </div>
                      <div className="flex gap-2">
                        <Button className={`flex-1 h-10 font-bold text-white ${editing!.mode === 'void' ? 'bg-red-600 hover:bg-red-700' : 'bg-[#141414]'}`} disabled={saving} onClick={() => submit(p)}>
                          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : editing!.mode === 'void' ? 'REQUEST VOID' : 'SEND CORRECTION FOR APPROVAL'}
                        </Button>
                        <Button variant="outline" className="h-10" disabled={saving} onClick={() => setEditing(null)}>Cancel</Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
