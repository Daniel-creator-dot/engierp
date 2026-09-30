import { useEffect, useState } from 'react';
import { FileSpreadsheet, Loader2, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/table';
import { accountingApi } from '../../../lib/api';
import { escapeHtml } from '../../../lib/html';
import { formatDate } from '../../../lib/dates';
import { downloadCsv, errorText, fmtMoney, openPrintWindow, PrintBranding } from './print';

export default function TaxReportsPanel({ startDate, endDate, currSym, branding }: { startDate: string; endDate: string; currSym: string; branding: PrintBranding }) {
  const [vat, setVat] = useState<any>(null);
  const [wht, setWht] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([accountingApi.getVatReport(startDate || undefined, endDate || undefined), accountingApi.getWhtReport(startDate || undefined, endDate || undefined)])
      .then(([v, w]) => { if (!cancelled) { setVat(v.data); setWht(w.data); } })
      .catch((error) => toast.error(errorText(error, 'Failed to load tax reports')))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [startDate, endDate]);

  const money = (v: number) => `${escapeHtml(currSym)}${fmtMoney(v)}`;
  const period = `${startDate ? formatDate(startDate) : 'Start'} to ${endDate ? formatDate(endDate) : 'today'}`;
  const components = vat ? Object.entries(vat.components as Record<string, { name: string; rate: number; amount: number }>) : [];

  const printVat = () => {
    if (!vat) return;
    const td = 'padding: 8px; border: 1px solid #E4E3E0;';
    const body = `<p style="color: #666;">Period: ${escapeHtml(period)}</p>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr><td style="${td}">Taxable supplies (net of credit notes)</td><td style="${td} text-align: right;">${money(vat.taxable_sales)}</td></tr>
        ${components.map(([, c]) => `<tr><td style="${td}">${escapeHtml(c.name)}${c.rate ? ` (${escapeHtml(c.rate)}%)` : ''}</td><td style="${td} text-align: right;">${money(c.amount)}</td></tr>`).join('')}
        <tr style="font-weight: bold;"><td style="${td}">Total output tax</td><td style="${td} text-align: right;">${money(vat.output_tax)}</td></tr>
        <tr><td style="${td}">Less: input VAT recoverable (account 1109)</td><td style="${td} text-align: right;">${money(vat.input_tax)}</td></tr>
        <tr style="font-weight: bold; background: #F5F5F5;"><td style="${td}">Net tax payable</td><td style="${td} text-align: right;">${money(vat.net_payable)}</td></tr>
      </table>
      <h3>Invoices</h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
        <thead><tr style="background: #F5F5F5;"><th style="${td} text-align: left;">Date</th><th style="${td} text-align: left;">Invoice</th><th style="${td} text-align: left;">Client</th><th style="${td} text-align: right;">Taxable</th><th style="${td} text-align: right;">Tax</th><th style="${td} text-align: right;">Total</th></tr></thead>
        <tbody>${vat.invoices.map((i: any) => `<tr><td style="${td}">${escapeHtml(formatDate(i.date))}</td><td style="${td}">${escapeHtml(i.id)}</td><td style="${td}">${escapeHtml(i.client)}</td><td style="${td} text-align: right;">${money(i.taxable)}</td><td style="${td} text-align: right;">${money(i.tax)}</td><td style="${td} text-align: right;">${money(i.total)}</td></tr>`).join('')}</tbody>
      </table>`;
    openPrintWindow('VAT & LEVIES RETURN SCHEDULE', body, branding, `VAT-${startDate || 'ALL'}-${endDate || ''}`);
  };

  const printWht = () => {
    if (!wht) return;
    const td = 'padding: 8px; border: 1px solid #E4E3E0;';
    const body = `<p style="color: #666;">Period: ${escapeHtml(period)}</p>
      <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
        <thead><tr style="background: #F5F5F5;"><th style="${td} text-align: left;">Date</th><th style="${td} text-align: left;">Supplier</th><th style="${td} text-align: left;">TIN</th><th style="${td} text-align: left;">Bill</th><th style="${td} text-align: right;">Gross</th><th style="${td} text-align: right;">Rate</th><th style="${td} text-align: right;">Tax withheld</th></tr></thead>
        <tbody>${wht.rows.map((r: any) => `<tr><td style="${td}">${escapeHtml(formatDate(r.date))}</td><td style="${td}">${escapeHtml(r.supplier_name)}</td><td style="${td}">${escapeHtml(r.supplier_tin || '')}</td><td style="${td}">${escapeHtml(r.bill_id)}</td><td style="${td} text-align: right;">${money(r.gross)}</td><td style="${td} text-align: right;">${escapeHtml(r.rate)}%</td><td style="${td} text-align: right;">${money(r.wht)}</td></tr>`).join('')}</tbody>
        <tfoot><tr style="font-weight: bold;"><td colspan="4" style="${td} text-align: right;">Totals</td><td style="${td} text-align: right;">${money(wht.total_gross)}</td><td style="${td}"></td><td style="${td} text-align: right;">${money(wht.total_wht)}</td></tr></tfoot>
      </table>`;
    openPrintWindow('WITHHOLDING TAX SCHEDULE', body, branding, `WHT-${startDate || 'ALL'}-${endDate || ''}`);
  };

  if (loading && !vat) return <p className="p-8 text-sm text-[#8E9299] flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>;

  return (
    <div className="space-y-6">
      {vat && (
        <Card className="border-none shadow-sm rounded-2xl bg-white overflow-hidden">
          <CardHeader className="bg-[#F5F5F5]/30 border-b border-[#F5F5F5] flex flex-row justify-between items-center">
            <div>
              <CardTitle>VAT, NHIL & GETFund <span className="text-sm font-normal text-[#8E9299]">{period}</span></CardTitle>
              <CardDescription>Output tax from posted invoices less credit notes, and input VAT recorded in account 1109. Use it to complete the GRA VAT return.</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={printVat}><Printer className="w-4 h-4 mr-2" /> Print</Button>
              <Button variant="outline" size="sm" onClick={() => downloadCsv('vat_schedule', ['Date', 'Invoice', 'Client', 'Taxable', 'Tax', 'Total'], [...vat.invoices.map((i: any) => [i.date, i.id, i.client, i.taxable.toFixed(2), i.tax.toFixed(2), i.total.toFixed(2)]), ...vat.credit_notes.map((c: any) => [c.date, `${c.id} (credit note on ${c.invoice_id})`, c.client, '', (-c.tax).toFixed(2), (-c.amount).toFixed(2)])])}><FileSpreadsheet className="w-4 h-4 mr-2" /> CSV</Button>
            </div>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            <div className="grid gap-4 md:grid-cols-4">
              <div className="p-4 rounded-2xl bg-[#F5F5F5]"><p className="text-[10px] font-bold uppercase text-[#8E9299]">Taxable supplies</p><p className="text-xl font-black">{currSym}{fmtMoney(vat.taxable_sales)}</p></div>
              <div className="p-4 rounded-2xl bg-blue-50"><p className="text-[10px] font-bold uppercase text-blue-700">Output tax</p><p className="text-xl font-black text-blue-700">{currSym}{fmtMoney(vat.output_tax)}</p></div>
              <div className="p-4 rounded-2xl bg-green-50"><p className="text-[10px] font-bold uppercase text-green-700">Input VAT</p><p className="text-xl font-black text-green-700">{currSym}{fmtMoney(vat.input_tax)}</p></div>
              <div className="p-4 rounded-2xl bg-[#141414] text-white"><p className="text-[10px] font-bold uppercase text-white/60">Net payable</p><p className="text-xl font-black">{currSym}{fmtMoney(vat.net_payable)}</p></div>
            </div>
            <Table>
              <TableHeader><TableRow className="bg-[#F5F5F5]/50"><TableHead>Component</TableHead><TableHead className="text-right">Rate</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
              <TableBody>
                {components.map(([code, c]) => (
                  <TableRow key={code}><TableCell className="font-bold">{c.name}</TableCell><TableCell className="text-right">{c.rate ? `${c.rate}%` : '-'}</TableCell><TableCell className="text-right font-mono">{currSym}{fmtMoney(c.amount)}</TableCell></TableRow>
                ))}
                {components.length === 0 && <TableRow><TableCell colSpan={3} className="text-center py-6 text-[#8E9299]">No taxed invoices in this period.</TableCell></TableRow>}
              </TableBody>
            </Table>
            {vat.credit_notes.length > 0 && <p className="text-xs text-[#8E9299]">Includes {vat.credit_notes.length} credit note(s) reducing output tax by {currSym}{fmtMoney(vat.credit_notes.reduce((s: number, c: any) => s + c.tax, 0))}.</p>}
          </CardContent>
        </Card>
      )}

      {wht && (
        <Card className="border-none shadow-sm rounded-2xl bg-white overflow-hidden">
          <CardHeader className="bg-[#F5F5F5]/30 border-b border-[#F5F5F5] flex flex-row justify-between items-center">
            <div>
              <CardTitle>Withholding Tax on Supplier Payments <span className="text-sm font-normal text-[#8E9299]">{period}</span></CardTitle>
              <CardDescription>Tax withheld from supplier payments (credited to account 2102), payable to GRA by the 15th of the following month.</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={printWht}><Printer className="w-4 h-4 mr-2" /> Print</Button>
              <Button variant="outline" size="sm" onClick={() => downloadCsv('wht_schedule', ['Date', 'Payment', 'Supplier', 'Supplier TIN', 'Bill', 'Gross', 'Rate %', 'Withheld', 'Net Paid'], wht.rows.map((r: any) => [r.date, r.payment_id, r.supplier_name, r.supplier_tin || '', r.bill_id, r.gross.toFixed(2), r.rate, r.wht.toFixed(2), r.net.toFixed(2)]))}><FileSpreadsheet className="w-4 h-4 mr-2" /> CSV</Button>
            </div>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader><TableRow className="bg-[#F5F5F5]/50"><TableHead>Date</TableHead><TableHead>Supplier</TableHead><TableHead>TIN</TableHead><TableHead>Bill</TableHead><TableHead className="text-right">Gross</TableHead><TableHead className="text-right">Rate</TableHead><TableHead className="text-right">Withheld</TableHead></TableRow></TableHeader>
              <TableBody>
                {wht.rows.map((r: any) => (
                  <TableRow key={r.payment_id}>
                    <TableCell className="font-mono text-xs text-[#8E9299]">{formatDate(r.date)}</TableCell>
                    <TableCell className="font-bold">{r.supplier_name}</TableCell>
                    <TableCell className="font-mono text-xs">{r.supplier_tin || <span className="text-orange-600">missing</span>}</TableCell>
                    <TableCell className="font-mono text-xs">{r.bill_id}</TableCell>
                    <TableCell className="text-right font-mono">{fmtMoney(r.gross)}</TableCell>
                    <TableCell className="text-right">{r.rate}%</TableCell>
                    <TableCell className="text-right font-black">{currSym}{fmtMoney(r.wht)}</TableCell>
                  </TableRow>
                ))}
                {wht.rows.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-8 text-[#8E9299]">No withholding tax deducted in this period.</TableCell></TableRow>}
                {wht.rows.length > 0 && (
                  <TableRow className="bg-[#141414] text-white hover:bg-[#141414]">
                    <TableCell colSpan={4} className="font-black text-right">Totals</TableCell>
                    <TableCell className="text-right font-bold">{fmtMoney(wht.total_gross)}</TableCell>
                    <TableCell />
                    <TableCell className="text-right font-black">{currSym}{fmtMoney(wht.total_wht)}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
