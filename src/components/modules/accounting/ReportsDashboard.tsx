import React, { useMemo, useState } from 'react';
import { addMonths, endOfMonth, format, isValid, parseISO, startOfMonth, subMonths } from 'date-fns';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, BarChart3, Download, Printer, Receipt, Sparkles, TrendingDown, TrendingUp, Users, X } from 'lucide-react';
import { KpiCard, Panel, EmptyState, Reveal } from '../dashboard/widgets';
import { AXIS, ChartTooltip, axisTick } from '../dashboard/charts';
import { percentChange } from '../dashboard/insights';
import type { Money } from '../dashboard/types';
import { escapeHtml } from '../../../lib/html';
import { formatDate } from '../../../lib/dates';
import { downloadCsv, openPrintWindow, type PrintBranding } from './print';

export type PresetKey = 'this-month' | 'last-month' | 'quarter' | 'ytd' | 'last-year';

export const PERIOD_PRESETS: { key: PresetKey; label: string }[] = [
  { key: 'this-month', label: 'This month' },
  { key: 'last-month', label: 'Last month' },
  { key: 'quarter', label: 'Quarter' },
  { key: 'ytd', label: 'YTD' },
  { key: 'last-year', label: 'Last year' },
];

const iso = (d: Date) => format(d, 'yyyy-MM-dd');
const dayBefore = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);

/** Quarters, YTD and "last year" follow the configured fiscal year start (1 January by default). */
export function presetRange(key: PresetKey, fiscal: { startMonth: number; startDay: number }, today = new Date()) {
  const fyStartIn = (year: number) => new Date(year, (fiscal.startMonth || 1) - 1, fiscal.startDay || 1);
  let fyStart = fyStartIn(today.getFullYear());
  if (fyStart > today) fyStart = fyStartIn(today.getFullYear() - 1);
  switch (key) {
    case 'this-month':
      return { start: iso(startOfMonth(today)), end: iso(endOfMonth(today)) };
    case 'last-month': {
      const last = subMonths(today, 1);
      return { start: iso(startOfMonth(last)), end: iso(endOfMonth(last)) };
    }
    case 'quarter': {
      let qStart = fyStart;
      while (addMonths(qStart, 3) <= today) qStart = addMonths(qStart, 3);
      return { start: iso(qStart), end: iso(dayBefore(addMonths(qStart, 3))) };
    }
    case 'ytd':
      return { start: iso(fyStart), end: iso(today) };
    case 'last-year':
      return { start: iso(fyStartIn(fyStart.getFullYear() - 1)), end: iso(dayBefore(fyStart)) };
  }
}

export function PeriodPresets({ startDate, endDate, fiscal, onChange }: {
  startDate: string; endDate: string; fiscal: { startMonth: number; startDay: number }; onChange: (start: string, end: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 bg-[#F5F5F5] p-1 rounded-xl" role="group" aria-label="Quick periods">
      {PERIOD_PRESETS.map(p => {
        const range = presetRange(p.key, fiscal);
        const active = range.start === startDate && range.end === endDate;
        return (
          <button key={p.key} type="button" onClick={() => onChange(range.start, range.end)} title={`${formatDate(range.start)} – ${formatDate(range.end)}`}
            className={`px-3 h-8 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${active ? 'bg-white text-[#141414] shadow-sm' : 'text-[#8E9299] hover:text-[#141414]'}`}>
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

/** "August 2026" for a whole calendar month, otherwise "2 Aug 2026 – 31 Aug 2026". */
export function describeRange(from: string, to: string) {
  const s = parseISO(from);
  const e = parseISO(to);
  if (isValid(s) && isValid(e) && s.getDate() === 1 && iso(endOfMonth(s)) === to) return format(s, 'MMMM yyyy');
  return `${formatDate(from)} – ${formatDate(to)}`;
}

export interface ManagementSummary {
  Income: number;
  Expense: number;
  PayrollCost?: number;
  TotalPayroll?: number;
  PayrollAccounts?: string[];
  Monthly?: { month: string; income: number; expense: number }[];
  Prior?: { from: string; to: string; Income: number; Expense: number; PayrollCost: number };
}

interface Props {
  data: ManagementSummary | null;
  incomeStatement: any[];
  startDate: string;
  endDate: string;
  loading: boolean;
  money: Money;
  compact: Money;
  branding: PrintBranding;
  onOpenTab: (tab: string) => void;
  onOpenAccount: (account: any) => void;
  onShowYtd: () => void;
}

const isUncategorized = (a: any) => a.code === '7104' || /uncategori[sz]ed/i.test(a.name || '');
const pct = (part: number, whole: number) => (whole ? (part / whole) * 100 : 0);

export default function ReportsDashboard({ data, incomeStatement, startDate, endDate, loading, money, compact, branding, onOpenTab, onOpenAccount, onShowYtd }: Props) {
  const [summaryHidden, setSummaryHidden] = useState(false);

  const figures = useMemo(() => {
    const income = Number(data?.Income || 0);
    const expense = Number(data?.Expense || 0);
    const payroll = Number(data?.PayrollCost || 0);
    const prior = data?.Prior ? { ...data.Prior, net: Number(data.Prior.Income) - Number(data.Prior.Expense) } : null;
    const expenses = incomeStatement
      .filter(a => a.type === 'Expense')
      .map(a => ({ ...a, amount: Number(a.total_debit || 0) - Number(a.total_credit || 0) }))
      .filter(a => Math.abs(a.amount) >= 0.005)
      .sort((a, b) => b.amount - a.amount);
    const rangeStart = startDate.slice(0, 7);
    const monthly = (data?.Monthly || []).map(m => ({
      ...m,
      net: m.income - m.expense,
      label: format(parseISO(`${m.month}-01`), 'MMM yy'),
      inRange: m.month >= rangeStart,
    }));
    return { income, expense, payroll, net: income - expense, prior, expenses, monthly, uncategorized: expenses.filter(isUncategorized).reduce((s, a) => s + a.amount, 0) };
  }, [data, incomeStatement, startDate]);

  if (!data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true">
        {[0, 1, 2, 3].map(i => <div key={i} className="h-40 rounded-3xl bg-white shadow-sm animate-pulse" />)}
      </div>
    );
  }

  const { income, expense, payroll, net, prior, expenses, monthly, uncategorized } = figures;
  const isLoss = net < 0;
  const priorLabel = prior ? describeRange(prior.from, prior.to) : '';
  const periodLabel = describeRange(startDate, endDate);
  const empty = income === 0 && expense === 0;
  const top = expenses.slice(0, 6);
  const maxTop = Math.max(...top.map(a => a.amount), 0);
  const payrollAccounts = data.PayrollAccounts?.length ? data.PayrollAccounts.join(', ') : 'the payroll expense accounts';

  const summary = (() => {
    if (empty) return `Nothing was posted to income or expense accounts in ${periodLabel}.`;
    const parts = [`${periodLabel}: ${isLoss ? 'an operating loss' : 'an operating profit'} of ${money(Math.abs(net))} on revenue of ${money(income)} and expenses of ${money(expense)}.`];
    if (income === 0) parts.push('No revenue was posted in this period.');
    const expChange = prior ? percentChange(expense, prior.Expense) : null;
    if (expChange !== null && Math.abs(expChange) >= 1) parts.push(`Expenses are ${Math.abs(expChange).toFixed(0)}% ${expChange < 0 ? 'lower' : 'higher'} than ${priorLabel}.`);
    if (uncategorized > 0) parts.push(`${money(uncategorized)} is sitting in Uncategorized Expense and should be reclassified.`);
    return parts.join(' ');
  })();

  const handlePrint = () => {
    const html = `
      <p class="muted">Period: ${escapeHtml(formatDate(startDate))} – ${escapeHtml(formatDate(endDate))}${prior ? ` · compared with ${escapeHtml(priorLabel)}` : ''}</p>
      <p>${escapeHtml(summary)}</p>
      <table>
        <thead><tr><th>Measure</th><th class="num">${escapeHtml(periodLabel)}</th>${prior ? `<th class="num">${escapeHtml(priorLabel)}</th>` : ''}</tr></thead>
        <tbody>
          ${[['Revenue', income, prior?.Income], ['Expenses', expense, prior?.Expense], [isLoss ? 'Operating loss' : 'Operating profit', net, prior?.net], ['Payroll & labour cost', payroll, prior?.PayrollCost]]
            .map(([label, value, before]) => `<tr><td>${escapeHtml(String(label))}</td><td class="num">${escapeHtml(money(Number(value)))}</td>${prior ? `<td class="num">${escapeHtml(money(Number(before)))}</td>` : ''}</tr>`).join('')}
        </tbody>
      </table>
      <h3>Expenses by account</h3>
      <table>
        <thead><tr><th>Code</th><th>Account</th><th class="num">Amount</th><th class="num">Share</th></tr></thead>
        <tbody>${expenses.map(a => `<tr><td>${escapeHtml(a.code)}</td><td>${escapeHtml(a.name)}</td><td class="num">${escapeHtml(money(a.amount))}</td><td class="num">${pct(a.amount, expense).toFixed(1)}%</td></tr>`).join('')}</tbody>
        <tfoot><tr class="total-row"><td></td><td>Total expenses</td><td class="num">${escapeHtml(money(expense))}</td><td class="num">100%</td></tr></tfoot>
      </table>`;
    openPrintWindow('Management Summary', html, branding);
  };

  const handleExport = () => {
    downloadCsv('Management_Summary', ['Section', 'Item', 'Amount', prior ? `Prior (${priorLabel})` : ''], [
      ['Summary', 'Revenue', income, prior?.Income ?? ''],
      ['Summary', 'Expenses', expense, prior?.Expense ?? ''],
      ['Summary', isLoss ? 'Operating loss' : 'Operating profit', net, prior?.net ?? ''],
      ['Summary', 'Payroll & labour cost', payroll, prior?.PayrollCost ?? ''],
      ...expenses.map(a => ['Expense by account', `${a.code} ${a.name}`, a.amount, '']),
      ...monthly.map(m => ['Monthly', `${m.month} revenue / expenses / net`, `${m.income} / ${m.expense} / ${m.net}`, '']),
    ]);
  };

  return (
    <div className="space-y-6">
      {!summaryHidden && (
        <Reveal>
          <div className="flex items-start gap-3 rounded-3xl bg-[#141414] text-white px-5 py-4 shadow-sm">
            <Sparkles className="w-4 h-4 mt-0.5 shrink-0 text-amber-300" />
            <p className="flex-1 text-sm leading-relaxed text-white/85">{summary}</p>
            <div className="flex items-center gap-1 shrink-0">
              <button type="button" onClick={handlePrint} className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10" title="Print management summary"><Printer className="w-4 h-4" /></button>
              <button type="button" onClick={handleExport} className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10" title="Export CSV"><Download className="w-4 h-4" /></button>
              <button type="button" onClick={() => setSummaryHidden(true)} className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10" aria-label="Hide summary"><X className="w-4 h-4" /></button>
            </div>
          </div>
        </Reveal>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Activity} tone={isLoss ? 'rose' : 'blue'} label={isLoss ? 'Operating loss' : 'Operating profit'} loading={loading}
          value={Math.abs(net)} format={money} compact={compact} valueClassName={isLoss ? 'text-rose-600' : 'text-blue-600'}
          info="Revenue minus every expense account for the period, before tax."
          footnote={income > 0 ? `Margin ${pct(net, income).toFixed(1)}% of revenue` : prior ? `${prior.net < 0 ? 'Loss' : 'Profit'} of ${money(Math.abs(prior.net))} in ${priorLabel}` : undefined} />
        <KpiCard icon={TrendingUp} tone="emerald" label="Revenue" loading={loading} value={income} format={money} compact={compact}
          change={prior ? percentChange(income, prior.Income) : null} goodWhenUp
          footnote={income === 0 ? 'Nothing posted to income accounts' : prior ? `vs ${money(prior.Income)} in ${priorLabel}` : undefined}
          onClick={() => onOpenTab('income-statement')} />
        <KpiCard icon={TrendingDown} tone="rose" label="Expenses" loading={loading} value={expense} format={money} compact={compact}
          change={prior ? percentChange(expense, prior.Expense) : null} goodWhenUp={false}
          footnote={prior ? `vs ${money(prior.Expense)} in ${priorLabel}` : undefined}
          onClick={() => onOpenTab('income-statement')} />
        <KpiCard icon={Users} tone="violet" label="Payroll & labour cost" loading={loading} value={payroll} format={money} compact={compact}
          change={prior ? percentChange(payroll, prior.PayrollCost) : null} goodWhenUp={false}
          info={`Expense posted to ${payrollAccounts} in this period, from payroll runs or manual salary journals.`}
          footnote={expense > 0 ? `${pct(payroll, expense).toFixed(1)}% of total expenses` : undefined} />
      </div>

      {empty ? (
        <EmptyState icon={Receipt} title="No postings in this period" text={`There are no revenue or expense entries between ${formatDate(startDate)} and ${formatDate(endDate)}.`}
          action={{ label: 'Show year to date', onClick: onShowYtd }} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-5">
          <Panel title="Revenue vs expenses" icon={BarChart3} className="lg:col-span-3"
            description={monthly.some(m => !m.inRange) ? 'By month; faded months fall before the selected period' : 'By month'}>
            {monthly.length === 0 ? (
              <EmptyState icon={BarChart3} title="No monthly activity" />
            ) : (
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={3} barCategoryGap="24%">
                    <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#F0F0F0" />
                    <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={8} />
                    <YAxis {...AXIS} width={72} tickFormatter={axisTick(compact)} />
                    <ReferenceLine y={0} stroke="#E5E5E5" />
                    <Tooltip cursor={{ fill: 'rgba(20,20,20,0.04)', radius: 8 } as any} content={<ChartTooltip money={money} />} />
                    <Bar dataKey="income" name="Revenue" fill="#10b981" radius={[6, 6, 0, 0]} maxBarSize={22}>
                      {monthly.map(m => <Cell key={m.month} fillOpacity={m.inRange ? 1 : 0.3} />)}
                    </Bar>
                    <Bar dataKey="expense" name="Expenses" fill="#fb7185" radius={[6, 6, 0, 0]} maxBarSize={22}>
                      {monthly.map(m => <Cell key={m.month} fillOpacity={m.inRange ? 1 : 0.3} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="mt-3 flex gap-4 text-[11px] font-medium text-[#8E9299]">
              <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />Revenue</span>
              <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-rose-400" />Expenses</span>
            </div>
          </Panel>

          <Panel title="Top expense accounts" icon={Receipt} className="lg:col-span-2" description={`${periodLabel} · click an account for its ledger`}
            action={{ label: 'Income statement', onClick: () => onOpenTab('income-statement') }}>
            {top.length === 0 ? (
              <EmptyState icon={Receipt} title="No expenses posted" text="Expense accounts have no movement in this period." />
            ) : (
              <ul className="space-y-1">
                {top.map(a => (
                  <li key={a.id}>
                    <button type="button" onClick={() => onOpenAccount(a)} className="w-full text-left rounded-xl px-2 py-2 hover:bg-[#F5F5F5] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-mono text-[10px] font-bold text-[#8E9299] w-9 shrink-0">{a.code}</span>
                        <span className="flex-1 min-w-0 truncate font-bold text-[#141414]" title={a.name}>{a.name}</span>
                        {isUncategorized(a) && <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">Reclassify</span>}
                        <span className="shrink-0 tabular-nums font-black text-[#141414]" title={money(a.amount)}>{compact(a.amount)}</span>
                      </div>
                      <div className="mt-1.5 ml-11 flex items-center gap-2">
                        <div className="h-1.5 flex-1 rounded-full bg-[#F2F2F2] overflow-hidden">
                          <div className={`h-full rounded-full ${isUncategorized(a) ? 'bg-amber-400' : 'bg-rose-400'}`} style={{ width: `${maxTop > 0 ? Math.max((a.amount / maxTop) * 100, 2) : 0}%` }} />
                        </div>
                        <span className="w-10 text-right text-[10px] font-bold tabular-nums text-[#8E9299]">{pct(a.amount, expense).toFixed(0)}%</span>
                      </div>
                    </button>
                  </li>
                ))}
                {expenses.length > top.length && (
                  <li className="px-2 pt-1 text-[11px] text-[#8E9299]">
                    + {expenses.length - top.length} more account{expenses.length - top.length === 1 ? '' : 's'} totalling {money(expenses.slice(top.length).reduce((s, a) => s + a.amount, 0))}
                  </li>
                )}
              </ul>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
