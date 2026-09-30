import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, Download, Eye, Loader2, Pencil, Plus, Search, Undo2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/card';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Textarea } from '../../ui/textarea';
import { Badge } from '../../ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui/tabs';
import { hrApi } from '../../../lib/api';
import { workingDaysBetween } from '../../../lib/payrollCalc';
import { formatDate, todayIso } from '../../../lib/dates';
import { useAuth } from '../../../contexts/AuthContext';
import type { LeaveBalance, LeaveRequest } from './types';
import { HR_ADMIN_ROLES, LEAVE_APPROVE_ROLES, LEAVE_TYPES, downloadWorkbook, errorMessage, yearOptions } from './utils';

type LeaveRow = LeaveRequest;
type LeaveStatus = LeaveRequest['status'];
type Decision = 'Approved' | 'Rejected';

const STATUS_FILTERS = ['All', 'Pending', 'Approved', 'Rejected', 'Cancelled'] as const;

const STATUS_BADGE: Record<LeaveStatus, string> = {
  Pending: 'bg-yellow-100 text-yellow-700',
  Approved: 'bg-green-100 text-green-700',
  Rejected: 'bg-red-100 text-red-700',
  Cancelled: 'bg-gray-100 text-gray-600',
};

const isoDay = (value?: string | null) => String(value || '').slice(0, 10);

const requestDays = (l: LeaveRow) =>
  l.days != null ? Number(l.days) : workingDaysBetween(isoDay(l.startDate), isoDay(l.endDate));

const emptyRequest = () => ({ type: 'Annual', startDate: todayIso(), endDate: todayIso(), reason: '' });

function StatusBadge({ status }: { status: LeaveStatus }) {
  return <Badge className={`${STATUS_BADGE[status] || STATUS_BADGE.Pending} border-none`}>{status}</Badge>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase text-[#8E9299]">{label}</p>
      <div className="font-medium">{children}</div>
    </div>
  );
}

export default function Leave() {
  const { user } = useAuth();
  const role = user?.role || '';
  const employeeId = user?.employee_id;
  const isApprover = LEAVE_APPROVE_ROLES.includes(role);
  const isHrAdmin = HR_ADMIN_ROLES.includes(role);
  const currentYear = new Date().getFullYear();

  const [requests, setRequests] = useState<LeaveRow[]>([]);
  const [myBalance, setMyBalance] = useState<LeaveBalance | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>(isApprover ? 'Pending' : 'All');
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('requests');

  const [isRequestOpen, setIsRequestOpen] = useState(false);
  const [form, setForm] = useState(emptyRequest);
  const [previewBalance, setPreviewBalance] = useState<LeaveBalance | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [viewing, setViewing] = useState<LeaveRow | null>(null);
  const [deciding, setDeciding] = useState<{ request: LeaveRow; status: Decision } | null>(null);
  const [decisionNote, setDecisionNote] = useState('');
  const [isDeciding, setIsDeciding] = useState(false);

  const [balanceYear, setBalanceYear] = useState(currentYear);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [isBalancesLoading, setIsBalancesLoading] = useState(false);
  const [balanceSearch, setBalanceSearch] = useState('');
  const [editingBalance, setEditingBalance] = useState<LeaveBalance | null>(null);
  const [balanceForm, setBalanceForm] = useState({ entitlement: '', carried_over: '' });
  const [isSavingBalance, setIsSavingBalance] = useState(false);

  const loadRequests = useCallback(async () => {
    try {
      const res = await hrApi.getLeaveRequests();
      setRequests(Array.isArray(res.data) ? res.data : []);
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to load leave requests'));
    }
  }, []);

  const loadMyBalance = useCallback(async () => {
    if (!employeeId) {
      setMyBalance(null);
      return;
    }
    try {
      const res = await hrApi.getLeaveBalances({ mine: true, year: currentYear });
      setMyBalance(Array.isArray(res.data) && res.data.length ? res.data[0] : null);
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to load your leave balance'));
    }
  }, [employeeId, currentYear]);

  const loadBalances = useCallback(async () => {
    if (!isHrAdmin) return;
    setIsBalancesLoading(true);
    try {
      const res = await hrApi.getLeaveBalances({ year: balanceYear });
      setBalances(Array.isArray(res.data) ? res.data : []);
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to load leave balances'));
    } finally {
      setIsBalancesLoading(false);
    }
  }, [isHrAdmin, balanceYear]);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    Promise.all([loadRequests(), loadMyBalance()]).finally(() => {
      if (active) setIsLoading(false);
    });
    return () => { active = false; };
  }, [loadRequests, loadMyBalance]);

  useEffect(() => {
    if (tab === 'balances') loadBalances();
  }, [tab, loadBalances]);

  const refreshAfterChange = async () => {
    await Promise.all([loadRequests(), loadMyBalance(), tab === 'balances' ? loadBalances() : Promise.resolve()]);
  };

  // The server checks Annual leave against the balance of the year the leave starts in.
  const requestYear = Number(form.startDate.slice(0, 4));
  useEffect(() => {
    if (!isRequestOpen || !employeeId || form.type !== 'Annual' || !Number.isInteger(requestYear) || requestYear < 2000) {
      setPreviewBalance(null);
      return;
    }
    if (requestYear === currentYear) {
      setPreviewBalance(myBalance);
      return;
    }
    let active = true;
    hrApi.getLeaveBalances({ mine: true, year: requestYear })
      .then(res => { if (active) setPreviewBalance(Array.isArray(res.data) && res.data.length ? res.data[0] : null); })
      .catch(() => { if (active) setPreviewBalance(null); });
    return () => { active = false; };
  }, [isRequestOpen, employeeId, form.type, requestYear, currentYear, myBalance]);

  const datesInvalid = Boolean(form.startDate && form.endDate && form.endDate < form.startDate);
  const previewDays = datesInvalid ? 0 : workingDaysBetween(form.startDate, form.endDate);
  const remainingAfter = previewBalance ? previewBalance.remaining_after_pending - previewDays : null;

  const openRequestDialog = () => {
    setForm(emptyRequest());
    setIsRequestOpen(true);
  };

  const handleSubmitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeId) return;
    if (!form.startDate || !form.endDate) return toast.error('Choose the start and end dates');
    if (datesInvalid) return toast.error('End date cannot be before the start date');
    if (previewDays === 0) return toast.error('The selected dates fall on a weekend; choose at least one working day');
    setIsSubmitting(true);
    try {
      await hrApi.submitLeaveRequest({ type: form.type, startDate: form.startDate, endDate: form.endDate, reason: form.reason.trim() });
      toast.success('Leave request submitted');
      setIsRequestOpen(false);
      await refreshAfterChange();
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to submit leave request'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const canDecide = (l: LeaveRow) =>
    isApprover && l.status === 'Pending' && (l.employee_id !== employeeId || role === 'admin');

  const canWithdraw = (l: LeaveRow) => Boolean(employeeId) && l.status === 'Pending' && l.employee_id === employeeId;

  const openDecision = (request: LeaveRow, status: Decision) => {
    setDecisionNote('');
    setDeciding({ request, status });
  };

  const handleDecision = async () => {
    if (!deciding) return;
    setIsDeciding(true);
    try {
      await hrApi.updateLeaveStatus(deciding.request.id, deciding.status, decisionNote.trim() || undefined);
      toast.success(`Leave request ${deciding.status.toLowerCase()}`);
      setDeciding(null);
      await refreshAfterChange();
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to update leave request'));
    } finally {
      setIsDeciding(false);
    }
  };

  const handleWithdraw = async (l: LeaveRow) => {
    if (!window.confirm(`Withdraw your ${l.type} leave request (${formatDate(l.startDate)} to ${formatDate(l.endDate)})?`)) return;
    try {
      await hrApi.cancelLeaveRequest(l.id);
      toast.success('Leave request withdrawn');
      if (viewing?.id === l.id) setViewing(null);
      await refreshAfterChange();
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to withdraw leave request'));
    }
  };

  const openBalanceEdit = (b: LeaveBalance) => {
    setBalanceForm({ entitlement: String(b.entitlement), carried_over: String(b.carried_over) });
    setEditingBalance(b);
  };

  const handleSaveBalance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBalance) return;
    const entitlement = Number(balanceForm.entitlement);
    const carriedOver = Number(balanceForm.carried_over || 0);
    if (balanceForm.entitlement === '' || !(entitlement >= 0 && entitlement <= 60) || !(carriedOver >= 0 && carriedOver <= 60)) {
      return toast.error('Entitlement and carry-over must be between 0 and 60 days');
    }
    setIsSavingBalance(true);
    try {
      await hrApi.updateLeaveBalance(editingBalance.employee_id, { year: balanceYear, entitlement, carried_over: carriedOver });
      toast.success('Leave balance updated');
      setEditingBalance(null);
      await Promise.all([loadBalances(), editingBalance.employee_id === employeeId ? loadMyBalance() : Promise.resolve()]);
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to update leave balance'));
    } finally {
      setIsSavingBalance(false);
    }
  };

  const pendingCount = useMemo(() => requests.filter(r => r.status === 'Pending').length, [requests]);

  const filteredRequests = useMemo(() => {
    const term = search.trim().toLowerCase();
    return requests.filter(r =>
      (statusFilter === 'All' || r.status === statusFilter) &&
      (!isApprover || !term || (r.employee_name || r.employee_id || '').toLowerCase().includes(term)));
  }, [requests, statusFilter, search, isApprover]);

  const filteredBalances = useMemo(() => {
    const term = balanceSearch.trim().toLowerCase();
    return term ? balances.filter(b => (b.name || b.employee_id).toLowerCase().includes(term)) : balances;
  }, [balances, balanceSearch]);

  const exportBalances = () => {
    if (!balances.length) return toast.error('No balances to export');
    downloadWorkbook(`leave-balances-${balanceYear}.xlsx`, [{
      name: `Leave ${balanceYear}`,
      rows: [
        ['Employee ID', 'Name', 'Department', 'Year', 'Entitlement', 'Carried over', 'Used', 'Pending', 'Available', 'Remaining after pending'],
        ...balances.map(b => [b.employee_id, b.name, b.department, b.year, b.entitlement, b.carried_over, b.used, b.pending, b.available, b.remaining_after_pending]),
      ],
    }]);
  };

  const columnCount = isApprover ? 7 : 6;

  const myLeaveCard = employeeId ? (
    <Card className="border-none shadow-sm rounded-2xl">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2"><CalendarDays className="w-4 h-4 text-blue-600" /> My leave</CardTitle>
        <CardDescription>Annual leave for {currentYear}, in working days</CardDescription>
      </CardHeader>
      <CardContent>
        {myBalance ? (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {([
              ['Entitlement', myBalance.entitlement],
              ['Carried over', myBalance.carried_over],
              ['Used', myBalance.used],
              ['Pending', myBalance.pending],
              ['Available', myBalance.available],
            ] as const).map(([label, value]) => (
              <div key={label} className="p-4 bg-[#F5F5F5]/50 rounded-xl">
                <p className="text-[10px] font-bold uppercase text-[#8E9299]">{label}</p>
                <p className={`text-2xl font-black ${label === 'Available' ? 'text-blue-600' : 'text-[#141414]'}`}>{value}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[#8E9299]">{isLoading ? 'Loading balance...' : 'No leave balance found for this year.'}</p>
        )}
      </CardContent>
    </Card>
  ) : (
    <Card className="border-none shadow-sm rounded-2xl">
      <CardContent className="p-6 text-sm text-[#8E9299]">
        Your login is not linked to an employee record, so you cannot request leave. Ask HR to link your account to your employee profile.
      </CardContent>
    </Card>
  );

  const requestsView = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <h3 className="font-bold">Leave requests</h3>
          <Badge className="bg-yellow-100 text-yellow-700 border-none">{pendingCount} pending</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2 ml-auto">
          {isApprover && (
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#8E9299]" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search staff..." className="pl-9 w-56 bg-white rounded-xl" />
            </div>
          )}
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40 bg-white rounded-xl"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUS_FILTERS.map(s => <SelectItem key={s} value={s}>{s === 'All' ? 'All statuses' : s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-[#F5F5F5] shadow-sm">
        <Table className="bg-white">
          <TableHeader>
            <TableRow className="bg-[#F5F5F5]/50">
              {isApprover && <TableHead>Staff Member</TableHead>}
              <TableHead>Type</TableHead>
              <TableHead>Period</TableHead>
              <TableHead>Working Days</TableHead>
              <TableHead>Requested</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={columnCount} className="py-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-[#8E9299]" /></TableCell></TableRow>
            ) : filteredRequests.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columnCount} className="text-center py-12 text-[#8E9299]">
                  {requests.length === 0 ? 'No leave requests yet.' : 'No leave requests match these filters.'}
                </TableCell>
              </TableRow>
            ) : filteredRequests.map(l => (
              <TableRow key={l.id}>
                {isApprover && (
                  <TableCell>
                    <div className="font-bold">{l.employee_name || l.employee_id}</div>
                    {l.employee_department && <div className="text-xs text-[#8E9299]">{l.employee_department}</div>}
                  </TableCell>
                )}
                <TableCell><Badge variant="outline" className="rounded-md font-medium text-[10px] uppercase">{l.type}</Badge></TableCell>
                <TableCell className="text-xs text-[#8E9299] whitespace-nowrap">{formatDate(l.startDate)} → {formatDate(l.endDate)}</TableCell>
                <TableCell className="text-xs font-bold">{requestDays(l)}</TableCell>
                <TableCell className="text-xs text-[#8E9299]">{formatDate(l.created_at)}</TableCell>
                <TableCell><StatusBadge status={l.status} /></TableCell>
                <TableCell className="text-right whitespace-nowrap space-x-1">
                  <Button variant="ghost" size="icon" title="View" onClick={() => setViewing(l)} className="h-8 w-8 text-blue-600 hover:bg-blue-50 rounded-full">
                    <Eye className="w-4 h-4" />
                  </Button>
                  {canDecide(l) && (
                    <>
                      <Button variant="ghost" size="icon" title="Approve" onClick={() => openDecision(l, 'Approved')} className="h-8 w-8 text-green-600 hover:bg-green-50 rounded-full"><CheckCircle2 className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="icon" title="Reject" onClick={() => openDecision(l, 'Rejected')} className="h-8 w-8 text-red-600 hover:bg-red-50 rounded-full"><XCircle className="w-4 h-4" /></Button>
                    </>
                  )}
                  {canWithdraw(l) && (
                    <Button variant="ghost" size="sm" onClick={() => handleWithdraw(l)} className="h-8 text-[#8E9299] hover:bg-[#F5F5F5] rounded-full gap-1">
                      <Undo2 className="w-3.5 h-3.5" /> Withdraw
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );

  const balancesView = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-bold mr-auto">Annual leave balances</h3>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#8E9299]" />
          <Input value={balanceSearch} onChange={e => setBalanceSearch(e.target.value)} placeholder="Search staff..." className="pl-9 w-56 bg-white rounded-xl" />
        </div>
        <Select value={String(balanceYear)} onValueChange={v => setBalanceYear(Number(v))}>
          <SelectTrigger className="w-28 bg-white rounded-xl"><SelectValue /></SelectTrigger>
          <SelectContent>{yearOptions().map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
        </Select>
        <Button variant="outline" onClick={exportBalances} disabled={!balances.length} className="rounded-xl gap-2"><Download className="w-4 h-4" /> Export</Button>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-[#F5F5F5] shadow-sm">
        <Table className="bg-white">
          <TableHeader>
            <TableRow className="bg-[#F5F5F5]/50">
              <TableHead>Staff Member</TableHead>
              <TableHead className="text-right">Entitlement</TableHead>
              <TableHead className="text-right">Carried Over</TableHead>
              <TableHead className="text-right">Used</TableHead>
              <TableHead className="text-right">Pending</TableHead>
              <TableHead className="text-right">Available</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isBalancesLoading ? (
              <TableRow><TableCell colSpan={7} className="py-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-[#8E9299]" /></TableCell></TableRow>
            ) : filteredBalances.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-12 text-[#8E9299]">
                  {balances.length === 0 ? `No leave balances for ${balanceYear}.` : 'No staff match this search.'}
                </TableCell>
              </TableRow>
            ) : filteredBalances.map(b => (
              <TableRow key={b.employee_id}>
                <TableCell>
                  <div className="font-bold">{b.name || b.employee_id}</div>
                  {b.department && <div className="text-xs text-[#8E9299]">{b.department}</div>}
                </TableCell>
                <TableCell className="text-right">{b.entitlement}</TableCell>
                <TableCell className="text-right">{b.carried_over}</TableCell>
                <TableCell className="text-right">{b.used}</TableCell>
                <TableCell className="text-right text-yellow-700">{b.pending || '—'}</TableCell>
                <TableCell className={`text-right font-bold ${b.available < 0 ? 'text-red-600' : 'text-[#141414]'}`}>{b.available}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" title="Edit balance" onClick={() => openBalanceEdit(b)} className="h-8 w-8 text-blue-600 hover:bg-blue-50 rounded-full">
                    <Pencil className="w-4 h-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <h2 className="text-xl font-bold">Leave</h2>
        <Button onClick={openRequestDialog} disabled={!employeeId} title={employeeId ? undefined : 'Your login is not linked to an employee record'} className="bg-[#141414] text-white gap-2 rounded-xl">
          <Plus className="w-4 h-4" /> Request leave
        </Button>
      </div>

      {myLeaveCard}

      {isHrAdmin ? (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="rounded-xl">
            <TabsTrigger value="requests" className="rounded-lg">Requests</TabsTrigger>
            <TabsTrigger value="balances" className="rounded-lg">Balances</TabsTrigger>
          </TabsList>
          <TabsContent value="requests" className="mt-4">{requestsView}</TabsContent>
          <TabsContent value="balances" className="mt-4">{balancesView}</TabsContent>
        </Tabs>
      ) : requestsView}

      <Dialog open={isRequestOpen} onOpenChange={setIsRequestOpen}>
        <DialogContent>
          <form onSubmit={handleSubmitRequest}>
            <DialogHeader>
              <DialogTitle>Request leave</DialogTitle>
              <DialogDescription>Only Monday to Friday count as working days.</DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4">
              <div className="grid gap-2">
                <Label>Leave type</Label>
                <Select value={form.type} onValueChange={type => setForm(f => ({ ...f, type }))}>
                  <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue /></SelectTrigger>
                  <SelectContent>{LEAVE_TYPES.map(t => <SelectItem key={t} value={t}>{t} leave</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Start date</Label>
                  <Input type="date" required value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} className="bg-[#F5F5F5] border-none" />
                </div>
                <div className="grid gap-2">
                  <Label>End date</Label>
                  <Input type="date" required min={form.startDate || undefined} value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} className="bg-[#F5F5F5] border-none" />
                </div>
              </div>
              <div className="p-4 bg-[#F5F5F5]/50 rounded-xl text-sm space-y-1">
                {datesInvalid ? (
                  <p className="text-red-600 font-medium">End date cannot be before the start date.</p>
                ) : (
                  <p><span className="font-bold">{previewDays}</span> working day{previewDays === 1 ? '' : 's'}</p>
                )}
                {form.type === 'Annual' && !datesInvalid && (
                  previewBalance && remainingAfter !== null ? (
                    <p className={remainingAfter < 0 ? 'text-red-600 font-medium' : 'text-[#8E9299]'}>
                      {remainingAfter < 0
                        ? `This exceeds your remaining ${requestYear} balance of ${previewBalance.remaining_after_pending} day(s)${previewBalance.pending ? ` (after ${previewBalance.pending} pending)` : ''}.`
                        : `${remainingAfter} day(s) of ${requestYear} annual leave left after this request${previewBalance.pending ? ` and ${previewBalance.pending} pending day(s)` : ''}.`}
                    </p>
                  ) : (
                    <p className="text-[#8E9299]">Balance for {Number.isInteger(requestYear) ? requestYear : 'this year'} unavailable.</p>
                  )
                )}
              </div>
              <div className="grid gap-2">
                <Label>Reason</Label>
                <Textarea value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="Details for approval..." className="min-h-[100px] bg-[#F5F5F5] border-none rounded-xl" />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsRequestOpen(false)} className="rounded-xl">Cancel</Button>
              <Button type="submit" disabled={!employeeId || isSubmitting || datesInvalid} className="bg-[#141414] text-white rounded-xl gap-2">
                {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />} Submit request
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(viewing)} onOpenChange={open => { if (!open) setViewing(null); }}>
        <DialogContent>
          {viewing && (
            <div>
              <DialogHeader>
                <DialogTitle>Leave details: {viewing.employee_name || viewing.employee_id}</DialogTitle>
                {viewing.employee_department && <DialogDescription>{viewing.employee_department}</DialogDescription>}
              </DialogHeader>
              <div className="py-6 space-y-4">
                <div className="flex justify-between items-center p-4 bg-[#F5F5F5] rounded-2xl">
                  <div>
                    <p className="text-[10px] font-bold uppercase text-[#8E9299]">Status</p>
                    <StatusBadge status={viewing.status} />
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-bold uppercase text-[#8E9299]">Leave type</p>
                    <p className="font-bold">{viewing.type}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Start date">{formatDate(viewing.startDate)}</Field>
                  <Field label="End date">{formatDate(viewing.endDate)}</Field>
                  <Field label="Working days">{requestDays(viewing)}</Field>
                  <Field label="Requested on">{formatDate(viewing.created_at)}</Field>
                  {(viewing.status === 'Approved' || viewing.status === 'Rejected') && (
                    <Field label="Decided on">{formatDate(viewing.decided_at)}</Field>
                  )}
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-bold uppercase text-[#8E9299]">Reason</p>
                  <p className="p-4 bg-[#F5F5F5]/50 rounded-xl text-sm italic">{viewing.reason || 'No reason provided.'}</p>
                </div>
                {viewing.decision_note && (
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase text-[#8E9299]">Decision note</p>
                    <p className="p-4 bg-[#F5F5F5]/50 rounded-xl text-sm">{viewing.decision_note}</p>
                  </div>
                )}
              </div>
              <DialogFooter className="gap-2">
                {canWithdraw(viewing) && (
                  <Button variant="outline" onClick={() => handleWithdraw(viewing)} className="rounded-xl gap-1"><Undo2 className="w-4 h-4" /> Withdraw</Button>
                )}
                {canDecide(viewing) && (
                  <>
                    <Button variant="outline" onClick={() => { const v = viewing; setViewing(null); openDecision(v, 'Rejected'); }} className="rounded-xl text-red-600 border-red-200">Reject</Button>
                    <Button onClick={() => { const v = viewing; setViewing(null); openDecision(v, 'Approved'); }} className="rounded-xl bg-green-600 text-white">Approve</Button>
                  </>
                )}
                <Button onClick={() => setViewing(null)} className="bg-[#141414] text-white rounded-xl">Close</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deciding)} onOpenChange={open => { if (!open && !isDeciding) setDeciding(null); }}>
        <DialogContent className="max-w-md">
          {deciding && (
            <div>
              <DialogHeader>
                <DialogTitle>{deciding.status === 'Approved' ? 'Approve' : 'Reject'} leave request</DialogTitle>
                <DialogDescription>
                  {deciding.request.employee_name || deciding.request.employee_id}: {deciding.request.type}, {formatDate(deciding.request.startDate)} to {formatDate(deciding.request.endDate)} ({requestDays(deciding.request)} working day{requestDays(deciding.request) === 1 ? '' : 's'})
                </DialogDescription>
              </DialogHeader>
              <div className="py-4 grid gap-2">
                <Label>{deciding.status === 'Rejected' ? 'Reason for rejection (optional)' : 'Note (optional)'}</Label>
                <Textarea
                  value={decisionNote}
                  onChange={e => setDecisionNote(e.target.value)}
                  placeholder={deciding.status === 'Rejected' ? 'Let the employee know why...' : 'Any note for the employee...'}
                  className="min-h-[90px] bg-[#F5F5F5] border-none rounded-xl"
                />
                <p className="text-xs text-[#8E9299]">The employee is notified of the decision{decisionNote.trim() ? ' and this note' : ''}.</p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDeciding(null)} disabled={isDeciding} className="rounded-xl">Cancel</Button>
                <Button
                  onClick={handleDecision}
                  disabled={isDeciding}
                  className={`rounded-xl text-white gap-2 ${deciding.status === 'Approved' ? 'bg-green-600' : 'bg-red-600'}`}
                >
                  {isDeciding && <Loader2 className="w-4 h-4 animate-spin" />}
                  {deciding.status === 'Approved' ? 'Approve' : 'Reject'}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingBalance)} onOpenChange={open => { if (!open && !isSavingBalance) setEditingBalance(null); }}>
        <DialogContent className="max-w-md">
          {editingBalance && (
            <form onSubmit={handleSaveBalance}>
              <DialogHeader>
                <DialogTitle>Edit leave balance</DialogTitle>
                <DialogDescription>{editingBalance.name || editingBalance.employee_id}, {balanceYear}. Used days ({editingBalance.used}) are updated by approvals.</DialogDescription>
              </DialogHeader>
              <div className="py-4 grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Entitlement (days)</Label>
                  <Input type="number" min="0" max="60" step="0.5" required value={balanceForm.entitlement} onChange={e => setBalanceForm(f => ({ ...f, entitlement: e.target.value }))} className="bg-[#F5F5F5] border-none" />
                </div>
                <div className="grid gap-2">
                  <Label>Carried over (days)</Label>
                  <Input type="number" min="0" max="60" step="0.5" value={balanceForm.carried_over} onChange={e => setBalanceForm(f => ({ ...f, carried_over: e.target.value }))} className="bg-[#F5F5F5] border-none" />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditingBalance(null)} disabled={isSavingBalance} className="rounded-xl">Cancel</Button>
                <Button type="submit" disabled={isSavingBalance} className="bg-[#141414] text-white rounded-xl gap-2">
                  {isSavingBalance && <Loader2 className="w-4 h-4 animate-spin" />} Save
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
