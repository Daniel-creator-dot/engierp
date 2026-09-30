import React from 'react';
import { format, formatDistanceToNowStrict, isValid, parseISO } from 'date-fns';
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  BellRing,
  Briefcase,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  HardHat,
  KeyRound,
  LogIn,
  Receipt,
  Repeat,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  UserCog,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { Module } from '../../../types';
import type { DashboardSummary, FinanceSummary, Money, ProjectRow, UpcomingItem, WorkforceSummary } from './types';
import { AttentionItem, QualityItem, Severity, describeMonths } from './insights';
import { CashTrendChart } from './charts';
import { EmptyState, Panel } from './widgets';

type Go = (target?: Module) => (() => void) | undefined;

const SEVERITY_STYLE: Record<Severity, { bar: string; icon: string; label: string; chip: string }> = {
  critical: { bar: 'bg-rose-500', icon: 'bg-rose-50 text-rose-600', label: 'Urgent', chip: 'bg-rose-50 text-rose-700' },
  warning: { bar: 'bg-amber-400', icon: 'bg-amber-50 text-amber-600', label: 'Soon', chip: 'bg-amber-50 text-amber-700' },
  info: { bar: 'bg-blue-500', icon: 'bg-blue-50 text-blue-600', label: 'FYI', chip: 'bg-blue-50 text-blue-700' },
};

const toDate = (value?: string | null) => {
  if (!value) return null;
  const d = parseISO(String(value).length <= 10 ? String(value).slice(0, 10) : String(value));
  return isValid(d) ? d : null;
};

const relative = (value?: string | null) => {
  const d = toDate(value);
  return d ? `${formatDistanceToNowStrict(d)} ago` : '';
};

export function AttentionPanel({ items, go, className = '' }: { items: AttentionItem[]; go: Go; className?: string }) {
  const counts = items.reduce((acc, i) => ({ ...acc, [i.severity]: (acc[i.severity] || 0) + 1 }), {} as Record<Severity, number>);
  return (
    <Panel title="Needs attention" icon={BellRing} description="Prioritised actions across the modules you can access." className={className}
      headerExtra={items.length > 0 && <span className="ml-1 inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-rose-500 text-white text-[10px] font-black">{items.length}</span>}>
      {items.length === 0 ? (
        <div className="flex h-full min-h-[220px] flex-col items-center justify-center text-center">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-emerald-400/30 blur-xl" />
            <CheckCircle2 className="relative w-12 h-12 text-emerald-500" />
          </div>
          <p className="font-bold mt-3">All clear</p>
          <p className="text-xs text-[#8E9299]">Nothing needs your attention right now.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-1.5">
            {(['critical', 'warning', 'info'] as Severity[]).filter(s => counts[s]).map(s => (
              <span key={s} className={`text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 ${SEVERITY_STYLE[s].chip}`}>{counts[s]} {SEVERITY_STYLE[s].label}</span>
            ))}
          </div>
          <ul className="space-y-1.5">
            {items.map((item, i) => {
              const style = SEVERITY_STYLE[item.severity];
              const onClick = go(item.target);
              return (
                <li key={i}>
                  <button type="button" onClick={onClick} disabled={!onClick}
                    className="group relative w-full text-left flex items-start gap-3 rounded-2xl p-3 pl-4 bg-[#FAFAFA] hover:bg-[#F2F2F2] transition-colors disabled:cursor-default overflow-hidden">
                    <span className={`absolute left-0 top-2 bottom-2 w-1 rounded-r-full ${style.bar}`} />
                    <span className={`p-1.5 rounded-xl shrink-0 ${style.icon}`}><item.icon className="w-4 h-4" /></span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-bold text-[#141414] leading-snug">{item.label}</span>
                      {item.detail && <span className="block text-xs text-[#8E9299] truncate">{item.detail}</span>}
                    </span>
                    {onClick && <ArrowRight className="w-4 h-4 text-[#C4C7CC] mt-1 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:text-[#141414]" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Panel>
  );
}

const UPCOMING_ICONS: Record<UpcomingItem['kind'], LucideIcon> = {
  payroll: Banknote, 'casual-pay': Wallet, contract: FileText, probation: UserCog, leave: CalendarDays,
  bill: Receipt, invoice: FileText, recurring: Repeat, maintenance: Wrench,
};

function dayChip(value: string) {
  const d = toDate(value);
  if (!d) return { top: '—', bottom: '' };
  const today = new Date();
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86400000);
  if (diff < 0) return { top: format(d, 'd'), bottom: 'Late', late: true };
  if (diff === 0) return { top: format(d, 'd'), bottom: 'Today', today: true };
  if (diff === 1) return { top: format(d, 'd'), bottom: 'Tmrw' };
  return { top: format(d, 'd'), bottom: format(d, 'EEE') };
}

export function UpcomingPanel({ items, money, go }: { items: UpcomingItem[]; money: Money; go: Go }) {
  return (
    <Panel title="Coming up this week" icon={CalendarClock} description="Pay days, due dates and HR milestones in the next 7 days.">
      {items.length === 0 ? (
        <EmptyState icon={CalendarCheck} title="A quiet week ahead" text="No pay days, due bills, contract dates or leave starting in the next 7 days." />
      ) : (
        <ul className="space-y-2">
          {items.map((item, i) => {
            const chip = dayChip(item.date);
            const Icon = UPCOMING_ICONS[item.kind] || CalendarDays;
            const onClick = go(item.target);
            return (
              <li key={i}>
                <button type="button" onClick={onClick} disabled={!onClick} className="w-full text-left flex items-center gap-3 rounded-2xl p-2 hover:bg-[#F7F7F7] transition-colors disabled:cursor-default">
                  <span className={`flex flex-col items-center justify-center w-11 h-11 rounded-xl shrink-0 ${chip.today ? 'bg-[#141414] text-white' : chip.late ? 'bg-rose-50 text-rose-700' : 'bg-[#F5F5F5] text-[#141414]'}`}>
                    <span className="text-sm font-black leading-none">{chip.top}</span>
                    <span className={`text-[9px] font-bold uppercase tracking-wide ${chip.today ? 'text-white/70' : 'text-[#8E9299]'}`}>{chip.bottom}</span>
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-1.5 text-sm font-bold text-[#141414]"><Icon className="w-3.5 h-3.5 text-[#8E9299] shrink-0" /><span className="truncate">{item.label}</span></span>
                    <span className="block text-xs text-[#8E9299] truncate">{item.detail}{item.amount ? ` · ${money(item.amount)}` : ''}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

const REFERENCE_LABELS: Record<string, string> = { manual: 'Journal', invoice: 'Invoice', bill: 'Bill', payment: 'Payment', payroll: 'Payroll' };

const AUDIT_TEXT: Record<string, [string, LucideIcon]> = {
  login: ['signed in', LogIn],
  profile_updated: ['updated their profile', UserCog],
  password_changed: ['changed their password', KeyRound],
  default_password_flagged: ['was asked to change a default password', ShieldCheck],
};

export function ActivityPanel({ activity, money, go }: { activity: NonNullable<DashboardSummary['activity']>; money: Money; go: Go }) {
  const rows = [
    ...activity.journals.map(j => ({
      key: `j${j.id}`, at: j.created_at, icon: Receipt, tone: 'bg-blue-50 text-blue-600',
      title: j.description || `${REFERENCE_LABELS[j.reference_type] || 'Journal'} posted`,
      detail: `${REFERENCE_LABELS[j.reference_type] || 'Journal'} · dated ${toDate(j.date) ? format(toDate(j.date)!, 'd MMM') : '—'}`,
      amount: j.amount, target: 'accounting-transactions' as Module,
    })),
    ...activity.audit.map(a => {
      const [text, icon] = AUDIT_TEXT[a.action] || [`${a.action.replace(/_/g, ' ')} ${a.entity ? `${a.entity.replace(/_/g, ' ')}${a.entity_id ? ` #${a.entity_id}` : ''}` : ''}`.trim(), Activity];
      const who = a.user_email ? a.user_email.split('@')[0] : a.entity === 'user' && a.entity_id ? `User #${a.entity_id}` : 'System';
      return { key: `a${a.id}`, at: a.created_at, icon, tone: 'bg-slate-100 text-slate-600', title: `${who} ${text}`, detail: a.user_email || 'Audit trail', amount: undefined as number | undefined, target: undefined as Module | undefined };
    }),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 8);

  return (
    <Panel title="Recent activity" icon={Activity} description="Latest postings and account events." action={{ label: 'Ledger', onClick: go('accounting-transactions') }}>
      {rows.length === 0 ? (
        <EmptyState icon={Activity} title="No activity yet" text="Postings and sign-ins will appear here." />
      ) : (
        <ol className="relative space-y-1 before:absolute before:left-[17px] before:top-3 before:bottom-3 before:w-px before:bg-[#EEEEEE]">
          {rows.map(r => (
            <li key={r.key} className="relative flex items-start gap-3 rounded-2xl p-1.5">
              <span className={`relative z-10 p-1.5 rounded-xl ring-4 ring-white shrink-0 ${r.tone}`}><r.icon className="w-3.5 h-3.5" /></span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-[#141414] truncate" title={r.title}>{r.title}</span>
                <span className="block text-[11px] text-[#8E9299] truncate">{relative(r.at)} · {r.detail}</span>
              </span>
              {r.amount ? <span className="text-xs font-bold tabular-nums text-[#141414] shrink-0 mt-0.5">{money(r.amount)}</span> : null}
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

export function DataQualityPanel({ items, money, go }: { items: QualityItem[]; money: Money; go: Go }) {
  return (
    <Panel title="Data health" icon={Sparkles} description="Quick fixes that make payroll, tax and reports reliable.">
      {items.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="Records look complete" text="No missing statutory details or miscategorised spend found." />
      ) : (
        <ul className="space-y-2">
          {items.map(item => {
            const onClick = go(item.target);
            return (
              <li key={item.label}>
                <button type="button" onClick={onClick} disabled={!onClick} className="group w-full text-left flex items-start gap-3 rounded-2xl border border-[#F0F0F0] p-3 hover:border-[#E0E0E0] hover:bg-[#FAFAFA] transition-colors disabled:cursor-default">
                  <span className="p-1.5 rounded-xl bg-violet-50 text-violet-600 shrink-0"><item.icon className="w-4 h-4" /></span>
                  <span className="flex-1 min-w-0">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-bold text-[#141414] leading-snug">{item.label}</span>
                      <span className="text-sm font-black tabular-nums text-violet-700 shrink-0">{item.amount !== undefined ? money(item.amount) : item.count}</span>
                    </span>
                    <span className="block text-xs text-[#8E9299] leading-snug">{item.detail}</span>
                    {onClick && <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-blue-600 opacity-80 group-hover:opacity-100">Fix now <ArrowRight className="w-3 h-3" /></span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function MoversPanel({ movers, money, go }: { movers: NonNullable<FinanceSummary['expenseMovers']>; money: Money; go: Go }) {
  const max = Math.max(1, ...movers.map(m => Math.abs(m.change)));
  const monthName = new Date().toLocaleString('en', { month: 'long' });
  return (
    <Panel title="Biggest expense movers" icon={TrendingDown} description={`${monthName} so far vs the same days last month.`} action={{ label: 'Reports', onClick: go('accounting-reports') }}>
      {movers.length === 0 ? (
        <EmptyState icon={TrendingDown} title="No change yet" text="Spending by account is level with last month." />
      ) : (
        <ul className="space-y-3">
          {movers.map(m => {
            const up = m.change > 0;
            return (
              <li key={m.name} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-semibold text-[#141414] truncate" title={m.name}>{m.name}</span>
                  <span className={`inline-flex items-center gap-0.5 text-xs font-bold tabular-nums shrink-0 ${up ? 'text-rose-600' : 'text-emerald-600'}`}>
                    {up ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}{money(Math.abs(m.change))}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-[#F2F2F2] overflow-hidden">
                  <div className={`h-full rounded-full ${up ? 'bg-rose-400' : 'bg-emerald-400'}`} style={{ width: `${(Math.abs(m.change) / max) * 100}%` }} />
                </div>
                <p className="text-[11px] text-[#8E9299] tabular-nums">{money(m.current)} now · {money(m.previous)} last month</p>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function CashPanel({ finance, money, compact, go }: { finance: FinanceSummary; money: Money; compact: Money; go: Go }) {
  const runway = finance.runway;
  const cover = runway?.coverMonths ?? null;
  const months = runway?.runwayMonths ?? cover;
  const tone = finance.cashPosition <= 0 || (months !== null && months < 1) ? 'rose' : months !== null && months < 3 ? 'amber' : 'emerald';
  const toneClass = { rose: 'bg-rose-50 text-rose-700 ring-rose-100', amber: 'bg-amber-50 text-amber-700 ring-amber-100', emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-100' }[tone];
  const gauge = months === null ? 0 : Math.min(months / 6, 1);
  return (
    <Panel title="Cash & runway" icon={Wallet} description="Cash and bank balance at each month end." action={{ label: 'Bank', onClick: go('accounting-bank') }}>
      <div className={`rounded-2xl ring-1 p-4 ${toneClass}`}>
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[10px] font-bold uppercase tracking-widest opacity-80">{runway?.runwayMonths != null ? 'Runway at net burn' : 'Cash covers'}</p>
          <p className="text-[10px] font-bold opacity-70">{runway?.basisLabel}</p>
        </div>
        <p className="text-2xl font-black tracking-tight mt-0.5">
          {finance.cashPosition <= 0 ? 'No cash cover' : months !== null ? `~${describeMonths(months)}` : 'Not enough history'}
        </p>
        <div className="mt-2 h-1.5 rounded-full bg-white/70 overflow-hidden">
          <div className="h-full rounded-full bg-current transition-all duration-700" style={{ width: `${Math.max(gauge * 100, finance.cashPosition > 0 ? 3 : 0)}%` }} />
        </div>
        <p className="mt-2 text-[11px] font-medium opacity-80">
          {runway?.runwayMonths != null
            ? `Net burn ~${money(-runway.avgMonthlyNet)}/month`
            : runway?.avgMonthlyExpense ? `of average spending (~${money(runway.avgMonthlyExpense)}/month)` : 'Post a few months of expenses to estimate this'}
        </p>
      </div>
      <div className="mt-4">
        <CashTrendChart data={finance.monthly} money={money} compact={compact} />
      </div>
    </Panel>
  );
}

function projectHealth(p: ProjectRow) {
  if (p.budgetUsedPct !== null && p.budgetUsedPct > 100) return { label: 'Over budget', chip: 'bg-rose-50 text-rose-700', bar: 'bg-rose-500' };
  if (!p.spent && !p.completion) return { label: 'Not started', chip: 'bg-slate-100 text-slate-600', bar: 'bg-slate-300' };
  if (p.budgetUsedPct !== null && p.budgetUsedPct - p.completion > 15) return { label: 'At risk', chip: 'bg-amber-50 text-amber-700', bar: 'bg-amber-500' };
  return { label: 'On track', chip: 'bg-emerald-50 text-emerald-700', bar: 'bg-blue-600' };
}

export function ProjectsPanel({ projects, money, go }: { projects: NonNullable<DashboardSummary['projects']>; money: Money; go: Go }) {
  return (
    <Panel title="Project health" icon={Briefcase} description="Budget used against work completed." action={{ label: 'All projects', onClick: go('projects-active') }}>
      {projects.open.length === 0 ? (
        <EmptyState icon={Briefcase} title="No open projects" text="Create a project to track budget, spend and progress here." action={{ label: 'Open projects', onClick: go('projects-active') }} />
      ) : (
        <div className={`grid gap-3 ${projects.open.length > 1 ? 'sm:grid-cols-2' : ''}`}>
          {projects.open.map(p => {
            const health = projectHealth(p);
            return (
              <div key={p.id} className="rounded-2xl bg-[#FAFAFA] ring-1 ring-black/[0.03] p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-sm text-[#141414] leading-snug line-clamp-2" title={p.name}>{p.name}</p>
                    <p className="text-[11px] text-[#8E9299] truncate">{p.client}{p.status ? ` · ${p.status}` : ''}{p.endDate && toDate(p.endDate) ? ` · due ${format(toDate(p.endDate)!, 'd MMM yyyy')}` : ''}</p>
                  </div>
                  <span className={`text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 shrink-0 ${health.chip}`}>{health.label}</span>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] font-medium text-[#8E9299]"><span>Budget used</span><span className="tabular-nums">{p.budgetUsedPct !== null ? `${p.budgetUsedPct}%` : 'No budget'}</span></div>
                  <div className="h-1.5 rounded-full bg-white overflow-hidden"><div className={`h-full rounded-full ${health.bar}`} style={{ width: `${Math.min(p.budgetUsedPct ?? 0, 100)}%` }} /></div>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] font-medium text-[#8E9299]"><span>Completed</span><span className="tabular-nums">{p.completion}%</span></div>
                  <div className="h-1.5 rounded-full bg-white overflow-hidden"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(p.completion, 100)}%` }} /></div>
                </div>
                <p className="text-[11px] text-[#8E9299] tabular-nums">{money(p.spent)} spent{p.budget ? ` of ${money(p.budget)}` : ''}</p>
              </div>
            );
          })}
        </div>
      )}
      {projects.retentionHeld > 0 && (
        <p className="text-xs text-[#8E9299] pt-3">Retention held on contracts: <span className="font-bold text-[#141414]">{money(projects.retentionHeld)}</span></p>
      )}
    </Panel>
  );
}

export function WorkforcePanel({ workforce, money, go }: { workforce: WorkforceSummary; money: Money; go: Go }) {
  const topDepartments = workforce.departments.slice(0, 5);
  const maxDept = Math.max(1, ...topDepartments.map(d => d.count));
  const attendance = workforce.attendanceToday;
  const runStatus = workforce.payroll.runStatus;
  const paid = String(runStatus || '').toLowerCase() === 'paid' || (workforce.payroll.processed > 0 && workforce.payroll.paid === workforce.payroll.processed);
  const payday = toDate(workforce.payroll.payday);
  return (
    <Panel title="Workforce" icon={Users} description="Headcount, attendance and payroll at a glance." action={{ label: 'Directory', onClick: go('hr-directory') }}>
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Headcount', value: workforce.headcount },
          { label: 'On leave today', value: workforce.onLeave },
          { label: 'Casual workers', value: workforce.casualWorkers ?? 0 },
        ].map(s => (
          <div key={s.label} className="rounded-2xl bg-[#FAFAFA] p-3 text-center">
            <p className="text-xl font-black tabular-nums text-[#141414]">{s.value}</p>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#8E9299]">{s.label}</p>
          </div>
        ))}
      </div>

      <div className={`mt-4 flex items-center justify-between gap-3 rounded-2xl p-3.5 ring-1 ${paid ? 'bg-emerald-50 ring-emerald-100' : 'bg-amber-50 ring-amber-100'}`}>
        <div className="flex items-center gap-3 min-w-0">
          <span className={`p-2 rounded-xl ${paid ? 'bg-white text-emerald-600' : 'bg-white text-amber-600'}`}><Banknote className="w-4 h-4" /></span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-[#141414] truncate">{workforce.payroll.period} payroll</p>
            <p className="text-[11px] text-[#6B6F76] truncate">
              {paid ? `Paid${workforce.payroll.netTotal ? ` · net ${money(workforce.payroll.netTotal)}` : ''}` : runStatus ? `Run is ${runStatus.toLowerCase()}` : 'Not started'}
              {payday ? ` · pay day ${format(payday, 'EEE d MMM')}` : ''}
            </p>
          </div>
        </div>
        <button type="button" onClick={go('hr-payroll')} className="shrink-0 text-xs font-bold rounded-xl bg-[#141414] text-white px-3 py-1.5 hover:bg-black transition-colors">
          {paid ? 'View' : 'Run payroll'}
        </button>
      </div>

      {topDepartments.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#8E9299]">Staff by department</p>
          {topDepartments.map(d => (
            <div key={d.name} className="flex items-center gap-3 text-sm">
              <span className="w-28 truncate font-medium capitalize text-[#141414]" title={d.name}>{d.name.toLowerCase()}</span>
              <div className="flex-1 h-2 bg-[#F2F2F2] rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500" style={{ width: `${(d.count / maxDept) * 100}%` }} />
              </div>
              <span className="w-8 text-right font-bold tabular-nums">{d.count}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 rounded-2xl border border-dashed border-[#E6E6E6] p-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <ClipboardCheck className="w-4 h-4 text-[#8E9299] shrink-0" />
          <p className="text-xs text-[#6B6F76] truncate">
            {attendance?.recorded
              ? `Attendance today: ${Object.entries(attendance.byStatus).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(' · ')}`
              : 'No attendance marked today'}
          </p>
        </div>
        <button type="button" onClick={go('hr-attendance')} className="shrink-0 text-xs font-bold text-blue-600 hover:text-blue-700">Open</button>
      </div>

      {workforce.onLeaveToday && workforce.onLeaveToday.length > 0 && (
        <p className="mt-3 text-[11px] text-[#8E9299] truncate">On leave: {workforce.onLeaveToday.map(l => l.name).join(', ')}</p>
      )}
    </Panel>
  );
}

export function SiteReportsPanel({ operations, go }: { operations: NonNullable<DashboardSummary['operations']>; go: Go }) {
  return (
    <Panel title="Latest site reports" icon={HardHat} description="Most recent updates from the field." action={{ label: 'Field Ops', onClick: go('field-ops') }}>
      {operations.recentReports.length === 0 ? (
        <EmptyState icon={HardHat} title="No site reports yet" text="Reports submitted from site will show here for review." action={{ label: 'Submit a report', onClick: go('field-ops') }} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {operations.recentReports.map(r => (
            <div key={r.id} className="rounded-2xl bg-[#FAFAFA] p-4">
              <div className="flex justify-between gap-3">
                <p className="font-bold text-sm truncate">{r.project_name || 'Unassigned project'}</p>
                <span className="text-[11px] text-[#8E9299] shrink-0">{relative(r.created_at)}</span>
              </div>
              <p className="text-xs text-[#8E9299] mt-1 line-clamp-2">{r.content || 'No details provided.'}</p>
              {r.issues && <p className="text-xs text-rose-600 mt-1 line-clamp-1">Issue: {r.issues}</p>}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
