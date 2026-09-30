import { useEffect, useState } from 'react';
import { FileSpreadsheet, Loader2, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/table';
import { accountingApi } from '../../../lib/api';
import { escapeHtml } from '../../../lib/html';
import { formatDate, todayIso } from '../../../lib/dates';
import { downloadCsv, errorText, fmtMoney, openPrintWindow, PrintBranding } from './print';
import { formatWithSymbol } from '../../../lib/currency';

const BUCKETS = [
  { key: 'current', label: 'Current' },
  { key: 'd1_30', label: '1–30 days' },
  { key: 'd31_60', label: '31–60 days' },
  { key: 'd61_90', label: '61–90 days' },
  { key: 'd90_plus', label: '90+ days' },
] as const;

export default function ArAgingPanel({ currSym, branding }: { currSym: string; branding: PrintBranding }) {
  const [asOf, setAsOf] = useState(todayIso());
  const [aging, setAging] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [clients, setClients] = useState<string[]>([]);
  const [client, setClient] = useState('');
  const [stmtStart, setStmtStart] = useState('');
  const [stmtEnd, setStmtEnd] = useState(todayIso());
  const [statement, setStatement] = useState<any>(null);
  const [stmtLoading, setStmtLoading] = useState(false);

  const loadAging = async () => {
    setLoading(true);
    try {
      const res = await accountingApi.getArAging(asOf);
      setAging(res.data);
    } catch (error: any) {
      toast.error(errorText(error, 'Failed to load AR aging'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAging(); }, [asOf]);
  useEffect(() => {
    accountingApi.getClients().then(res => setClients(res.data)).catch(() => setClients([]));
  }, []);

  const loadStatement = async (name = client) => {
    if (!name) return;
    setStmtLoading(true);
    try {
      const res = await accountingApi.getClientStatement(name, stmtStart || undefined, stmtEnd || undefined);
      setStatement(res.data);
    } catch (error: any) {
      toast.error(errorText(error, 'Failed to load statement'));
    } finally {
      setStmtLoading(false);
    }
  };

  const money = (value: unknown) => formatWithSymbol(value, currSym);

  const printAging = () => {
    if (!aging) return;
    const th = 'padding: 8px; border: 1px solid #E4E3E0; font-size: 0.7rem; text-transform: uppercase;';
    const td = 'padding: 8px; border: 1px solid #E4E3E0;';
    const rows = aging.clients.map((c: any) => `<tr><td style="${td}">${escapeHtml(c.client)}</td>${BUCKETS.map(b => `<td style="${td} text-align: right;">${money(c[b.key])}</td>`).join('')}<td style="${td} text-align: right; font-weight: bold;">${money(c.total)}</td></tr>`).join('');
    const totals = `<tr style="background: #F5F5F5; font-weight: bold;"><td style="${td}">Total</td>${BUCKETS.map(b => `<td style="${td} text-align: right;">${money(aging.totals[b.key])}</td>`).join('')}<td style="${td} text-align: right;">${money(aging.totals.total)}</td></tr>`;
    const body = `<p style="color: #666;">As of ${escapeHtml(formatDate(aging.asOf))}</p>
      <table style="width: 100%; border-collapse: collapse;"><thead><tr style="background: #F5F5F5;"><th style="${th} text-align: left;">Client</th>${BUCKETS.map(b => `<th style="${th} text-align: right;">${b.label}</th>`).join('')}<th style="${th} text-align: right;">Total</th></tr></thead><tbody>${rows}${totals}</tbody></table>`;
    openPrintWindow('AGED RECEIVABLES', body, branding, `AR-AGING-${aging.asOf}`);
  };

  const printStatement = () => {
    if (!statement) return;
    const td = 'padding: 8px; border-bottom: 1px solid #E4E3E0;';
    const rows = statement.lines.map((l: any) => `<tr><td style="${td}">${escapeHtml(formatDate(l.date))}</td><td style="${td}">${escapeHtml(l.description)}</td><td style="${td} text-align: right;">${l.debit ? money(l.debit) : ''}</td><td style="${td} text-align: right;">${l.credit ? money(l.credit) : ''}</td><td style="${td} text-align: right;">${money(l.balance)}</td></tr>`).join('');
    const body = `
      <div style="margin: 20px 0;"><h4 style="color: #8E9299; text-transform: uppercase; font-size: 0.7rem; margin-bottom: 5px;">Statement for:</h4><h3 style="margin: 0;">${escapeHtml(statement.client)}</h3>
      <p style="color: #666;">Period: ${escapeHtml(statement.startDate ? formatDate(statement.startDate) : 'All history')} to ${escapeHtml(formatDate(statement.endDate))}</p></div>
      <table style="width: 100%; border-collapse: collapse;">
        <thead style="background: #F5F5F5;"><tr><th style="padding: 8px; text-align: left;">Date</th><th style="padding: 8px; text-align: left;">Details</th><th style="padding: 8px; text-align: right;">Charges</th><th style="padding: 8px; text-align: right;">Payments / Credits</th><th style="padding: 8px; text-align: right;">Balance</th></tr></thead>
        <tbody><tr><td style="${td}"></td><td style="${td} font-style: italic;">Balance brought forward</td><td style="${td}"></td><td style="${td}"></td><td style="${td} text-align: right;">${money(statement.opening_balance)}</td></tr>${rows}</tbody>
        <tfoot><tr style="font-weight: bold; font-size: 1.1rem;"><td colspan="4" style="padding: 14px 8px; text-align: right;">Amount Due:</td><td style="padding: 14px 8px; text-align: right;">${money(statement.closing_balance)}</td></tr></tfoot>
      </table>`;
    openPrintWindow('STATEMENT OF ACCOUNT', body, branding, `STMT-${statement.endDate}`);
  };

  return (
    <div className="space-y-6">
      <Card className="border-none shadow-sm rounded-2xl overflow-hidden">
        <CardHeader className="bg-[#F5F5F5]/30 border-b border-[#F5F5F5] flex flex-row flex-wrap items-end justify-between gap-3">
          <div>
            <CardTitle>Aged Receivables</CardTitle>
            <CardDescription>Outstanding invoice balances by days past due.</CardDescription>
          </div>
          <div className="flex items-end gap-2">
            <div className="space-y-1"><Label className="text-[10px] font-bold uppercase text-[#8E9299]">As of</Label><Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value || todayIso())} className="h-9 w-40 bg-white" /></div>
            <Button variant="outline" size="sm" className="h-9" disabled={!aging} onClick={printAging}><Printer className="w-4 h-4 mr-1" /> Print</Button>
            <Button variant="outline" size="sm" className="h-9" disabled={!aging} onClick={() => aging && downloadCsv(`ar_aging_${aging.asOf}`, ['Invoice', 'Client', 'Invoice Date', 'Due Date', 'Days Overdue', 'Amount', 'Balance', 'Bucket'], aging.invoices.map((i: any) => [i.id, i.client, i.date, i.due_date, i.days_overdue, Number(i.amount).toFixed(2), Number(i.balance).toFixed(2), BUCKETS.find(b => b.key === i.bucket)?.label]))}><FileSpreadsheet className="w-4 h-4 mr-1" /> CSV</Button>
          </div>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {loading && !aging ? (
            <p className="p-8 text-sm text-[#8E9299] flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-[#F5F5F5]/50">
                  <TableHead>Client</TableHead>
                  {BUCKETS.map(b => <TableHead key={b.key} className="text-right">{b.label}</TableHead>)}
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(aging?.clients || []).map((c: any) => (
                  <TableRow key={c.client}>
                    <TableCell className="font-bold">{c.client}<p className="text-[10px] text-[#8E9299] font-normal">{c.invoices} open invoice(s)</p></TableCell>
                    {BUCKETS.map(b => <TableCell key={b.key} className={`text-right font-mono text-xs ${Number(c[b.key]) > 0 && b.key !== 'current' ? 'text-red-600 font-bold' : ''}`}>{Number(c[b.key]) > 0 ? fmtMoney(c[b.key]) : '-'}</TableCell>)}
                    <TableCell className="text-right font-black">{money(c.total)}</TableCell>
                    <TableCell className="text-right"><Button variant="ghost" size="sm" className="text-xs font-bold text-blue-600" onClick={() => { setClient(c.client); loadStatement(c.client); }}>Statement</Button></TableCell>
                  </TableRow>
                ))}
                {aging && aging.clients.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-10 text-[#8E9299]">No outstanding receivables.</TableCell></TableRow>}
                {aging && aging.clients.length > 0 && (
                  <TableRow className="bg-[#141414] text-white hover:bg-[#141414]">
                    <TableCell className="font-black">Total</TableCell>
                    {BUCKETS.map(b => <TableCell key={b.key} className="text-right font-bold">{fmtMoney(aging.totals[b.key])}</TableCell>)}
                    <TableCell className="text-right font-black">{money(aging.totals.total)}</TableCell>
                    <TableCell />
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="border-none shadow-sm rounded-2xl overflow-hidden">
        <CardHeader className="bg-[#F5F5F5]/30 border-b border-[#F5F5F5]">
          <CardTitle>Client Statement</CardTitle>
          <CardDescription>Invoices, payments and credit notes with a running balance.</CardDescription>
          <div className="flex flex-wrap items-end gap-3 pt-3">
            <div className="space-y-1 w-64">
              <Label className="text-[10px] font-bold uppercase text-[#8E9299]">Client</Label>
              <Select value={client} onValueChange={setClient}>
                <SelectTrigger className="h-9 bg-white"><SelectValue placeholder="Choose a client" /></SelectTrigger>
                <SelectContent>{clients.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label className="text-[10px] font-bold uppercase text-[#8E9299]">From</Label><Input type="date" value={stmtStart} onChange={(e) => setStmtStart(e.target.value)} className="h-9 w-40 bg-white" /></div>
            <div className="space-y-1"><Label className="text-[10px] font-bold uppercase text-[#8E9299]">To</Label><Input type="date" value={stmtEnd} onChange={(e) => setStmtEnd(e.target.value)} className="h-9 w-40 bg-white" /></div>
            <Button size="sm" className="h-9 bg-[#141414] text-white" disabled={!client || stmtLoading} onClick={() => loadStatement()}>{stmtLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Show'}</Button>
            <Button variant="outline" size="sm" className="h-9" disabled={!statement} onClick={printStatement}><Printer className="w-4 h-4 mr-1" /> Print</Button>
            <Button variant="outline" size="sm" className="h-9" disabled={!statement} onClick={() => statement && downloadCsv(`statement_${statement.client}`, ['Date', 'Type', 'Reference', 'Details', 'Charges', 'Payments/Credits', 'Balance'], [['', '', '', 'Balance brought forward', '', '', Number(statement.opening_balance).toFixed(2)], ...statement.lines.map((l: any) => [l.date, l.type, l.reference, l.description, l.debit ? Number(l.debit).toFixed(2) : '', l.credit ? Number(l.credit).toFixed(2) : '', Number(l.balance).toFixed(2)])])}><FileSpreadsheet className="w-4 h-4 mr-1" /> CSV</Button>
          </div>
        </CardHeader>
        {statement && (
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader><TableRow className="bg-[#F5F5F5]/50"><TableHead>Date</TableHead><TableHead>Details</TableHead><TableHead className="text-right">Charges</TableHead><TableHead className="text-right">Payments / Credits</TableHead><TableHead className="text-right">Balance</TableHead></TableRow></TableHeader>
              <TableBody>
                <TableRow><TableCell /><TableCell className="italic text-[#8E9299]">Balance brought forward</TableCell><TableCell /><TableCell /><TableCell className="text-right font-mono">{fmtMoney(statement.opening_balance)}</TableCell></TableRow>
                {statement.lines.map((l: any, idx: number) => (
                  <TableRow key={idx}>
                    <TableCell className="font-mono text-xs text-[#8E9299]">{formatDate(l.date)}</TableCell>
                    <TableCell className="font-medium">{l.description}</TableCell>
                    <TableCell className="text-right font-mono">{l.debit ? fmtMoney(l.debit) : ''}</TableCell>
                    <TableCell className="text-right font-mono text-green-700">{l.credit ? fmtMoney(l.credit) : ''}</TableCell>
                    <TableCell className="text-right font-mono font-bold">{fmtMoney(l.balance)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-[#141414] text-white hover:bg-[#141414]">
                  <TableCell colSpan={4} className="text-right font-black">Amount Due</TableCell>
                  <TableCell className="text-right font-black">{money(statement.closing_balance)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
