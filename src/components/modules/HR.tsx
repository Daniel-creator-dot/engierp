import React, { useState, useEffect } from 'react';
import { 
  Users, 
  Calendar, 
  CreditCard, 
  Plus, 
  Search, 
  Filter,
  MoreVertical,
  Loader2,
  Briefcase,
  FileText,
  CheckCircle2,
  Clock,
  TrendingUp,
  Award,
  XCircle,
  Pencil,
  Printer,
  ChevronDown,
  ChevronRight,
  Eye
} from 'lucide-react';
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle,
  CardDescription
} from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '../ui/table';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from '../ui/dialog';
import { Label } from '../ui/label';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '../ui/select';
import { Badge } from '../ui/badge';
import { Checkbox } from '../ui/checkbox';
import { toast } from 'sonner';
import { hrApi, settingsApi } from '../../lib/api';
import { Employee, LeaveRequest, PayrollRecord } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { GHANA_BANKS } from '../../lib/constants';

interface HRProps {
  activeSub?: string;
}

export default function HR({ activeSub = 'hr-directory' }: HRProps) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [payrollEntries, setPayrollEntries] = useState<PayrollRecord[]>([]);
  const [appraisals, setAppraisals] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { user } = useAuth();
  
  const [isAddEmployeeOpen, setIsAddEmployeeOpen] = useState(false);
  const [isEditEmployeeOpen, setIsEditEmployeeOpen] = useState(false);
  const [isViewEmployeeOpen, setIsViewEmployeeOpen] = useState(false);
  const [isViewLeaveOpen, setIsViewLeaveOpen] = useState(false);
  const [isViewPayrollOpen, setIsViewPayrollOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [selectedLeave, setSelectedLeave] = useState<LeaveRequest | null>(null);
  const [selectedPayrollEntry, setSelectedPayrollEntry] = useState<PayrollRecord | null>(null);
  const [isLeaveRequestOpen, setIsLeaveRequestOpen] = useState(false);
  const [isBatchPayrollOpen, setIsBatchPayrollOpen] = useState(false);
  const [isAppraisalOpen, setIsAppraisalOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [companySettings, setCompanySettings] = useState<any[]>([]);
  const [expandedPeriods, setExpandedPeriods] = useState<Record<string, boolean>>({});
  const [newEmployeeWageType, setNewEmployeeWageType] = useState('Salaried');
  const [editEmployeeWageType, setEditEmployeeWageType] = useState('Salaried');
  const [isIndividualPayrollOpen, setIsIndividualPayrollOpen] = useState(false);
  const [selectedBatchEmployees, setSelectedBatchEmployees] = useState<number[]>([]);
  const [payrollData, setPayrollData] = useState<any>({
    base_salary: 0,
    allowances: 0,
    deductions: [] as { type: string, amount: number }[],
    month: new Date().toLocaleString('default', { month: 'long' }),
    year: 2026,
    payment_date: new Date().toISOString().split('T')[0]
  });

  const togglePeriod = (period: string) => {
    setExpandedPeriods(prev => ({ ...prev, [period]: !prev[period] }));
  };

  useEffect(() => {
    fetchData();
  }, [activeSub]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const settingsRes = await settingsApi.getSettings();
      setCompanySettings(settingsRes.data);

      if (activeSub === 'hr-directory') {
        const res = await hrApi.getEmployees();
        setEmployees(res.data);
      } else if (activeSub === 'hr-leave') {
        const res = await hrApi.getLeaveRequests();
        setLeaveRequests(res.data);
      } else if (activeSub === 'hr-payroll') {
        const res = await hrApi.getPayroll();
        setPayrollEntries(res.data);
        const empRes = await hrApi.getEmployees();
        setEmployees(empRes.data);
      } else if (activeSub === 'hr-performance') {
        const [appRes, empRes] = await Promise.all([
          hrApi.getAppraisals(),
          hrApi.getEmployees()
        ]);
        setAppraisals(appRes.data);
        setEmployees(empRes.data);
      }
    } catch (error) {
      toast.error('Failed to load HR data');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    const data = {
      id: `EMP-${Math.floor(100 + Math.random() * 900)}`,
      name: formData.get('name'),
      role: formData.get('role'),
      department: formData.get('department'),
      salary: Number(formData.get('salary')),
      joinDate: new Date().toISOString().split('T')[0],
      status: 'active',
      ssnit: formData.get('ssnit'),
      ghana_card: formData.get('ghana_card'),
      phone: formData.get('phone'),
      address: formData.get('address'),
      bank_name: formData.get('bank_name'),
      account_name: formData.get('account_name'),
      account_number: formData.get('account_number'),
      branch: formData.get('branch'),
      wage_type: formData.get('wage_type')
    };
    try {
      await hrApi.addEmployee(data);
      toast.success('Employee registered successfully');
      setIsAddEmployeeOpen(false);
      setNewEmployeeWageType('Salaried'); // Reset state
      fetchData();
    } catch (error) {
      toast.error('Failed to add employee');
    }
  };

  const handleEditEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmployee) return;
    const formData = new FormData(e.target as HTMLFormElement);
    const data = {
      name: formData.get('name'),
      role: formData.get('role'),
      department: formData.get('department'),
      salary: Number(formData.get('salary')),
      status: formData.get('status'),
      ssnit: formData.get('ssnit'),
      ghana_card: formData.get('ghana_card'),
      phone: formData.get('phone'),
      address: formData.get('address'),
      bank_name: formData.get('bank_name'),
      account_name: formData.get('account_name'),
      account_number: formData.get('account_number'),
      branch: formData.get('branch'),
      wage_type: formData.get('wage_type')
    };
    try {
      await hrApi.updateEmployee(selectedEmployee.id, data);
      toast.success('Employee record updated');
      setIsEditEmployeeOpen(false);
      fetchData();
    } catch (error) {
      toast.error('Failed to update employee');
    }
  };

  const handleBatchPayroll = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);
    const formData = new FormData(e.target as HTMLFormElement);
    const data = {
      month: formData.get('month') as string,
      year: Number(formData.get('year')),
      payment_date: formData.get('payment_date') as string,
      employee_ids: selectedBatchEmployees
    };
    try {
      const res = await hrApi.batchProcessPayroll(data);
      toast.success(res.data.message);
      setIsBatchPayrollOpen(false);
      fetchData();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to process bulk payroll');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleApprovePayroll = async (id: number, status: string) => {
    try {
      await hrApi.approvePayroll(id, status);
      toast.success(`Payroll entry ${status.toLowerCase()}`);
      fetchData();
    } catch (error) {
      toast.error('Failed to update payroll status');
    }
  };

  const handleApproveBatchPayroll = async (month: string, year: number) => {
    try {
      const res = await hrApi.approveBatchPayroll({ month, year });
      toast.success(res.data.message);
      fetchData();
    } catch (error) {
      toast.error('Failed to approve batch payroll');
    }
  };

  const handlePostAppraisal = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    const data = {
      employee_id: formData.get('employee_id'),
      year: Number(formData.get('year')),
      period: formData.get('period'),
      score: Number(formData.get('score')),
      feedback: formData.get('feedback'),
      status: 'Approved'
    };

    try {
      await hrApi.submitAppraisal(data);
      toast.success('Performance review recorded');
      setIsAppraisalOpen(false);
      fetchData();
    } catch (error) {
      toast.error('Failed to save appraisal');
    }
  };

  const handleSubmitLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    const data = {
      type: formData.get('type'),
      startDate: formData.get('startDate'),
      endDate: formData.get('endDate'),
      reason: formData.get('reason')
    };

    try {
      await hrApi.submitLeaveRequest(data);
      toast.success('Leave request submitted for review');
      setIsLeaveRequestOpen(false);
      fetchData();
    } catch (error) {
      toast.error('Failed to submit leave request');
    }
  };

  const handleUpdateLeaveStatus = async (id: number, status: string) => {
    try {
      await hrApi.updateLeaveStatus(id, status);
      toast.success(`Request ${status}`);
      fetchData();
    } catch (error) {
      toast.error('Failed to update request');
    }
  };

  const handleIndividualPayroll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmployee) return;
    
    const totalDeductions = payrollData.deductions.reduce((sum: number, d: any) => sum + Number(d.amount), 0);
    
    try {
      await hrApi.processPayroll({
        employee_id: selectedEmployee.id,
        month: payrollData.month,
        year: payrollData.year,
        payment_date: payrollData.payment_date,
        base_salary: payrollData.base_salary,
        allowances: payrollData.allowances,
        deductions: totalDeductions,
        detailed_deductions: payrollData.deductions
      });
      toast.success(`Payroll processed for ${selectedEmployee.name}`);
      setIsIndividualPayrollOpen(false);
      fetchData();
    } catch (error) {
      toast.error('Failed to process payroll');
    }
  };

  const handlePrintDocument = (title: string, content: string) => {
    const getSetting = (key: string) => companySettings.find((s: any) => s.key === key)?.value || '';
    const logo = getSetting('company_logo');
    const signature = getSetting('company_signature');
    const currSym = getSetting('currency') === 'USD' ? '$' : 'GH₵';
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    printWindow.document.write(`
      <html>
        <head>
          <title>${title}</title>
          <style>
            body { font-family: 'Inter', sans-serif; padding: 40px; color: #141414; line-height: 1.5; }
            .header { border-bottom: 2px solid #141414; padding-bottom: 20px; margin-bottom: 40px; display: flex; justify-content: space-between; align-items: center; }
            .logo { max-height: 60px; max-width: 200px; }
            .footer { margin-top: 60px; border-top: 1px solid #E4E3E0; padding-top: 20px; display: flex; justify-content: space-between; }
            .signature { max-height: 60px; }
            .branding-banner { display: flex; flex-direction: column; }
            .address-block { font-size: 0.8rem; color: #8E9299; margin-top: 4px; }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="branding-banner">
              ${logo ? `<img src="${logo}" class="logo" />` : `<h1>${getSetting('company_name') || 'ENGINEERING ERP'}</h1>`}
              <div class="address-block">${getSetting('company_address') || ''}</div>
            </div>
            <div style="text-align: right">
              <h2>${title}</h2>
              <p>Generated: ${new Date().toLocaleDateString()}</p>
            </div>
          </div>
          ${content}
          <div class="footer">
            <div>
              <p>Authorized Signature</p>
              ${signature ? `<img src="${signature}" class="signature" />` : '<div style="height: 60px; width: 200px; border-bottom: 1px solid #000;"></div>'}
            </div>
            <div style="text-align: right; color: #8E9299; font-size: 0.75rem;">
              <p>Digital ERP Hash: ${Math.random().toString(36).substring(7).toUpperCase()}</p>
            </div>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-[#141414]" />
      </div>
    );
  }

  const renderContent = () => {
    switch (activeSub) {
      case 'hr-directory':
        return (
          <Card className="border-none shadow-sm rounded-2xl overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between border-b border-[#F5F5F5] bg-[#F5F5F5]/30">
              <div><CardTitle>Workforce Directory</CardTitle></div>
              {(user?.role === 'admin' || user?.role === 'hr') && (
                <Dialog open={isAddEmployeeOpen} onOpenChange={setIsAddEmployeeOpen}>
                  <DialogTrigger asChild><Button className="bg-[#141414] text-white gap-2 rounded-xl"><Plus className="w-4 h-4" /> Add Personnel</Button></DialogTrigger>
                <DialogContent>
                  <form onSubmit={handleAddEmployee}>
                    <DialogHeader><DialogTitle>Personnel Onboarding</DialogTitle></DialogHeader>
                    <div className="p-4 space-y-4">
                      <div className="grid gap-2"><Label>Full Name</Label><Input name="name" required /></div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2"><Label>Primary Role</Label><Input name="role" required /></div>
                        <div className="grid gap-2"><Label>Department</Label><Input name="department" required /></div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                          <Label>Wage Type</Label>
                          <Select name="wage_type" value={newEmployeeWageType} onValueChange={setNewEmployeeWageType}>
                            <SelectTrigger className="bg-white border-slate-200 rounded-xl"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Salaried">Salaried</SelectItem>
                              <SelectItem value="Hourly">Hourly</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid gap-2"><Label>{newEmployeeWageType === 'Hourly' ? 'Hourly Rate (GH₵)' : 'Monthly Gross Salary (GH₵)'}</Label><Input name="salary" type="number" required /></div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2"><Label>Phone Number</Label><Input name="phone" placeholder="+233..." /></div>
                        <div className="grid gap-2"><Label>SSNIT Number</Label><Input name="ssnit" placeholder="E123..." /></div>
                      </div>
                      <div className="grid gap-2"><Label>Ghana Card ID</Label><Input name="ghana_card" placeholder="GHA-7..." /></div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                          <Label>Bank Name</Label>
                          <Select name="bank_name" key={isAddEmployeeOpen ? 'new' : 'none'}>
                            <SelectTrigger className="bg-white border-slate-200 rounded-xl">
                              <SelectValue placeholder="Select bank..." />
                            </SelectTrigger>
                            <SelectContent>
                              {GHANA_BANKS.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid gap-2"><Label>Account Name</Label><Input name="account_name" placeholder="John Doe..." /></div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2"><Label>Account Number</Label><Input name="account_number" placeholder="144..." /></div>
                        <div className="grid gap-2"><Label>Branch</Label><Input name="branch" placeholder="Accra Central..." /></div>
                      </div>
                      <div className="grid gap-2"><Label>Residential Address</Label><Textarea name="address" placeholder="Street name, City..." /></div>
                    </div>
                    <DialogFooter><Button type="submit" className="bg-[#141414] text-white w-full rounded-xl">Register Staff</Button></DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
              )}
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow className="bg-[#F5F5F5]/50"><TableHead>Staff ID</TableHead><TableHead>Name</TableHead><TableHead>Department</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
                <TableBody>
                  {employees.map(e => (
                    <TableRow key={e.id} className="hover:bg-blue-50/30">
                      <TableCell className="font-mono text-xs font-bold">{e.id}</TableCell>
                      <TableCell>
                        <div className="font-bold">{e.name}</div>
                        <div className="text-[10px] text-slate-500 uppercase flex items-center gap-1">
                          {e.wage_type === 'Hourly' ? 'HOURLY WAGE' : 'FIXED SALARY'}
                        </div>
                      </TableCell>
                      <TableCell className="font-medium text-[#8E9299]">{e.department}</TableCell>
                      <TableCell><Badge className={e.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}>{e.status}</Badge></TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button variant="ghost" size="sm" onClick={() => { 
                          setSelectedEmployee(e); 
                          setPayrollData({
                            base_salary: e.salary,
                            allowances: 0,
                            deductions: [],
                            month: new Date().toLocaleString('default', { month: 'long' }),
                            year: 2026,
                            payment_date: new Date().toISOString().split('T')[0],
                            days_worked: 0,
                            hours_per_day: 10
                          });
                          setIsIndividualPayrollOpen(true); 
                        }} className="h-8 px-2 rounded-xl hover:bg-green-50 text-green-600 gap-1 mr-2">
                          <CreditCard className="w-3.5 h-3.5" /> Pay
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => { setSelectedEmployee(e); setIsViewEmployeeOpen(true); }} className="h-8 w-8 p-0 rounded-full hover:bg-white hover:shadow-sm">
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                        {(user?.role === 'admin' || user?.role === 'hr') && (
                          <Button variant="ghost" size="sm" onClick={() => { setSelectedEmployee(e); setIsEditEmployeeOpen(true); }} className="h-8 w-8 p-0 rounded-full hover:bg-white hover:shadow-sm">
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>

            <Dialog open={isViewEmployeeOpen} onOpenChange={setIsViewEmployeeOpen}>
              <DialogContent className="max-w-2xl">
                {selectedEmployee && (
                  <div>
                    <DialogHeader>
                      <DialogTitle>Personnel Profile: {selectedEmployee.name}</DialogTitle>
                      <DialogDescription>Comprehensive employee record and compliance data.</DialogDescription>
                    </DialogHeader>
                    <div className="py-6 space-y-6">
                      <div className="grid grid-cols-2 gap-8">
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold uppercase text-[#8E9299]">Full Name</p>
                          <p className="font-bold text-lg">{selectedEmployee.name}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold uppercase text-[#8E9299]">Employee ID</p>
                          <p className="font-mono font-bold text-blue-600">{selectedEmployee.id}</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-8">
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold uppercase text-[#8E9299]">Role</p>
                          <p className="font-medium">{selectedEmployee.role}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold uppercase text-[#8E9299]">Department</p>
                          <p className="font-medium">{selectedEmployee.department}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold uppercase text-[#8E9299]">Status</p>
                          <Badge className={selectedEmployee.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}>
                            {selectedEmployee.status}
                          </Badge>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-8 p-4 bg-[#F5F5F5] rounded-2xl">
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold uppercase text-[#8E9299]">Phone</p>
                          <p className="font-medium">{selectedEmployee.phone || 'N/A'}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold uppercase text-[#8E9299]">SSNIT Number</p>
                          <p className="font-medium">{selectedEmployee.ssnit || 'N/A'}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold uppercase text-[#8E9299]">Ghana Card ID</p>
                          <p className="font-medium">{selectedEmployee.ghana_card || 'N/A'}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold uppercase text-[#8E9299]">Gross Salary</p>
                          <p className="font-bold text-green-600">GH₵{Number(selectedEmployee.salary).toLocaleString()}</p>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <h4 className="text-xs font-black uppercase tracking-widest text-[#141414]">Banking Details</h4>
                        <div className="grid grid-cols-2 gap-4 border-t border-[#F5F5F5] pt-3">
                          <div>
                            <p className="text-[10px] font-bold uppercase text-[#8E9299]">Bank</p>
                            <p className="font-medium">{selectedEmployee.bank_name || 'Not Configured'}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-bold uppercase text-[#8E9299]">Account Name</p>
                            <p className="font-medium">{selectedEmployee.account_name || 'N/A'}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-bold uppercase text-[#8E9299]">Account Number</p>
                            <p className="font-mono font-bold">{selectedEmployee.account_number || 'N/A'}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-bold uppercase text-[#8E9299]">Branch</p>
                            <p className="font-medium">{selectedEmployee.branch || 'N/A'}</p>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-1">
                        <p className="text-[10px] font-bold uppercase text-[#8E9299]">Residential Address</p>
                        <p className="text-sm">{selectedEmployee.address || 'No address provided.'}</p>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button onClick={() => setIsViewEmployeeOpen(false)} className="bg-[#141414] text-white w-full rounded-xl">Close Profile</Button>
                    </DialogFooter>
                  </div>
                )}
              </DialogContent>
            </Dialog>

            <Dialog open={isEditEmployeeOpen} onOpenChange={setIsEditEmployeeOpen}>
              <DialogContent>
                {selectedEmployee && (
                  <form onSubmit={handleEditEmployee}>
                    <DialogHeader><DialogTitle>Edit Personnel Record</DialogTitle></DialogHeader>
                    <div className="p-4 space-y-4">
                      <div className="grid gap-2"><Label>Full Name</Label><Input name="name" defaultValue={selectedEmployee.name} required /></div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2"><Label>Primary Role</Label><Input name="role" defaultValue={selectedEmployee.role} required /></div>
                        <div className="grid gap-2"><Label>Department</Label><Input name="department" defaultValue={selectedEmployee.department} required /></div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                          <Label>Wage Type</Label>
                          <Select name="wage_type" defaultValue={selectedEmployee.wage_type || 'Salaried'} onValueChange={setEditEmployeeWageType}>
                            <SelectTrigger className="bg-white border-slate-200 rounded-xl"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Salaried">Salaried</SelectItem>
                              <SelectItem value="Hourly">Hourly</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid gap-2"><Label>{(editEmployeeWageType || selectedEmployee.wage_type) === 'Hourly' ? 'Hourly Rate (GH₵)' : 'Monthly Gross Salary (GH₵)'}</Label><Input name="salary" type="number" defaultValue={selectedEmployee.salary} required /></div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2"><Label>Phone Number</Label><Input name="phone" defaultValue={selectedEmployee.phone} /></div>
                        <div className="grid gap-2"><Label>SSNIT Number</Label><Input name="ssnit" defaultValue={selectedEmployee.ssnit} /></div>
                      </div>
                      <div className="grid gap-2"><Label>Ghana Card ID</Label><Input name="ghana_card" defaultValue={selectedEmployee.ghana_card} /></div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                          <Label>Bank Name</Label>
                          <Select name="bank_name" defaultValue={selectedEmployee.bank_name} key={selectedEmployee.id}>
                            <SelectTrigger className="bg-white border-slate-200 rounded-xl">
                              <SelectValue placeholder="Select bank..." />
                            </SelectTrigger>
                            <SelectContent>
                              {GHANA_BANKS.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid gap-2"><Label>Account Name</Label><Input name="account_name" defaultValue={selectedEmployee.account_name} /></div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2"><Label>Account Number</Label><Input name="account_number" defaultValue={selectedEmployee.account_number} /></div>
                        <div className="grid gap-2"><Label>Branch</Label><Input name="branch" defaultValue={selectedEmployee.branch} /></div>
                      </div>
                      <div className="grid gap-2"><Label>Residential Address</Label><Textarea name="address" defaultValue={selectedEmployee.address} /></div>
                      <div className="grid gap-2">
                        <Label>Status</Label>
                        <Select name="status" defaultValue={selectedEmployee.status} key={`${selectedEmployee.id}-status`}>
                          <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="on-leave">On Leave</SelectItem>
                            <SelectItem value="terminated">Terminated</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <DialogFooter><Button type="submit" className="bg-blue-600 text-white w-full rounded-xl font-bold">COMMIT UPDATES</Button></DialogFooter>
                  </form>
                )}
              </DialogContent>
            </Dialog>

            <Dialog open={isIndividualPayrollOpen} onOpenChange={setIsIndividualPayrollOpen}>
              <DialogContent className="max-w-xl">
                {selectedEmployee && (
                  <form onSubmit={handleIndividualPayroll}>
                    <DialogHeader>
                      <DialogTitle>Process Payroll: {selectedEmployee.name}</DialogTitle>
                      <DialogDescription>Enter monthly earnings and detailed deductions.</DialogDescription>
                    </DialogHeader>
                    <div className="p-4 space-y-6">
                      <div className="grid grid-cols-3 gap-4">
                        <div className="grid gap-2"><Label>Month</Label>
                          <Select value={payrollData.month} onValueChange={(v) => setPayrollData({...payrollData, month: v})}>
                            <SelectTrigger className="bg-[#F5F5F5] border-none rounded-xl h-11"><SelectValue /></SelectTrigger>
                            <SelectContent>{['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div className="grid gap-2"><Label>Year</Label><Input type="number" value={payrollData.year} onChange={(e) => setPayrollData({...payrollData, year: Number(e.target.value)})} className="bg-[#F5F5F5] border-none rounded-xl h-11" /></div>
                        <div className="grid gap-2"><Label>Payment Date</Label><Input type="date" value={payrollData.payment_date || ''} onChange={(e) => setPayrollData({...payrollData, payment_date: e.target.value})} className="bg-[#F5F5F5] border-none rounded-xl h-11" required /></div>
                      </div>

                      {selectedEmployee.wage_type === 'Hourly' ? (
                        <div className="grid grid-cols-4 gap-4 p-4 bg-blue-50/50 rounded-2xl border border-blue-100">
                          <div className="grid gap-2"><Label>Days Worked</Label><Input type="number" value={payrollData.days_worked || ''} onChange={(e) => {
                            const days = Number(e.target.value);
                            const hours = days * (payrollData.hours_per_day || 10);
                            setPayrollData({...payrollData, days_worked: days, base_salary: hours * selectedEmployee.salary});
                          }} className="bg-white border-none rounded-xl h-11" placeholder="e.g. 22.7" step="0.1" /></div>
                          <div className="grid gap-2"><Label>Hours/Day</Label><Input type="number" value={payrollData.hours_per_day || ''} onChange={(e) => {
                            const hpday = Number(e.target.value);
                            const hours = (payrollData.days_worked || 0) * hpday;
                            setPayrollData({...payrollData, hours_per_day: hpday, base_salary: hours * selectedEmployee.salary});
                          }} className="bg-white border-none rounded-xl h-11" placeholder="10" step="0.1" /></div>
                          <div className="grid gap-2"><Label>Total Hrs</Label><Input type="number" value={(payrollData.days_worked || 0) * (payrollData.hours_per_day || 10)} readOnly className="bg-blue-100/50 border-none rounded-xl h-11 font-bold text-blue-800" /></div>
                          <div className="grid gap-2"><Label>Gross Pay (Rate: {selectedEmployee.salary})</Label><Input type="number" value={payrollData.base_salary} readOnly className="bg-blue-100/50 border-none rounded-xl h-11 font-bold text-blue-800" /></div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-4">
                          <div className="grid gap-2"><Label>Base Salary (GH₵)</Label><Input type="number" value={payrollData.base_salary} onChange={(e) => setPayrollData({...payrollData, base_salary: Number(e.target.value)})} className="bg-[#F5F5F5] border-none rounded-xl h-11" /></div>
                          <div className="grid gap-2"><Label>Allowances (GH₵)</Label><Input type="number" value={payrollData.allowances} onChange={(e) => setPayrollData({...payrollData, allowances: Number(e.target.value)})} className="bg-[#F5F5F5] border-none rounded-xl h-11" /></div>
                        </div>
                      )}
                      
                      {selectedEmployee.wage_type === 'Hourly' && (
                        <div className="grid grid-cols-2 gap-4">
                           <div className="grid gap-2"><Label>Allowances (GH₵)</Label><Input type="number" value={payrollData.allowances} onChange={(e) => setPayrollData({...payrollData, allowances: Number(e.target.value)})} className="bg-[#F5F5F5] border-none rounded-xl h-11" /></div>
                        </div>
                      )}

                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <Label className="font-bold">Staff Deductions</Label>
                          <Button type="button" variant="outline" size="sm" className="h-7 rounded-lg" onClick={() => setPayrollData({...payrollData, deductions: [...payrollData.deductions, { type: 'Loan', amount: 0 }]})}>
                            <Plus className="w-3 h-3 mr-1" /> Add Item
                          </Button>
                        </div>
                        {payrollData.deductions.map((d: any, i: number) => {
                          const config = companySettings.find(s => s.key === 'payroll_config');
                          const types = config ? JSON.parse(config.value).deduction_types : ['Loan', 'Staff Advance'];
                          return (
                            <div key={i} className="flex gap-2 items-end">
                              <div className="flex-1">
                                <Select value={d.type} onValueChange={(v) => {
                                  const config = companySettings.find(s => s.key === 'payroll_config');
                                  const configObj = config ? JSON.parse(config.value) : { deduction_types: [] };
                                  const deductionDef = configObj.deduction_types.find((dt: any) => dt.name === v);
                                  
                                  let amount = 0;
                                  if (deductionDef) {
                                    if (deductionDef.type === 'percentage') {
                                      amount = (Number(payrollData.base_salary) * Number(deductionDef.value)) / 100;
                                    } else {
                                      amount = Number(deductionDef.value);
                                    }
                                  }

                                  const newD = [...payrollData.deductions];
                                  newD[i].type = v;
                                  newD[i].amount = amount;
                                  setPayrollData({...payrollData, deductions: newD});
                                }}>
                                  <SelectTrigger className="bg-[#F5F5F5] border-none h-11 rounded-xl"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {(companySettings.find(s => s.key === 'payroll_config') 
                                      ? JSON.parse(companySettings.find(s => s.key === 'payroll_config')!.value).deduction_types 
                                      : []).map((t: any) => <SelectItem key={t.name} value={t.name}>{t.name}</SelectItem>)
                                    }
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="w-32"><Input type="number" value={d.amount} onChange={(e) => {
                                const newD = [...payrollData.deductions];
                                newD[i].amount = Number(e.target.value);
                                setPayrollData({...payrollData, deductions: newD});
                              }} placeholder="Amount" className="bg-[#F5F5F5] border-none h-11 rounded-xl" /></div>
                              <Button type="button" variant="ghost" size="sm" className="h-11 w-11 text-red-500 hover:bg-red-50 rounded-xl" onClick={() => setPayrollData({...payrollData, deductions: payrollData.deductions.filter((_: any, idx: number) => idx !== i)})}>×</Button>
                            </div>
                          );
                        })}
                      </div>

                      <div className="p-4 bg-blue-50/50 rounded-2xl flex justify-between items-center text-blue-700 border border-blue-100">
                        <span className="font-bold">Final Net Disbursal:</span>
                        <span className="text-xl font-black tabular-nums">
                          GH₵{(payrollData.base_salary + payrollData.allowances - payrollData.deductions.reduce((s: number, d: any) => s + Number(d.amount), 0)).toLocaleString()}
                        </span>
                      </div>
                    </div>
                    <DialogFooter className="bg-[#F5F5F5]/30 p-6 border-t rounded-b-3xl">
                      <Button type="submit" className="bg-blue-600 text-white w-full rounded-xl font-bold h-11 shadow-lg shadow-blue-500/20">COMMIT PAYROLL DISBURSAL</Button>
                    </DialogFooter>
                  </form>
                )}
              </DialogContent>
            </Dialog>
          </Card>
        );
      case 'hr-leave':
        return (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-bold">Leave Governance</h2>
              <Dialog open={isLeaveRequestOpen} onOpenChange={setIsLeaveRequestOpen}>
                <DialogTrigger asChild><Button className="bg-[#141414] text-white gap-2 rounded-xl"><Plus className="w-4 h-4" /> Request Absence</Button></DialogTrigger>
                <DialogContent>
                  <form onSubmit={handleSubmitLeave}>
                    <DialogHeader><DialogTitle>New Leave Request</DialogTitle></DialogHeader>
                    <div className="p-4 space-y-4">
                      <div className="grid gap-2">
                        <Label>Leave Type</Label>
                        <Select name="type" required>
                          <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue placeholder="Select type..." /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Annual">Annual Leave</SelectItem>
                            <SelectItem value="Sick">Sick Leave</SelectItem>
                            <SelectItem value="Study">Study Leave</SelectItem>
                            <SelectItem value="Maternity">Maternity/Paternity</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2"><Label>Start Date</Label><Input name="startDate" type="date" required /></div>
                        <div className="grid gap-2"><Label>End Date</Label><Input name="endDate" type="date" required /></div>
                      </div>
                      <div className="grid gap-2">
                        <Label>Reason / Logistics</Label>
                        <Textarea name="reason" placeholder="Details for approval..." className="min-h-[100px] bg-[#F5F5F5] border-none rounded-xl" />
                      </div>
                    </div>
                    <DialogFooter><Button type="submit" className="bg-blue-600 text-white w-full rounded-xl font-bold">SUBMIT REQUEST</Button></DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
            <div className="overflow-x-auto rounded-2xl border border-[#F5F5F5] shadow-sm">
              <Table className="bg-white">
                <TableHeader><TableRow className="bg-[#F5F5F5]/50"><TableHead>Staff Member</TableHead><TableHead>Type</TableHead><TableHead>Period</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                <TableBody>
                    {leaveRequests.map(l => (
                      <TableRow key={l.id}>
                        <TableCell className="font-bold">{l.employee_name || l.employee_id}</TableCell>
                        <TableCell><Badge variant="outline" className="rounded-md font-medium text-[10px] uppercase">{l.type}</Badge></TableCell>
                        <TableCell className="text-xs text-[#8E9299]">{l.startDate} → {l.endDate}</TableCell>
                        <TableCell>
                          <Badge className={
                            l.status === 'Approved' ? 'bg-green-100 text-green-700' : 
                            l.status === 'Rejected' ? 'bg-red-100 text-red-700' : 
                            'bg-yellow-100 text-yellow-700'
                          }>
                            {l.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right space-x-2">
                          <Button variant="ghost" size="icon" onClick={() => { setSelectedLeave(l); setIsViewLeaveOpen(true); }} className="h-8 w-8 text-blue-600 hover:bg-blue-50 rounded-full">
                            <Eye className="w-4 h-4" />
                          </Button>
                          {l.status === 'Pending' && user?.role === 'admin' && (
                            <>
                              <Button variant="ghost" size="icon" onClick={() => handleUpdateLeaveStatus(l.id, 'Approved')} className="h-8 w-8 text-green-600 hover:bg-green-50 rounded-full"><CheckCircle2 className="w-4 h-4" /></Button>
                              <Button variant="ghost" size="icon" onClick={() => handleUpdateLeaveStatus(l.id, 'Rejected')} className="h-8 w-8 text-red-600 hover:bg-red-50 rounded-full"><XCircle className="w-4 h-4" /></Button>
                            </>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {leaveRequests.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-12 text-[#8E9299]">No current absence records.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </div>
            </div>
          );
      case 'hr-payroll':
        return (
          <div className="space-y-6">
            <div className="flex justify-end gap-4">
              <Dialog open={isBatchPayrollOpen} onOpenChange={(open) => {
                setIsBatchPayrollOpen(open);
                if (open) {
                  setSelectedBatchEmployees(employees.filter(e => e.status === 'active' && e.wage_type !== 'Hourly').map(e => e.id));
                }
              }}>
                <DialogTrigger asChild><Button variant="outline" className="text-[#141414] border-[#141414] gap-2 rounded-xl h-11"><TrendingUp className="w-4 h-4" /> Batch Process Month</Button></DialogTrigger>
                <DialogContent>
                  <form onSubmit={handleBatchPayroll}>
                    <DialogHeader><DialogTitle>Corporate Bulk Payroll</DialogTitle></DialogHeader>
                    <div className="p-6 grid gap-4">
                      <div className="grid grid-cols-3 gap-4">
                        <div className="grid gap-2">
                          <Label>Month</Label>
                          <Select name="month" required>
                            <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue placeholder="Select month" /></SelectTrigger>
                            <SelectContent>
                              {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map(m => (
                                <SelectItem key={m} value={m}>{m}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid gap-2"><Label>Year</Label><Input name="year" type="number" defaultValue={2026} className="bg-[#F5F5F5] border-none" required /></div>
                        <div className="grid gap-2"><Label>Payment Date</Label><Input name="payment_date" type="date" defaultValue={new Date().toISOString().split('T')[0]} className="bg-[#F5F5F5] border-none" required /></div>
                      </div>
                      
                      <div className="space-y-3 mt-2">
                        <Label>Select Salaried Staff for this run</Label>
                        <div className="max-h-48 overflow-y-auto border border-[#F5F5F5] rounded-xl p-2 space-y-1">
                          <div className="flex items-center space-x-3 p-2 hover:bg-[#F5F5F5] rounded-lg transition-colors">
                             <Checkbox 
                               id="select-all"
                               checked={selectedBatchEmployees.length > 0 && selectedBatchEmployees.length === employees.filter(e => e.status === 'active' && e.wage_type !== 'Hourly').length} 
                               onCheckedChange={(checked) => checked ? setSelectedBatchEmployees(employees.filter(e => e.status === 'active' && e.wage_type !== 'Hourly').map(e => e.id)) : setSelectedBatchEmployees([])} 
                             />
                             <Label htmlFor="select-all" className="font-bold cursor-pointer">Select All Eligible Staff</Label>
                          </div>
                          {employees.filter(e => e.status === 'active' && e.wage_type !== 'Hourly').map(e => (
                             <div key={e.id} className="flex items-center space-x-3 p-2 hover:bg-[#F5F5F5] rounded-lg transition-colors">
                               <Checkbox 
                                 id={`emp-${e.id}`}
                                 checked={selectedBatchEmployees.includes(e.id)} 
                                 onCheckedChange={(checked) => {
                                   if (checked) setSelectedBatchEmployees([...selectedBatchEmployees, e.id]);
                                   else setSelectedBatchEmployees(selectedBatchEmployees.filter(id => id !== e.id));
                                 }} 
                               />
                               <Label htmlFor={`emp-${e.id}`} className="cursor-pointer">{e.name} <span className="text-[#8E9299]">({e.department})</span></Label>
                             </div>
                          ))}
                          {employees.filter(e => e.status === 'active' && e.wage_type !== 'Hourly').length === 0 && (
                            <div className="p-4 text-center text-sm text-[#8E9299]">No eligible salaried staff found.</div>
                          )}
                        </div>
                      </div>
                    </div>
                    <DialogFooter><Button type="submit" className="bg-blue-600 text-white w-full rounded-xl font-bold h-11" disabled={isProcessing}>{isProcessing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null} Execute Compliant Run</Button></DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
            <Card className="border-none shadow-sm overflow-hidden">
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow className="bg-[#F5F5F5]/50"><TableHead>Employee</TableHead><TableHead>Gross</TableHead><TableHead>Deductions</TableHead><TableHead className="text-right">Net Pay (GH₵)</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {Object.entries(
                      payrollEntries.reduce((acc, curr) => {
                        const period = `${curr.month} ${curr.year}`;
                        if (!acc[period]) acc[period] = [];
                        acc[period].push(curr);
                        return acc;
                      }, {} as Record<string, PayrollRecord[]>)
                    ).map(([period, entries]: [string, PayrollRecord[]]) => {
                      const hasPending = entries.some(e => e.status === 'Pending');
                      const [periodMonth, periodYear] = period.split(' ');
                      return (
                      <React.Fragment key={period}>
                        <TableRow className="bg-[#F5F5F5] hover:bg-[#F5F5F5] cursor-pointer" onClick={() => togglePeriod(period)}>
                          <TableCell colSpan={6} className="font-black text-[#141414] uppercase text-xs tracking-wider border-b border-[#E4E3E0] py-4">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                {expandedPeriods[period] ? <ChevronDown className="w-4 h-4 text-[#8E9299]" /> : <ChevronRight className="w-4 h-4 text-[#8E9299]" />}
                                {period} PAYROLL RUN ({entries.length} EMPLOYEES)
                                {hasPending && <Badge className="bg-yellow-100 text-yellow-700 ml-2">PENDING APPROVAL</Badge>}
                              </div>
                              {hasPending && user?.role === 'admin' && (
                                <Button size="sm" className="bg-green-600 text-white rounded-xl h-8 px-4 text-xs font-bold" onClick={(e) => { e.stopPropagation(); handleApproveBatchPayroll(periodMonth, Number(periodYear)); }}>
                                  <CheckCircle2 className="w-3 h-3 mr-1" /> Approve All
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                        {expandedPeriods[period] && entries.map(p => (
                          <TableRow key={p.id}>
                            <TableCell className="font-bold pl-8">{p.name}</TableCell>
                            <TableCell>GH₵{Number(p.base_salary).toLocaleString()}</TableCell>
                            <TableCell className="text-red-500">-GH₵{Number(p.deductions).toLocaleString()}</TableCell>
                            <TableCell className="text-right font-bold text-green-600">GH₵{Number(p.net_pay).toLocaleString()}</TableCell>
                            <TableCell>
                              <Badge className={
                                p.status === 'Paid' ? 'bg-green-100 text-green-700' :
                                p.status === 'Rejected' ? 'bg-red-100 text-red-700' :
                                'bg-yellow-100 text-yellow-700'
                              }>
                                {p.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right space-x-1">
                              {p.status === 'Pending' && user?.role === 'admin' && (
                                <>
                                  <Button variant="ghost" size="icon" onClick={() => handleApprovePayroll(p.id, 'Paid')} className="h-8 w-8 text-green-600 hover:bg-green-50 rounded-full"><CheckCircle2 className="w-4 h-4" /></Button>
                                  <Button variant="ghost" size="icon" onClick={() => handleApprovePayroll(p.id, 'Rejected')} className="h-8 w-8 text-red-600 hover:bg-red-50 rounded-full"><XCircle className="w-4 h-4" /></Button>
                                </>
                              )}
                              <Button variant="ghost" size="sm" className="h-8 w-8 text-blue-600 p-0" onClick={() => { setSelectedPayrollEntry(p); setIsViewPayrollOpen(true); }}>
                                <Eye className="w-4 h-4" />
                              </Button>
                              {p.status === 'Paid' && (
                                <Button variant="ghost" size="sm" className="h-8 w-8 text-blue-600 p-0" onClick={(e) => { e.stopPropagation(); handlePrintDocument(`PAYSLIP - ${p.name}`, `<h3>Employee: ${p.name}</h3><p>Period: ${p.month} ${p.year}</p><p>Gross Salary: GH₵${Number(p.base_salary).toLocaleString()}</p><p>Total Deductions: GH₵${Number(p.deductions).toLocaleString()}</p><h2 style="color: green;">Net Pay: GH₵${Number(p.net_pay).toLocaleString()}</h2>`); }}>
                                  <Printer className="w-4 h-4" />
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </React.Fragment>
                    );
                    })}
                    {payrollEntries.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-10 text-[#8E9299]">No payroll records to display.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <Dialog open={isViewLeaveOpen} onOpenChange={setIsViewLeaveOpen}>
              <DialogContent>
                {selectedLeave && (
                  <div>
                    <DialogHeader>
                      <DialogTitle>Leave Details: {selectedLeave.employee_name}</DialogTitle>
                    </DialogHeader>
                    <div className="py-6 space-y-4">
                      <div className="flex justify-between items-center p-4 bg-[#F5F5F5] rounded-2xl">
                        <div>
                          <p className="text-[10px] font-bold uppercase text-[#8E9299]">Status</p>
                          <Badge className={
                            selectedLeave.status === 'Approved' ? 'bg-green-100 text-green-700' : 
                            selectedLeave.status === 'Rejected' ? 'bg-red-100 text-red-700' : 
                            'bg-yellow-100 text-yellow-700'
                          }>
                            {selectedLeave.status}
                          </Badge>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] font-bold uppercase text-[#8E9299]">Leave Type</p>
                          <p className="font-bold">{selectedLeave.type}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-[10px] font-bold uppercase text-[#8E9299]">Start Date</p>
                          <p className="font-medium">{selectedLeave.startDate}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold uppercase text-[#8E9299]">End Date</p>
                          <p className="font-medium">{selectedLeave.endDate}</p>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <p className="text-[10px] font-bold uppercase text-[#8E9299]">Reason / Logistics</p>
                        <p className="p-4 bg-[#F5F5F5]/50 rounded-xl text-sm italic">“{selectedLeave.reason || 'No reason provided.'}”</p>
                      </div>
                    </div>
                    <DialogFooter><Button onClick={() => setIsViewLeaveOpen(false)} className="bg-[#141414] text-white w-full rounded-xl">Close</Button></DialogFooter>
                  </div>
                )}
              </DialogContent>
            </Dialog>

            <Dialog open={isViewPayrollOpen} onOpenChange={setIsViewPayrollOpen}>
              <DialogContent className="max-w-xl">
                {selectedPayrollEntry && (
                  <div>
                    <DialogHeader>
                      <DialogTitle>Payroll Statement: {selectedPayrollEntry.name}</DialogTitle>
                      <DialogDescription>{selectedPayrollEntry.month} {selectedPayrollEntry.year}</DialogDescription>
                    </DialogHeader>
                    <div className="py-6 space-y-6">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 bg-white border border-[#F5F5F5] rounded-2xl">
                          <p className="text-[10px] font-bold uppercase text-[#8E9299] mb-1">Gross Earnings</p>
                          <p className="text-xl font-black text-[#141414]">GH₵{Number(selectedPayrollEntry.base_salary).toLocaleString()}</p>
                        </div>
                        <div className="p-4 bg-white border border-[#F5F5F5] rounded-2xl text-right">
                          <p className="text-[10px] font-bold uppercase text-[#8E9299] mb-1">Net Disbursal</p>
                          <p className="text-xl font-black text-green-600">GH₵{Number(selectedPayrollEntry.net_pay).toLocaleString()}</p>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <h4 className="text-xs font-black uppercase tracking-widest">Deduction Breakdown</h4>
                        <div className="space-y-2">
                          <div className="flex justify-between items-center text-sm p-3 bg-[#F5F5F5] rounded-xl">
                            <span className="font-bold text-[#141414]">Statutory Deductions (SSNIT/Tax)</span>
                            <span className="font-mono text-red-500">-GH₵{Number(selectedPayrollEntry.deductions).toLocaleString()}</span>
                          </div>
                          {/* Add detailed deductions if available in the future */}
                        </div>
                      </div>
                    </div>
                    <DialogFooter><Button onClick={() => setIsViewPayrollOpen(false)} className="bg-[#141414] text-white w-full rounded-xl">Close Statement</Button></DialogFooter>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </div>
        );
      case 'hr-performance':
        return (
          <div className="space-y-6">
            <div className="flex justify-end">
              <Dialog open={isAppraisalOpen} onOpenChange={setIsAppraisalOpen}>
                <DialogTrigger asChild><Button className="bg-[#141414] text-white gap-2 rounded-xl h-11 px-6"><Award className="w-4 h-4" /> New Performance Review</Button></DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <form onSubmit={handlePostAppraisal}>
                    <DialogHeader><DialogTitle>Personnel Appraisal</DialogTitle></DialogHeader>
                    <div className="p-6 grid gap-6">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                          <Label>Employee</Label>
                          <Select name="employee_id" required>
                            <SelectTrigger className="bg-[#F5F5F5] border-none rounded-xl h-11"><SelectValue placeholder="Target staff..." /></SelectTrigger>
                            <SelectContent>{employees.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="grid gap-2"><Label>Period</Label><Input name="period" placeholder="Q1" required /></div>
                          <div className="grid gap-2"><Label>Year</Label><Input name="year" type="number" defaultValue={2026} required /></div>
                        </div>
                      </div>
                      <div className="grid gap-2">
                        <Label>KPI Score (1-100)</Label>
                        <Input name="score" type="number" min="0" max="100" required className="bg-[#F5F5F5] border-none rounded-xl h-11" />
                      </div>
                      <div className="grid gap-2"><Label>Executive Feedback</Label><Textarea name="feedback" placeholder="Describe performance and development areas..." className="bg-[#F5F5F5] border-none rounded-xl min-h-[120px]" /></div>
                    </div>
                    <DialogFooter className="bg-[#F5F5F5]/30 p-6 border-t"><Button type="submit" className="bg-[#141414] text-white w-full rounded-xl h-11 font-bold">Commit Review</Button></DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
            <div className="grid gap-6 md:grid-cols-2">
              {appraisals.length > 0 ? appraisals.map(a => (
                <Card key={a.id} className="border-none shadow-sm rounded-2xl overflow-hidden group hover:scale-[1.01] transition-all">
                  <CardHeader className="bg-[#F5F5F5]/30 flex flex-row items-center justify-between pb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-white shadow-sm flex items-center justify-center"><Award className="w-5 h-5 text-blue-600" /></div>
                      <div><CardTitle className="text-lg">{a.name}</CardTitle><CardDescription>{a.period} {a.year} Appraisal</CardDescription></div>
                    </div>
                    <div className="text-right"><div className="text-2xl font-black text-blue-600">{a.score}</div><div className="text-[10px] font-bold uppercase text-[#8E9299]">KPI SCORE</div></div>
                  </CardHeader>
                  <CardContent className="p-6">
                    <div className="p-4 bg-[#F5F5F5] rounded-xl text-sm italic text-[#141414]/70">“{a.feedback}”</div>
                  </CardContent>
                </Card>
              )) : <div className="col-span-2 py-12 text-center text-[#8E9299]">No performance reviews recorded yet.</div>}
            </div>
          </div>
        );
      case 'hr-resources':
        const departments = Array.from(new Set(employees.map(e => e.department)));
        return (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {departments.map((dept, i) => {
              const deptEmps = employees.filter(e => e.department === dept);
              const deptPayroll = deptEmps.reduce((s, e) => s + Number(e.salary), 0);
              return (
                <Card key={i} className="border-none shadow-sm rounded-2xl overflow-hidden bg-white">
                  <CardHeader className="bg-blue-50/50 pb-4">
                    <CardTitle className="text-lg flex items-center gap-2"><Briefcase className="w-4 h-4 text-blue-600" /> {dept}</CardTitle>
                    <CardDescription>{deptEmps.length} Active Personnel</CardDescription>
                  </CardHeader>
                  <CardContent className="p-6 space-y-4">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-[#8E9299]">Monthly Fiscal Weight</span>
                      <span className="font-bold text-[#141414]">GH₵{(deptPayroll / 12).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-[#8E9299]">Operational Capacity</span>
                      <Badge className="bg-green-100 text-green-700">OPTIMAL</Badge>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            <Card className="border-dashed border-2 border-[#E4E3E0] shadow-none rounded-2xl flex flex-col items-center justify-center p-8 text-[#8E9299] hover:bg-white hover:border-blue-300 transition-all cursor-not-allowed opacity-50">
              <Plus className="w-8 h-8 mb-2 opacity-20" />
              <p className="text-xs font-bold uppercase tracking-widest">Construct New Dept</p>
            </Card>
          </div>
        );
      default:
        return <div>Resource categorization in progress...</div>;
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[#141414]">Human Resources</h1>
        <p className="text-[#8E9299]">Workforce governance, performance tracking, and compliant payroll.</p>
      </div>
      {renderContent()}
    </div>
  );
}
