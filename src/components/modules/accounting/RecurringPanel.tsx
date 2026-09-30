import React, { useEffect, useState } from 'react';
import { Edit, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Badge } from '../../ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/table';
import { accountingApi, procurementApi } from '../../../lib/api';
import { formatDate, todayIso } from '../../../lib/dates';
import { errorText, fmtMoney } from './print';

interface Props {
  coa: any[];
  projects: any[];
  currSym: string;
  onGenerated: () => void;
}

type Line = { account_id: string; debit: number; credit: number };
const emptyLines = (): Line[] => [{ account_id: '', debit: 0, credit: 0 }, { account_id: '', debit: 0, credit: 0 }];

export default function RecurringPanel({ coa, projects, currSym, onGenerated }: Props) {
  const [templates, setTemplates] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [generating, setGenerating] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [kind, setKind] = useState<'journal' | 'bill'>('journal');
  const [lines, setLines] = useState<Line[]>(emptyLines());
  const [formKey, setFormKey] = useState(0);

  const load = async () => {
    try {
      const res = await accountingApi.getRecurring();
      setTemplates(res.data);
    } catch (error: any) {
      toast.error(errorText(error, 'Failed to load recurring templates'));
    }
  };

  useEffect(() => {
    load();
    procurementApi.getSuppliers().then(res => setSuppliers(res.data)).catch(() => setSuppliers([]));
  }, []);

  const openEditor = (template?: any) => {
    setEditing(template || {});
    setKind(template?.kind || 'journal');
    setLines(template?.kind === 'journal' && template.payload?.lines?.length
      ? template.payload.lines.map((l: any) => ({ account_id: String(l.account_id), debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 }))
      : emptyLines());
    setFormKey(k => k + 1);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    const projectId = String(fd.get('project_id') || 'none');
    const payload = kind === 'journal'
      ? { description: fd.get('description'), project_id: projectId !== 'none' ? projectId : null, lines: lines.filter(l => l.account_id).map(l => ({ account_id: Number(l.account_id), debit: l.debit || 0, credit: l.credit || 0 })) }
      : {
          supplier_id: fd.get('supplier_id'),
          account_id: Number(fd.get('account_id')),
          amount: Number(fd.get('amount')),
          due_days: Number(fd.get('due_days') || 0),
          category: coa.find(a => String(a.id) === String(fd.get('account_id')))?.name,
          description: fd.get('description'),
          project_id: projectId !== 'none' ? projectId : null,
        };
    const data = {
      name: fd.get('name'),
      kind,
      frequency: fd.get('frequency'),
      next_run_date: fd.get('next_run_date'),
      end_date: fd.get('end_date') || null,
      is_active: fd.get('is_active') === 'on',
      payload,
    };
    try {
      if (editing?.id) await accountingApi.updateRecurring(editing.id, data);
      else await accountingApi.createRecurring(data);
      toast.success('Recurring template saved');
      setEditing(null);
      load();
    } catch (error: any) {
      toast.error(errorText(error, 'Failed to save template'));
    }
  };

  const remove = async (t: any) => {
    if (!window.confirm(`Delete the recurring template "${t.name}"? Items already generated are kept.`)) return;
    try {
      await accountingApi.deleteRecurring(t.id);
      load();
    } catch (error: any) {
      toast.error(errorText(error, 'Failed to delete template'));
    }
  };

  const generate = async () => {
    setGenerating(true);
    try {
      const res = await accountingApi.generateRecurring();
      toast.success(res.data.message);
      res.data.failed?.forEach((f: any) => toast.error(`${f.template}: ${f.message}`));
      load();
      onGenerated();
    } catch (error: any) {
      toast.error(errorText(error, 'Failed to generate recurring items'));
    } finally {
      setGenerating(false);
    }
  };

  const dueCount = templates.filter(t => t.due).length;
  const totalDebit = lines.reduce((s, l) => s + (l.debit || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (l.credit || 0), 0);
  const accountOptions = (filter?: (a: any) => boolean) => coa.filter(a => !filter || filter(a)).map(a => <SelectItem key={a.id} value={String(a.id)}>{a.code} - {a.name}</SelectItem>);

  return (
    <Card className="border-none shadow-sm rounded-2xl overflow-hidden">
      <CardHeader className="bg-[#F5F5F5]/30 border-b border-[#F5F5F5] flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle>Recurring Journals & Bills</CardTitle>
          <CardDescription>Rent, loan repayments, subscriptions and accruals. {dueCount > 0 ? `${dueCount} template(s) are due.` : 'Nothing is due right now.'}</CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1" onClick={() => openEditor()}><Plus className="w-4 h-4" /> New template</Button>
          <Button size="sm" className="gap-1 bg-[#141414] text-white" disabled={generating || dueCount === 0} onClick={generate}>{generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Generate due items</Button>
        </div>
      </CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        <Table>
          <TableHeader><TableRow className="bg-[#F5F5F5]/50"><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Frequency</TableHead><TableHead>Next date</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
          <TableBody>
            {templates.map(t => {
              const amount = t.kind === 'bill' ? Number(t.payload?.amount || 0) : (t.payload?.lines || []).reduce((s: number, l: any) => s + Number(l.debit || 0), 0);
              return (
                <TableRow key={t.id}>
                  <TableCell className="font-bold">{t.name}</TableCell>
                  <TableCell className="text-xs uppercase font-bold text-[#8E9299]">{t.kind}</TableCell>
                  <TableCell className="text-xs capitalize">{t.frequency}</TableCell>
                  <TableCell className="font-mono text-xs">{formatDate(t.next_run_date)}{t.end_date ? <span className="text-[#8E9299]"> (until {formatDate(t.end_date)})</span> : ''}</TableCell>
                  <TableCell className="text-right font-bold">{currSym}{fmtMoney(amount)}</TableCell>
                  <TableCell>{!t.is_active ? <Badge className="bg-gray-100 text-gray-500 border-none">Paused</Badge> : t.due ? <Badge className="bg-orange-100 text-orange-700 border-none">Due</Badge> : <Badge className="bg-green-100 text-green-700 border-none">Scheduled</Badge>}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600" onClick={() => openEditor(t)}><Edit className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => remove(t)}><Trash2 className="w-4 h-4" /></Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {templates.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-8 text-[#8E9299]">No recurring templates yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="rounded-2xl max-w-2xl max-h-[90vh] overflow-y-auto">
          <form onSubmit={save} key={formKey}>
            <DialogHeader>
              <DialogTitle>{editing?.id ? 'Edit recurring template' : 'New recurring template'}</DialogTitle>
              <DialogDescription>Items are created when you click "Generate due items"; missed periods are caught up.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1 col-span-2"><Label>Name</Label><Input name="name" required defaultValue={editing?.name || ''} placeholder="e.g. Office rent" className="bg-[#F5F5F5] border-none" /></div>
                <div className="space-y-1">
                  <Label>Type</Label>
                  <Select value={kind} onValueChange={(v) => setKind(v as 'journal' | 'bill')} disabled={!!editing?.id}>
                    <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="journal">Journal</SelectItem><SelectItem value="bill">Supplier bill</SelectItem></SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label>Frequency</Label>
                  <Select name="frequency" defaultValue={editing?.frequency || 'monthly'}>
                    <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="weekly">Weekly</SelectItem><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="quarterly">Quarterly</SelectItem><SelectItem value="yearly">Yearly</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="space-y-1"><Label>Next date</Label><Input name="next_run_date" type="date" required defaultValue={editing?.next_run_date || todayIso()} className="bg-[#F5F5F5] border-none" /></div>
                <div className="space-y-1"><Label>End date (optional)</Label><Input name="end_date" type="date" defaultValue={editing?.end_date || ''} className="bg-[#F5F5F5] border-none" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label>Description</Label><Input name="description" required={kind === 'journal'} defaultValue={editing?.payload?.description || ''} className="bg-[#F5F5F5] border-none" /></div>
                <div className="space-y-1">
                  <Label>Project (optional)</Label>
                  <Select name="project_id" defaultValue={editing?.payload?.project_id ? String(editing.payload.project_id) : 'none'}>
                    <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="none">No project</SelectItem>{projects.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>

              {kind === 'journal' ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-12 gap-2 text-[10px] font-black uppercase text-[#8E9299]"><div className="col-span-6">Account</div><div className="col-span-3 text-right">Debit</div><div className="col-span-3 text-right">Credit</div></div>
                  {lines.map((l, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2">
                      <div className="col-span-6">
                        <Select value={l.account_id} onValueChange={(v) => setLines(lines.map((x, i) => (i === idx ? { ...x, account_id: v } : x)))}>
                          <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue placeholder="Account" /></SelectTrigger>
                          <SelectContent>{accountOptions()}</SelectContent>
                        </Select>
                      </div>
                      <Input className="col-span-3 bg-[#F5F5F5] border-none text-right" type="number" step="0.01" value={l.debit || ''} onChange={(e) => setLines(lines.map((x, i) => (i === idx ? { ...x, debit: Number(e.target.value) } : x)))} />
                      <Input className="col-span-3 bg-[#F5F5F5] border-none text-right" type="number" step="0.01" value={l.credit || ''} onChange={(e) => setLines(lines.map((x, i) => (i === idx ? { ...x, credit: Number(e.target.value) } : x)))} />
                    </div>
                  ))}
                  <div className="flex justify-between items-center">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setLines([...lines, { account_id: '', debit: 0, credit: 0 }])}>+ Add line</Button>
                    <span className={`text-xs font-bold ${Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0 ? 'text-green-600' : 'text-red-600'}`}>Debits {fmtMoney(totalDebit)} / Credits {fmtMoney(totalCredit)}</span>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Supplier</Label>
                    <Select name="supplier_id" required defaultValue={editing?.payload?.supplier_id ? String(editing.payload.supplier_id) : undefined}>
                      <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue placeholder="Choose supplier" /></SelectTrigger>
                      <SelectContent>{suppliers.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Expense / asset account</Label>
                    <Select name="account_id" required defaultValue={editing?.payload?.account_id ? String(editing.payload.account_id) : undefined}>
                      <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue placeholder="Choose account" /></SelectTrigger>
                      <SelectContent>{accountOptions(a => a.type === 'Expense' || a.type === 'Asset')}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1"><Label>Amount</Label><Input name="amount" type="number" step="0.01" min="0.01" required defaultValue={editing?.payload?.amount || ''} className="bg-[#F5F5F5] border-none" /></div>
                  <div className="space-y-1"><Label>Due after (days)</Label><Input name="due_days" type="number" min="0" defaultValue={editing?.payload?.due_days ?? 30} className="bg-[#F5F5F5] border-none" /></div>
                </div>
              )}
              <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" name="is_active" defaultChecked={editing?.is_active !== false} /> Active</label>
            </div>
            <DialogFooter><Button type="submit" className="w-full bg-[#141414] text-white font-bold">SAVE TEMPLATE</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
