import {
  BadgeCheck,
  Banknote,
  CalendarClock,
  ClipboardCheck,
  FilePlus2,
  FileWarning,
  HardHat,
  Landmark,
  Package,
  Receipt,
  ShieldAlert,
  ShoppingCart,
  UserPlus,
  Wallet,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { Module } from '../../../types';
import type { DashboardSummary, Money, PeriodKey, UpcomingItem } from './types';

export type Severity = 'critical' | 'warning' | 'info';

export interface AttentionItem {
  severity: Severity;
  icon: LucideIcon;
  label: string;
  detail: string;
  target?: Module;
}

export interface QuickAction {
  label: string;
  icon: LucideIcon;
  target: Module;
  roles: string[];
}

export const QUICK_ACTIONS: QuickAction[] = [
  { label: 'New invoice', icon: FilePlus2, target: 'accounting-ar', roles: ['admin', 'accountant'] },
  { label: 'Record bill', icon: Receipt, target: 'accounting-ap', roles: ['admin', 'accountant'] },
  { label: 'Add employee', icon: UserPlus, target: 'hr-directory', roles: ['admin', 'hr'] },
  { label: 'Run payroll', icon: Banknote, target: 'hr-payroll', roles: ['admin', 'hr', 'accountant'] },
  { label: 'Mark attendance', icon: ClipboardCheck, target: 'hr-attendance', roles: ['admin', 'hr', 'pm'] },
  { label: 'New PO', icon: ShoppingCart, target: 'procurement-pos', roles: ['admin', 'accountant', 'procurement'] },
  { label: 'Site report', icon: HardHat, target: 'field-ops', roles: ['admin', 'pm'] },
];

export const PERIOD_OPTIONS: { key: PeriodKey; label: string; short: string }[] = [
  { key: 'month', label: 'This month', short: 'Month' },
  { key: 'quarter', label: 'This quarter', short: 'Quarter' },
  { key: 'ytd', label: 'Year to date', short: 'YTD' },
  { key: '12m', label: 'Last 12 months', short: '12M' },
];

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

export const percentChange = (current: number, previous: number) => {
  if (!previous) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "3 days", "2 weeks", "4.5 months" for a figure measured in months. */
export function describeMonths(months: number) {
  const days = months * 30.4;
  if (days < 1) return 'less than a day';
  if (days < 14) return plural(Math.round(days), 'day');
  if (months < 2) return plural(Math.round(days / 7), 'week');
  return `${months.toFixed(1)} months`;
}

const periodPhrase = (key: PeriodKey | undefined) => {
  switch (key) {
    case 'quarter': return 'this quarter';
    case 'ytd': return 'this year';
    case '12m': return 'in the last 12 months';
    default: return `in ${new Date().toLocaleString('en', { month: 'long' })}`;
  }
};

/** One or two plain sentences describing the business right now, built from the figures on screen. */
export function buildSummary(summary: DashboardSummary, money: Money, attentionCount: number) {
  const { finance, workforce, projects, procurement } = summary;
  const sentences: string[] = [];

  if (finance?.period) {
    const { period, prior } = finance;
    const phrase = periodPhrase(period.key);
    let revenue: string;
    if (!period.income) revenue = `No revenue recorded yet ${phrase}`;
    else {
      const change = prior ? percentChange(period.income, prior.income) : null;
      revenue = change === null
        ? `Revenue of ${money(period.income)} ${phrase}`
        : `Revenue is ${change >= 0 ? 'up' : 'down'} ${Math.abs(change).toFixed(0)}% on the ${period.priorLabel}`;
    }
    const expenseChange = prior ? percentChange(period.expense, prior.expense) : null;
    const expenses = expenseChange === null
      ? `expenses total ${money(period.expense)}`
      : `expenses are ${expenseChange >= 0 ? 'up' : 'down'} ${Math.abs(expenseChange).toFixed(0)}% on the ${period.priorLabel}`;
    sentences.push(`${revenue}, and ${expenses}.`);

    const runway = finance.runway;
    if (finance.cashPosition <= 0) sentences.push('Cash and bank balances are at or below zero in the ledger.');
    else if (runway?.runwayMonths != null) sentences.push(`At the recent net burn, cash of ${money(finance.cashPosition)} lasts about ${describeMonths(runway.runwayMonths)}.`);
    else if (runway?.coverMonths != null && runway.coverMonths < 3) sentences.push(`Cash of ${money(finance.cashPosition)} covers about ${describeMonths(runway.coverMonths)} of average spending.`);
  } else {
    const bits: string[] = [];
    if (workforce) bits.push(`${plural(workforce.headcount, 'person', 'people')} on staff${workforce.onLeave ? `, ${workforce.onLeave} on leave today` : ''}`);
    if (projects) bits.push(plural(projects.openTotal, 'open project'));
    if (procurement) bits.push(`${plural(procurement.pendingApproval, 'purchase order')} awaiting approval`);
    if (bits.length) sentences.push(`${bits.join(' · ')}.`);
  }

  sentences.push(attentionCount ? `${plural(attentionCount, 'item')} ${attentionCount === 1 ? 'needs' : 'need'} your attention.` : 'Nothing needs your attention right now.');
  return sentences.join(' ');
}

export function buildAttention(summary: DashboardSummary, money: Money): AttentionItem[] {
  const { finance, workforce, projects, operations, procurement, assets } = summary;
  const items: AttentionItem[] = [];
  const add = (item: AttentionItem) => items.push(item);

  if (finance) {
    const cover = finance.runway?.coverMonths;
    if (finance.cashPosition <= 0) {
      add({ severity: 'critical', icon: Wallet, label: 'Cash and bank at or below zero', detail: `Ledger balance ${money(finance.cashPosition)}`, target: 'accounting-bank' });
    } else if (cover != null && cover < 1) {
      add({ severity: cover < 0.5 ? 'critical' : 'warning', icon: Wallet, label: `Cash covers only ~${describeMonths(cover)} of spending`, detail: `${money(finance.cashPosition)} against ~${money(finance.runway!.avgMonthlyExpense)} a month`, target: 'accounting-bank' });
    }
    if (finance.receivables.overdue) add({ severity: 'critical', icon: FileWarning, label: `${plural(finance.receivables.overdue, 'overdue invoice')}`, detail: `${money(finance.receivables.overdueAmount)} past due from clients`, target: 'accounting-ar' });
    if (finance.payables.overdue) add({ severity: 'critical', icon: Receipt, label: `${plural(finance.payables.overdue, 'overdue supplier bill')}`, detail: `${money(finance.payables.overdueAmount)} past due to suppliers`, target: 'accounting-ap' });
    if (summary.role === 'admin' && finance.pendingApprovals) add({ severity: 'warning', icon: BadgeCheck, label: `${plural(finance.pendingApprovals, 'accounting request')} awaiting your approval`, detail: 'Corrections, voids and large bills stay off the ledger until approved', target: 'accounting-approvals' });
  }
  if (projects?.overBudget) add({ severity: 'critical', icon: Landmark, label: `${plural(projects.overBudget, 'project')} over budget`, detail: 'Actual spend is higher than the budget', target: 'projects-active' });
  if (workforce) {
    const runPaid = String(workforce.payroll.runStatus || '').toLowerCase() === 'paid' || (workforce.payroll.processed > 0 && workforce.payroll.paid === workforce.payroll.processed);
    const daysToPayday = workforce.payroll.payday ? Math.ceil((new Date(`${workforce.payroll.payday}T23:59:59`).getTime() - Date.now()) / 86400000) : null;
    if (workforce.headcount > 0 && !runPaid && (new Date().getDate() >= 20 || (daysToPayday !== null && daysToPayday <= 7))) {
      add({
        severity: daysToPayday !== null && daysToPayday <= 2 ? 'critical' : 'warning', icon: Banknote,
        label: workforce.payroll.runStatus ? `${workforce.payroll.period} payroll is ${workforce.payroll.runStatus.toLowerCase()}` : `Payroll not run for ${workforce.payroll.period}`,
        detail: workforce.payroll.lastPeriod ? `Last payroll: ${workforce.payroll.lastPeriod}` : 'No payroll has been processed yet',
        target: 'hr-payroll',
      });
    }
    if (workforce.upcomingDatesTotal) add({ severity: 'warning', icon: CalendarClock, label: `${plural(workforce.upcomingDatesTotal, 'contract/probation date')} in the next 30 days`, detail: workforce.upcomingDates.slice(0, 2).map(d => `${d.name} · ${d.label.toLowerCase()}`).join('; '), target: 'hr-directory' });
    if (workforce.pendingLeave) add({ severity: 'warning', icon: CalendarClock, label: `${plural(workforce.pendingLeave, 'leave request')} awaiting approval`, detail: 'Review in Leave Management', target: 'hr-leave' });
  }
  if (procurement?.lowStockCount) add({ severity: 'warning', icon: Package, label: `${plural(procurement.lowStockCount, 'item')} at or below reorder level`, detail: procurement.lowStock.slice(0, 3).map(i => i.name).join(', '), target: 'procurement-inventory' });
  if (assets?.maintenanceDueCount) add({ severity: 'warning', icon: Wrench, label: `${plural(assets.maintenanceDueCount, 'equipment service', 'equipment services')} due`, detail: assets.maintenanceDue.slice(0, 2).map(m => m.name).join('; '), target: 'assets' });
  if (procurement?.pendingApproval) add({ severity: 'info', icon: ShoppingCart, label: `${plural(procurement.pendingApproval, 'purchase order')} awaiting approval`, detail: `${money(procurement.pendingValue)} in total`, target: 'procurement-pos' });
  if (operations?.pendingReview) add({ severity: 'info', icon: HardHat, label: `${plural(operations.pendingReview, 'site report')} pending review`, detail: 'Review in Field Operations', target: 'field-ops' });

  return items.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export interface QualityItem {
  label: string;
  detail: string;
  count?: number;
  amount?: number;
  target: Module;
  icon: LucideIcon;
}

export function buildDataQuality(summary: DashboardSummary): QualityItem[] {
  const items: QualityItem[] = [];
  const { finance, workforce } = summary;
  if (finance?.uncategorized && finance.uncategorized.ytd >= 1) {
    items.push({ icon: Receipt, label: 'Uncategorized spend this year', detail: 'Re-post to proper expense accounts so reports and tax figures are accurate', amount: finance.uncategorized.ytd, target: 'accounting-transactions' });
  }
  const dq = workforce?.dataQuality;
  if (dq?.flaggedRates) items.push({ icon: ShieldAlert, label: 'Pay rates that look wrong', detail: 'Hourly above 500 or daily above 1,000 looks like a monthly salary', count: dq.flaggedRates, target: 'hr-directory' });
  if (dq?.missingSsnit) items.push({ icon: FileWarning, label: 'Staff without an SSNIT number', detail: 'Needed for the monthly SSNIT contribution report', count: dq.missingSsnit, target: 'hr-directory' });
  if (dq?.missingBank) items.push({ icon: Landmark, label: 'Staff without bank details', detail: 'Needed to pay salaries by bank transfer', count: dq.missingBank, target: 'hr-directory' });
  return items;
}

export function mergeUpcoming(summary: DashboardSummary): UpcomingItem[] {
  const today = new Date();
  const soon = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7);
  const pad = (n: number) => String(n).padStart(2, '0');
  const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const maintenance: UpcomingItem[] = (summary.assets?.maintenanceDue || [])
    .filter(m => m.date && m.date <= iso(soon))
    .map(m => ({ date: m.date, label: `Service due: ${m.name}`, detail: m.date < iso(today) ? 'Overdue' : 'Scheduled maintenance', kind: 'maintenance', target: 'assets' }));
  return [...(summary.finance?.upcoming || []), ...(summary.workforce?.upcoming || []), ...maintenance]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 8);
}
