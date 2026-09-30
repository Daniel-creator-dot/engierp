import { Router } from 'express';
import db from '../db';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { pendingCount } from '../lib/approvals';

const router = Router();

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ALERT_WINDOW_DAYS = 30;
const UPCOMING_WINDOW_DAYS = 7;
const MAINTENANCE_WINDOW_DAYS = 14;
const TREND_MONTHS = 12;
const RUNWAY_BASIS_MONTHS = 3;

const SECTION_ROLES = {
  finance: ['admin', 'accountant'],
  workforce: ['admin', 'hr', 'accountant'],
  projects: ['admin', 'accountant', 'pm', 'hr'],
  operations: ['admin', 'pm'],
  procurement: ['admin', 'accountant', 'procurement'],
  assets: ['admin', 'accountant'],
  activity: ['admin', 'accountant'],
};

const PERIODS = ['month', 'quarter', 'ytd', '12m'] as const;
type PeriodKey = typeof PERIODS[number];

interface Range { start: string; end: string }

interface UpcomingItem {
  date: string;
  label: string;
  detail: string;
  kind: 'payroll' | 'casual-pay' | 'contract' | 'probation' | 'leave' | 'bill' | 'invoice' | 'recurring' | 'maintenance';
  amount?: number;
  target?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const monthLabel = (d: Date) => `${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${String(d.getFullYear()).slice(2)}`;
const addDays = (d: Date, days: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86400000);
const num = (value: any) => Number(value || 0);
const round2 = (n: number) => Math.round(n * 100) / 100;
const toIso = (value: any) => (value instanceof Date ? isoDate(value) : String(value || '').slice(0, 10));
const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

/** Current period and the comparable stretch before it, so partial periods are compared like for like. */
function periodRanges(key: PeriodKey, today: Date) {
  const y = today.getFullYear();
  const m = today.getMonth();
  const d = today.getDate();
  const end = isoDate(today);
  switch (key) {
    case 'quarter': {
      const qMonth = Math.floor(m / 3) * 3;
      const start = new Date(y, qMonth, 1);
      const priorStart = new Date(y, qMonth - 3, 1);
      const priorQuarterEnd = new Date(y, qMonth, 0);
      const priorEnd = addDays(priorStart, daysBetween(start, today));
      return {
        key, label: `Q${qMonth / 3 + 1} to date`, priorLabel: 'same point last quarter',
        current: { start: isoDate(start), end },
        prior: { start: isoDate(priorStart), end: isoDate(priorEnd > priorQuarterEnd ? priorQuarterEnd : priorEnd) },
      };
    }
    case 'ytd':
      return {
        key, label: `${y} to date`, priorLabel: `same period of ${y - 1}`,
        current: { start: `${y}-01-01`, end },
        prior: { start: `${y - 1}-01-01`, end: isoDate(new Date(y - 1, m, Math.min(d, daysInMonth(y - 1, m)))) },
      };
    case '12m':
      return {
        key, label: 'Last 12 months', priorLabel: 'previous 12 months',
        current: { start: isoDate(new Date(y, m - 11, 1)), end },
        prior: { start: isoDate(new Date(y, m - 23, 1)), end: isoDate(new Date(y, m - 11, 0)) },
      };
    default:
      return {
        key: 'month' as PeriodKey, label: `${MONTH_NAMES[m]} to date`, priorLabel: 'same days last month',
        current: { start: isoDate(new Date(y, m, 1)), end },
        prior: { start: isoDate(new Date(y, m - 1, 1)), end: isoDate(new Date(y, m - 1, Math.min(d, daysInMonth(y, m - 1)))) },
      };
  }
}

type Period = ReturnType<typeof periodRanges>;

const sumBetween = (expr: string, alias: string, range: Range) =>
  db.raw(`COALESCE(SUM(${expr}) FILTER (WHERE je.date BETWEEN ? AND ?), 0) as ${alias}`, [range.start, range.end]);

const earliest = (...ranges: Range[]) => ranges.map(r => r.start).sort()[0];

/** Resolves to the fallback instead of failing the whole section when an optional query breaks. */
async function optional<T>(query: PromiseLike<T>, fallback: T, what: string): Promise<T> {
  try {
    return await query;
  } catch (error) {
    console.error(`Dashboard: ${what} failed:`, error);
    return fallback;
  }
}

function lastWorkingDay(year: number, month: number) {
  const d = new Date(year, month + 1, 0);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return d;
}

function agingBucket(due: string, todayIso: string): keyof ReturnType<typeof emptyAging> {
  if (!due || due >= todayIso) return 'current';
  const late = daysBetween(new Date(`${due}T00:00:00`), new Date(`${todayIso}T00:00:00`));
  if (late <= 30) return 'd30';
  if (late <= 60) return 'd60';
  if (late <= 90) return 'd90';
  return 'd90plus';
}

const emptyAging = () => ({ current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 });

async function financeSection(today: Date, period: Period) {
  const y = today.getFullYear();
  const m = today.getMonth();
  const todayIso = isoDate(today);
  const soonIso = isoDate(addDays(today, UPCOMING_WINDOW_DAYS));
  const firstMonth = new Date(y, m - (TREND_MONTHS - 1), 1);
  const ranges = {
    period: period.current,
    prior: period.prior,
    ytd: { start: `${y}-01-01`, end: todayIso },
    mtd: periodRanges('month', today).current,
    prevMtd: periodRanges('month', today).prior,
  };

  const [monthlyRows, totalsRows, accountRows, cashRows] = await Promise.all([
    db('ledger_entries as le')
      .join('journal_entries as je', 'le.journal_id', 'je.id')
      .join('chart_of_accounts as coa', 'le.account_id', 'coa.id')
      .whereIn('coa.type', ['Income', 'Expense'])
      .where('je.date', '>=', isoDate(firstMonth))
      .select(db.raw(`to_char(je.date, 'YYYY-MM') as month`), 'coa.type', db.raw('COALESCE(SUM(le.credit - le.debit), 0) as amount'))
      .groupByRaw(`to_char(je.date, 'YYYY-MM'), coa.type`),
    db('ledger_entries as le')
      .join('journal_entries as je', 'le.journal_id', 'je.id')
      .join('chart_of_accounts as coa', 'le.account_id', 'coa.id')
      .whereIn('coa.type', ['Income', 'Expense'])
      .where('je.date', '>=', earliest(...Object.values(ranges)))
      .select('coa.type', ...Object.entries(ranges).map(([alias, range]) => sumBetween('le.credit - le.debit', alias, range)))
      .groupBy('coa.type'),
    db('ledger_entries as le')
      .join('journal_entries as je', 'le.journal_id', 'je.id')
      .join('chart_of_accounts as coa', 'le.account_id', 'coa.id')
      .where('coa.type', 'Expense')
      .where('je.date', '>=', earliest(ranges.period, ranges.ytd, ranges.prevMtd))
      .select('coa.id', 'coa.code', 'coa.name',
        sumBetween('le.debit - le.credit', 'period', ranges.period),
        sumBetween('le.debit - le.credit', 'ytd', ranges.ytd),
        sumBetween('le.debit - le.credit', 'mtd', ranges.mtd),
        sumBetween('le.debit - le.credit', 'prev_mtd', ranges.prevMtd))
      .groupBy('coa.id', 'coa.code', 'coa.name'),
    db('ledger_entries as le')
      .leftJoin('journal_entries as je', 'le.journal_id', 'je.id')
      .join('chart_of_accounts as coa', 'le.account_id', 'coa.id')
      .where('coa.type', 'Asset')
      .where(function () {
        this.where('coa.name', 'ilike', '%cash%').orWhere('coa.name', 'ilike', '%bank%');
      })
      .select(db.raw(`to_char(je.date, 'YYYY-MM') as month`), db.raw('COALESCE(SUM(le.debit - le.credit), 0) as movement'))
      .groupByRaw(`to_char(je.date, 'YYYY-MM')`),
  ]);

  const months = Array.from({ length: TREND_MONTHS }, (_, i) => {
    const d = new Date(firstMonth.getFullYear(), firstMonth.getMonth() + i, 1);
    return { key: monthKey(d), label: monthLabel(d), income: 0, expense: 0, net: 0, cash: 0 };
  });
  for (const row of monthlyRows as any[]) {
    const month = months.find(mo => mo.key === row.month);
    if (!month) continue;
    if (row.type === 'Income') month.income += num(row.amount);
    else month.expense -= num(row.amount);
  }

  const totals: Record<keyof typeof ranges, { income: number; expense: number }> = {} as any;
  for (const key of Object.keys(ranges) as (keyof typeof ranges)[]) totals[key] = { income: 0, expense: 0 };
  for (const row of totalsRows as any[]) {
    for (const key of Object.keys(ranges) as (keyof typeof ranges)[]) {
      if (row.type === 'Income') totals[key].income += num(row[key]);
      else totals[key].expense -= num(row[key]);
    }
  }
  const withNet = (t: { income: number; expense: number }) => ({ income: round2(t.income), expense: round2(t.expense), net: round2(t.income - t.expense) });

  // Cash: running balance at each month end; entries without a date count from the start.
  const cashMoves = (cashRows as any[]).map(r => ({ month: r.month || '0000-00', movement: num(r.movement) }));
  const cashPosition = cashMoves.reduce((sum, r) => sum + r.movement, 0);
  for (const month of months) {
    month.cash = round2(cashMoves.filter(r => r.month <= month.key).reduce((sum, r) => sum + r.movement, 0));
    month.income = round2(month.income);
    month.expense = round2(month.expense);
    month.net = round2(month.income - month.expense);
  }

  // Runway uses the last complete months so a half-finished month doesn't skew the average.
  const basis = months.slice(-(RUNWAY_BASIS_MONTHS + 1), -1);
  const avgExpense = basis.reduce((s, mo) => s + mo.expense, 0) / basis.length;
  const avgNet = basis.reduce((s, mo) => s + mo.net, 0) / basis.length;
  const runway = {
    basisLabel: `${basis[0].label} – ${basis[basis.length - 1].label}`,
    avgMonthlyExpense: round2(avgExpense),
    avgMonthlyNet: round2(avgNet),
    coverMonths: cashPosition > 0 && avgExpense > 0 ? round2(cashPosition / avgExpense) : null,
    runwayMonths: cashPosition > 0 && avgNet < 0 ? round2(cashPosition / -avgNet) : null,
  };

  const accounts = (accountRows as any[]).map(r => ({
    id: r.id, code: r.code, name: r.name,
    period: num(r.period), ytd: num(r.ytd), mtd: num(r.mtd), prevMtd: num(r.prev_mtd),
  }));
  const spent = accounts.filter(a => a.period > 0.005).sort((a, b) => b.period - a.period);
  const breakdownTotal = spent.reduce((s, a) => s + a.period, 0);
  const topSpend = spent.slice(0, 5).map(a => ({ name: a.name, code: a.code, amount: round2(a.period) }));
  const otherSpend = spent.slice(5).reduce((s, a) => s + a.period, 0);
  if (otherSpend > 0.005) topSpend.push({ name: `Other (${spent.length - 5} accounts)`, code: '', amount: round2(otherSpend) });

  const movers = accounts
    .map(a => ({ name: a.name, code: a.code, current: round2(a.mtd), previous: round2(a.prevMtd), change: round2(a.mtd - a.prevMtd) }))
    .filter(a => Math.abs(a.change) >= 1)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, 5);

  const uncategorized = accounts.filter(a => /uncategori[sz]ed/i.test(a.name));

  const [invoices, bills, recurring] = await Promise.all([
    db('invoices as i')
      .leftJoin('payments as p', function () {
        this.on('p.target_id', 'i.id').andOn('p.target_type', db.raw('?', ['Invoice']));
      })
      .where(function () { this.whereNull('i.status').orWhereNot('i.status', 'void'); })
      .select('i.id', 'i.client', 'i.amount', 'i.dueDate', db.raw('COALESCE(SUM(p.amount), 0) as paid'))
      .groupBy('i.id'),
    db('bills as b')
      .leftJoin('payments as p', function () {
        this.on('p.target_id', db.raw('CAST(b.id AS VARCHAR)')).andOn('p.target_type', db.raw('?', ['Bill']));
      })
      .where(function () { this.whereNull('b.status').orWhereNotIn('b.status', ['void', 'pending_approval']); })
      .select('b.id', 'b.amount', 'b.due_date', 'b.reference', 'b.description', db.raw('COALESCE(SUM(p.amount), 0) as paid'))
      .groupBy('b.id'),
    optional(
      db('recurring_templates').where('is_active', true).whereBetween('next_run_date', [todayIso, soonIso])
        .select('name', 'kind', 'next_run_date').orderBy('next_run_date').limit(5),
      [] as any[], 'recurring templates'),
  ]);

  const upcoming: UpcomingItem[] = [];
  const receivables = { outstanding: 0, open: 0, overdue: 0, overdueAmount: 0, aging: emptyAging() };
  for (const inv of invoices as any[]) {
    const balance = Math.max(0, num(inv.amount) - num(inv.paid));
    if (balance <= 0.005) continue;
    const due = toIso(inv.dueDate);
    receivables.outstanding += balance;
    receivables.open += 1;
    receivables.aging[agingBucket(isIsoDate(due) ? due : '', todayIso)] += balance;
    if (isIsoDate(due) && due < todayIso) {
      receivables.overdue += 1;
      receivables.overdueAmount += balance;
    } else if (isIsoDate(due) && due <= soonIso) {
      upcoming.push({ date: due, label: `Invoice ${inv.id} due`, detail: inv.client || 'Client', amount: round2(balance), kind: 'invoice', target: 'accounting-ar' });
    }
  }

  const payables = { outstanding: 0, open: 0, overdue: 0, overdueAmount: 0, aging: emptyAging() };
  for (const bill of bills as any[]) {
    const balance = Math.max(0, num(bill.amount) - num(bill.paid));
    if (balance <= 0.005) continue;
    const due = toIso(bill.due_date);
    payables.outstanding += balance;
    payables.open += 1;
    payables.aging[agingBucket(isIsoDate(due) ? due : '', todayIso)] += balance;
    if (isIsoDate(due) && due < todayIso) {
      payables.overdue += 1;
      payables.overdueAmount += balance;
    } else if (isIsoDate(due) && due <= soonIso) {
      upcoming.push({ date: due, label: `Supplier bill ${bill.reference || `#${bill.id}`} due`, detail: bill.description || 'Supplier bill', amount: round2(balance), kind: 'bill', target: 'accounting-ap' });
    }
  }

  for (const r of recurring as any[]) {
    upcoming.push({ date: toIso(r.next_run_date), label: `Recurring ${String(r.kind || 'entry').replace(/_/g, ' ')} due`, detail: r.name, kind: 'recurring', target: 'accounting-transactions' });
  }

  const currentMonth = months[months.length - 1];
  const previousMonth = months[months.length - 2];

  return {
    period: { key: period.key, label: period.label, priorLabel: period.priorLabel, ...withNet(totals.period) },
    prior: withNet(totals.prior),
    ytd: withNet(totals.ytd),
    monthToDate: withNet(totals.mtd),
    previousMonthToDate: withNet(totals.prevMtd),
    currentMonth,
    previousMonth,
    monthly: months,
    cashPosition: round2(cashPosition),
    runway,
    expenseBreakdown: { total: round2(breakdownTotal), items: topSpend },
    expenseMovers: movers,
    uncategorized: {
      ytd: round2(uncategorized.reduce((s, a) => s + a.ytd, 0)),
      period: round2(uncategorized.reduce((s, a) => s + a.period, 0)),
    },
    receivables,
    payables,
    upcoming,
  };
}

async function workforceSection(today: Date) {
  const employees = await db('employees').select(
    'id', 'name', 'department', 'status', 'contract_end_date', 'probation_end_date',
    'ssnit', 'account_number', 'wage_type', 'salary', 'pay_frequency', 'employment_type',
  );
  const current = employees.filter((e: any) => e.status !== 'terminated');
  const todayIso = isoDate(today);
  const windowEnd = isoDate(addDays(today, ALERT_WINDOW_DAYS));
  const soonIso = isoDate(addDays(today, UPCOMING_WINDOW_DAYS));

  const upcomingDates: { name: string; label: string; date: string }[] = [];
  for (const e of current as any[]) {
    if (e.contract_end_date && e.contract_end_date <= windowEnd) {
      upcomingDates.push({ name: e.name, label: e.contract_end_date < todayIso ? 'Contract ended' : 'Contract ends', date: e.contract_end_date });
    }
    if (e.probation_end_date && e.probation_end_date >= todayIso && e.probation_end_date <= windowEnd) {
      upcomingDates.push({ name: e.name, label: 'Probation ends', date: e.probation_end_date });
    }
  }
  upcomingDates.sort((a, b) => a.date.localeCompare(b.date));

  const departments: Record<string, number> = {};
  for (const e of current as any[]) departments[e.department || 'Unassigned'] = (departments[e.department || 'Unassigned'] || 0) + 1;

  const blank = (v: any) => !String(v ?? '').trim();
  const isCasual = (e: any) => e.wage_type === 'Daily' || e.pay_frequency === 'Weekly' || e.employment_type === 'Casual';
  const rateLooksWrong = (e: any) => (e.wage_type === 'Hourly' && num(e.salary) > 500) || (e.wage_type === 'Daily' && num(e.salary) > 1000);

  const monthName = MONTH_NAMES[today.getMonth()];
  const [pendingLeave, onLeaveRows, leaveStarting, attendanceRows, payrollRows, latestPayroll, monthlyRun] = await Promise.all([
    db('leave_requests').where('status', 'Pending').count('id as count').first(),
    db('leave_requests as lr').leftJoin('employees as e', 'lr.employee_id', 'e.id')
      .where('lr.status', 'Approved').where('lr.startDate', '<=', todayIso).where('lr.endDate', '>=', todayIso)
      .select('lr.employee_id', 'e.name', 'lr.type', 'lr.endDate'),
    db('leave_requests as lr').leftJoin('employees as e', 'lr.employee_id', 'e.id')
      .where('lr.status', 'Approved').where('lr.startDate', '>', todayIso).where('lr.startDate', '<=', soonIso)
      .select('e.name', 'lr.type', 'lr.startDate', 'lr.endDate').orderBy('lr.startDate').limit(5),
    optional(db('timesheets').where('date', todayIso).select('attendance', db.raw('COUNT(DISTINCT employee_id) as count')).groupBy('attendance'), [] as any[], 'attendance today'),
    db('payroll').where({ month: monthName, year: today.getFullYear() }).select('status', 'net_pay'),
    db('payroll').select('month', 'year').orderBy('year', 'desc').orderBy('created_at', 'desc').first(),
    optional(
      db('payroll_runs').where({ month: monthName, year: today.getFullYear() })
        .where(function () { this.whereNull('run_type').orWhereNot('run_type', 'casual'); })
        .whereNot('status', 'Cancelled').select('id', 'status').orderBy('created_at', 'desc').first(),
      undefined, 'payroll run'),
  ]);

  const onLeaveToday = new Map<string, any>();
  for (const r of onLeaveRows as any[]) onLeaveToday.set(r.employee_id, { name: r.name || 'Employee', type: r.type, until: r.endDate });

  const attendance: Record<string, number> = {};
  for (const r of attendanceRows as any[]) attendance[r.attendance || 'Recorded'] = num(r.count);
  const attendanceRecorded = Object.values(attendance).reduce((s, n) => s + n, 0);

  const casualWorkers = current.filter(isCasual).length;
  const salariedWorkers = current.length - casualWorkers;

  const upcoming: UpcomingItem[] = [];
  const payday = lastWorkingDay(today.getFullYear(), today.getMonth());
  const paydayIso = isoDate(payday);
  const runStatus: string | null = (monthlyRun as any)?.status || null;
  if (salariedWorkers > 0 && paydayIso >= todayIso && paydayIso <= soonIso && String(runStatus).toLowerCase() !== 'paid') {
    upcoming.push({
      date: paydayIso, label: `${monthName} payroll`, kind: 'payroll', target: 'hr-payroll',
      detail: runStatus ? `Pay run is ${runStatus.toLowerCase()} · ${salariedWorkers} staff` : `Pay run not started · ${salariedWorkers} staff`,
    });
  }
  if (casualWorkers > 0) {
    const saturday = addDays(today, (6 - today.getDay() + 7) % 7);
    upcoming.push({ date: isoDate(saturday), label: 'Casual pay day', detail: `${casualWorkers} daily-rated worker(s), priced from attendance`, kind: 'casual-pay', target: 'hr-payroll' });
  }
  for (const d of upcomingDates) {
    if (d.date >= todayIso && d.date <= soonIso) {
      upcoming.push({ date: d.date, label: `${d.label}: ${d.name}`, detail: 'Renew, confirm or plan the exit', kind: d.label.startsWith('Probation') ? 'probation' : 'contract', target: 'hr-directory' });
    }
  }
  for (const l of leaveStarting as any[]) {
    upcoming.push({ date: String(l.startDate).slice(0, 10), label: `${l.name || 'Employee'} starts ${String(l.type || 'leave').toLowerCase()}`, detail: `Back after ${String(l.endDate).slice(0, 10)}`, kind: 'leave', target: 'hr-leave' });
  }

  return {
    headcount: current.length,
    active: current.filter((e: any) => e.status === 'active').length,
    onLeave: Math.max(current.filter((e: any) => e.status === 'on-leave').length, onLeaveToday.size),
    onLeaveToday: Array.from(onLeaveToday.values()).slice(0, 5),
    casualWorkers,
    departments: Object.entries(departments).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    pendingLeave: num((pendingLeave as any)?.count),
    upcomingDates: upcomingDates.slice(0, 6),
    upcomingDatesTotal: upcomingDates.length,
    attendanceToday: { recorded: attendanceRecorded, byStatus: attendance },
    dataQuality: {
      missingSsnit: current.filter((e: any) => blank(e.ssnit)).length,
      missingBank: current.filter((e: any) => blank(e.account_number)).length,
      flaggedRates: current.filter(rateLooksWrong).length,
    },
    payroll: {
      period: `${monthName} ${today.getFullYear()}`,
      payday: paydayIso,
      runStatus,
      processed: payrollRows.length,
      paid: payrollRows.filter((p: any) => String(p.status).toLowerCase() === 'paid').length,
      netTotal: payrollRows.reduce((sum: number, p: any) => sum + num(p.net_pay), 0),
      lastPeriod: latestPayroll ? `${(latestPayroll as any).month} ${(latestPayroll as any).year}` : null,
    },
    upcoming,
  };
}

async function projectsSection() {
  const projects = await db('projects').select('id', 'name', 'client', 'status', 'budget', 'revised_budget', 'completion_rate', 'endDate');
  const spendRows = await db('ledger_entries as le')
    .join('journal_entries as je', 'le.journal_id', 'je.id')
    .join('chart_of_accounts as coa', 'le.account_id', 'coa.id')
    .where('coa.type', 'Expense')
    .whereNotNull('je.project_id')
    .select('je.project_id', db.raw('COALESCE(SUM(le.debit - le.credit), 0) as spent'))
    .groupBy('je.project_id');
  const spentByProject = new Map((spendRows as any[]).map(r => [r.project_id, num(r.spent)]));

  const byStatus: Record<string, number> = {};
  for (const p of projects as any[]) byStatus[p.status || 'Unknown'] = (byStatus[p.status || 'Unknown'] || 0) + 1;

  const open = (projects as any[])
    .filter(p => p.status !== 'Completed')
    .map(p => {
      const budget = num(p.revised_budget) || num(p.budget);
      const spent = spentByProject.get(p.id) || 0;
      const endDate = isIsoDate(String(p.endDate || '').slice(0, 10)) ? String(p.endDate).slice(0, 10) : null;
      return {
        id: p.id,
        name: p.name,
        client: p.client,
        status: p.status,
        endDate,
        budget,
        spent,
        budgetUsedPct: budget > 0 ? Math.round((spent / budget) * 100) : null,
        completion: Math.round(num(p.completion_rate)),
      };
    })
    .sort((a, b) => (b.budgetUsedPct ?? -1) - (a.budgetUsedPct ?? -1));

  const retention: any = await db('contracts').sum('retention_amount as total').first();

  return {
    total: projects.length,
    byStatus,
    open: open.slice(0, 6),
    openTotal: open.length,
    overBudget: open.filter(p => p.budgetUsedPct !== null && p.budgetUsedPct > 100).length,
    retentionHeld: num(retention?.total),
  };
}

async function operationsSection() {
  const recent = await db('site_reports')
    .leftJoin('projects', 'site_reports.project_id', 'projects.id')
    .select('site_reports.id', 'site_reports.content', 'site_reports.issues', 'site_reports.status', 'site_reports.created_at', 'projects.name as project_name')
    .orderBy('site_reports.created_at', 'desc')
    .limit(4);
  const pending: any = await db('site_reports').where('status', 'Pending Review').count('id as count').first();
  return { recentReports: recent, pendingReview: num(pending?.count) };
}

async function procurementSection() {
  const pendingPOs: any = await db('purchase_orders').where('status', 'Pending Approval')
    .select(db.raw('COUNT(*) as count'), db.raw('COALESCE(SUM(total_amount), 0) as total')).first();
  const lowStock = await db('inventory_items').whereRaw('quantity <= reorder_level').select('name', 'quantity', 'unit').orderBy('quantity').limit(5);
  const lowStockCount: any = await db('inventory_items').whereRaw('quantity <= reorder_level').count('id as count').first();
  return {
    pendingApproval: num(pendingPOs?.count),
    pendingValue: num(pendingPOs?.total),
    lowStock,
    lowStockCount: num(lowStockCount?.count),
  };
}

async function assetsSection(today: Date) {
  const equipment = await db('equipment').whereNot('status', 'Disposed').orWhereNull('status').select('id', 'name', 'status', 'next_maintenance');
  const windowEnd = isoDate(addDays(today, MAINTENANCE_WINDOW_DAYS));
  const maintenanceDue = (equipment as any[])
    .map(e => ({ ...e, next_maintenance: e.next_maintenance instanceof Date ? isoDate(e.next_maintenance) : e.next_maintenance }))
    .filter(e => e.next_maintenance && e.next_maintenance <= windowEnd)
    .sort((a, b) => a.next_maintenance.localeCompare(b.next_maintenance));
  return {
    total: equipment.length,
    onSite: equipment.filter((e: any) => e.status === 'On Site').length,
    inMaintenance: equipment.filter((e: any) => e.status === 'Maintenance').length,
    maintenanceDue: maintenanceDue.slice(0, 5).map(e => ({ name: e.name, date: e.next_maintenance })),
    maintenanceDueCount: maintenanceDue.length,
  };
}

/** Recently posted ledger documents, plus the audit trail for admins. */
async function activitySection(role: string) {
  const [journals, audit] = await Promise.all([
    db('journal_entries as je')
      .leftJoin('ledger_entries as le', 'le.journal_id', 'je.id')
      .select('je.id', 'je.date', 'je.description', 'je.reference_type', 'je.created_at', db.raw('COALESCE(SUM(le.debit), 0) as amount'))
      .groupBy('je.id')
      .orderBy('je.created_at', 'desc')
      .limit(8),
    role === 'admin'
      ? optional(db('audit_log').select('id', 'action', 'entity', 'entity_id', 'user_email', 'created_at').orderBy('created_at', 'desc').limit(8), [] as any[], 'audit log')
      : Promise.resolve([] as any[]),
  ]);
  return {
    journals: (journals as any[]).map(j => ({ ...j, date: toIso(j.date), amount: num(j.amount) })),
    audit,
  };
}

router.get('/', authenticateToken, async (req: AuthRequest, res) => {
  const role = req.user?.role || '';
  const today = new Date();
  const periodKey: PeriodKey = PERIODS.includes(req.query.period as PeriodKey) ? req.query.period as PeriodKey : 'month';
  const period = periodRanges(periodKey, today);
  const can = (section: keyof typeof SECTION_ROLES) => SECTION_ROLES[section].includes(role);

  const loaders: [string, () => Promise<any>][] = [];
  if (can('finance')) {
    loaders.push(['finance', async () => {
      const [finance, pendingApprovals] = await Promise.all([financeSection(today, period), pendingCount(req.user as any)]);
      return { ...finance, pendingApprovals };
    }]);
  }
  if (can('workforce')) loaders.push(['workforce', () => workforceSection(today)]);
  if (can('projects')) loaders.push(['projects', projectsSection]);
  if (can('operations')) loaders.push(['operations', operationsSection]);
  if (can('procurement')) loaders.push(['procurement', procurementSection]);
  if (can('assets')) loaders.push(['assets', () => assetsSection(today)]);
  if (can('activity')) loaders.push(['activity', () => activitySection(role)]);

  const results = await Promise.allSettled(loaders.map(([, load]) => load()));
  const body: Record<string, any> = {
    generatedAt: today.toISOString(),
    role,
    period: { key: period.key, label: period.label, priorLabel: period.priorLabel, ...period.current },
    errors: [] as string[],
  };
  results.forEach((result, i) => {
    const [name] = loaders[i];
    if (result.status === 'fulfilled') {
      body[name] = result.value;
    } else {
      console.error(`Dashboard section "${name}" failed:`, result.reason);
      body.errors.push(name);
    }
  });

  res.json(body);
});

export default router;
