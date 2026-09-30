import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Briefcase,
  ClipboardList,
  HardHat,
  Package,
  PieChart as PieChartIcon,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Truck,
  Users,
  Wallet,
} from 'lucide-react';
import { dashboardApi, settingsApi } from '../../lib/api';
import { formatCompactCurrency, formatCurrency } from '../../lib/currency';
import { useAuth } from '../../contexts/AuthContext';
import { Module } from '../../types';
import Hero from './dashboard/Hero';
import { AgingBar, ExpenseDonut, PerformanceChart } from './dashboard/charts';
import {
  QUICK_ACTIONS,
  buildAttention,
  buildDataQuality,
  buildSummary,
  describeMonths,
  mergeUpcoming,
  percentChange,
} from './dashboard/insights';
import {
  ActivityPanel,
  AttentionPanel,
  CashPanel,
  DataQualityPanel,
  MoversPanel,
  ProjectsPanel,
  SiteReportsPanel,
  UpcomingPanel,
  WorkforcePanel,
} from './dashboard/panels';
import type { DashboardSummary, FinanceSummary, PeriodKey, PL } from './dashboard/types';
import { DashboardSkeleton, EmptyState, KpiCard, MiniStat, Panel, Reveal } from './dashboard/widgets';

interface DashboardProps {
  onNavigate?: (module: Module) => void;
}

const PERIOD_STORAGE_KEY = 'dashboard.period';
const STALE_AFTER_MS = 5 * 60 * 1000;
const PERIODS: PeriodKey[] = ['month', 'quarter', 'ytd', '12m'];

const storedPeriod = (): PeriodKey => {
  const value = localStorage.getItem(PERIOD_STORAGE_KEY) as PeriodKey | null;
  return value && PERIODS.includes(value) ? value : 'month';
};

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Period figures, falling back to the month fields an older API returns. */
function periodFigures(finance: FinanceSummary) {
  const legacy = finance as any;
  const period = finance.period ?? { ...(legacy.currentMonth as PL), key: 'month' as PeriodKey, label: 'This month', priorLabel: 'same days last month' };
  const prior: PL = finance.prior ?? legacy.previousMonthToDate ?? legacy.previousMonth ?? { income: 0, expense: 0, net: 0 };
  return { period, prior };
}

export default function Dashboard({ onNavigate }: DashboardProps) {
  const { user } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [currency, setCurrency] = useState('GHS');
  const [period, setPeriod] = useState<PeriodKey>(storedPeriod);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [, setClock] = useState(0);
  const latestRequest = useRef(0);
  const periodRef = useRef(period);
  const summaryRef = useRef<DashboardSummary | null>(null);

  const load = useCallback(async (nextPeriod: PeriodKey, mode: 'initial' | 'refresh' | 'silent') => {
    const requestId = ++latestRequest.current;
    if (mode === 'initial') setIsLoading(true);
    if (mode === 'refresh') setIsRefreshing(true);
    setLoadError('');
    try {
      const res = await dashboardApi.getSummary(nextPeriod);
      if (requestId !== latestRequest.current) return;
      summaryRef.current = res.data;
      setSummary(res.data);
    } catch (error: any) {
      if (requestId !== latestRequest.current) return;
      setLoadError(error?.response?.data?.message || 'Could not load the dashboard. Check your connection and try again.');
    } finally {
      if (requestId === latestRequest.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    load(periodRef.current, 'initial');
    settingsApi.getSettings()
      .then(res => {
        const setting = res.data.find((s: any) => s.key === 'currency');
        if (setting?.value) setCurrency(setting.value);
      })
      .catch(() => undefined);

    const clock = window.setInterval(() => setClock(c => c + 1), 30000);
    const onVisible = () => {
      const generatedAt = summaryRef.current?.generatedAt;
      if (document.visibilityState === 'visible' && generatedAt && Date.now() - new Date(generatedAt).getTime() > STALE_AFTER_MS) {
        load(periodRef.current, 'silent');
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(clock);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const changePeriod = (next: PeriodKey) => {
    if (next === periodRef.current) return;
    periodRef.current = next;
    setPeriod(next);
    localStorage.setItem(PERIOD_STORAGE_KEY, next);
    load(next, 'refresh');
  };

  const money = (value: number) => formatCurrency(value || 0, currency);
  const compact = (value: number) => formatCompactCurrency(value || 0, currency);
  const go = (target?: Module) => (target && onNavigate ? () => onNavigate(target) : undefined);

  if (isLoading && !summary) return <DashboardSkeleton />;

  if (!summary) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4 text-center">
        <div className="p-4 rounded-3xl bg-amber-50"><AlertTriangle className="w-8 h-8 text-amber-500" /></div>
        <p className="font-bold text-[#141414] max-w-md">{loadError || 'Nothing to show yet.'}</p>
        <button type="button" onClick={() => load(periodRef.current, 'initial')} className="inline-flex items-center gap-2 rounded-xl bg-[#141414] px-4 py-2 text-sm font-bold text-white hover:bg-black">
          <RefreshCw className="w-4 h-4" /> Try again
        </button>
      </div>
    );
  }

  const { finance, workforce, projects, operations, procurement, assets, activity } = summary;
  const role = summary.role || user?.role || '';
  const attention = buildAttention(summary, money);
  const quality = buildDataQuality(summary);
  const upcoming = mergeUpcoming(summary);
  const actions = QUICK_ACTIONS.filter(a => a.roles.includes(role));
  const displayName = (user?.name || user?.email?.split('@')[0] || '').trim().toLowerCase().replace(/\b\p{L}/gu, c => c.toUpperCase());

  const figures = finance ? periodFigures(finance) : null;
  const monthly = finance?.monthly ?? [];
  const cashSeries = monthly.map(m => m.cash ?? 0);
  const lastMonthCash = monthly.length > 1 ? monthly[monthly.length - 2].cash : undefined;
  const isLoss = !!figures && figures.period.net < 0;
  const ytdLoss = !!finance && finance.ytd.net < 0;
  const hasChartData = monthly.some(m => m.income || m.expense);
  const trendIncome = monthly.reduce((s, m) => s + m.income, 0);
  const trendExpense = monthly.reduce((s, m) => s + m.expense, 0);
  const cover = finance?.runway?.coverMonths ?? null;
  const showAging = !!finance && (finance.receivables.outstanding > 0 || finance.payables.outstanding > 0) && !!finance.receivables.aging;

  const miniStats = [
    workforce && { icon: Users, tone: 'blue' as const, label: 'Staff', value: workforce.headcount, footnote: `${workforce.active} active${workforce.onLeave ? ` · ${workforce.onLeave} on leave` : ''}`, target: 'hr-directory' as Module },
    projects && { icon: Briefcase, tone: 'violet' as const, label: 'Open projects', value: projects.openTotal, footnote: `${projects.total} total${projects.overBudget ? ` · ${projects.overBudget} over budget` : ''}`, target: 'projects-active' as Module },
    finance && { icon: ClipboardList, tone: finance.receivables.overdue ? 'rose' as const : 'emerald' as const, label: 'Owed by clients', value: money(finance.receivables.outstanding), footnote: finance.receivables.open ? `${finance.receivables.open} unpaid${finance.receivables.overdue ? `, ${finance.receivables.overdue} overdue` : ''}` : 'All invoices paid', target: 'accounting-ar' as Module },
    finance && { icon: ClipboardList, tone: finance.payables.overdue ? 'rose' as const : 'emerald' as const, label: 'Owed to suppliers', value: money(finance.payables.outstanding), footnote: finance.payables.open ? `${finance.payables.open} unpaid${finance.payables.overdue ? `, ${finance.payables.overdue} overdue` : ''}` : 'All bills paid', target: 'accounting-ap' as Module },
    procurement && { icon: Package, tone: procurement.pendingApproval ? 'amber' as const : 'slate' as const, label: 'POs to approve', value: procurement.pendingApproval, footnote: procurement.pendingApproval ? money(procurement.pendingValue) : 'Nothing waiting', target: 'procurement-pos' as Module },
    assets && { icon: Truck, tone: 'slate' as const, label: 'Equipment on site', value: `${assets.onSite} / ${assets.total}`, footnote: assets.total ? `${Math.round((assets.onSite / assets.total) * 100)}% utilised` : 'None registered', target: 'assets' as Module },
    operations && { icon: HardHat, tone: operations.pendingReview ? 'amber' as const : 'slate' as const, label: 'Site reports', value: operations.pendingReview, footnote: operations.pendingReview ? 'Awaiting review' : 'Nothing to review', target: 'field-ops' as Module },
  ].filter(Boolean) as { icon: any; tone: any; label: string; value: React.ReactNode; footnote: string; target: Module }[];

  const noSections = !finance && !workforce && !projects && !operations && !procurement && !assets;

  return (
    <div className="space-y-6 pb-12">
      <Reveal>
        <Hero
          name={displayName}
          summary={buildSummary(summary, money, attention.length)}
          actions={actions}
          onNavigate={onNavigate}
          period={period}
          onPeriodChange={finance ? changePeriod : undefined}
          generatedAt={summary.generatedAt}
          refreshing={isRefreshing}
          onRefresh={() => load(periodRef.current, 'refresh')}
        />
      </Reveal>

      {(summary.errors?.length > 0 || (loadError && summary)) && (
        <div className="p-4 bg-amber-50 ring-1 ring-amber-100 rounded-2xl text-sm text-amber-800 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {loadError || `Some figures couldn't be loaded (${summary.errors.join(', ')}). The rest of the dashboard is up to date.`}
        </div>
      )}

      {finance && figures && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Reveal delay={0.05}>
            <KpiCard icon={TrendingUp} tone="emerald" label={`Revenue · ${figures.period.label}`} value={figures.period.income} format={money}
              loading={isRefreshing}
              change={figures.period.income ? percentChange(figures.period.income, figures.prior.income) : null} goodWhenUp
              info={`Income posted to revenue accounts in the general ledger, ${figures.period.label.toLowerCase()}, compared with the ${figures.period.priorLabel}.`}
              footnote={figures.period.income ? `${capitalize(figures.period.priorLabel)}: ${money(figures.prior.income)}` : `No revenue recorded yet · ${figures.period.priorLabel} ${money(figures.prior.income)}`}
              spark={monthly.map(m => m.income)} onClick={go('accounting-reports')} />
          </Reveal>
          <Reveal delay={0.1}>
            <KpiCard icon={TrendingDown} tone="rose" label={`Expenses · ${figures.period.label}`} value={figures.period.expense} format={money}
              loading={isRefreshing}
              change={percentChange(figures.period.expense, figures.prior.expense)} goodWhenUp={false}
              info={`Everything posted to expense accounts, ${figures.period.label.toLowerCase()}. Green means spending fell compared with the ${figures.period.priorLabel}.`}
              footnote={`${capitalize(figures.period.priorLabel)}: ${money(figures.prior.expense)}`}
              spark={monthly.map(m => m.expense)} onClick={go('accounting-reports')} />
          </Reveal>
          <Reveal delay={0.15}>
            <KpiCard icon={Activity} tone={isLoss ? 'rose' : 'blue'} label={`${isLoss ? 'Net loss' : 'Net profit'} · ${figures.period.label}`}
              value={Math.abs(figures.period.net)} format={money} valueClassName={isLoss ? 'text-rose-600' : undefined}
              loading={isRefreshing}
              badge={isLoss ? <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-rose-700">Loss</span> : undefined}
              info={`Revenue minus expenses, ${figures.period.label.toLowerCase()}.\nRevenue: ${money(figures.period.income)}\nExpenses: ${money(figures.period.expense)}\n${isLoss ? 'Net loss' : 'Net profit'}: ${money(Math.abs(figures.period.net))}`}
              footnote={figures.period.key === 'ytd'
                ? `Revenue ${compact(figures.period.income)} · Expenses ${compact(figures.period.expense)}`
                : <>Year to date: <span className={ytdLoss ? 'text-rose-600 font-bold' : 'text-emerald-600 font-bold'}>{ytdLoss ? 'net loss' : 'net profit'} {money(Math.abs(finance.ytd.net))}</span></>}
              spark={monthly.map(m => m.net)} onClick={go('accounting-reports')} />
          </Reveal>
          <Reveal delay={0.2}>
            <KpiCard icon={Wallet} tone="amber" label="Cash & bank" value={finance.cashPosition} format={money}
              valueClassName={finance.cashPosition < 0 ? 'text-rose-600' : undefined}
              change={lastMonthCash !== undefined ? percentChange(finance.cashPosition, lastMonthCash) : null} goodWhenUp
              info={'Balance of all cash and bank accounts in the ledger right now. The change compares with the balance at the end of last month.'}
              footnote={finance.cashPosition <= 0 ? 'Balance is at or below zero' : cover !== null ? `Covers ~${describeMonths(cover)} of average spending` : 'Cash and bank accounts in the ledger'}
              spark={cashSeries} onClick={go('accounting-bank')} />
          </Reveal>
        </div>
      )}

      {miniStats.length > 0 && (
        <Reveal delay={0.25}>
          <div className={`grid gap-3 grid-cols-2 md:grid-cols-4 ${miniStats.length > 4 ? 'xl:grid-cols-7' : ''}`}>
            {miniStats.map(s => (
              <React.Fragment key={s.label}>
                <MiniStat icon={s.icon} tone={s.tone} label={s.label} value={s.value} footnote={s.footnote} onClick={go(s.target)} />
              </React.Fragment>
            ))}
          </div>
        </Reveal>
      )}

      {finance ? (
        <>
          <div className="grid gap-6 lg:grid-cols-3">
            <Reveal delay={0.3} className="lg:col-span-2">
              <Panel title="Revenue vs expenses" icon={BarChart3} description="Last 12 months from the general ledger, with net profit as a line." className="h-full"
                action={{ label: 'P&L', onClick: go('accounting-reports') }}>
                {hasChartData ? (
                  <>
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mb-3 text-xs">
                      <span className="inline-flex items-center gap-1.5 text-[#8E9299]"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />Revenue <b className="text-[#141414] tabular-nums">{compact(trendIncome)}</b></span>
                      <span className="inline-flex items-center gap-1.5 text-[#8E9299]"><span className="w-2.5 h-2.5 rounded-full bg-rose-400" />Expenses <b className="text-[#141414] tabular-nums">{compact(trendExpense)}</b></span>
                      <span className="inline-flex items-center gap-1.5 text-[#8E9299]"><span className="w-4 h-0.5 rounded-full bg-blue-600" />Net <b className={`tabular-nums ${trendIncome - trendExpense < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{compact(trendIncome - trendExpense)}</b></span>
                    </div>
                    <PerformanceChart data={monthly} money={money} compact={compact} />
                  </>
                ) : (
                  <EmptyState icon={BarChart3} title="No revenue or expenses yet" text="Post invoices, bills or journals and the 12-month trend will build up here." />
                )}
              </Panel>
            </Reveal>
            <Reveal delay={0.35}><AttentionPanel items={attention} go={go} className="h-full" /></Reveal>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Reveal delay={0.4}>
              <Panel title="Where the money went" icon={PieChartIcon} description={`Top expense accounts · ${figures?.period.label.toLowerCase()}`} className="h-full">
                {finance.expenseBreakdown && finance.expenseBreakdown.items.length > 0 ? (
                  <ExpenseDonut items={finance.expenseBreakdown.items} total={finance.expenseBreakdown.total} money={money} compact={compact} />
                ) : (
                  <EmptyState icon={PieChartIcon} title="No expenses in this period" text="Pick a longer period above to see the spending mix." />
                )}
              </Panel>
            </Reveal>
            <Reveal delay={0.45}><MoversPanel movers={finance.expenseMovers ?? []} money={money} go={go} /></Reveal>
            <Reveal delay={0.5}><CashPanel finance={finance} money={money} compact={compact} go={go} /></Reveal>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Reveal delay={0.55}><UpcomingPanel items={upcoming} money={money} go={go} /></Reveal>
            {activity ? <Reveal delay={0.6}><ActivityPanel activity={activity} money={money} go={go} /></Reveal> : null}
            <Reveal delay={0.65} className={activity ? '' : 'lg:col-span-2'}><DataQualityPanel items={quality} money={money} go={go} /></Reveal>
          </div>

          {showAging && (
            <Reveal>
              <Panel title="Receivables & payables aging" icon={ClipboardList} description="Open balances by how long they have been due.">
                <div className="grid gap-6 md:grid-cols-2">
                  <AgingBar title="Owed by clients" aging={finance.receivables.aging!} total={finance.receivables.outstanding} money={money} />
                  <AgingBar title="Owed to suppliers" aging={finance.payables.aging!} total={finance.payables.outstanding} money={money} />
                </div>
              </Panel>
            </Reveal>
          )}
        </>
      ) : !noSections && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Reveal delay={0.3}><AttentionPanel items={attention} go={go} className="h-full" /></Reveal>
          <Reveal delay={0.35}><UpcomingPanel items={upcoming} money={money} go={go} /></Reveal>
          {workforce && <Reveal delay={0.4}><DataQualityPanel items={quality} money={money} go={go} /></Reveal>}
        </div>
      )}

      {(projects || workforce) && (
        <div className={`grid gap-6 ${projects && workforce ? 'lg:grid-cols-2' : ''}`}>
          {projects && <Reveal><ProjectsPanel projects={projects} money={money} go={go} /></Reveal>}
          {workforce && <Reveal><WorkforcePanel workforce={workforce} money={money} go={go} /></Reveal>}
        </div>
      )}

      {operations && (operations.recentReports.length > 0 || role === 'pm') && <Reveal><SiteReportsPanel operations={operations} go={go} /></Reveal>}

      {noSections && (
        <Panel title="Welcome" icon={Activity}>
          <EmptyState icon={Activity} title="No dashboard figures for your role yet" text="Use the menu to open your modules." />
        </Panel>
      )}
    </div>
  );
}
