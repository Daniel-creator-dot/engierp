import { useEffect, useState } from 'react';
import { FileSpreadsheet, Loader2, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/card';
import { Table, TableBody, TableCell, TableRow } from '../../ui/table';
import { accountingApi } from '../../../lib/api';
import { escapeHtml } from '../../../lib/html';
import { downloadCsv, errorText, fmtMoney, openPrintWindow, PrintBranding } from './print';
import { formatWithSymbol } from '../../../lib/currency';

const SECTIONS = [
  { key: 'operating', label: 'Operating Activities' },
  { key: 'investing', label: 'Investing Activities' },
  { key: 'financing', label: 'Financing Activities' },
] as const;


export default function CashFlowPanel({ startDate, endDate, currSym, branding }: { startDate: string; endDate: string; currSym: string; branding: PrintBranding }) {
  const money = (value: unknown) => formatWithSymbol(value, currSym);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    accountingApi.getCashFlow(startDate || undefined, endDate || undefined)
      .then(res => { if (!cancelled) setData(res.data); })
      .catch((error) => toast.error(errorText(error, 'Failed to load the cash flow statement')))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [startDate, endDate]);

  const print = () => {
    if (!data) return;
    const td = 'padding: 8px 16px; border-bottom: 1px solid #F0F0F0;';
    const sections = SECTIONS.map(s => {
      const sec = data[s.key];
      return `<tr style="background: #F5F5F5;"><td colspan="2" style="padding: 10px 16px; font-weight: bold;">${s.label}</td></tr>
        ${sec.lines.map((l: any) => `<tr><td style="${td} padding-left: 32px;">${escapeHtml(l.account)}</td><td style="${td} text-align: right;">${money(l.amount)}</td></tr>`).join('')}
        <tr><td style="${td} font-weight: bold;">Net cash from ${s.label.toLowerCase()}</td><td style="${td} text-align: right; font-weight: bold;">${money(sec.net)}</td></tr>`;
    }).join('');
    const body = `<p style="color: #666;">Period: ${escapeHtml(startDate || 'start')} to ${escapeHtml(endDate || 'today')}</p>
      <table style="width: 100%; border-collapse: collapse;">${sections}
        <tr><td style="${td} font-weight: bold;">Net change in cash</td><td style="${td} text-align: right; font-weight: bold;">${money(data.netCashFlow)}</td></tr>
        <tr><td style="${td}">Opening cash and bank</td><td style="${td} text-align: right;">${money(data.openingCash)}</td></tr>
        <tr style="background: #141414; color: white;"><td style="padding: 12px 16px; font-weight: bold;">Closing cash and bank</td><td style="padding: 12px 16px; text-align: right; font-weight: bold;">${money(data.closingCash)}</td></tr>
      </table>`;
    openPrintWindow('CASH FLOW STATEMENT', body, branding, `CF-${startDate || 'ALL'}-${endDate || ''}`);
  };

  const exportCsv = () => {
    if (!data) return;
    const rows: (string | number)[][] = [];
    SECTIONS.forEach(s => {
      rows.push([s.label, '']);
      data[s.key].lines.forEach((l: any) => rows.push([`  ${l.account}`, l.amount.toFixed(2)]));
      rows.push([`Net cash from ${s.label.toLowerCase()}`, data[s.key].net.toFixed(2)]);
    });
    rows.push(['Net change in cash', data.netCashFlow.toFixed(2)], ['Opening cash and bank', data.openingCash.toFixed(2)], ['Closing cash and bank', data.closingCash.toFixed(2)]);
    downloadCsv('cash_flow', ['Line', 'Amount'], rows);
  };

  return (
    <Card className="border-none shadow-sm rounded-2xl bg-white overflow-hidden max-w-4xl">
      <CardHeader className="bg-[#F5F5F5]/30 border-b border-[#F5F5F5] flex flex-row justify-between items-center">
        <div>
          <CardTitle>Cash Flow Statement <span className="text-sm font-normal text-[#8E9299]">{startDate} to {endDate}</span></CardTitle>
          <CardDescription>Direct method: each cash movement is classified by the account on the other side of the entry. Transfers between your own bank and cash accounts are excluded.</CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={!data} onClick={print}><Printer className="w-4 h-4 mr-2" /> Print</Button>
          <Button variant="outline" size="sm" disabled={!data} onClick={exportCsv}><FileSpreadsheet className="w-4 h-4 mr-2" /> CSV</Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {loading && !data && <p className="p-8 text-sm text-[#8E9299] flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>}
        {data && (
          <Table>
            <TableBody>
              {SECTIONS.map(s => {
                const sec = data[s.key];
                return [
                  <TableRow key={`${s.key}-h`} className="bg-[#F5F5F5]/50 hover:bg-[#F5F5F5]/50"><TableCell colSpan={2} className="font-bold">{s.label}</TableCell></TableRow>,
                  ...sec.lines.map((l: any) => (
                    <TableRow key={`${s.key}-${l.account}`}>
                      <TableCell className="pl-8 text-[#141414]">{l.account}</TableCell>
                      <TableCell className={`text-right font-mono ${l.amount < 0 ? 'text-red-600' : 'text-green-700'}`}>{money(l.amount)}</TableCell>
                    </TableRow>
                  )),
                  sec.lines.length === 0 && <TableRow key={`${s.key}-e`}><TableCell colSpan={2} className="pl-8 text-xs text-[#8E9299]">No cash movements</TableCell></TableRow>,
                  <TableRow key={`${s.key}-t`}>
                    <TableCell className="font-bold">Net cash from {s.label.toLowerCase()}</TableCell>
                    <TableCell className="text-right font-black">{money(sec.net)}</TableCell>
                  </TableRow>,
                ];
              })}
              <TableRow><TableCell className="font-bold">Net change in cash</TableCell><TableCell className="text-right font-black">{money(data.netCashFlow)}</TableCell></TableRow>
              <TableRow><TableCell>Opening cash and bank</TableCell><TableCell className="text-right font-mono">{money(data.openingCash)}</TableCell></TableRow>
              <TableRow className="bg-[#141414] text-white hover:bg-[#141414]"><TableCell className="font-black text-lg">Closing cash and bank</TableCell><TableCell className="text-right font-black text-lg">{money(data.closingCash)}</TableCell></TableRow>
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
