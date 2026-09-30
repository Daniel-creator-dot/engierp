import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Briefcase,
  CheckCircle2,
  ClipboardList,
  HardHat,
  Loader2,
  Package,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Truck,
  Users,
  Wallet
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { dashboardApi, settingsApi } from '../../lib/api';
import { formatCurrency, getCurrencySymbol } from '../../lib/currency';
import { formatDate } from '../../lib/dates';
import { useAuth } from '../../contexts/AuthContext';
import { Module } from '../../types';

interface DashboardProps {
  onNavigate?: (module: Module) => void;
}

interface AttentionItem {
  label: string;
  detail: string;
  tone: 'red' | 'amber' | 'blue';
  target?: Module;
}

const percentChange = (current: number, previous: number) => {
  if (!previous) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
};

const greeting = () => {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
};

export default function Dashboard({ onNavigate }: DashboardProps) {
  const { user } = useAuth();
  const [summary, setSummary] = useState<any>(null);
  const [currency, setCurrency] = useState('GHS');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    load();
  }, []);

  const load = async (refresh = false) => {
    refresh ? setIsRefreshing(true) : setIsLoading(true);
    setLoadError('');
    try {
      const [summaryRes, settingsRes] = await Promise.allSettled([dashboardApi.getSummary(), settingsApi.getSettings()]);
      if (summaryRes.status === 'rejected') throw summaryRes.reason;
      setSummary(summaryRes.value.data);
      if (settingsRes.status === 'fulfilled') {
        const currencySetting = settingsRes.value.data.find((s: any) => s.key === 'currency');
        if (currencySetting) setCurrency(currencySetting.value);
      }
    } catch (error: any) {
      setLoadError(error?.response?.data?.message || 'Could not load the dashboard. Check your connection and try again.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const money = (value: number) => formatCurrency(value || 0, currency);
  const go = (target?: Module) => (target && onNavigate ? () => onNavigate(target) : undefined);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh]">
        <Loader2 className="w-10 h-10 animate-spin text-blue-600" />
        <p className="mt-4 text-sm font-bold text-[#8E9299] uppercase tracking-widest">Loading dashboard...</p>
      </div>
    );
  }

  if (loadError || !summary) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4 text-center">
        <AlertTriangle className="w-10 h-10 text-amber-500" />
        <p className="font-bold text-[#141414]">{loadError || 'Nothing to show yet.'}</p>
        <Button onClick={() => load()} className="bg-[#141414] text-white rounded-xl gap-2"><RefreshCw className="w-4 h-4" /> Try again</Button>
      </div>
    );
  }

  const { finance, workforce, projects, operations, procurement, assets } = summary;

  const attention: AttentionItem[] = [];
  if (finance?.receivables.overdue) attention.push({ label: `${finance.receivables.overdue} overdue invoice(s)`, detail: `${money(finance.receivables.overdueAmount)} past due from clients`, tone: 'red', target: 'accounting-ar' });
  if (finance?.payables.overdue) attention.push({ label: `${finance.payables.overdue} overdue supplier bill(s)`, detail: `${money(finance.payables.overdueAmount)} past due to suppliers`, tone: 'red', target: 'accounting-ap' });
  if (projects?.overBudget) attention.push({ label: `${projects.overBudget} project(s) over budget`, detail: 'Actual spend is higher than the budget', tone: 'red', target: 'projects-active' });
  if (workforce?.upcomingDatesTotal) attention.push({ label: `${workforce.upcomingDatesTotal} contract/probation date(s) due`, detail: workforce.upcomingDates.slice(0, 2).map((d: any) => `${d.name} · ${d.label.toLowerCase()} ${formatDate(d.date)}`).join('; '), tone: 'amber', target: 'hr-directory' });
  if (workforce?.pendingLeave) attention.push({ label: `${workforce.pendingLeave} leave request(s) awaiting approval`, detail: 'Review in Leave Management', tone: 'amber', target: 'hr-leave' });
  if (workforce && workforce.headcount > 0 && workforce.payroll.processed === 0 && new Date().getDate() >= 20) {
    attention.push({ label: `Payroll not run for ${workforce.payroll.period}`, detail: workforce.payroll.lastPeriod ? `Last payroll: ${workforce.payroll.lastPeriod}` : 'No payroll has been processed yet', tone: 'amber', target: 'hr-payroll' });
  }
  if (procurement?.pendingApproval) attention.push({ label: `${procurement.pendingApproval} purchase order(s) awaiting approval`, detail: `${money(procurement.pendingValue)} in total`, tone: 'blue', target: 'procurement-pos' });
  if (procurement?.lowStockCount) attention.push({ label: `${procurement.lowStockCount} item(s) at or below reorder level`, detail: procurement.lowStock.slice(0, 3).map((i: any) => i.name).join(', '), tone: 'amber', target: 'procurement-inventory' });
  if (assets?.maintenanceDueCount) attention.push({ label: `${assets.maintenanceDueCount} equipment maintenance due`, detail: assets.maintenanceDue.slice(0, 2).map((m: any) => `${m.name} · ${formatDate(m.date)}`).join('; '), tone: 'amber', target: 'assets' });
  if (operations?.pendingReview) attention.push({ label: `${operations.pendingReview} site report(s) pending review`, detail: 'Review in Field Operations', tone: 'blue', target: 'field-ops' });

  const revenueChange = finance ? percentChange(finance.currentMonth.income, finance.previousMonth.income) : null;
  const expenseChange = finance ? percentChange(finance.currentMonth.expense, finance.previousMonth.expense) : null;
  const hasChartData = finance?.monthly.some((m: any) => m.income || m.expense);

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-blue-600 uppercase tracking-widest">{formatDate(new Date().toISOString())}</p>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight text-[#141414] mt-1">
            {greeting()}{user?.email ? `, ${user.email.split('@')[0]}` : ''}
          </h1>
          <p className="text-[#8E9299] font-medium mt-1">Here's how the business is doing today.</p>
        </div>
        <Button variant="outline" onClick={() => load(true)} disabled={isRefreshing} className="rounded-xl gap-2 font-bold self-start md:self-auto">
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      {summary.errors?.length > 0 && (
        <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl text-sm text-amber-800 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> Some figures couldn't be loaded ({summary.errors.join(', ')}). The rest of the dashboard is up to date.
        </div>
      )}

      {finance && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <KPI icon={TrendingUp} color="green" label={`Revenue · ${finance.currentMonth.label}`} value={money(finance.currentMonth.income)}
            change={revenueChange} goodWhenUp footnote={`Last month ${money(finance.previousMonth.income)}`} onClick={go('accounting-reports')} />
          <KPI icon={TrendingDown} color="red" label={`Expenses · ${finance.currentMonth.label}`} value={money(finance.currentMonth.expense)}
            change={expenseChange} goodWhenUp={false} footnote={`Last month ${money(finance.previousMonth.expense)}`} onClick={go('accounting-reports')} />
          <KPI icon={Activity} color={finance.ytd.net >= 0 ? 'blue' : 'red'} label={`Net profit · ${new Date().getFullYear()} to date`} value={money(finance.ytd.net)}
            footnote={`Revenue ${money(finance.ytd.income)} · Expenses ${money(finance.ytd.expense)}`} onClick={go('accounting-reports')} />
          <KPI icon={Wallet} color="orange" label="Cash & bank" value={money(finance.cashPosition)}
            footnote="Balance of cash and bank accounts in the ledger" onClick={go('accounting-bank')} />
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {workforce && (
          <KPI icon={Users} color="blue" label="Staff" value={workforce.headcount}
            footnote={`${workforce.active} active${workforce.onLeave ? ` · ${workforce.onLeave} on leave` : ''}`} onClick={go('hr-directory')} />
        )}
        {projects && (
          <KPI icon={Briefcase} color="blue" label="Open projects" value={projects.openTotal}
            footnote={`${projects.total} total${projects.overBudget ? ` · ${projects.overBudget} over budget` : ''}`} onClick={go('projects-active')} />
        )}
        {finance && (
          <KPI icon={ClipboardList} color={finance.receivables.overdue ? 'red' : 'green'} label="Owed by clients" value={money(finance.receivables.outstanding)}
            footnote={finance.receivables.open ? `${finance.receivables.open} unpaid invoice(s)${finance.receivables.overdue ? `, ${finance.receivables.overdue} overdue` : ''}` : 'All invoices paid'} onClick={go('accounting-ar')} />
        )}
        {finance && (
          <KPI icon={ClipboardList} color={finance.payables.overdue ? 'red' : 'green'} label="Owed to suppliers" value={money(finance.payables.outstanding)}
            footnote={finance.payables.open ? `${finance.payables.open} unpaid bill(s)${finance.payables.overdue ? `, ${finance.payables.overdue} overdue` : ''}` : 'All bills paid'} onClick={go('accounting-ap')} />
        )}
        {procurement && (
          <KPI icon={Package} color={procurement.pendingApproval ? 'orange' : 'green'} label="POs awaiting approval" value={procurement.pendingApproval}
            footnote={procurement.pendingApproval ? money(procurement.pendingValue) : 'Nothing waiting'} onClick={go('procurement-pos')} />
        )}
        {assets && (
          <KPI icon={Truck} color="blue" label="Equipment on site" value={`${assets.onSite} / ${assets.total}`}
            footnote={assets.total ? `${Math.round((assets.onSite / assets.total) * 100)}% utilised${assets.inMaintenance ? ` · ${assets.inMaintenance} in maintenance` : ''}` : 'No equipment registered'} onClick={go('assets')} />
        )}
        {operations && (
          <KPI icon={HardHat} color={operations.pendingReview ? 'orange' : 'green'} label="Site reports to review" value={operations.pendingReview}
            footnote={operations.recentReports.length ? `Latest ${formatDate(operations.recentReports[0].created_at)}` : 'No reports yet'} onClick={go('field-ops')} />
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {finance && (
          <Card className="lg:col-span-2 border-none shadow-sm rounded-3xl bg-white overflow-hidden">
            <CardHeader className="p-6 border-b border-[#F5F5F5]">
              <CardTitle className="text-lg font-bold">Revenue vs expenses</CardTitle>
              <CardDescription>Last six months, from the general ledger.</CardDescription>
            </CardHeader>
            <CardContent className="p-6">
              {hasChartData ? (
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={finance.monthly} barGap={4}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                      <XAxis dataKey="label" stroke="#8E9299" fontSize={11} tickLine={false} axisLine={false} />
                      <YAxis stroke="#8E9299" fontSize={11} tickLine={false} axisLine={false} width={60}
                        tickFormatter={(v) => `${getCurrencySymbol(currency)}${Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : v}`} />
                      <Tooltip formatter={(v: any) => money(Number(v))} contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 10px 25px -5px rgb(0 0 0 / 0.1)' }} />
                      <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="income" name="Revenue" fill="#16a34a" radius={[6, 6, 0, 0]} />
                      <Bar dataKey="expense" name="Expenses" fill="#ef4444" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState text="No revenue or expenses posted in the last six months." />
              )}
            </CardContent>
          </Card>
        )}

        <Card className={`border-none shadow-sm rounded-3xl bg-white overflow-hidden ${finance ? '' : 'lg:col-span-3'}`}>
          <CardHeader className="p-6 border-b border-[#F5F5F5]">
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              Needs attention
              {attention.length > 0 && <Badge className="bg-red-100 text-red-700 border-none">{attention.length}</Badge>}
            </CardTitle>
            <CardDescription>Things to act on across the modules you can access.</CardDescription>
          </CardHeader>
          <CardContent className="p-4 space-y-2">
            {attention.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <CheckCircle2 className="w-10 h-10 text-green-500" />
                <p className="font-bold mt-3">All clear</p>
                <p className="text-xs text-[#8E9299]">Nothing needs your attention right now.</p>
              </div>
            ) : attention.map((item, i) => (
              <button key={i} type="button" onClick={go(item.target)} disabled={!item.target || !onNavigate}
                className="w-full text-left flex items-start gap-3 p-3 rounded-2xl hover:bg-[#F5F5F5] transition-colors disabled:cursor-default">
                <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${item.tone === 'red' ? 'bg-red-500' : item.tone === 'amber' ? 'bg-amber-500' : 'bg-blue-500'}`} />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-bold text-[#141414]">{item.label}</span>
                  {item.detail && <span className="block text-xs text-[#8E9299] truncate">{item.detail}</span>}
                </span>
                {item.target && onNavigate && <ArrowRight className="w-4 h-4 text-[#8E9299] mt-1 shrink-0" />}
              </button>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {projects && (
          <Card className="border-none shadow-sm rounded-3xl bg-white overflow-hidden">
            <CardHeader className="p-6 pb-2 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg font-bold">Projects</CardTitle>
                <CardDescription>Open projects by budget used.</CardDescription>
              </div>
              {onNavigate && <Button variant="ghost" onClick={go('projects-active')} className="text-blue-600 font-bold rounded-xl">View all</Button>}
            </CardHeader>
            <CardContent className="p-6 pt-2 space-y-3">
              {projects.open.length === 0 ? <EmptyState text="No open projects." /> : projects.open.map((p: any) => {
                const pct = p.budgetUsedPct;
                const barColor = pct === null ? 'bg-slate-300' : pct > 100 ? 'bg-red-500' : pct > 85 ? 'bg-amber-500' : 'bg-blue-600';
                return (
                  <div key={p.id} className="p-4 bg-[#F5F5F5] rounded-2xl space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-bold text-[#141414] truncate">{p.name}</p>
                        <p className="text-xs text-[#8E9299] truncate">{p.client}{p.endDate ? ` · due ${formatDate(p.endDate)}` : ''}</p>
                      </div>
                      <Badge className="bg-white text-[#141414] border-none shrink-0">{p.status}</Badge>
                    </div>
                    <div className="h-2 bg-white rounded-full overflow-hidden">
                      <div className={`h-full ${barColor}`} style={{ width: `${Math.min(pct ?? 0, 100)}%` }} />
                    </div>
                    <div className="flex justify-between text-[11px] text-[#8E9299] font-medium">
                      <span>{money(p.spent)} of {p.budget ? money(p.budget) : 'no budget'}{pct !== null ? ` (${pct}%)` : ''}</span>
                      <span>{p.completion}% complete</span>
                    </div>
                  </div>
                );
              })}
              {projects.retentionHeld > 0 && (
                <p className="text-xs text-[#8E9299] pt-1">Retention held on contracts: <span className="font-bold text-[#141414]">{money(projects.retentionHeld)}</span></p>
              )}
            </CardContent>
          </Card>
        )}

        {workforce && (
          <Card className="border-none shadow-sm rounded-3xl bg-white overflow-hidden">
            <CardHeader className="p-6 pb-2 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg font-bold">Workforce</CardTitle>
                <CardDescription>Staff, payroll and upcoming employment dates.</CardDescription>
              </div>
              {onNavigate && <Button variant="ghost" onClick={go('hr-directory')} className="text-blue-600 font-bold rounded-xl">Directory</Button>}
            </CardHeader>
            <CardContent className="p-6 pt-2 space-y-5">
              <div className="p-4 bg-[#F5F5F5] rounded-2xl flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase text-[#8E9299]">Payroll · {workforce.payroll.period}</p>
                  <p className="font-bold text-[#141414]">
                    {workforce.payroll.processed === 0 ? 'Not processed yet' : `${workforce.payroll.processed} processed · ${workforce.payroll.paid} paid`}
                  </p>
                  {workforce.payroll.processed > 0 && <p className="text-xs text-[#8E9299]">Net pay {money(workforce.payroll.netTotal)}</p>}
                </div>
                <Badge className={workforce.payroll.processed === 0 ? 'bg-amber-100 text-amber-800 border-none' : workforce.payroll.paid === workforce.payroll.processed ? 'bg-green-100 text-green-700 border-none' : 'bg-blue-100 text-blue-700 border-none'}>
                  {workforce.payroll.processed === 0 ? 'PENDING' : workforce.payroll.paid === workforce.payroll.processed ? 'PAID' : 'IN PROGRESS'}
                </Badge>
              </div>

              {workforce.departments.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-bold uppercase text-[#8E9299]">Staff by department</p>
                  {workforce.departments.slice(0, 5).map((d: any) => (
                    <div key={d.name} className="flex items-center gap-3 text-sm">
                      <span className="w-32 truncate font-medium">{d.name}</span>
                      <div className="flex-1 h-2 bg-[#F5F5F5] rounded-full overflow-hidden">
                        <div className="h-full bg-blue-600" style={{ width: `${(d.count / workforce.headcount) * 100}%` }} />
                      </div>
                      <span className="w-8 text-right font-bold">{d.count}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-2">
                <p className="text-[10px] font-bold uppercase text-[#8E9299]">Next 30 days</p>
                {workforce.upcomingDates.length === 0 ? (
                  <p className="text-sm text-[#8E9299]">No contract or probation dates coming up.</p>
                ) : workforce.upcomingDates.map((d: any, i: number) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span><span className="font-bold">{d.name}</span> <span className="text-[#8E9299]">· {d.label}</span></span>
                    <span className="font-medium">{formatDate(d.date)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {operations && (
          <Card className="border-none shadow-sm rounded-3xl bg-white overflow-hidden">
            <CardHeader className="p-6 pb-2 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg font-bold">Latest site reports</CardTitle>
                <CardDescription>Most recent updates from the field.</CardDescription>
              </div>
              {onNavigate && <Button variant="ghost" onClick={go('field-ops')} className="text-blue-600 font-bold rounded-xl">Field Ops</Button>}
            </CardHeader>
            <CardContent className="p-6 pt-2 space-y-3">
              {operations.recentReports.length === 0 ? <EmptyState text="No site reports submitted yet." /> : operations.recentReports.map((r: any) => (
                <div key={r.id} className="p-4 bg-[#F5F5F5] rounded-2xl">
                  <div className="flex justify-between gap-3">
                    <p className="font-bold text-sm truncate">{r.project_name || 'Unassigned project'}</p>
                    <span className="text-xs text-[#8E9299] shrink-0">{formatDate(r.created_at)}</span>
                  </div>
                  <p className="text-xs text-[#8E9299] mt-1 line-clamp-2">{r.content || 'No details provided.'}</p>
                  {r.issues && <p className="text-xs text-red-600 mt-1 line-clamp-1">Issue: {r.issues}</p>}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {!finance && !workforce && !projects && !operations && !procurement && !assets && (
          <Card className="md:col-span-2 border-none shadow-sm rounded-3xl bg-white">
            <CardContent className="p-10"><EmptyState text="Your role doesn't have any dashboard figures yet. Use the menu to open your modules." /></CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

const KPI_COLORS: Record<string, string> = {
  red: 'bg-red-50 text-red-600',
  green: 'bg-green-50 text-green-600',
  orange: 'bg-orange-50 text-orange-600',
  blue: 'bg-blue-50 text-blue-600',
};

interface KPIProps {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  color: keyof typeof KPI_COLORS;
  footnote?: string;
  change?: number | null;
  goodWhenUp?: boolean;
  onClick?: () => void;
}

function KPI({ icon: Icon, label, value, color, footnote, change, goodWhenUp = true, onClick }: KPIProps) {
  const hasChange = change !== undefined && change !== null && Number.isFinite(change);
  const isUp = hasChange && (change as number) >= 0;
  const isGood = hasChange && (isUp === goodWhenUp);
  return (
    <Card
      onClick={onClick}
      className={`border-none shadow-sm rounded-3xl bg-white transition-all ${onClick ? 'cursor-pointer hover:shadow-lg hover:shadow-black/5' : ''}`}
    >
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className={`p-2.5 rounded-2xl ${KPI_COLORS[color]}`}><Icon className="w-5 h-5" /></div>
          {hasChange && (
            <span className={`text-xs font-bold flex items-center ${isGood ? 'text-green-600' : 'text-red-600'}`}>
              {isUp ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
              {Math.abs(change as number).toFixed(1)}%
            </span>
          )}
        </div>
        <p className="mt-4 text-[11px] font-bold text-[#8E9299] uppercase tracking-widest">{label}</p>
        <p className="text-2xl font-black text-[#141414] mt-1 tabular-nums truncate">{value}</p>
        {footnote && <p className="text-[11px] text-[#8E9299] mt-1 truncate" title={footnote}>{footnote}</p>}
      </CardContent>
    </Card>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="text-sm text-[#8E9299] text-center py-8">{text}</p>;
}
