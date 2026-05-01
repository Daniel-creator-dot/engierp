
export type Module = 
  | 'dashboard' 
  | 'accounting-gl' | 'accounting-ar' | 'accounting-ap' | 'accounting-tax' | 'accounting-bank' | 'accounting-transactions' | 'accounting-reports' | 'accounting-coa'
  | 'hr-directory' | 'hr-payroll' | 'hr-attendance' | 'hr-leave' | 'hr-performance' | 'hr-resources'
  | 'projects-active' | 'projects-costing' | 'projects-contracts' | 'projects-wip'
  | 'procurement-pos' | 'procurement-inventory' | 'procurement-suppliers'
  | 'field-ops' | 'assets'
  | 'settings'
  | 'profile';

export type ParentModule = 'dashboard' | 'accounting' | 'hr' | 'projects' | 'procurement' | 'field-ops' | 'settings';

export interface Project {
  id: string;
  name: string;
  client: string;
  budget: number;
  spent: number;
  status: 'active' | 'completed' | 'on-hold' | 'draft';
  startDate: string;
  endDate: string;
  manager: string;
  profitability: number;
}

export interface Transaction {
  id: string;
  date: string;
  description: string;
  category: string;
  amount: number;
  type: 'income' | 'expense';
  status: 'cleared' | 'pending';
  project?: string;
}

export interface Employee {
  id: string;
  name: string;
  role: string;
  department: string;
  salary: number;
  joinDate: string;
  status: 'active' | 'on-leave' | 'terminated';
  ssnit?: string;
  ghana_card?: string;
  phone?: string;
  address?: string;
  bank_name?: string;
  account_name?: string;
  account_number?: string;
  branch?: string;
  wage_type?: string;
}

export interface Invoice {
  id: string;
  client: string;
  amount: number;
  dueDate: string;
  status: 'paid' | 'unpaid' | 'overdue';
  project?: string;
}

export interface TaxRecord {
  id: string;
  period: string;
  type: 'VAT' | 'PAYE' | 'SSNIT';
  amount: number;
  status: 'filed' | 'pending';
}

export interface LeaveRequest {
  id: number;
  employee_id: string;
  employee_name?: string;
  type: string;
  startDate: string;
  endDate: string;
  reason: string;
  status: 'Pending' | 'Approved' | 'Rejected';
}

export interface PayrollRecord {
  id: number;
  employee_id: string;
  name: string;
  base_salary: number;
  allowances: number;
  deductions: number;
  net_pay: number;
  month: string;
  year: number;
  payment_date: string;
  status: string;
}

export interface Appraisal {
  id: number;
  employee_id: string;
  name: string;
  year: number;
  period: string;
  score: number;
  feedback: string;
  status: string;
}
