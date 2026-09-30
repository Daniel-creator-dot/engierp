import React, { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import {
  Mail, Shield, Calendar, Building, Phone, Briefcase, LogOut, Loader2, Pencil, KeyRound,
  Printer, Plus, Wallet, Plane, Clock,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { Avatar, AvatarFallback } from '../ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { useAuth } from '../../contexts/AuthContext';
import { authApi, hrApi, settingsApi, apiErrorMessage } from '../../lib/api';
import { formatCurrency } from '../../lib/currency';
import { formatDate, inclusiveDays, todayIso } from '../../lib/dates';
import { escapeHtml } from '../../lib/html';
import ChangePasswordForm from '../ChangePasswordForm';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const LEAVE_TYPES = [
  { value: 'Annual', label: 'Annual Leave' },
  { value: 'Sick', label: 'Sick Leave' },
  { value: 'Casual', label: 'Casual Leave' },
  { value: 'Maternity', label: 'Maternity/Paternity' },
];
const PRINTABLE_STATUSES = ['approved', 'paid'];

const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
// Payroll months are stored either as numbers ('1'..'12') or as names ('January').
const monthIndex = (m: unknown) => {
  const n = Number(m);
  if (Number.isInteger(n) && n >= 1 && n <= 12) return n;
  const i = MONTHS.findIndex(name => name.toLowerCase() === String(m ?? '').trim().toLowerCase());
  return i >= 0 ? i + 1 : 0;
};
const monthLabel = (m: unknown) => {
  const i = monthIndex(m);
  return i ? MONTHS[i - 1] : String(m ?? '');
};

// detailed_* columns are JSON text: either [{ name, amount }] or { name: amount }.
function parseBreakdown(raw: unknown): Array<{ name: string; amount: number }> {
  if (!raw) return [];
  try {
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(data)) {
      return data
        .map((d: any) => ({ name: String(d.name ?? d.type ?? d.label ?? 'Item'), amount: Number(d.amount ?? d.value ?? 0) }))
        .filter(d => d.amount);
    }
    if (data && typeof data === 'object') {
      return Object.entries(data).map(([name, amount]) => ({ name, amount: Number(amount) })).filter(d => d.amount);
    }
  } catch {
    // Not JSON; ignore.
  }
  return [];
}

const statusTone = (status: string) => {
  const s = status.toLowerCase();
  if (s === 'paid' || s === 'approved') return 'bg-green-100 text-green-700';
  if (s === 'rejected' || s === 'cancelled') return 'bg-red-100 text-red-700';
  return 'bg-amber-100 text-amber-800';
};

export default function Profile() {
  const { user, logout, applySession } = useAuth();
  const [employee, setEmployee] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [payslips, setPayslips] = useState<any[]>([]);
  const [leave, setLeave] = useState<any[]>([]);
  const [company, setCompany] = useState<Record<string, string>>({});

  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', phone: '', email: '' });
  const [saving, setSaving] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveForm, setLeaveForm] = useState({ type: 'Annual', startDate: todayIso(), endDate: todayIso(), reason: '' });

  const loadSelfService = async (employeeId?: string | null) => {
    if (!employeeId) return;
    const [payRes, leaveRes] = await Promise.allSettled([hrApi.getPayroll(), hrApi.getLeaveRequests()]);
    if (payRes.status === 'fulfilled') setPayslips(payRes.value.data.filter((p: any) => p.employee_id === employeeId));
    if (leaveRes.status === 'fulfilled') setLeave(leaveRes.value.data.filter((l: any) => l.employee_id === employeeId));
  };

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await authApi.getProfile();
        if (cancelled) return;
        setEmployee(res.data.employee);
        await loadSelfService(res.data.employee?.id);
      } catch (error) {
        if (!cancelled) toast.error(apiErrorMessage(error, 'Failed to load your profile'));
      } finally {
        if (!cancelled) setLoading(false);
      }
      settingsApi.getSettings()
        .then(res => { if (!cancelled) setCompany(Object.fromEntries(res.data.map((s: any) => [s.key, s.value]))); })
        .catch(() => undefined);
    })();
    return () => { cancelled = true; };
  }, [user?.id, user?.employee_id]);

  const sortedPayslips = useMemo(
    () => [...payslips].sort((a, b) => (Number(b.year) - Number(a.year)) || (monthIndex(b.month) - monthIndex(a.month)) || (b.id - a.id)),
    [payslips],
  );
  const sortedLeave = useMemo(
    () => [...leave].sort((a, b) => String(b.startDate).localeCompare(String(a.startDate))),
    [leave],
  );
  const leaveDaysThisYear = useMemo(() => {
    const year = String(new Date().getFullYear());
    return leave
      .filter(l => l.status === 'Approved' && String(l.startDate).startsWith(year))
      .reduce((sum, l) => sum + inclusiveDays(l.startDate, l.endDate), 0);
  }, [leave]);

  if (!user) return null;
  const displayName = employee?.name || user.name || user.email.split('@')[0];
  const currency = company.currency || 'GHS';

  const openEdit = () => {
    setEditForm({ name: employee?.name || user.name || '', phone: user.phone || employee?.phone || '', email: user.email });
    setEditOpen(true);
  };

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: { name?: string; phone?: string; email?: string } = { phone: editForm.phone, email: editForm.email };
      if (employee) payload.name = editForm.name;
      const res = await authApi.updateProfile(payload);
      applySession(res.data.token, res.data.user);
      if (employee) setEmployee({ ...employee, name: editForm.name, phone: editForm.phone });
      setEditOpen(false);
      toast.success('Profile updated');
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to update profile'));
    } finally {
      setSaving(false);
    }
  };

  const submitLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (leaveForm.endDate < leaveForm.startDate) return toast.error('End date cannot be before the start date');
    setSaving(true);
    try {
      await hrApi.submitLeaveRequest(leaveForm);
      toast.success('Leave request submitted');
      setLeaveOpen(false);
      setLeaveForm({ type: 'Annual', startDate: todayIso(), endDate: todayIso(), reason: '' });
      await loadSelfService(employee?.id);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to submit leave request'));
    } finally {
      setSaving(false);
    }
  };

  const printPayslip = (p: any) => {
    const win = window.open('', '_blank', 'width=800,height=900');
    if (!win) return toast.error('Allow pop-ups to print your payslip');
    const money = (v: unknown) => escapeHtml(formatCurrency(Number(v || 0), currency));
    const basic = num(p.base_salary) ?? 0;
    const allowances = parseBreakdown(p.detailed_allowances);
    const allowanceTotal = num(p.allowances) ?? allowances.reduce((s, a) => s + a.amount, 0);
    const gross = num(p.gross) ?? basic + allowanceTotal;
    const deductions = parseBreakdown(p.detailed_deductions);
    const statutory: Array<[string, number | null]> = [['SSNIT (employee)', num(p.ssnit_employee)], ['PAYE income tax', num(p.paye)]];
    const totalDeductions = num(p.deductions) ?? gross - Number(p.net_pay || 0);

    const earningRows = [
      `<tr><td>Basic salary</td><td class="amt">${money(basic)}</td></tr>`,
      ...(allowances.length
        ? allowances.map(a => `<tr><td>${escapeHtml(a.name)}</td><td class="amt">${money(a.amount)}</td></tr>`)
        : allowanceTotal ? [`<tr><td>Allowances</td><td class="amt">${money(allowanceTotal)}</td></tr>`] : []),
    ].join('');
    const deductionRows = [
      ...statutory.filter(([, v]) => v !== null && v !== 0).map(([label, v]) => `<tr><td>${escapeHtml(label)}</td><td class="amt">${money(v)}</td></tr>`),
      ...deductions.map(d => `<tr><td>${escapeHtml(d.name)}</td><td class="amt">${money(d.amount)}</td></tr>`),
    ].join('') || `<tr><td>Total deductions</td><td class="amt">${money(totalDeductions)}</td></tr>`;

    const logo = company.company_logo && /^data:image\//.test(company.company_logo)
      ? `<img src="${escapeHtml(company.company_logo)}" alt="" style="max-height:60px" />` : '';
    const period = `${monthLabel(p.month)} ${p.year || ''}`.trim();

    win.document.write(`<!doctype html><html><head><title>Payslip ${escapeHtml(period)}</title>
<style>
  body { font-family: Arial, sans-serif; color: #141414; margin: 32px; font-size: 13px; }
  .head { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #141414; padding-bottom: 12px; }
  h1 { font-size: 20px; margin: 0; } h2 { font-size: 14px; margin: 20px 0 6px; text-transform: uppercase; letter-spacing: .05em; color: #555; }
  table { width: 100%; border-collapse: collapse; } td { padding: 6px 4px; border-bottom: 1px solid #eee; }
  .amt { text-align: right; font-variant-numeric: tabular-nums; } .meta td { border: none; padding: 3px 4px; }
  .net { margin-top: 20px; padding: 12px; background: #f5f5f5; display: flex; justify-content: space-between; font-size: 16px; font-weight: bold; }
  .foot { margin-top: 32px; font-size: 11px; color: #777; }
</style></head><body>
<div class="head"><div><h1>${escapeHtml(company.company_name || 'Payslip')}</h1><div>Payslip for ${escapeHtml(period)}</div></div>${logo}</div>
<table class="meta" style="margin-top:12px">
  <tr><td><b>Employee</b></td><td>${escapeHtml(p.name || displayName)}</td><td><b>Employee ID</b></td><td>${escapeHtml(p.employee_id)}</td></tr>
  <tr><td><b>Position</b></td><td>${escapeHtml(employee?.role || '')}</td><td><b>Department</b></td><td>${escapeHtml(employee?.department || '')}</td></tr>
  <tr><td><b>SSNIT No.</b></td><td>${escapeHtml(employee?.ssnit || '—')}</td><td><b>Bank</b></td><td>${escapeHtml([employee?.bank_name, employee?.account_number].filter(Boolean).join(' · ') || '—')}</td></tr>
  <tr><td><b>Status</b></td><td>${escapeHtml(p.status)}</td><td><b>Payment date</b></td><td>${escapeHtml(p.payment_date ? formatDate(String(p.payment_date)) : '—')}</td></tr>
</table>
<h2>Earnings</h2><table>${earningRows}<tr><td><b>Gross pay</b></td><td class="amt"><b>${money(gross)}</b></td></tr></table>
<h2>Deductions</h2><table>${deductionRows}<tr><td><b>Total deductions</b></td><td class="amt"><b>${money(totalDeductions)}</b></td></tr></table>
<div class="net"><span>Net pay</span><span>${money(p.net_pay)}</span></div>
<div class="foot">Payroll record #${escapeHtml(p.id)} · printed ${escapeHtml(format(new Date(), 'd MMM yyyy, HH:mm'))} by ${escapeHtml(user.email)}${company.company_footer_note ? `<br/>${escapeHtml(company.company_footer_note)}` : ''}</div>
<script>window.onload = function () { window.print(); };</script>
</body></html>`);
    win.document.close();
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-20">
      <Card className="border-none shadow-sm rounded-3xl bg-white overflow-hidden">
        <CardContent className="p-8">
          <div className="flex flex-col md:flex-row items-center gap-8">
            <Avatar className="w-28 h-28 border-4 border-white shadow-xl">
              <AvatarFallback className="bg-blue-600 text-white text-3xl font-bold">
                {displayName.substring(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="text-center md:text-left space-y-3 flex-1 min-w-0">
              <div className="space-y-1">
                <Badge className="bg-blue-100 text-blue-700 border-none font-bold px-3">{user.role.toUpperCase()}</Badge>
                <h1 className="text-3xl md:text-4xl font-black text-[#141414] tracking-tight truncate">{displayName}</h1>
                <div className="flex flex-wrap items-center justify-center md:justify-start gap-x-4 gap-y-1 text-[#8E9299]">
                  <span className="flex items-center gap-2"><Mail className="w-4 h-4" />{user.email}</span>
                  {user.phone && <span className="flex items-center gap-2"><Phone className="w-4 h-4" />{user.phone}</span>}
                </div>
                <p className="text-xs text-[#8E9299] flex items-center justify-center md:justify-start gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  {user.last_login_at ? `Signed in ${format(new Date(user.last_login_at), 'd MMM yyyy, HH:mm')}` : 'Sign-in time not recorded'}
                </p>
              </div>
              <div className="flex flex-wrap justify-center md:justify-start gap-3">
                <Button onClick={openEdit} className="bg-[#141414] text-white hover:bg-black rounded-xl font-bold px-6 gap-2"><Pencil className="w-4 h-4" /> Edit Profile</Button>
                <Button variant="outline" onClick={() => setPasswordOpen(true)} className="rounded-xl font-bold px-6 gap-2"><KeyRound className="w-4 h-4" /> Change Password</Button>
                <Button variant="outline" className="rounded-xl font-bold px-6 gap-2" onClick={logout}><LogOut className="w-4 h-4" /> Log out</Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>
      ) : !employee ? (
        <Card className="border-none shadow-sm rounded-3xl">
          <CardContent className="p-8 text-center space-y-2">
            <p className="font-bold text-[#141414]">Your account isn't linked to an employee record</p>
            <p className="text-sm text-[#8E9299]">Payslips and leave appear here once an administrator links your account under Settings → Users.</p>
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="employment" className="w-full">
          <TabsList className="bg-[#F5F5F5] p-1 h-auto mb-6 border-none justify-start flex overflow-x-auto">
            <TabsTrigger value="employment" className="px-6 py-2.5 data-[state=active]:bg-white rounded-xl"><Building className="w-4 h-4 mr-2" /> Employment</TabsTrigger>
            <TabsTrigger value="payslips" className="px-6 py-2.5 data-[state=active]:bg-white rounded-xl"><Wallet className="w-4 h-4 mr-2" /> My Payslips</TabsTrigger>
            <TabsTrigger value="leave" className="px-6 py-2.5 data-[state=active]:bg-white rounded-xl"><Plane className="w-4 h-4 mr-2" /> My Leave</TabsTrigger>
          </TabsList>

          <TabsContent value="employment">
            <Card className="border-none shadow-sm rounded-3xl">
              <CardContent className="p-8 grid gap-5 md:grid-cols-2">
                <ProfileItem icon={Shield} label="Employee ID" value={employee.id} />
                <ProfileItem icon={Building} label="Department" value={employee.department} />
                <ProfileItem icon={Briefcase} label="Position" value={employee.role} />
                <ProfileItem icon={Calendar} label="Commencement" value={formatDate(employee.joinDate)} />
                <ProfileItem icon={Briefcase} label="Employment type" value={employee.employment_type || '—'} />
                <ProfileItem icon={Shield} label="Status" value={employee.status} />
                <ProfileItem icon={Shield} label="SSNIT No." value={employee.ssnit || 'Not on file — tell HR'} />
                <ProfileItem icon={Wallet} label="Salary bank" value={[employee.bank_name, employee.account_number].filter(Boolean).join(' · ') || 'Not on file — tell HR'} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="payslips">
            <Card className="border-none shadow-sm rounded-3xl">
              <CardHeader>
                <CardTitle>My Payslips</CardTitle>
                <CardDescription>Payslips can be printed once payroll is approved.</CardDescription>
              </CardHeader>
              <CardContent>
                {sortedPayslips.length === 0 ? (
                  <p className="text-sm text-[#8E9299] py-6 text-center">No payroll records yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase text-[#8E9299] border-b border-[#E4E3E0]">
                          <th className="py-2 pr-4">Period</th>
                          <th className="py-2 pr-4 text-right">Gross</th>
                          <th className="py-2 pr-4 text-right">Deductions</th>
                          <th className="py-2 pr-4 text-right">Net pay</th>
                          <th className="py-2 pr-4">Status</th>
                          <th className="py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {sortedPayslips.map(p => {
                          const gross = num(p.gross) ?? Number(p.base_salary || 0) + Number(p.allowances || 0);
                          const printable = PRINTABLE_STATUSES.includes(String(p.status).toLowerCase());
                          return (
                            <tr key={p.id} className="border-b border-[#F5F5F5]">
                              <td className="py-3 pr-4 font-medium">{monthLabel(p.month)} {p.year || ''}</td>
                              <td className="py-3 pr-4 text-right">{formatCurrency(gross, currency)}</td>
                              <td className="py-3 pr-4 text-right">{formatCurrency(Number(p.deductions || 0), currency)}</td>
                              <td className="py-3 pr-4 text-right font-bold">{formatCurrency(Number(p.net_pay || 0), currency)}</td>
                              <td className="py-3 pr-4"><Badge className={`border-none ${statusTone(String(p.status))}`}>{p.status}</Badge></td>
                              <td className="py-3 text-right">
                                <Button variant="ghost" size="sm" disabled={!printable} title={printable ? 'Print payslip' : 'Available once approved'} onClick={() => printPayslip(p)} className="gap-1 rounded-xl">
                                  <Printer className="w-4 h-4" /> Print
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="leave">
            <Card className="border-none shadow-sm rounded-3xl">
              <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle>My Leave</CardTitle>
                  <CardDescription>{leaveDaysThisYear} approved day{leaveDaysThisYear === 1 ? '' : 's'} taken in {new Date().getFullYear()}.</CardDescription>
                </div>
                <Button onClick={() => setLeaveOpen(true)} className="bg-[#141414] text-white rounded-xl gap-2"><Plus className="w-4 h-4" /> Request Leave</Button>
              </CardHeader>
              <CardContent>
                {sortedLeave.length === 0 ? (
                  <p className="text-sm text-[#8E9299] py-6 text-center">No leave requests yet.</p>
                ) : (
                  <div className="space-y-3">
                    {sortedLeave.map(l => (
                      <div key={l.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-4 rounded-2xl bg-[#F5F5F5]/60">
                        <div>
                          <p className="font-bold">{LEAVE_TYPES.find(t => t.value === l.type)?.label || l.type}</p>
                          <p className="text-sm text-[#5f6368]">
                            {formatDate(l.startDate)} – {formatDate(l.endDate)} · {inclusiveDays(l.startDate, l.endDate)} day(s)
                          </p>
                          {l.reason && <p className="text-xs text-[#8E9299] mt-1">{l.reason}</p>}
                        </div>
                        <Badge className={`border-none self-start sm:self-center ${statusTone(String(l.status))}`}>{l.status}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <form onSubmit={saveProfile}>
            <DialogHeader>
              <DialogTitle>Edit Profile</DialogTitle>
              <DialogDescription>Changing your email changes the address you sign in with.</DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4">
              {employee && (
                <div className="space-y-2"><Label>Full name</Label><Input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} required className="bg-[#F5F5F5] border-none rounded-xl" /></div>
              )}
              <div className="space-y-2"><Label>Email</Label><Input type="email" value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })} required className="bg-[#F5F5F5] border-none rounded-xl" /></div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input value={editForm.phone} onChange={e => setEditForm({ ...editForm, phone: e.target.value })} placeholder="024 000 0000" className="bg-[#F5F5F5] border-none rounded-xl" />
                <p className="text-xs text-[#8E9299]">Password-reset codes and alerts are sent to this number.</p>
              </div>
            </div>
            <DialogFooter><Button type="submit" disabled={saving} className="bg-[#141414] text-white w-full rounded-xl">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={passwordOpen} onOpenChange={setPasswordOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Password</DialogTitle>
            <DialogDescription>You'll stay signed in here; other devices will be signed out.</DialogDescription>
          </DialogHeader>
          <ChangePasswordForm onDone={() => setPasswordOpen(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <DialogContent>
          <form onSubmit={submitLeave}>
            <DialogHeader>
              <DialogTitle>Request Leave</DialogTitle>
              <DialogDescription>Your request goes to HR/admin for approval.</DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={leaveForm.type} onValueChange={v => setLeaveForm({ ...leaveForm, type: v })}>
                  <SelectTrigger className="bg-[#F5F5F5] border-none rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>{LEAVE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>From</Label><Input type="date" value={leaveForm.startDate} onChange={e => setLeaveForm({ ...leaveForm, startDate: e.target.value })} required className="bg-[#F5F5F5] border-none rounded-xl" /></div>
                <div className="space-y-2"><Label>To</Label><Input type="date" value={leaveForm.endDate} min={leaveForm.startDate} onChange={e => setLeaveForm({ ...leaveForm, endDate: e.target.value })} required className="bg-[#F5F5F5] border-none rounded-xl" /></div>
              </div>
              <p className="text-xs text-[#8E9299]">{inclusiveDays(leaveForm.startDate, leaveForm.endDate)} day(s)</p>
              <div className="space-y-2"><Label>Reason</Label><Input value={leaveForm.reason} onChange={e => setLeaveForm({ ...leaveForm, reason: e.target.value })} className="bg-[#F5F5F5] border-none rounded-xl" /></div>
            </div>
            <DialogFooter><Button type="submit" disabled={saving} className="bg-[#141414] text-white w-full rounded-xl">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Submit Request'}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProfileItem({ icon: Icon, label, value }: { icon: any; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-[#F5F5F5] rounded-xl"><Icon className="w-4 h-4 text-[#141414]" /></div>
        <span className="text-xs font-bold text-[#8E9299] uppercase tracking-widest">{label}</span>
      </div>
      <span className="text-sm font-bold text-[#141414] text-right">{value}</span>
    </div>
  );
}
