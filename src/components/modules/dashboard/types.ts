import type { Module } from '../../../types';

export type PeriodKey = 'month' | 'quarter' | 'ytd' | '12m';

export interface PL { income: number; expense: number; net: number }

export interface MonthPoint extends PL { key: string; label: string; cash: number }

export interface Aging { current: number; d30: number; d60: number; d90: number; d90plus: number }

export interface OpenBalances { outstanding: number; open: number; overdue: number; overdueAmount: number; aging?: Aging }

export interface UpcomingItem {
  date: string;
  label: string;
  detail: string;
  kind: 'payroll' | 'casual-pay' | 'contract' | 'probation' | 'leave' | 'bill' | 'invoice' | 'recurring' | 'maintenance';
  amount?: number;
  target?: Module;
}

export interface FinanceSummary {
  period?: PL & { key: PeriodKey; label: string; priorLabel: string };
  prior?: PL;
  ytd: PL;
  monthly: MonthPoint[];
  cashPosition: number;
  runway?: { basisLabel: string; avgMonthlyExpense: number; avgMonthlyNet: number; coverMonths: number | null; runwayMonths: number | null };
  expenseBreakdown?: { total: number; items: { name: string; code: string; amount: number }[] };
  expenseMovers?: { name: string; code: string; current: number; previous: number; change: number }[];
  uncategorized?: { ytd: number; period: number };
  receivables: OpenBalances;
  payables: OpenBalances;
  upcoming?: UpcomingItem[];
  pendingApprovals?: number;
}

export interface WorkforceSummary {
  headcount: number;
  active: number;
  onLeave: number;
  onLeaveToday?: { name: string; type: string; until: string }[];
  casualWorkers?: number;
  departments: { name: string; count: number }[];
  pendingLeave: number;
  upcomingDates: { name: string; label: string; date: string }[];
  upcomingDatesTotal: number;
  attendanceToday?: { recorded: number; byStatus: Record<string, number> };
  dataQuality?: { missingSsnit: number; missingBank: number; flaggedRates: number };
  payroll: { period: string; payday?: string; runStatus?: string | null; processed: number; paid: number; netTotal: number; lastPeriod: string | null };
  upcoming?: UpcomingItem[];
}

export interface ProjectRow {
  id: string;
  name: string;
  client: string;
  status: string;
  endDate: string | null;
  budget: number;
  spent: number;
  budgetUsedPct: number | null;
  completion: number;
}

export interface DashboardSummary {
  generatedAt: string;
  role: string;
  period?: { key: PeriodKey; label: string; priorLabel: string; start: string; end: string };
  errors: string[];
  finance?: FinanceSummary;
  workforce?: WorkforceSummary;
  projects?: { total: number; byStatus: Record<string, number>; open: ProjectRow[]; openTotal: number; overBudget: number; retentionHeld: number };
  operations?: { recentReports: { id: number; content: string; issues: string; status: string; created_at: string; project_name: string | null }[]; pendingReview: number };
  procurement?: { pendingApproval: number; pendingValue: number; lowStock: { name: string; quantity: number; unit: string }[]; lowStockCount: number };
  assets?: { total: number; onSite: number; inMaintenance: number; maintenanceDue: { name: string; date: string }[]; maintenanceDueCount: number };
  activity?: {
    journals: { id: number; date: string; description: string; reference_type: string; created_at: string; amount: number }[];
    audit: { id: number; action: string; entity: string; entity_id: string; user_email: string | null; created_at: string }[];
  };
}

export type Money = (value: number) => string;
