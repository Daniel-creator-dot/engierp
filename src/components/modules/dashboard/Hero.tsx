import React from 'react';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { RefreshCw, Sparkles } from 'lucide-react';
import type { Module } from '../../../types';
import type { PeriodKey } from './types';
import { PERIOD_OPTIONS, QuickAction } from './insights';

interface HeroProps {
  name: string;
  summary: string;
  actions: QuickAction[];
  onNavigate?: (module: Module) => void;
  period: PeriodKey;
  onPeriodChange?: (period: PeriodKey) => void;
  generatedAt?: string;
  refreshing: boolean;
  onRefresh: () => void;
}

const greeting = () => {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
};

export default function Hero({ name, summary, actions, onNavigate, period, onPeriodChange, generatedAt, refreshing, onRefresh }: HeroProps) {
  const updated = generatedAt ? formatDistanceToNowStrict(new Date(generatedAt), { addSuffix: true }) : '';
  return (
    <section className="relative overflow-hidden rounded-[2rem] bg-[#141414] text-white shadow-2xl shadow-black/10">
      <div aria-hidden className="pointer-events-none absolute -top-24 -right-16 h-72 w-72 rounded-full bg-blue-600/40 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-28 left-1/3 h-72 w-72 rounded-full bg-violet-600/25 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute top-10 -left-20 h-56 w-56 rounded-full bg-emerald-500/15 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(rgba(255,255,255,.6)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.6)_1px,transparent_1px)] [background-size:32px_32px] [mask-image:radial-gradient(ellipse_at_top_right,black,transparent_70%)]" />

      <div className="relative p-6 md:p-8 lg:p-10">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 max-w-3xl">
            <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-white/80 ring-1 ring-white/10">
              <span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" /></span>
              {format(new Date(), 'EEEE, d MMMM yyyy')}
            </p>
            <h1 className="mt-4 text-3xl md:text-4xl lg:text-5xl font-black tracking-tight leading-[1.05]">
              {greeting()}{name ? ',' : ''}{' '}
              {name && <span className="bg-gradient-to-r from-white via-blue-100 to-violet-200 bg-clip-text text-transparent">{name}</span>}
            </h1>
            <p className="mt-3 flex gap-2 text-sm md:text-base text-white/70 leading-relaxed">
              <Sparkles className="w-4 h-4 mt-1 shrink-0 text-blue-300" />
              <span>{summary}</span>
            </p>
          </div>

          <div className="flex flex-col items-start gap-3 lg:items-end shrink-0">
            {onPeriodChange && (
              <div role="radiogroup" aria-label="Reporting period" className="inline-flex rounded-2xl bg-white/10 p-1 ring-1 ring-white/10">
                {PERIOD_OPTIONS.map(opt => (
                  <button key={opt.key} type="button" role="radio" aria-checked={period === opt.key} title={opt.label} onClick={() => onPeriodChange(opt.key)}
                    className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-all ${period === opt.key ? 'bg-white text-[#141414] shadow' : 'text-white/70 hover:text-white'}`}>
                    {opt.short}
                  </button>
                ))}
              </div>
            )}
            <button type="button" onClick={onRefresh} disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-semibold text-white/70 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-60">
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Refreshing…' : updated ? `Updated ${updated}` : 'Refresh'}
            </button>
          </div>
        </div>

        {actions.length > 0 && onNavigate && (
          <div className="mt-7 -mx-6 px-6 md:mx-0 md:px-0 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {actions.map(action => (
              <button key={action.label} type="button" onClick={() => onNavigate(action.target)}
                className="group inline-flex shrink-0 items-center gap-2 rounded-2xl bg-white/[0.08] px-4 py-2.5 text-sm font-semibold text-white ring-1 ring-white/10 backdrop-blur transition-all hover:bg-white hover:text-[#141414] hover:-translate-y-0.5">
                <action.icon className="w-4 h-4 text-blue-300 transition-colors group-hover:text-blue-600" />
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
