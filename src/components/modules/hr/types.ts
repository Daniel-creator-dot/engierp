import type { PayItem } from '../../../lib/payrollCalc';

export type { Employee, LeaveRequest, Appraisal } from '../../../types';

export interface Setting { key: string; value: string }

export interface PayrollEntry {
  id: number;
  run_id: number | null;
  employee_id: string;
  name: string;
  department?: string;
  employee_role?: string;
  wage_type?: string;
  employee_ssnit?: string | null;
  employee_ghana_card?: string | null;
  bank_name?: string | null;
  account_name?: string | null;
  account_number?: string | null;
  branch?: string | null;
  month: string;
  year: number;
  payment_date?: string | null;
  base_salary: number | string;
  allowances: number | string | null;
  gross: number | string | null;
  ssnit_employee: number | string | null;
  ssnit_employer: number | string | null;
  taxable_income: number | string | null;
  paye: number | string | null;
  other_deductions: number | string | null;
  deductions: number | string | null;
  net_pay: number | string;
  detailed_allowances?: string | null;
  detailed_deductions?: string | null;
  hours_worked?: number | string | null;
  overtime_hours?: number | string | null;
  project_id?: string | null;
  journal_id?: number | null;
  notes?: string | null;
  status: string;
  paid_at?: string | null;
  created_at?: string;
  employee_phone?: string | null;
  employment_type?: string | null;
  pay_type?: 'casual' | null;
  days_worked?: number | string | null;
  daily_rate?: number | string | null;
  overtime_rate?: number | string | null;
  overtime_pay?: number | string | null;
  wht?: number | string | null;
  tax_treatment?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  project_breakdown?: string | null;
}

export interface ProjectShare { project_id: string | null; project_name?: string | null; days: number; overtime_hours: number; amount: number }

export interface PayrollRun {
  id: number;
  month: string;
  year: number;
  status: 'Draft' | 'Reviewed' | 'Approved' | 'Paid' | 'Cancelled';
  payment_date?: string | null;
  project_id?: string | null;
  notes?: string | null;
  journal_id?: number | null;
  employee_count?: number;
  total_gross?: number | string;
  total_net?: number | string;
  total_paye?: number | string;
  total_ssnit_employee?: number | string;
  total_ssnit_employer?: number | string;
  total_other_deductions?: number | string;
  total_wht?: number | string;
  total_days?: number | string;
  run_type?: 'monthly' | 'casual';
  frequency?: 'Weekly' | 'Daily' | null;
  period_start?: string | null;
  period_end?: string | null;
  reviewed_at?: string | null;
  approved_at?: string | null;
  paid_at?: string | null;
  created_at?: string;
  entries?: PayrollEntry[];
}

export interface LeaveBalance {
  employee_id: string;
  name?: string;
  department?: string;
  year: number;
  entitlement: number;
  carried_over: number;
  used: number;
  pending: number;
  available: number;
  remaining_after_pending: number;
}

export interface AttendanceRow {
  id?: number;
  employee_id: string;
  employee_name?: string;
  project_id?: string | null;
  project_name?: string | null;
  date: string;
  attendance: string;
  hours: number;
  overtime_hours: number;
  description?: string | null;
}

export type { PayItem };
