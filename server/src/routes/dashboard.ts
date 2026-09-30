import { Router } from 'express';
import db from '../db';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ALERT_WINDOW_DAYS = 30;
const MAINTENANCE_WINDOW_DAYS = 14;

const SECTION_ROLES = {
  finance: ['admin', 'accountant'],
  workforce: ['admin', 'hr', 'accountant'],
  projects: ['admin', 'accountant', 'pm', 'hr'],
  operations: ['admin', 'pm'],
  procurement: ['admin', 'accountant', 'procurement'],
  assets: ['admin', 'accountant'],
};

const pad = (n: number) => String(n).padStart(2, '0');
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const addDays = (d: Date, days: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
const num = (value: any) => Number(value || 0);

async function financeSection(today: Date) {
  const firstMonth = new Date(today.getFullYear(), today.getMonth() - 5, 1);
  const yearStart = `${today.getFullYear()}-01-01`;

  const monthlyRows = await db('ledger_entries as le')
    .join('journal_entries as je', 'le.journal_id', 'je.id')
    .join('chart_of_accounts as coa', 'le.account_id', 'coa.id')
    .whereIn('coa.type', ['Income', 'Expense'])
    .where('je.date', '>=', isoDate(firstMonth))
    .select(
      db.raw(`to_char(je.date, 'YYYY-MM') as month`),
      'coa.type',
      db.raw('COALESCE(SUM(le.debit), 0) as debit'),
      db.raw('COALESCE(SUM(le.credit), 0) as credit')
    )
    .groupByRaw(`to_char(je.date, 'YYYY-MM'), coa.type`);

  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(firstMonth.getFullYear(), firstMonth.getMonth() + i, 1);
    return { key: monthKey(d), label: `${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${String(d.getFullYear()).slice(2)}`, income: 0, expense: 0 };
  });
  for (const row of monthlyRows as any[]) {
    const month = months.find(m => m.key === row.month);
    if (!month) continue;
    if (row.type === 'Income') month.income += num(row.credit) - num(row.debit);
    else month.expense += num(row.debit) - num(row.credit);
  }
  const monthly = months.map(m => ({ ...m, net: m.income - m.expense }));

  const ytdRows = await db('ledger_entries as le')
    .join('journal_entries as je', 'le.journal_id', 'je.id')
    .join('chart_of_accounts as coa', 'le.account_id', 'coa.id')
    .whereIn('coa.type', ['Income', 'Expense'])
    .where('je.date', '>=', yearStart)
    .select('coa.type', db.raw('COALESCE(SUM(le.debit), 0) as debit'), db.raw('COALESCE(SUM(le.credit), 0) as credit'))
    .groupBy('coa.type');
  const ytd = { income: 0, expense: 0 };
  for (const row of ytdRows as any[]) {
    if (row.type === 'Income') ytd.income = num(row.credit) - num(row.debit);
    else ytd.expense = num(row.debit) - num(row.credit);
  }

  const cashRow: any = await db('ledger_entries as le')
    .join('chart_of_accounts as coa', 'le.account_id', 'coa.id')
    .where('coa.type', 'Asset')
    .where(function () {
      this.where('coa.name', 'ilike', '%cash%').orWhere('coa.name', 'ilike', '%bank%');
    })
    .select(db.raw('COALESCE(SUM(le.debit - le.credit), 0) as balance'))
    .first();

  const todayIso = isoDate(today);

  const invoices = await db('invoices as i')
    .leftJoin('payments as p', function () {
      this.on('p.target_id', 'i.id').andOn('p.target_type', db.raw('?', ['Invoice']));
    })
    .select('i.id', 'i.amount', 'i.dueDate', db.raw('COALESCE(SUM(p.amount), 0) as paid'))
    .groupBy('i.id');
  const receivables = { outstanding: 0, open: 0, overdue: 0, overdueAmount: 0 };
  for (const inv of invoices as any[]) {
    const balance = Math.max(0, num(inv.amount) - num(inv.paid));
    if (balance <= 0.005) continue;
    receivables.outstanding += balance;
    receivables.open += 1;
    if (inv.dueDate && String(inv.dueDate).slice(0, 10) < todayIso) {
      receivables.overdue += 1;
      receivables.overdueAmount += balance;
    }
  }

  const bills = await db('bills as b')
    .leftJoin('payments as p', function () {
      this.on('p.target_id', db.raw('CAST(b.id AS VARCHAR)')).andOn('p.target_type', db.raw('?', ['Bill']));
    })
    .select('b.id', 'b.amount', 'b.due_date', db.raw('COALESCE(SUM(p.amount), 0) as paid'))
    .groupBy('b.id');
  const payables = { outstanding: 0, open: 0, overdue: 0, overdueAmount: 0 };
  for (const bill of bills as any[]) {
    const balance = Math.max(0, num(bill.amount) - num(bill.paid));
    if (balance <= 0.005) continue;
    payables.outstanding += balance;
    payables.open += 1;
    const due = bill.due_date instanceof Date ? isoDate(bill.due_date) : String(bill.due_date || '').slice(0, 10);
    if (due && due < todayIso) {
      payables.overdue += 1;
      payables.overdueAmount += balance;
    }
  }

  const current = monthly[monthly.length - 1];
  const previous = monthly[monthly.length - 2];

  return {
    currentMonth: current,
    previousMonth: previous,
    monthly,
    ytd: { ...ytd, net: ytd.income - ytd.expense },
    cashPosition: num(cashRow?.balance),
    receivables,
    payables,
  };
}

async function workforceSection(today: Date) {
  const employees = await db('employees').select('id', 'name', 'department', 'status', 'contract_end_date', 'probation_end_date');
  const current = employees.filter((e: any) => e.status !== 'terminated');
  const todayIso = isoDate(today);
  const windowEnd = isoDate(addDays(today, ALERT_WINDOW_DAYS));

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

  const pendingLeave: any = await db('leave_requests').where('status', 'Pending').count('id as count').first();
  const onLeaveToday: any = await db('leave_requests')
    .where('status', 'Approved')
    .where('startDate', '<=', todayIso)
    .where('endDate', '>=', todayIso)
    .countDistinct('employee_id as count')
    .first();

  const monthName = MONTH_NAMES[today.getMonth()];
  const payrollRows = await db('payroll').where({ month: monthName, year: today.getFullYear() }).select('status', 'net_pay');
  const latestPayroll: any = await db('payroll').select('month', 'year').orderBy('year', 'desc').orderBy('created_at', 'desc').first();

  return {
    headcount: current.length,
    active: current.filter((e: any) => e.status === 'active').length,
    onLeave: Math.max(current.filter((e: any) => e.status === 'on-leave').length, num(onLeaveToday?.count)),
    departments: Object.entries(departments).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    pendingLeave: num(pendingLeave?.count),
    upcomingDates: upcomingDates.slice(0, 6),
    upcomingDatesTotal: upcomingDates.length,
    payroll: {
      period: `${monthName} ${today.getFullYear()}`,
      processed: payrollRows.length,
      paid: payrollRows.filter((p: any) => String(p.status).toLowerCase() === 'paid').length,
      netTotal: payrollRows.reduce((sum: number, p: any) => sum + num(p.net_pay), 0),
      lastPeriod: latestPayroll ? `${latestPayroll.month} ${latestPayroll.year}` : null,
    },
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
      return {
        id: p.id,
        name: p.name,
        client: p.client,
        status: p.status,
        endDate: p.endDate || null,
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
    open: open.slice(0, 5),
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

router.get('/', authenticateToken, async (req: AuthRequest, res) => {
  const role = req.user?.role || '';
  const today = new Date();
  const can = (section: keyof typeof SECTION_ROLES) => SECTION_ROLES[section].includes(role);

  const loaders: [string, () => Promise<any>][] = [];
  if (can('finance')) loaders.push(['finance', () => financeSection(today)]);
  if (can('workforce')) loaders.push(['workforce', () => workforceSection(today)]);
  if (can('projects')) loaders.push(['projects', projectsSection]);
  if (can('operations')) loaders.push(['operations', operationsSection]);
  if (can('procurement')) loaders.push(['procurement', procurementSection]);
  if (can('assets')) loaders.push(['assets', () => assetsSection(today)]);

  const results = await Promise.allSettled(loaders.map(([, load]) => load()));
  const body: Record<string, any> = { generatedAt: today.toISOString(), role, errors: [] as string[] };
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
