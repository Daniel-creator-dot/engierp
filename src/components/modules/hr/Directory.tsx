import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download, Eye, FileSpreadsheet, Loader2, Pencil, Plus, Search, ShieldAlert, Upload } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../ui/card';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Badge } from '../../ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/table';
import { toast } from 'sonner';
import { hrApi } from '../../../lib/api';
import { useAuth } from '../../../contexts/AuthContext';
import { ageInYears, daysUntil, formatDate, serviceLength } from '../../../lib/dates';
import { isValidSsnit, normalisePayrollConfig } from '../../../lib/payrollCalc';
import type { Employee, Setting } from './types';
import EmployeeForm from './EmployeeForm';
import BulkImport from './BulkImport';
import {
  EMPLOYMENT_TYPES, FIXED_TERM_TYPES, HR_ADMIN_ROLES, currencySymbol, downloadCsv, downloadWorkbook, errorMessage, getSetting, money,
} from './utils';

const EXPIRY_WARNING_DAYS = 30;
const ALL = 'all';

const statusBadge = (status: string) =>
  status === 'active' ? 'bg-green-100 text-green-700' : status === 'terminated' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700';

const describeDays = (days: number) =>
  days < 0 ? `${Math.abs(days)} day${days === -1 ? '' : 's'} ago` : days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`;

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1 ${className}`}>
      <p className="text-[10px] font-bold uppercase text-[#8E9299]">{label}</p>
      <div className="font-medium">{children}</div>
    </div>
  );
}

export default function Directory({ settings }: { settings: Setting[] }) {
  const { user } = useAuth();
  const canEdit = HR_ADMIN_ROLES.includes(user?.role || '');
  const symbol = currencySymbol(settings);
  const defaultLeaveDays = normalisePayrollConfig(getSetting(settings, 'payroll_config')).annual_leave_days;

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState(ALL);
  const [status, setStatus] = useState('current');
  const [employmentType, setEmploymentType] = useState(ALL);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [viewing, setViewing] = useState<Employee | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [showCompliance, setShowCompliance] = useState(false);

  const load = async () => {
    setIsLoading(true);
    try {
      const res = await hrApi.getEmployees();
      setEmployees(res.data);
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to load employees'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const departments = useMemo(
    () => Array.from(new Set(employees.map(e => e.department).filter(Boolean))).sort(),
    [employees],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter(e => {
      if (status === 'current' ? e.status === 'terminated' : status !== ALL && e.status !== status) return false;
      if (department !== ALL && e.department !== department) return false;
      if (employmentType !== ALL && (e.employment_type || 'Permanent') !== employmentType) return false;
      if (!q) return true;
      return [e.name, e.id, e.role, e.ssnit, e.phone, e.ghana_card].some(v => String(v || '').toLowerCase().includes(q));
    });
  }, [employees, search, department, status, employmentType]);

  const current = employees.filter(e => e.status !== 'terminated');
  const compliance = useMemo(() => current.map(e => {
    const issues: string[] = [];
    if (!e.ssnit) issues.push('No SSNIT number');
    else if (!isValidSsnit(e.ssnit)) issues.push('SSNIT number format looks wrong');
    if (!e.ghana_card) issues.push('No Ghana Card ID');
    if (!e.bank_name || !e.account_number) issues.push('No salary bank account');
    if (e.wage_type === 'Hourly' && Number(e.salary) > 500) issues.push(`Hourly rate of ${money(e.salary, symbol)} looks like a monthly salary`);
    if (!Number(e.salary)) issues.push('No salary or rate');
    return { employee: e, issues };
  }).filter(c => c.issues.length), [employees, symbol]);
  const missingSsnit = current.filter(e => !e.ssnit || !isValidSsnit(e.ssnit)).length;
  const suspiciousRates = current.filter(e => e.wage_type === 'Hourly' && Number(e.salary) > 500).length;

  const dateAlerts = current
    .flatMap(e => {
      const alerts: { employee: Employee; label: string; date: string; days: number }[] = [];
      const contractDays = daysUntil(e.contract_end_date);
      if (e.contract_end_date && contractDays !== null && contractDays <= EXPIRY_WARNING_DAYS) {
        alerts.push({ employee: e, label: 'Contract ends', date: e.contract_end_date, days: contractDays });
      }
      const probationDays = daysUntil(e.probation_end_date);
      if (e.probation_end_date && probationDays !== null && probationDays >= 0 && probationDays <= EXPIRY_WARNING_DAYS) {
        alerts.push({ employee: e, label: 'Probation ends', date: e.probation_end_date, days: probationDays });
      }
      return alerts;
    })
    .sort((a, b) => a.days - b.days);

  const exportRows = () => [
    ['Staff ID', 'Name', 'Role', 'Department', 'Status', 'Employment Type', 'Wage Type', 'Salary / Rate', 'Commenced', 'Exit Date',
      'SSNIT', 'Ghana Card', 'Phone', 'Bank', 'Account Name', 'Account Number', 'Branch', 'Annual Leave Days'],
    ...filtered.map(e => [
      e.id, e.name, e.role, e.department, e.status, e.employment_type || '', e.wage_type || 'Salaried', Number(e.salary) || 0,
      e.joinDate?.slice(0, 10) || '', e.exit_date?.slice(0, 10) || '', e.ssnit || '', e.ghana_card || '', e.phone || '',
      e.bank_name || '', e.account_name || '', e.account_number || '', e.branch || '', e.annual_leave_days ?? defaultLeaveDays,
    ]),
  ];
  const stamp = new Date().toISOString().slice(0, 10);

  const openAdd = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (e: Employee) => { setEditing(e); setFormOpen(true); };

  return (
    <Card className="border-none shadow-sm rounded-2xl overflow-hidden">
      <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-b border-[#F5F5F5] bg-[#F5F5F5]/30">
        <div>
          <CardTitle>Workforce Directory</CardTitle>
          <CardDescription>{current.length} current staff · {employees.length - current.length} former</CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="rounded-xl gap-2" onClick={() => downloadCsv(`Employees_${stamp}.csv`, exportRows())} disabled={!filtered.length}>
            <Download className="w-4 h-4" /> CSV
          </Button>
          <Button variant="outline" className="rounded-xl gap-2" onClick={() => downloadWorkbook(`Employees_${stamp}.xlsx`, [{ name: 'Employees', rows: exportRows() }])} disabled={!filtered.length}>
            <FileSpreadsheet className="w-4 h-4" /> Excel
          </Button>
          {canEdit && (
            <>
              <Button variant="outline" className="rounded-xl gap-2" onClick={() => setImportOpen(true)}><Upload className="w-4 h-4" /> Import</Button>
              <Button className="bg-[#141414] text-white gap-2 rounded-xl" onClick={openAdd}><Plus className="w-4 h-4" /> Add Personnel</Button>
            </>
          )}
        </div>
      </CardHeader>

      {compliance.length > 0 && (
        <div className="mx-4 mt-4 p-4 bg-red-50 border border-red-100 rounded-2xl space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-black uppercase tracking-widest text-red-800 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4" /> Missing compliance data
            </p>
            <Button variant="ghost" size="sm" className="h-7 text-red-800" onClick={() => setShowCompliance(s => !s)}>
              {showCompliance ? 'Hide' : `Show ${compliance.length} employee(s)`}
            </Button>
          </div>
          <p className="text-sm text-red-800">
            {missingSsnit} of {current.length} current staff have no valid SSNIT number, so SSNIT contributions can't be filed for them.
            {suspiciousRates > 0 && ` ${suspiciousRates} hourly employee(s) have rates above ${symbol}500/hour; check these before running payroll.`}
          </p>
          {showCompliance && (
            <div className="max-h-64 overflow-y-auto divide-y divide-red-100">
              {compliance.map(({ employee, issues }) => (
                <div key={employee.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span><span className="font-bold">{employee.name}</span> <span className="text-red-700">· {issues.join(' · ')}</span></span>
                  {canEdit && <Button variant="ghost" size="sm" className="h-7" onClick={() => openEdit(employee)}><Pencil className="w-3.5 h-3.5 mr-1" /> Fix</Button>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {dateAlerts.length > 0 && (
        <div className="mx-4 mt-4 p-4 bg-amber-50 border border-amber-100 rounded-2xl space-y-2">
          <p className="text-xs font-black uppercase tracking-widest text-amber-800 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Upcoming employment dates</p>
          {dateAlerts.map((a, i) => (
            <div key={`${a.employee.id}-${i}`} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span><span className="font-bold">{a.employee.name}</span> <span className="text-amber-800">· {a.label} {formatDate(a.date)}</span></span>
              <Badge className={a.days < 0 ? 'bg-red-100 text-red-700 border-none' : 'bg-amber-100 text-amber-800 border-none'}>{describeDays(a.days)}</Badge>
            </div>
          ))}
        </div>
      )}

      <div className="p-4 flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#8E9299]" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, staff ID, role, SSNIT, phone..." className="pl-9 rounded-xl" />
        </div>
        <Select value={department} onValueChange={setDepartment}>
          <SelectTrigger className="md:w-44 rounded-xl"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All departments</SelectItem>
            {departments.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="md:w-40 rounded-xl"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="current">Current staff</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="on-leave">On leave</SelectItem>
            <SelectItem value="terminated">Terminated</SelectItem>
            <SelectItem value={ALL}>Everyone</SelectItem>
          </SelectContent>
        </Select>
        <Select value={employmentType} onValueChange={setEmploymentType}>
          <SelectTrigger className="md:w-44 rounded-xl"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All employment types</SelectItem>
            {EMPLOYMENT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <CardContent className="p-0">
        {isLoading ? (
          <div className="flex items-center justify-center h-40"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-[#F5F5F5]/50">
                <TableHead>Staff ID</TableHead><TableHead>Name</TableHead><TableHead>Department</TableHead>
                <TableHead>Commenced</TableHead><TableHead>SSNIT</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center py-10 text-[#8E9299]">No employees match these filters.</TableCell></TableRow>
              )}
              {filtered.map(e => (
                <TableRow key={e.id} className="hover:bg-blue-50/30">
                  <TableCell className="font-mono text-xs font-bold">{e.id}</TableCell>
                  <TableCell>
                    <div className="font-bold">{e.name}</div>
                    <div className="text-[10px] text-slate-500 uppercase">{e.role} · {e.wage_type === 'Hourly' ? 'Hourly wage' : 'Fixed salary'}</div>
                  </TableCell>
                  <TableCell className="font-medium text-[#8E9299]">{e.department}</TableCell>
                  <TableCell>
                    <div className="text-sm font-medium">{formatDate(e.joinDate)}</div>
                    <div className="text-[10px] text-slate-500 uppercase">{serviceLength(e.joinDate, e.exit_date)}{e.employment_type ? ` · ${e.employment_type}` : ''}</div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {e.ssnit ? (isValidSsnit(e.ssnit) ? e.ssnit : <span className="text-amber-700">{e.ssnit}</span>) : <span className="text-red-600 font-sans">Missing</span>}
                  </TableCell>
                  <TableCell><Badge className={statusBadge(e.status)}>{e.status}</Badge></TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button variant="ghost" size="sm" onClick={() => setViewing(e)} className="h-8 w-8 p-0 rounded-full" title="View profile"><Eye className="w-3.5 h-3.5" /></Button>
                    {canEdit && <Button variant="ghost" size="sm" onClick={() => openEdit(e)} className="h-8 w-8 p-0 rounded-full" title="Edit"><Pencil className="w-3.5 h-3.5" /></Button>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <EmployeeForm
        open={formOpen}
        onOpenChange={setFormOpen}
        employee={editing}
        departments={departments}
        defaultLeaveDays={defaultLeaveDays}
        onSaved={load}
      />
      <BulkImport open={importOpen} onOpenChange={setImportOpen} onImported={load} />

      <Dialog open={Boolean(viewing)} onOpenChange={o => !o && setViewing(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {viewing && (
            <>
              <DialogHeader>
                <DialogTitle>{viewing.name}</DialogTitle>
                <DialogDescription>Staff ID <span className="font-mono font-bold">{viewing.id}</span> · {viewing.role} · {viewing.department}</DialogDescription>
              </DialogHeader>
              <div className="py-4 space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <Field label="Status"><Badge className={statusBadge(viewing.status)}>{viewing.status}</Badge></Field>
                  <Field label="Commencement Date">{formatDate(viewing.joinDate)}</Field>
                  <Field label="Length of Service">{serviceLength(viewing.joinDate, viewing.exit_date)}</Field>
                  <Field label="Employment Type">{viewing.employment_type || 'Not set'}</Field>
                  <Field label="Probation Ends">{formatDate(viewing.probation_end_date, 'Not set')}</Field>
                  {(viewing.contract_end_date || FIXED_TERM_TYPES.includes(viewing.employment_type || '')) && (
                    <Field label="Contract Ends">{formatDate(viewing.contract_end_date, 'Not set')}</Field>
                  )}
                  <Field label="Date of Birth">
                    {formatDate(viewing.date_of_birth, 'Not set')}
                    {ageInYears(viewing.date_of_birth) !== null && <span className="text-xs text-[#8E9299]"> (age {ageInYears(viewing.date_of_birth)})</span>}
                  </Field>
                  {viewing.status === 'terminated' && <Field label="Exit Date"><span className="text-red-600">{formatDate(viewing.exit_date, 'Not recorded')}</span></Field>}
                  <Field label="Annual Leave">{viewing.annual_leave_days ?? defaultLeaveDays} days</Field>
                </div>
                <div className="grid grid-cols-2 gap-4 p-4 bg-[#F5F5F5] rounded-2xl">
                  <Field label={viewing.wage_type === 'Hourly' ? 'Hourly Rate' : 'Monthly Basic Salary'}><span className="text-green-700 font-bold">{money(viewing.salary, symbol)}</span></Field>
                  <Field label="SSNIT Number">
                    {viewing.ssnit || <span className="text-red-600">Missing</span>}
                    {viewing.ssnit && !isValidSsnit(viewing.ssnit) && <span className="block text-xs text-amber-700">Format looks wrong</span>}
                  </Field>
                  <Field label="Ghana Card ID">{viewing.ghana_card || 'N/A'}</Field>
                  <Field label="Phone">{viewing.phone || 'N/A'}</Field>
                </div>
                <div className="space-y-3">
                  <h4 className="text-xs font-black uppercase tracking-widest text-[#141414]">Salary Bank Account</h4>
                  <div className="grid grid-cols-2 gap-4 border-t border-[#F5F5F5] pt-3">
                    <Field label="Bank">{viewing.bank_name || 'Not configured'}</Field>
                    <Field label="Account Name">{viewing.account_name || 'N/A'}</Field>
                    <Field label="Account Number"><span className="font-mono">{viewing.account_number || 'N/A'}</span></Field>
                    <Field label="Branch">{viewing.branch || 'N/A'}</Field>
                  </div>
                </div>
                <Field label="Residential Address"><span className="text-sm font-normal">{viewing.address || 'No address provided.'}</span></Field>
              </div>
              <DialogFooter className="gap-2">
                {canEdit && <Button variant="outline" className="rounded-xl" onClick={() => { const e = viewing; setViewing(null); openEdit(e); }}>Edit</Button>}
                <Button onClick={() => setViewing(null)} className="bg-[#141414] text-white rounded-xl">Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
