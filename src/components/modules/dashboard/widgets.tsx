import React, { useEffect, useId, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Info, type LucideIcon } from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';

export type Tone = 'emerald' | 'rose' | 'blue' | 'amber' | 'violet' | 'slate';

export const TONES: Record<Tone, { icon: string; stroke: string; soft: string }> = {
  emerald: { icon: 'bg-emerald-50 text-emerald-600 ring-emerald-100', stroke: '#10b981', soft: 'bg-emerald-500' },
  rose: { icon: 'bg-rose-50 text-rose-600 ring-rose-100', stroke: '#f43f5e', soft: 'bg-rose-500' },
  blue: { icon: 'bg-blue-50 text-blue-600 ring-blue-100', stroke: '#2563eb', soft: 'bg-blue-600' },
  amber: { icon: 'bg-amber-50 text-amber-600 ring-amber-100', stroke: '#f59e0b', soft: 'bg-amber-500' },
  violet: { icon: 'bg-violet-50 text-violet-600 ring-violet-100', stroke: '#7c3aed', soft: 'bg-violet-600' },
  slate: { icon: 'bg-slate-100 text-slate-600 ring-slate-200', stroke: '#64748b', soft: 'bg-slate-500' },
};

/** Fades and lifts children in once; skipped for users who prefer reduced motion. */
export function Reveal({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string }) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div className={className} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] }}>
      {children}
    </motion.div>
  );
}

export function useCountUp(target: number, duration = 800) {
  const reduce = useReducedMotion();
  const [value, setValue] = useState(reduce ? target : 0);
  const from = useRef(0);
  useEffect(() => {
    if (reduce || !Number.isFinite(target)) {
      setValue(target);
      return;
    }
    const start = performance.now();
    const origin = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(origin + (target - origin) * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
      else from.current = target;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration, reduce]);
  return value;
}

export function InfoTip({ text, className = '' }: { text: string; className?: string }) {
  return (
    <span className={`relative inline-flex group/tip ${className}`} onClick={e => e.stopPropagation()}>
      <button type="button" aria-label={text} className="text-[#8E9299] hover:text-[#141414] focus:text-[#141414] focus:outline-none rounded-full">
        <Info className="w-3.5 h-3.5" />
      </button>
      <span role="tooltip" className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 w-64 -translate-x-1/2 rounded-xl bg-[#141414] px-3 py-2 text-[11px] font-medium normal-case tracking-normal leading-relaxed text-white opacity-0 shadow-xl transition-opacity duration-150 group-hover/tip:opacity-100 group-focus-within/tip:opacity-100 whitespace-pre-line">
        {text}
      </span>
    </span>
  );
}

export function DeltaPill({ change, goodWhenUp = true, className = '' }: { change: number | null | undefined; goodWhenUp?: boolean; className?: string }) {
  if (change === null || change === undefined || !Number.isFinite(change)) return null;
  const up = change >= 0;
  const good = up === goodWhenUp;
  const Arrow = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${good ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'} ${className}`}>
      <Arrow className="w-3 h-3" />
      {Math.abs(change) >= 1000 ? '999+' : Math.abs(change).toFixed(1)}%
    </span>
  );
}

export function Sparkline({ data, color, height = 44 }: { data: number[]; color: string; height?: number }) {
  const id = `spark-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  if (!data.length || data.every(v => !v)) return <div style={{ height }} className="flex items-end"><div className="h-px w-full bg-[#EDEDED]" /></div>;
  const points = data.map((v, i) => ({ i, v }));
  return (
    <div style={{ height }} aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 4, right: 2, bottom: 0, left: 2 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={`url(#${id})`} dot={false} isAnimationActive animationDuration={900} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

interface KpiCardProps {
  icon: LucideIcon;
  tone: Tone;
  label: string;
  value: number;
  format: (value: number) => string;
  info?: string;
  change?: number | null;
  goodWhenUp?: boolean;
  badge?: React.ReactNode;
  footnote?: React.ReactNode;
  spark?: number[];
  valueClassName?: string;
  loading?: boolean;
  onClick?: () => void;
}

export function KpiCard({ icon: Icon, tone, label, value, format, info, change, goodWhenUp, badge, footnote, spark, valueClassName, loading, onClick }: KpiCardProps) {
  const animated = useCountUp(value);
  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      className={`group relative w-full text-left rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/[0.03] transition-all duration-300 ${onClick ? 'cursor-pointer hover:-translate-y-0.5 hover:shadow-xl hover:shadow-black/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500' : ''} ${loading ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className={`p-2.5 rounded-2xl ring-1 ${TONES[tone].icon}`}><Icon className="w-5 h-5" /></div>
        <div className="flex items-center gap-1.5">
          {badge}
          <DeltaPill change={change} goodWhenUp={goodWhenUp} />
        </div>
      </div>
      <div className="mt-4 flex items-center gap-1.5">
        <p className="text-[11px] font-bold text-[#8E9299] uppercase tracking-widest truncate">{label}</p>
        {info && <InfoTip text={info} />}
      </div>
      <p className={`mt-1 text-[1.65rem] leading-tight font-black tabular-nums tracking-tight truncate ${valueClassName || 'text-[#141414]'}`}>{format(animated)}</p>
      {footnote && <div className="mt-1 min-h-[2.5em] text-[11px] leading-[1.25em] text-[#8E9299] font-medium line-clamp-2">{footnote}</div>}
      {spark && <div className="mt-3 -mx-1"><Sparkline data={spark} color={TONES[tone].stroke} /></div>}
    </div>
  );
}

export function MiniStat({ icon: Icon, tone, label, value, footnote, onClick }: { icon: LucideIcon; tone: Tone; label: string; value: React.ReactNode; footnote?: string; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick}
      className={`group w-full text-left flex items-center gap-3 rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-black/[0.03] transition-all ${onClick ? 'hover:shadow-md hover:ring-black/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500' : ''}`}>
      <div className={`p-2 rounded-xl ring-1 shrink-0 ${TONES[tone].icon}`}><Icon className="w-4 h-4" /></div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#8E9299] truncate">{label}</p>
        <p className="text-base font-black text-[#141414] tabular-nums truncate">{value}</p>
        {footnote && <p className="text-[10px] text-[#8E9299] truncate">{footnote}</p>}
      </div>
    </Tag>
  );
}

interface PanelProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: { label: string; onClick?: () => void };
  headerExtra?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}

export function Panel({ title, description, icon: Icon, action, headerExtra, className = '', bodyClassName = '', children }: PanelProps) {
  return (
    <section className={`flex flex-col rounded-3xl bg-white shadow-sm ring-1 ring-black/[0.03] overflow-hidden ${className}`}>
      <header className="flex items-start justify-between gap-3 px-6 pt-5 pb-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-bold text-[#141414]">
            {Icon && <Icon className="w-4 h-4 text-[#8E9299]" />}
            {title}
            {headerExtra}
          </h2>
          {description && <p className="text-xs text-[#8E9299] mt-0.5">{description}</p>}
        </div>
        {action?.onClick && (
          <button type="button" onClick={action.onClick} className="shrink-0 inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-700 rounded-lg px-2 py-1 hover:bg-blue-50 transition-colors">
            {action.label} <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </header>
      <div className={`flex-1 px-6 pb-6 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

export function EmptyState({ icon: Icon, title, text, action }: { icon: LucideIcon; title: string; text?: string; action?: { label: string; onClick?: () => void } }) {
  return (
    <div className="flex h-full min-h-[160px] flex-col items-center justify-center text-center rounded-2xl border border-dashed border-[#E6E6E6] bg-[#FAFAFA] px-6 py-8">
      <div className="p-3 rounded-2xl bg-white ring-1 ring-black/[0.04] shadow-sm"><Icon className="w-5 h-5 text-[#8E9299]" /></div>
      <p className="mt-3 text-sm font-bold text-[#141414]">{title}</p>
      {text && <p className="mt-1 text-xs text-[#8E9299] max-w-xs">{text}</p>}
      {action?.onClick && (
        <button type="button" onClick={action.onClick} className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-700">
          {action.label} <ArrowRight className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

const Bone = ({ className = '' }: { className?: string }) => <div className={`animate-pulse rounded-xl bg-[#ECECEC] ${className}`} />;

export function DashboardSkeleton() {
  return (
    <div className="space-y-6 pb-12" aria-busy="true" aria-label="Loading dashboard">
      <div className="rounded-[2rem] bg-[#141414] p-6 md:p-8 space-y-4">
        <div className="h-3 w-28 rounded-full bg-white/10 animate-pulse" />
        <div className="h-9 w-2/3 max-w-md rounded-xl bg-white/10 animate-pulse" />
        <div className="h-4 w-full max-w-xl rounded-full bg-white/10 animate-pulse" />
        <div className="flex gap-2 pt-2">{[0, 1, 2, 3].map(i => <div key={i} className="h-9 w-28 rounded-xl bg-white/10 animate-pulse" />)}</div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="rounded-3xl bg-white p-5 shadow-sm space-y-3">
            <Bone className="h-10 w-10 rounded-2xl" />
            <Bone className="h-3 w-24" />
            <Bone className="h-7 w-36" />
            <Bone className="h-10 w-full" />
          </div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-3xl bg-white p-6 shadow-sm space-y-4"><Bone className="h-4 w-40" /><Bone className="h-64 w-full" /></div>
        <div className="rounded-3xl bg-white p-6 shadow-sm space-y-3"><Bone className="h-4 w-32" />{[0, 1, 2, 3].map(i => <React.Fragment key={i}><Bone className="h-12 w-full" /></React.Fragment>)}</div>
      </div>
    </div>
  );
}
