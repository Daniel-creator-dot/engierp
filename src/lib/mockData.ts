import { Project, Transaction, Employee, Invoice, TaxRecord } from '../types';

export const mockProjects: Project[] = [
  {
    id: 'PRJ-001',
    name: 'Skyline Bridge Construction',
    client: 'City Council',
    budget: 1200000,
    spent: 850000,
    status: 'active',
    startDate: '2023-01-15',
    endDate: '2024-06-30',
    manager: 'John Doe',
    profitability: 28,
  },
  {
    id: 'PRJ-002',
    name: 'Green Valley Solar Farm',
    client: 'EcoEnergy Ltd',
    budget: 5000000,
    spent: 2100000,
    status: 'active',
    startDate: '2023-05-10',
    endDate: '2025-12-31',
    manager: 'Sarah Smith',
    profitability: 35,
  },
  {
    id: 'PRJ-003',
    name: 'Metro Tunnel Expansion',
    client: 'Transport Authority',
    budget: 8500000,
    spent: 8200000,
    status: 'on-hold',
    startDate: '2022-03-01',
    endDate: '2024-12-20',
    manager: 'Mike Ross',
    profitability: 12,
  },
];

export const mockTransactions: Transaction[] = [
  { id: 'TX-001', date: '2024-04-01', description: 'Cement Supply - Batch A', category: 'Materials', amount: 15000, type: 'expense', status: 'cleared', project: 'PRJ-001' },
  { id: 'TX-002', date: '2024-04-02', description: 'Consultancy Fee - Design', category: 'Professional Services', amount: 5000, type: 'expense', status: 'cleared', project: 'PRJ-001' },
  { id: 'TX-003', date: '2024-04-05', description: 'Progress Payment #4', category: 'Revenue', amount: 250000, type: 'income', status: 'cleared', project: 'PRJ-001' },
  { id: 'TX-004', date: '2024-04-06', description: 'Office Rent - April', category: 'Overhead', amount: 3500, type: 'expense', status: 'cleared' },
];

export const mockEmployees: Employee[] = [
  { id: 'EMP-001', name: 'James Mensah', role: 'Senior Engineer', department: 'Civil', salary: 8500, joinDate: '2020-01-10', status: 'active' },
  { id: 'EMP-002', name: 'Abena Osei', role: 'Project Manager', department: 'Operations', salary: 9200, joinDate: '2021-03-15', status: 'active' },
  { id: 'EMP-003', name: 'Kofi Appiah', role: 'Site Supervisor', department: 'Construction', salary: 5500, joinDate: '2022-06-01', status: 'on-leave' },
];

export const mockInvoices: Invoice[] = [
  { id: 'INV-1001', client: 'City Council', amount: 250000, dueDate: '2024-05-01', status: 'unpaid', project: 'PRJ-001' },
  { id: 'INV-1002', client: 'EcoEnergy Ltd', amount: 500000, dueDate: '2024-04-15', status: 'paid', project: 'PRJ-002' },
  { id: 'INV-1003', client: 'Transport Authority', amount: 120000, dueDate: '2024-03-30', status: 'overdue', project: 'PRJ-003' },
];

export const mockTaxRecords: TaxRecord[] = [
  { id: 'TAX-001', period: 'March 2024', type: 'VAT', amount: 45000, status: 'filed' },
  { id: 'TAX-002', period: 'March 2024', type: 'PAYE', amount: 12500, status: 'filed' },
  { id: 'TAX-003', period: 'April 2024', type: 'VAT', amount: 38000, status: 'pending' },
];
