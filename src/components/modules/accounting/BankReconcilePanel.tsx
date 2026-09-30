import React, { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { CheckCircle2, Edit, Eye, Link2, Loader2, Plus, Trash2, Undo2, Upload, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Badge } from '../../ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/table';
import { accountingApi } from '../../../lib/api';
import { formatDate, todayIso } from '../../../lib/dates';
import { errorText, fmtMoney } from './print';
import { formatWithSymbol } from '../../../lib/currency';

interface Props {
  bankAccounts: any[];
  bankTx: any[];
  coa: any[];
  currSym: string;
  onChanged: () => void;
  onEditLine: (tx: any) => void;
  onOpenJournal: (journalId: number) => void;
}

type Mapping = { date: string; description: string; amount: string; debit: string; credit: string };
const NONE = '__none__';

const pad = (n: number) => String(n).padStart(2, '0');

/** Statement dates arrive as Date objects, ISO strings, or day-first strings (dd/mm/yyyy). */
function parseStatementDate(value: unknown): string | null {
  if (value instanceof Date && !isNaN(value.getTime())) return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  const s = String(value ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${year}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
  }
  const t = Date.parse(s);
  if (isNaN(t)) return null;
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseAmount(value: unknown): number {
  if (typeof value === 'number') return value;
  let s = String(value ?? '').trim();
  if (!s) return 0;
  const negative = /^\(.*\)$/.test(s) || /^-/.test(s) || /\bDR\b/i.test(s);
  s = s.replace(/[^0-9.]/g, '');
  const n = Number(s) || 0;
  return negative ? -n : n;
}

function guessColumn(headers: string[], patterns: RegExp[]) {
  for (const p of patterns) {
    const hit = headers.find(h => p.test(h));
    if (hit) return hit;
  }
  return NONE;
}

export default function BankReconcilePanel({ bankAccounts, bankTx, coa, currSym, onChanged, onEditLine, onOpenJournal }: Props) {
  const money = (value: unknown) => formatWithSymbol(value, currSym);
  const [accountFilter, setAccountFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'open' | 'all'>('open');
  const [busy, setBusy] = useState(false);
  const [matchTx, setMatchTx] = useState<any>(null);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [postAccountId, setPostAccountId] = useState('');
  const [postDescription, setPostDescription] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importAccountId, setImportAccountId] = useState('');
  const [sheetRows, setSheetRows] = useState<Record<string, unknown>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Mapping>({ date: NONE, description: NONE, amount: NONE, debit: NONE, credit: NONE });
  const [addOpen, setAddOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const lines = useMemo(() => bankTx.filter(tx =>
    (accountFilter === 'all' || String(tx.bank_account_id) === accountFilter) &&
    (statusFilter === 'all' || tx.status !== 'Reconciled')
  ), [bankTx, accountFilter, statusFilter]);

  const openCount = bankTx.filter(tx => tx.status !== 'Reconciled' && (accountFilter === 'all' || String(tx.bank_account_id) === accountFilter)).length;

  const parsedRows = useMemo(() => sheetRows.map(r => {
    const date = mapping.date !== NONE ? parseStatementDate(r[mapping.date]) : null;
    const amount = mapping.amount !== NONE
      ? parseAmount(r[mapping.amount])
      : parseAmount(mapping.credit !== NONE ? r[mapping.credit] : 0) - Math.abs(parseAmount(mapping.debit !== NONE ? r[mapping.debit] : 0));
    const description = mapping.description !== NONE ? String(r[mapping.description] ?? '').trim() : '';
    return { date, amount: Math.round(amount * 100) / 100, description };
  }).filter(r => r.date && r.amount !== 0), [sheetRows, mapping]);

  const readFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: true });
      // Bank exports often have a preamble; the header row is the first with a date-like and an amount-like column.
      const headerIndex = grid.findIndex(row => {
        const cells = row.map(c => String(c).toLowerCase());
        return cells.some(c => /date/.test(c)) && cells.some(c => /amount|debit|credit|withdraw|deposit/.test(c));
      });
      if (headerIndex < 0) {
        toast.error('Could not find a header row with Date and Amount (or Debit/Credit) columns');
        return;
      }
      const hdrs = grid[headerIndex].map((h, i) => String(h).trim() || `Column ${i + 1}`);
      const rows = grid.slice(headerIndex + 1).map(row => Object.fromEntries(hdrs.map((h, i) => [h, row[i]])));
      setHeaders(hdrs);
      setSheetRows(rows);
      const lower = hdrs.map(h => h.toLowerCase());
      const pickCol = (patterns: RegExp[]) => {
        const g = guessColumn(lower, patterns);
        return g === NONE ? NONE : hdrs[lower.indexOf(g)];
      };
      const amountCol = pickCol([/^amount$/, /amount/]);
      setMapping({
        date: pickCol([/^(value|transaction|txn|posting)?\s*date$/, /date/]),
        description: pickCol([/description|narration|details|particulars|memo|remarks/]),
        amount: amountCol,
        debit: amountCol === NONE ? pickCol([/debit|withdraw|paid out|money out/]) : NONE,
        credit: amountCol === NONE ? pickCol([/credit|deposit|paid in|money in/]) : NONE,
      });
      toast.success(`Read ${rows.length} rows from ${file.name}`);
    } catch {
      toast.error('Could not read that file. Use CSV or Excel.');
    }
  };

  const runImport = async () => {
    if (!importAccountId) return toast.error('Choose the bank account this statement belongs to');
    if (parsedRows.length === 0) return toast.error('No valid rows to import. Check the column mapping.');
    setBusy(true);
    try {
      const res = await accountingApi.importBankStatement({ bank_account_id: Number(importAccountId), rows: parsedRows });
      toast.success(res.data.message);
      if (res.data.errors?.length) toast.warning(`${res.data.errors.length} row(s) were rejected: ${res.data.errors.slice(0, 3).join('; ')}`);
      setImportOpen(false);
      setSheetRows([]);
      setHeaders([]);
      setAccountFilter(importAccountId);
      onChanged();
    } catch (error: any) {
      toast.error(errorText(error, 'Import failed'));
    } finally {
      setBusy(false);
    }
  };

  const autoMatch = async () => {
    setBusy(true);
    try {
      const res = await accountingApi.autoMatchBank(accountFilter === 'all' ? undefined : accountFilter);
      toast.success(res.data.message);
      if (res.data.unlinked) toast.warning(`${res.data.unlinked} line(s) belong to bank accounts that are not linked to the ledger`);
      onChanged();
    } catch (error: any) {
      toast.error(errorText(error, 'Auto-match failed'));
    } finally {
      setBusy(false);
    }
  };

  const openMatch = async (tx: any) => {
    setMatchTx(tx);
    setPostAccountId('');
    setPostDescription(tx.description || '');
    setCandidates([]);
    setCandidatesLoading(true);
    try {
      const res = await accountingApi.getBankMatchCandidates(tx.id);
      setCandidates(res.data);
    } catch (error: any) {
      toast.error(errorText(error, 'Could not load matches'));
    } finally {
      setCandidatesLoading(false);
    }
  };

  const matchTo = async (journalId: number) => {
    try {
      await accountingApi.reconcileBankTransaction(matchTx.id, journalId);
      toast.success('Line reconciled');
      setMatchTx(null);
      onChanged();
    } catch (error: any) {
      toast.error(errorText(error, 'Could not reconcile'));
    }
  };

  const postAndMatch = async () => {
    if (!postAccountId) return toast.error('Choose the account to post against');
    try {
      await accountingApi.postBankTransaction(matchTx.id, { account_id: Number(postAccountId), description: postDescription });
      toast.success('Posted to the ledger and reconciled');
      setMatchTx(null);
      onChanged();
    } catch (error: any) {
      toast.error(errorText(error, 'Could not post'));
    }
  };

  const unreconcile = async (tx: any) => {
    try {
      await accountingApi.unreconcileBankTransaction(tx.id);
      toast.success('Line unreconciled');
      onChanged();
    } catch (error: any) {
      toast.error(errorText(error, 'Could not unreconcile'));
    }
  };

  const remove = async (tx: any) => {
    if (!window.confirm('Delete this statement line? Ledger postings are not affected.')) return;
    try {
      await accountingApi.deleteBankTransaction(tx.id);
      onChanged();
    } catch (error: any) {
      toast.error(errorText(error, 'Could not delete'));
    }
  };

  const addLine = async (e: React.FormEvent) => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    try {
      await accountingApi.importBankTransaction({
        bank_account_id: Number(fd.get('bank_account_id')),
        date: fd.get('date'),
        description: fd.get('description'),
        amount: Number(fd.get('amount')),
        type: fd.get('type'),
      });
      toast.success('Statement line added');
      setAddOpen(false);
      onChanged();
    } catch (error: any) {
      toast.error(errorText(error, 'Could not add line'));
    }
  };

  const mappingSelect = (key: keyof Mapping, label: string) => (
    <div className="space-y-1">
      <Label className="text-[10px] font-bold uppercase text-[#8E9299]">{label}</Label>
      <Select value={mapping[key]} onValueChange={(v) => setMapping(m => ({ ...m, [key]: v }))}>
        <SelectTrigger className="h-9 bg-[#F5F5F5] border-none"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>(not used)</SelectItem>
          {headers.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <Card className="border-none shadow-sm rounded-2xl overflow-hidden">
      <CardHeader className="bg-[#F5F5F5]/30 border-b border-[#F5F5F5]">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <CardTitle>Bank Reconciliation</CardTitle>
            <CardDescription>{openCount} statement line(s) still to reconcile.</CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Select value={accountFilter} onValueChange={setAccountFilter}>
              <SelectTrigger className="h-9 w-56 bg-white"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All bank accounts</SelectItem>
                {bankAccounts.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.account_name} ({b.bank_name})</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as 'open' | 'all')}>
              <SelectTrigger className="h-9 w-36 bg-white"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="open">Unreconciled</SelectItem><SelectItem value="all">All lines</SelectItem></SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-9 gap-1" onClick={() => setAddOpen(true)}><Plus className="w-4 h-4" /> Add line</Button>
            <Button variant="outline" size="sm" className="h-9 gap-1" onClick={() => { setImportAccountId(accountFilter !== 'all' ? accountFilter : ''); setImportOpen(true); }}><Upload className="w-4 h-4" /> Import statement</Button>
            <Button size="sm" className="h-9 gap-1 bg-[#141414] text-white" disabled={busy} onClick={autoMatch}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />} Auto-match</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        <Table>
          <TableHeader><TableRow className="bg-[#F5F5F5]/50"><TableHead>Date</TableHead><TableHead>Description</TableHead><TableHead>Bank</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
          <TableBody>
            {lines.map(tx => {
              const reconciled = tx.status === 'Reconciled';
              return (
                <TableRow key={tx.id}>
                  <TableCell className="font-mono text-xs text-[#8E9299] whitespace-nowrap">{formatDate(tx.date)}</TableCell>
                  <TableCell className="font-bold text-[#141414]">{tx.description}</TableCell>
                  <TableCell className="text-xs text-[#8E9299]">{tx.account_name}</TableCell>
                  <TableCell className={`text-right font-black ${tx.type === 'Credit' ? 'text-green-600' : 'text-[#141414]'}`}>{tx.type === 'Credit' ? '+' : '-'}{money(tx.amount)}</TableCell>
                  <TableCell><Badge className={reconciled ? 'bg-green-100 text-green-700 border-none' : 'bg-yellow-100 text-yellow-700 border-none'}>{tx.status}</Badge></TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {!reconciled && <Button variant="outline" size="sm" className="h-8 text-xs font-bold gap-1" onClick={() => openMatch(tx)}><Link2 className="w-3 h-3" /> Match</Button>}
                      {reconciled && tx.matched_ledger_id && <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600" title={`Journal #${tx.matched_ledger_id}`} onClick={() => onOpenJournal(tx.matched_ledger_id)}><Eye className="w-4 h-4" /></Button>}
                      {reconciled && <Button variant="ghost" size="icon" className="h-8 w-8 text-orange-600" title="Unreconcile" onClick={() => unreconcile(tx)}><Undo2 className="w-4 h-4" /></Button>}
                      {!reconciled && <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600" title="Edit line" onClick={() => onEditLine(tx)}><Edit className="w-4 h-4" /></Button>}
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" title="Delete line" onClick={() => remove(tx)}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {lines.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-12 text-[#8E9299]">{statusFilter === 'open' ? 'Everything is reconciled. Import a statement to continue.' : 'No statement lines yet.'}</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={!!matchTx} onOpenChange={(open) => !open && setMatchTx(null)}>
        <DialogContent className="rounded-2xl max-w-2xl">
          <DialogHeader>
            <DialogTitle>Match statement line</DialogTitle>
            <DialogDescription>{matchTx && `${formatDate(matchTx.date)} · ${matchTx.description} · ${matchTx.type === 'Credit' ? '+' : '-'}${money(matchTx.amount)}`}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs font-bold uppercase text-[#8E9299]">Ledger postings with the same amount within 7 days</p>
            {candidatesLoading && <p className="text-sm text-[#8E9299] flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Searching…</p>}
            {!candidatesLoading && candidates.length === 0 && <p className="text-sm text-[#8E9299]">No matching postings. If this line is not in the books yet (e.g. bank charges or interest), post it below.</p>}
            {candidates.map(c => (
              <div key={c.journal_id} className="flex items-center gap-3 p-3 rounded-xl bg-[#F5F5F5]">
                <div className="flex-1">
                  <p className="text-sm font-bold">{c.description}</p>
                  <p className="text-[10px] text-[#8E9299] uppercase font-bold">#{c.journal_id} · {formatDate(c.date)} · {String(c.reference_type).replace(/_/g, ' ')}</p>
                </div>
                <span className="font-mono font-bold">{money(Number(c.debit) || Number(c.credit))}</span>
                <Button size="sm" className="bg-green-600 text-white gap-1" onClick={() => matchTo(c.journal_id)}><CheckCircle2 className="w-4 h-4" /> Match</Button>
              </div>
            ))}
          </div>
          <div className="border-t border-[#F5F5F5] pt-4 space-y-3">
            <p className="text-xs font-bold uppercase text-[#8E9299]">Or post it to the ledger now</p>
            <div className="grid grid-cols-2 gap-3">
              <Select value={postAccountId} onValueChange={setPostAccountId}>
                <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue placeholder={matchTx?.type === 'Credit' ? 'Income / source account' : 'Expense / destination account'} /></SelectTrigger>
                <SelectContent>{coa.map(a => <SelectItem key={a.id} value={String(a.id)}>{a.code} - {a.name}</SelectItem>)}</SelectContent>
              </Select>
              <Input value={postDescription} onChange={(e) => setPostDescription(e.target.value)} placeholder="Description" className="bg-[#F5F5F5] border-none" />
            </div>
          </div>
          <DialogFooter><Button className="w-full bg-[#141414] text-white font-bold" onClick={postAndMatch}>POST & RECONCILE</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="rounded-2xl max-w-3xl">
          <DialogHeader>
            <DialogTitle>Import bank statement</DialogTitle>
            <DialogDescription>Upload the CSV or Excel export from your bank. Lines already imported are skipped automatically.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-[10px] font-bold uppercase text-[#8E9299]">Bank account</Label>
                <Select value={importAccountId} onValueChange={setImportAccountId}>
                  <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue placeholder="Choose account" /></SelectTrigger>
                  <SelectContent>{bankAccounts.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.account_name} ({b.bank_name})</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] font-bold uppercase text-[#8E9299]">Statement file</Label>
                <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={readFile} />
                <Button variant="outline" className="w-full gap-2" onClick={() => fileRef.current?.click()}><Upload className="w-4 h-4" /> Choose file</Button>
              </div>
            </div>
            {headers.length > 0 && (
              <>
                <div className="grid grid-cols-5 gap-2">
                  {mappingSelect('date', 'Date')}
                  {mappingSelect('description', 'Description')}
                  {mappingSelect('amount', 'Amount (signed)')}
                  {mappingSelect('credit', 'Money in')}
                  {mappingSelect('debit', 'Money out')}
                </div>
                <p className="text-xs text-[#8E9299]">Use either a single signed Amount column (deposits positive) or separate Money in / Money out columns. Dates like 05/03/2026 are read as day/month/year.</p>
                <div className="max-h-56 overflow-y-auto rounded-xl border border-[#F5F5F5]">
                  <Table>
                    <TableHeader><TableRow className="bg-[#F5F5F5]/50"><TableHead>Date</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {parsedRows.slice(0, 50).map((r, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-xs">{r.date}</TableCell>
                          <TableCell className="text-xs">{r.description}</TableCell>
                          <TableCell className={`text-right font-mono text-xs ${r.amount > 0 ? 'text-green-600' : ''}`}>{fmtMoney(r.amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <p className="text-xs font-bold">{parsedRows.length} valid line(s) of {sheetRows.length} rows</p>
              </>
            )}
          </div>
          <DialogFooter><Button className="w-full bg-[#141414] text-white font-bold" disabled={busy || parsedRows.length === 0} onClick={runImport}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : `IMPORT ${parsedRows.length} LINE(S)`}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="rounded-2xl">
          <form onSubmit={addLine}>
            <DialogHeader><DialogTitle>Add statement line</DialogTitle><DialogDescription>Record a single line from a bank statement for reconciliation.</DialogDescription></DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label>Bank account</Label>
                <Select name="bank_account_id" required defaultValue={accountFilter !== 'all' ? accountFilter : undefined}>
                  <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue placeholder="Choose account" /></SelectTrigger>
                  <SelectContent>{bankAccounts.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.account_name} ({b.bank_name})</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Date</Label><Input name="date" type="date" required defaultValue={todayIso()} className="bg-[#F5F5F5] border-none" /></div>
                <div className="space-y-2">
                  <Label>Direction</Label>
                  <Select name="type" defaultValue="Credit">
                    <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="Credit">Money in (deposit)</SelectItem><SelectItem value="Debit">Money out (withdrawal)</SelectItem></SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2"><Label>Description</Label><Input name="description" required className="bg-[#F5F5F5] border-none" /></div>
              <div className="space-y-2"><Label>Amount</Label><Input name="amount" type="number" step="0.01" min="0.01" required className="bg-[#F5F5F5] border-none" /></div>
            </div>
            <DialogFooter><Button type="submit" className="w-full bg-[#141414] text-white font-bold">ADD LINE</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
