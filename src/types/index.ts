
export type Module = 
  | 'dashboard' 
  | 'accounting-gl' | 'accounting-ar' | 'accounting-ap' | 'accounting-tax' | 'accounting-bank'
  | 'hr-directory' | 'hr-payroll' | 'hr-attendance' | 'hr-leave'
  | 'projects-active' | 'projects-costing' | 'projects-contracts' | 'projects-wip'
  | 'procurement-pos' | 'procurement-inventory' | 'procurement-suppliers'
  | 'field-ops' 
  | 'settings';

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
