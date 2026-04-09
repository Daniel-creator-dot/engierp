import axios from 'axios';

let rawApiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
// Auto-append /api if the user forgot it in their environment variable
if (rawApiUrl && !rawApiUrl.endsWith('/api')) {
  rawApiUrl = rawApiUrl.endsWith('/') ? `${rawApiUrl}api` : `${rawApiUrl}/api`;
}
const API_BASE_URL = rawApiUrl;

const api = axios.create({
  baseURL: API_BASE_URL,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;

export const authApi = {
  login: (credentials: any) => api.post('/auth/login', credentials),
  me: () => api.get('/auth/me'),
  forgotPassword: (email: string) => api.post('/auth/forgot-password', { email }),
  resetPassword: (data: any) => api.post('/auth/reset-password', data),
};

export const hrApi = {
  getEmployees: () => api.get('/hr/employees'),
  addEmployee: (data: any) => api.post('/hr/employees', data),
  updateEmployee: (id: string, data: any) => api.patch(`/hr/employees/${id}`, data),
  getLeaveRequests: () => api.get('/hr/leave-requests'),
  submitLeaveRequest: (data: any) => api.post('/hr/leave-requests', data),
  updateLeaveStatus: (id: number, status: string) => api.patch(`/hr/leave-requests/${id}`, { status }),
  getPayroll: () => api.get('/hr/payroll'),
  processPayroll: (data: any) => api.post('/hr/payroll', data),
  batchProcessPayroll: (data: { month: string, year: number }) => api.post('/hr/payroll/batch', data),
  getAppraisals: () => api.get('/hr/appraisals'),
  submitAppraisal: (data: any) => api.post('/hr/appraisals', data),
};

export const procurementApi = {
  getSuppliers: () => api.get('/procurement/suppliers'),
  addSupplier: (data: any) => api.post('/procurement/suppliers', data),
  updateSupplier: (id: string, data: any) => api.patch(`/procurement/suppliers/${id}`, data),
  getInventory: () => api.get('/procurement/inventory'),
  addInventory: (data: any) => api.post('/procurement/inventory', data),
  getPurchaseOrders: () => api.get('/procurement/purchase-orders'),
  createPurchaseOrder: (data: any) => api.post('/procurement/purchase-orders', data),
  updateLogistics: (id: string, data: any) => api.patch(`/procurement/purchase-orders/${id}`, data),
};

export const accountingApi = {
  getTransactions: () => api.get('/accounting/transactions'),
  addTransaction: (data: any) => api.post('/accounting/transactions', data),
  getInvoices: () => api.get('/accounting/invoices'),
  createInvoice: (data: any) => api.post('/accounting/invoices', data),
  getTaxes: () => api.get('/accounting/taxes'),
  getReceivables: () => api.get('/accounting/reports/receivables'),
  getPayables: () => api.get('/accounting/reports/payables'),
  getProfitLoss: () => api.get('/accounting/reports/profit-loss'),
  getCOA: () => api.get('/accounting/coa'),
  createCOA: (data: any) => api.post('/accounting/coa', data),
  postJournal: (data: any) => api.post('/accounting/journal', data),
  getTrialBalance: () => api.get('/accounting/reports/trial-balance'),
  
  // Enterprise Finance
  getBankAccounts: () => api.get('/accounting/bank-accounts'),
  addBankAccount: (data: any) => api.post('/accounting/bank-accounts', data),
  getBankTransactions: () => api.get('/accounting/bank-transactions'),
  importBankTransaction: (data: any) => api.post('/accounting/bank-transactions', data),
  
  getBills: () => api.get('/accounting/bills'),
  recordBill: (data: any) => api.post('/accounting/bills', data),
  
  recordPayment: (data: any) => api.post('/accounting/payments', data),
};

export const projectsApi = {
  getProjects: () => api.get('/projects'),
  createProject: (data: any) => api.post('/projects', data),
  updateProject: (id: string, data: any) => api.patch(`/projects/${id}`, data),
  getJobCosting: (id: string) => api.get(`/projects/${id}/job-costing`),
  getWIPReport: () => api.get('/projects/reports/wip'),
};

export const contractsApi = {
  getContracts: () => api.get('/contracts'),
  createContract: (data: any) => api.post('/contracts', data),
  updateContract: (id: string, data: any) => api.patch(`/contracts/${id}`, data),
};

export const fieldOpsApi = {
  getReports: () => api.get('/field-ops/reports'),
  submitReport: (data: any) => api.post('/field-ops/reports', data),
  getTasks: () => api.get('/field-ops/tasks'),
  updateTask: (id: string, status: string) => api.patch(`/field-ops/tasks/${id}`, { status }),
};

export const assetsApi = {
  getEquipment: () => api.get('/assets'),
  addEquipment: (data: any) => api.post('/assets', data),
  updateEquipment: (id: string, data: any) => api.patch(`/assets/${id}`, data),
  getAllocations: () => api.get('/assets/allocations'),
  allocateEquipment: (data: any) => api.post('/assets/allocations', data),
};

export const settingsApi = {
  getSettings: () => api.get('/settings'),
  updateSetting: (key: string, value: string) => api.post('/settings', { key, value }),
  getUsers: () => api.get('/settings/users'),
  addUser: (data: any) => api.post('/settings/users', data),
  getSMSConfig: () => api.get('/settings/sms'),
  updateSMSConfig: (data: any) => api.post('/settings/sms', data),
};
