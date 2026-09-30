import React, { useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Aging, MonthPoint, Money } from './types';

const AXIS = { stroke: '#A1A5AB', fontSize: 11, tickLine: false, axisLine: false } as const;
/** Recharts wraps tick text on spaces; a non-breaking space keeps "GH₵ 1.2M" on one line. */
const axisTick = (compact: Money) => (v: number) => compact(v).replace(/ /g, '\u00A0');
export const DONUT_COLORS = ['#2563eb', '#7c3aed', '#f59e0b', '#10b981', '#f43f5e', '#94a3b8'];

function ChartTooltip({ active, payload, label, money }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-2xl bg-[#141414] px-3.5 py-2.5 text-white shadow-2xl min-w-[170px]">
      {label && <p className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1.5">{label}</p>}
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4 text-xs py-0.5">
          <span className="flex items-center gap-1.5 text-white/70">
            <span className="w-2 h-2 rounded-full" style={{ background: p.color || p.stroke || p.fill }} />
            {p.name}
          </span>
          <span className={`font-bold tabular-nums ${p.dataKey === 'net' && Number(p.value) < 0 ? 'text-rose-300' : ''}`}>{money(Number(p.value))}</span>
        </div>
      ))}
    </div>
  );
}

export function PerformanceChart({ data, money, compact }: { data: MonthPoint[]; money: Money; compact: Money }) {
  return (
    <div className="h-[300px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={3} barCategoryGap="22%">
          <defs>
            <linearGradient id="perf-income" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity={1} />
              <stop offset="100%" stopColor="#10b981" stopOpacity={0.55} />
            </linearGradient>
            <linearGradient id="perf-expense" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fb7185" stopOpacity={1} />
              <stop offset="100%" stopColor="#fb7185" stopOpacity={0.55} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#F0F0F0" />
          <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={8} />
          <YAxis {...AXIS} width={72} tickFormatter={axisTick(compact)} />
          <ReferenceLine y={0} stroke="#E5E5E5" />
          <Tooltip cursor={{ fill: 'rgba(20,20,20,0.04)', radius: 8 } as any} content={<ChartTooltip money={money} />} />
          <Bar dataKey="income" name="Revenue" fill="url(#perf-income)" radius={[6, 6, 0, 0]} maxBarSize={22} />
          <Bar dataKey="expense" name="Expenses" fill="url(#perf-expense)" radius={[6, 6, 0, 0]} maxBarSize={22} />
          <Line type="monotone" dataKey="net" name="Net profit" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 3, strokeWidth: 2, fill: '#fff' }} activeDot={{ r: 5 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ExpenseDonut({ items, total, money, compact }: { items: { name: string; amount: number }[]; total: number; money: Money; compact: Money }) {
  const [active, setActive] = useState<number | null>(null);
  const focus = active !== null ? items[active] : null;
  return (
    <div className="flex flex-col gap-4">
      <div className="relative h-[190px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={items} dataKey="amount" nameKey="name" innerRadius="68%" outerRadius="96%" paddingAngle={2} stroke="none" cornerRadius={6}
              onMouseEnter={(_: any, i: number) => setActive(i)} onMouseLeave={() => setActive(null)}>
              {items.map((_, i) => <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} opacity={active === null || active === i ? 1 : 0.35} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center px-10">
          <span className="text-[10px] font-bold uppercase tracking-widest text-[#8E9299] line-clamp-1">{focus ? focus.name : 'Total spend'}</span>
          <span className="text-lg font-black tabular-nums text-[#141414]">{compact(focus ? focus.amount : total)}</span>
          {focus && total > 0 && <span className="text-[11px] font-bold text-[#8E9299]">{((focus.amount / total) * 100).toFixed(1)}%</span>}
        </div>
      </div>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={item.name} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}
            className={`flex items-center gap-2 text-xs rounded-lg px-1.5 py-1 transition-colors ${active === i ? 'bg-[#F5F5F5]' : ''}`}>
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
            <span className="flex-1 truncate font-medium text-[#141414]" title={item.name}>{item.name}</span>
            <span className="tabular-nums text-[#8E9299]">{total > 0 ? `${((item.amount / total) * 100).toFixed(0)}%` : ''}</span>
            <span className="tabular-nums font-bold text-[#141414] w-24 text-right" title={money(item.amount)}>{compact(item.amount)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CashTrendChart({ data, money, compact }: { data: MonthPoint[]; money: Money; compact: Money }) {
  const hasNegative = data.some(d => d.cash < 0);
  return (
    <div className="h-[150px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="cash-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={16} />
          <YAxis {...AXIS} width={72} tickFormatter={axisTick(compact)} />
          {hasNegative && <ReferenceLine y={0} stroke="#fda4af" strokeDasharray="4 4" />}
          <Tooltip content={<ChartTooltip money={money} />} />
          <Area type="monotone" dataKey="cash" name="Cash & bank" stroke="#f59e0b" strokeWidth={2.5} fill="url(#cash-fill)" dot={false} activeDot={{ r: 4 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

const AGING_BUCKETS: { key: keyof Aging; label: string; color: string }[] = [
  { key: 'current', label: 'Not due', color: 'bg-emerald-500' },
  { key: 'd30', label: '1–30 days', color: 'bg-amber-400' },
  { key: 'd60', label: '31–60', color: 'bg-orange-500' },
  { key: 'd90', label: '61–90', color: 'bg-rose-500' },
  { key: 'd90plus', label: '90+', color: 'bg-rose-700' },
];

export function AgingBar({ title, aging, total, money }: { title: string; aging: Aging; total: number; money: Money }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-bold text-[#141414]">{title}</p>
        <p className="text-xs font-black tabular-nums">{money(total)}</p>
      </div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-[#F2F2F2]">
        {total > 0 && AGING_BUCKETS.map(b => aging[b.key] > 0 && (
          <div key={b.key} className={`${b.color} h-full`} style={{ width: `${(aging[b.key] / total) * 100}%` }} title={`${b.label}: ${money(aging[b.key])}`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {AGING_BUCKETS.map(b => (
          <span key={b.key} className="inline-flex items-center gap-1 text-[10px] text-[#8E9299]">
            <span className={`w-2 h-2 rounded-full ${b.color}`} />{b.label} <span className="font-bold text-[#141414] tabular-nums">{money(aging[b.key])}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
