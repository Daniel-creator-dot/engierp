import axios from 'axios';

let rawApiUrl = (import.meta as any).env.VITE_API_URL || 'http://localhost:5000/api';
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

// The backend runs on Render, which briefly drops requests while a deploy swaps instances or a
// sleeping free instance starts. Retry idempotent GETs once instead of failing the whole screen.
api.interceptors.response.use(undefined, async (error) => {
  const config = error?.config;
  const status = error?.response?.status;
  const transient = !error?.response || status === 502 || status === 503 || status === 504;
  if (config && transient && (config.method || 'get').toLowerCase() === 'get' && !config.__retried) {
    config.__retried = true;
    await new Promise(resolve => setTimeout(resolve, 1500));
    return api.request(config);
  }
  return Promise.reject(error);
});

// Only these codes mean "the session is gone"; other 401/403s (e.g. no linked employee) must not log the user out.
const SESSION_ENDED_CODES = new Set(['NO_TOKEN', 'TOKEN_EXPIRED', 'TOKEN_INVALID', 'ACCOUNT_DISABLED', 'SESSION_REVOKED']);
const sessionListeners = new Set<(message: string) => void>();
const passwordChangeListeners = new Set<() => void>();

export const onSessionEnded = (listener: (message: string) => void) => {
  sessionListeners.add(listener);
  return () => { sessionListeners.delete(listener); };
};

export const onPasswordChangeRequired = (listener: () => void) => {
  passwordChangeListeners.add(listener);
  return () => { passwordChangeListeners.delete(listener); };
};

api.interceptors.response.use(undefined, (error) => {
  const status = error?.response?.status;
  const code = error?.response?.data?.code;
  if (status === 401 && SESSION_ENDED_CODES.has(code) && localStorage.getItem('token')) {
    localStorage.removeItem('token');
    const message = error.response.data?.message || 'Your session has ended. Please log in again.';
    sessionListeners.forEach(listener => listener(message));
  } else if (status === 403 && code === 'PASSWORD_CHANGE_REQUIRED') {
    passwordChangeListeners.forEach(listener => listener());
  }
  return Promise.reject(error);
});

export const apiErrorMessage = (error: any, fallback: string) => {
  const data = error?.response?.data;
  if (data?.message || data?.error) return data.message || data.error;
  return error?.response ? fallback : 'Could not reach the server. Check your connection and try again.';
};

export default api;

export const authApi = {
  login: (credentials: any) => api.post('/auth/login', credentials),
  me: () => api.get('/auth/me'),
  forgotPassword: (phone: string) => api.post('/auth/forgot-password', { phone }),
  resetPassword: (data: any) => api.post('/auth/reset-password', data),
  changePassword: (data: { currentPassword: string; newPassword: string }) => api.post('/auth/change-password', data),
  getProfile: () => api.get('/auth/profile'),
  updateProfile: (data: { name?: string; phone?: string; email?: string }) => api.patch('/auth/profile', data),
};

export const notificationsApi = {
  list: () => api.get('/notifications'),
  markRead: (id: number) => api.patch(`/notifications/${id}/read`),
  markAllRead: () => api.post('/notifications/read-all'),
};

export const searchApi = {
  search: (q: string) => api.get('/search', { params: { q } }),
};

export const auditApi = {
  list: (params: { entity?: string; action?: string; q?: string; from?: string; to?: string; limit?: number; offset?: number }) =>
    api.get('/audit', { params }),
};

export const hrApi = {
  getEmployees: () => api.get('/hr/employees'),
  addEmployee: (data: any) => api.post('/hr/employees', data),
  updateEmployee: (id: string, data: any) => api.patch(`/hr/employees/${id}`, data),
  bulkImportEmployees: (employees: any[], dryRun: boolean) => api.post('/hr/employees/bulk', { employees, dryRun }),
  bulkUpdatePaySetup: (ids: string[], updates: Record<string, unknown>) => api.patch('/hr/employees/bulk-pay', { ids, updates }),
  // Pass { mine: true } for the signed-in user's own records (self-service), whatever their role.
  getLeaveRequests: (params?: { mine?: boolean }) => api.get('/hr/leave-requests', { params: params?.mine ? { mine: 1 } : undefined }),
  submitLeaveRequest: (data: any) => api.post('/hr/leave-requests', data),
  updateLeaveStatus: (id: number, status: string, note?: string) => api.patch(`/hr/leave-requests/${id}`, { status, note }),
  cancelLeaveRequest: (id: number) => api.patch(`/hr/leave-requests/${id}/cancel`),
  getLeaveBalances: (params?: { year?: number; mine?: boolean }) =>
    api.get('/hr/leave-balances', { params: { year: params?.year, mine: params?.mine ? 1 : undefined } }),
  updateLeaveBalance: (employeeId: string, data: { year: number; entitlement: number; carried_over: number }) =>
    api.put(`/hr/leave-balances/${employeeId}`, data),
  getPayroll: (params?: { mine?: boolean; standalone?: boolean }) =>
    api.get('/hr/payroll', { params: { mine: params?.mine ? 1 : undefined, standalone: params?.standalone ? 1 : undefined } }),
  processPayroll: (data: any) => api.post('/hr/payroll', data),
  approvePayroll: (id: number, status: string) => api.patch(`/hr/payroll/${id}`, { status }),
  deletePayroll: (id: number) => api.delete(`/hr/payroll/${id}`),
  getPayrollRuns: () => api.get('/hr/payroll-runs'),
  getPayrollRun: (id: number) => api.get(`/hr/payroll-runs/${id}`),
  createPayrollRun: (data: {
    month?: string; year?: number; payment_date?: string; project_id?: string; notes?: string;
    run_type?: 'monthly' | 'casual'; frequency?: 'Weekly' | 'Daily'; period_start?: string;
  }) => api.post('/hr/payroll-runs', data),
  refreshPayrollRun: (runId: number) => api.post(`/hr/payroll-runs/${runId}/refresh`),
  updatePayrollRunEntry: (runId: number, entryId: number, data: any) => api.patch(`/hr/payroll-runs/${runId}/entries/${entryId}`, data),
  removePayrollRunEntry: (runId: number, entryId: number) => api.delete(`/hr/payroll-runs/${runId}/entries/${entryId}`),
  payrollRunAction: (runId: number, action: 'review' | 'reopen' | 'approve' | 'mark-paid' | 'cancel') =>
    api.post(`/hr/payroll-runs/${runId}/${action}`),
  getPayrollSettings: () => api.get('/hr/payroll-settings'),
  savePayrollSettings: (data: { config?: any; accounts?: any }) => api.put('/hr/payroll-settings', data),
  getAppraisals: (params?: { mine?: boolean }) => api.get('/hr/appraisals', { params: params?.mine ? { mine: 1 } : undefined }),
  submitAppraisal: (data: any) => api.post('/hr/appraisals', data),
  getAttendanceRoster: () => api.get('/hr/attendance/roster'),
  getAttendance: (date: string, projectId?: string) => api.get('/hr/attendance', { params: { date, project_id: projectId || undefined } }),
  saveAttendance: (data: { date: string; project_id?: string | null; entries: any[] }) => api.put('/hr/attendance', data),
  getAttendanceSummary: (month: string, year: number) => api.get('/hr/attendance/summary', { params: { month, year } }),
};

export const procurementApi = {
  getSuppliers: () => api.get('/procurement/suppliers'),
  addSupplier: (data: any) => api.post('/procurement/suppliers', data),
  updateSupplier: (id: string, data: any) => api.patch(`/procurement/suppliers/${id}`, data),
  getSupplierHistory: (id: string) => api.get(`/procurement/suppliers/${id}/history`),
  getInventory: () => api.get('/procurement/inventory'),
  addInventory: (data: any) => api.post('/procurement/inventory', data),
  updateInventory: (id: string, data: any) => api.patch(`/procurement/inventory/${id}`, data),
  getStockMovements: (id: string) => api.get(`/procurement/inventory/${id}/movements`),
  recordStockMovement: (id: string, data: { type: 'issue' | 'adjustment'; quantity: number; project_id?: string; notes?: string }) =>
    api.post(`/procurement/inventory/${id}/movements`, data),
  getPurchaseOrders: () => api.get('/procurement/purchase-orders'),
  getPurchaseOrder: (id: string) => api.get(`/procurement/purchase-orders/${id}`),
  createPurchaseOrder: (data: any) => api.post('/procurement/purchase-orders', data),
  editPurchaseOrder: (id: string, data: any) => api.put(`/procurement/purchase-orders/${id}`, data),
  updateLogistics: (id: string, data: any) => api.patch(`/procurement/purchase-orders/${id}`, data),
  updatePOStatus: (id: string, data: { status: string }) => api.patch(`/procurement/purchase-orders/${id}`, data),
  approvePO: (id: string) => api.post(`/procurement/purchase-orders/${id}/approve`),
  rejectPO: (id: string, reason?: string) => api.post(`/procurement/purchase-orders/${id}/reject`, { reason }),
  cancelPO: (id: string) => api.post(`/procurement/purchase-orders/${id}/cancel`),
  receiveGoods: (id: string, data: { receipt_date: string; delivery_note?: string; notes?: string; lines: Array<{ po_item_id: number; quantity: number; inventory_item_id?: string; add_to_stock?: boolean }> }) =>
    api.post(`/procurement/purchase-orders/${id}/receive`, data),
  convertToBill: (id: string, data: { account_id: number; bill_date: string; due_date?: string }) =>
    api.post(`/procurement/purchase-orders/${id}/convert-to-bill`, data),
  getBillAccounts: () => api.get('/procurement/bill-accounts'),
};

export const accountingApi = {
  getTransactions: (params?: LedgerQuery) => api.get('/accounting/transactions', { params }),
  exportTransactions: (params?: LedgerQuery) => api.get('/accounting/transactions/export', { params }),
  addTransaction: (data: any) => api.post('/accounting/transactions', data),
  getInvoices: () => api.get('/accounting/invoices'),
  createInvoice: (data: any) => api.post('/accounting/invoices', data),
  getTaxes: () => api.get('/accounting/taxes'),
  getTrialBalance: (startDate?: string, endDate?: string) => api.get('/accounting/reports/trial-balance', { params: { startDate, endDate } }),
  getIncomeStatement: (startDate?: string, endDate?: string) => api.get('/accounting/reports/income-statement', { params: { startDate, endDate } }),
  getBalanceSheet: (asOfDate?: string) => api.get('/accounting/reports/balance-sheet', { params: { asOfDate } }),
  getManagementAccounts: (startDate?: string, endDate?: string) => api.get('/accounting/reports/management', { params: { startDate, endDate } }),
  getCOA: () => api.get('/accounting/coa'),
  createCOA: (data: any) => api.post('/accounting/coa', data),
  updateCOA: (id: number, data: any) => api.patch(`/accounting/coa/${id}`, data),
  deleteCOA: (id: number) => api.delete(`/accounting/coa/${id}`),
  postJournal: (data: any) => api.post('/accounting/journal', data),
  
  // Enterprise Finance
  getBankAccounts: () => api.get('/accounting/bank-accounts'),
  addBankAccount: (data: any) => api.post('/accounting/bank-accounts', data),
  getBankTransactions: () => api.get('/accounting/bank-transactions'),
  importBankTransaction: (data: any) => api.post('/accounting/bank-transactions', data),
  
  getBills: () => api.get('/accounting/bills'),
  recordBill: (data: any) => api.post('/accounting/bills', data),
  
  recordPayment: (data: any) => api.post('/accounting/payments', data),
  getCashFlow: (startDate?: string, endDate?: string) => api.get('/accounting/reports/cash-flow', { params: { startDate, endDate } }),
  reconcileBankTransaction: (id: number, matched_ledger_id?: number) => api.patch(`/accounting/bank-transactions/${id}/reconcile`, { matched_ledger_id }),
  getLedgerEntries: (accountId: number | string, startDate?: string, endDate?: string) => api.get(`/accounting/ledger-entries/${accountId}`, { params: { startDate, endDate } }),
  deleteJournal: (id: number | string, reason?: string) => api.delete(`/accounting/journal/${id}`, { data: { reason } }),
  getJournalDetails: (id: number | string) => api.get(`/accounting/journal/${id}`),
  deleteBankTransaction: (id: number | string) => api.delete(`/accounting/bank-transactions/${id}`),
  updateBankTransaction: (id: number | string, data: any) => api.patch(`/accounting/bank-transactions/${id}`, data),
  getFiscalYear: () => api.get('/accounting/settings/fiscal-year'),
  updateFiscalYear: (data: any) => api.post('/accounting/settings/fiscal-year', data),
  postOpeningBalances: (data: any) => api.post('/accounting/opening-balances', data),
  getOpeningBalances: (date?: string) => api.get('/accounting/opening-balances', { params: { date } }),
  updateJournal: (id: number | string, data: any) => api.put(`/accounting/journal/${id}`, data),
  voidInvoice: (id: string, data: { date?: string; reason?: string }) => api.post(`/accounting/invoices/${id}/void`, data),
  getCreditNotes: (invoiceId: string) => api.get(`/accounting/invoices/${invoiceId}/credit-notes`),
  createCreditNote: (invoiceId: string, data: { date?: string; amount: number; reason?: string }) => api.post(`/accounting/invoices/${invoiceId}/credit-notes`, data),
  voidBill: (id: number | string, data: { date?: string; reason?: string }) => api.post(`/accounting/bills/${id}/void`, data),
  getPayments: (params?: { target_type?: string; target_id?: string; include_void?: number }) => api.get('/accounting/payments', { params }),
  getApprovals: (status?: string) => api.get('/accounting/approvals', { params: { status } }),
  getApprovalCount: () => api.get('/accounting/approvals/count'),
  requestApproval: (data: { entity_type: 'bill' | 'invoice' | 'payment' | 'journal'; entity_id: string | number; action: 'correct' | 'void' | 'credit_note'; reason: string; proposed?: any }) =>
    api.post('/accounting/approvals', data),
  approveRequest: (id: number, comment?: string) => api.post(`/accounting/approvals/${id}/approve`, { comment }),
  rejectRequest: (id: number, comment: string) => api.post(`/accounting/approvals/${id}/reject`, { comment }),
  cancelRequest: (id: number) => api.post(`/accounting/approvals/${id}/cancel`),
  getApprovalSettings: () => api.get('/accounting/settings/approvals'),
  updateApprovalSettings: (bill_approval_threshold: number | null) => api.put('/accounting/settings/approvals', { bill_approval_threshold }),
  updateBankAccount: (id: number | string, data: any) => api.patch(`/accounting/bank-accounts/${id}`, data),
  importBankStatement: (data: { bank_account_id: number; rows: any[] }) => api.post('/accounting/bank-transactions/import', data),
  getBankMatchCandidates: (id: number | string) => api.get(`/accounting/bank-transactions/${id}/candidates`),
  autoMatchBank: (bank_account_id?: number | string) => api.post('/accounting/bank-transactions/auto-match', { bank_account_id }),
  unreconcileBankTransaction: (id: number | string) => api.post(`/accounting/bank-transactions/${id}/unreconcile`),
  postBankTransaction: (id: number | string, data: { account_id: number; description?: string }) => api.post(`/accounting/bank-transactions/${id}/post`, data),
  getArAging: (asOfDate?: string) => api.get('/accounting/reports/ar-aging', { params: { asOfDate } }),
  getClients: () => api.get('/accounting/clients'),
  getClientStatement: (client: string, startDate?: string, endDate?: string) => api.get('/accounting/clients/statement', { params: { client, startDate, endDate } }),
  getVatReport: (startDate?: string, endDate?: string) => api.get('/accounting/reports/vat', { params: { startDate, endDate } }),
  getWhtReport: (startDate?: string, endDate?: string) => api.get('/accounting/reports/wht', { params: { startDate, endDate } }),
  getTaxSettings: () => api.get('/accounting/settings/tax'),
  updateTaxSettings: (data: any) => api.put('/accounting/settings/tax', data),
  getPeriodLock: () => api.get('/accounting/settings/period-lock'),
  updatePeriodLock: (closed_through: string | null) => api.put('/accounting/settings/period-lock', { closed_through }),
  getRecurring: () => api.get('/accounting/recurring'),
  createRecurring: (data: any) => api.post('/accounting/recurring', data),
  updateRecurring: (id: number, data: any) => api.put(`/accounting/recurring/${id}`, data),
  deleteRecurring: (id: number) => api.delete(`/accounting/recurring/${id}`),
  generateRecurring: () => api.post('/accounting/recurring/generate'),
  getAttachments: (entity_type: AttachmentEntity, entity_id: string | number) => api.get('/accounting/attachments', { params: { entity_type, entity_id } }),
  uploadAttachment: (entity_type: AttachmentEntity, entity_id: string | number, file: File) =>
    api.post('/accounting/attachments', file, {
      params: { entity_type, entity_id, file_name: file.name },
      headers: { 'Content-Type': file.type && file.type !== 'application/json' ? file.type : 'application/octet-stream' },
    }),
  downloadAttachment: (id: number) => api.get(`/accounting/attachments/${id}/download`, { responseType: 'blob' }),
  deleteAttachment: (id: number) => api.delete(`/accounting/attachments/${id}`),
};

export type AttachmentEntity = 'invoice' | 'bill' | 'journal';

export interface LedgerQuery {
  q?: string;
  startDate?: string;
  endDate?: string;
  type?: string;
  accountId?: string | number;
  page?: number;
  pageSize?: number;
}

export const projectsApi = {
  getProjects: () => api.get('/projects'),
  createProject: (data: any) => api.post('/projects', data),
  updateProject: (id: string, data: any) => api.patch(`/projects/${id}`, data),
  getJobCosting: (id: string) => api.get(`/projects/${id}/job-costing`),
  getWIPReport: () => api.get('/projects/reports/wip'),
  getCostAccounts: () => api.get('/projects/cost-accounts'),
  saveBudgetLines: (id: string, lines: Array<{ account_id: number; amount: number; notes?: string }>) =>
    api.put(`/projects/${id}/budget-lines`, { lines }),
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
  createTask: (data: { project_id: string; name: string; description?: string; assigned_to?: string; due_date?: string }) =>
    api.post('/field-ops/tasks', data),
  editTask: (id: number | string, data: any) => api.patch(`/field-ops/tasks/${id}`, data),
  deleteTask: (id: number | string) => api.delete(`/field-ops/tasks/${id}`),
  reviewReport: (id: number | string, status: 'Approved' | 'Rejected') => api.patch(`/field-ops/reports/${id}`, { status }),
  uploadReportPhoto: (reportId: number | string, file: Blob, fileName?: string) =>
    api.post(`/field-ops/reports/${reportId}/photos`, file, {
      headers: { 'Content-Type': file.type || 'image/jpeg', ...(fileName ? { 'X-File-Name': encodeURIComponent(fileName) } : {}) },
    }),
  getReportPhotos: (reportId: number | string) => api.get(`/field-ops/reports/${reportId}/photos`),
  getPhotoBlob: (photoId: number | string) => api.get(`/field-ops/photos/${photoId}`, { responseType: 'blob' }),
};

export const assetsApi = {
  getEquipment: () => api.get('/assets'),
  addEquipment: (data: any) => api.post('/assets', data),
  updateEquipment: (id: string, data: any) => api.patch(`/assets/${id}`, data),
  getAllocations: () => api.get('/assets/allocations'),
  allocateEquipment: (data: any) => api.post('/assets/allocations', data),
  depreciate: (periodEndDate?: string) => api.post('/assets/depreciate', { periodEndDate }),
  dispose: (id: string, data: { disposal_date: string; disposal_value: number; proceeds_account_id?: number | null }) =>
    api.post(`/assets/dispose/${id}`, data),
  returnAllocation: (id: number, end_date: string) => api.post(`/assets/allocations/${id}/return`, { end_date }),
  getDepreciationRuns: () => api.get('/assets/depreciation-runs'),
  runDepreciation: (period: string) => api.post('/assets/depreciation-runs', { period }),
  undoDepreciationRun: (id: number) => api.delete(`/assets/depreciation-runs/${id}`),
  getAccountMappings: () => api.get('/assets/account-mappings'),
  saveAccountMappings: (data: any) => api.put('/assets/account-mappings', data),
};

export const dashboardApi = {
  getSummary: () => api.get('/dashboard'),
};

export type CategoryType = 'expense' | 'supplier' | 'inventory' | 'asset' | 'service';

export const catalogApi = {
  getCategories: (params?: { type?: CategoryType; active?: boolean }) =>
    api.get('/catalog/categories', { params: { type: params?.type, active: params?.active ? 'true' : undefined } }),
  createCategory: (data: any) => api.post('/catalog/categories', data),
  updateCategory: (id: number, data: any) => api.patch(`/catalog/categories/${id}`, data),
  deleteCategory: (id: number) => api.delete(`/catalog/categories/${id}`),
  getServices: (params?: { active?: boolean }) =>
    api.get('/catalog/services', { params: { active: params?.active ? 'true' : undefined } }),
  createService: (data: any) => api.post('/catalog/services', data),
  updateService: (id: number, data: any) => api.patch(`/catalog/services/${id}`, data),
  deleteService: (id: number) => api.delete(`/catalog/services/${id}`),
};

export const settingsApi = {
  getSettings: () => api.get('/settings'),
  updateSetting: (key: string, value: string) => api.post('/settings', { key, value }),
  getUsers: () => api.get('/settings/users'),
  addUser: (data: any) => api.post('/settings/users', data),
  updateUser: (id: number, data: { role?: string; phone?: string; email?: string; employee_id?: string }) => api.patch(`/settings/users/${id}`, data),
  deactivateUser: (id: number) => api.post(`/settings/users/${id}/deactivate`),
  reactivateUser: (id: number) => api.post(`/settings/users/${id}/reactivate`),
  resetUserPassword: (id: number) => api.post(`/settings/users/${id}/reset-password`),
  getSecuritySummary: () => api.get('/settings/users/security-summary'),
  getSMSConfig: () => api.get('/settings/sms'),
  updateSMSConfig: (data: any) => api.post('/settings/sms', data),
  getSMSStatus: () => api.get('/settings/sms/status'),
  sendTestSMS: (phone: string) => api.post('/settings/sms/test', { phone }),
};
