import React, { useEffect, useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Plus, Pencil, KeyRound, UserX, UserCheck, Copy, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { settingsApi, hrApi, apiErrorMessage } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

export const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'accountant', label: 'Accountant' },
  { value: 'hr', label: 'HR' },
  { value: 'pm', label: 'Project Manager' },
  { value: 'procurement', label: 'Procurement' },
];

const roleLabel = (role: string) => ROLE_OPTIONS.find(r => r.value === role)?.label || role;

interface ManagedUser {
  id: number;
  email: string;
  role: string;
  phone?: string | null;
  employee_id?: string | null;
  name?: string | null;
  department?: string | null;
  is_active: boolean;
  must_change_password: boolean;
  last_login_at?: string | null;
  locked_until?: string | null;
}

interface Credentials {
  email: string;
  password: string;
  smsSent: boolean;
  reason: 'created' | 'reset';
}

const NO_EMPLOYEE = '__none__';

export default function UserManagement() {
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === 'admin';
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [employees, setEmployees] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', email: '', phone: '', role: 'pm', department: '', employee_id: NO_EMPLOYEE });
  const [saving, setSaving] = useState(false);

  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [editForm, setEditForm] = useState({ role: '', phone: '', email: '', employee_id: NO_EMPLOYEE });

  const [confirm, setConfirm] = useState<{ user: ManagedUser; action: 'deactivate' | 'reactivate' | 'reset' } | null>(null);
  const [credentials, setCredentials] = useState<Credentials | null>(null);

  const load = async () => {
    try {
      const res = await settingsApi.getUsers();
      setUsers(res.data);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to load users'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    hrApi.getEmployees().then(res => setEmployees(res.data.map((e: any) => ({ id: e.id, name: e.name })))).catch(() => undefined);
  }, []);

  const linkedEmployeeIds = useMemo(() => new Set(users.map(u => u.employee_id).filter(Boolean)), [users]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return users;
    return users.filter(u => [u.email, u.name, u.phone, u.role, u.employee_id].some(v => v && String(v).toLowerCase().includes(q)));
  }, [users, filter]);

  const replaceUser = (updated: ManagedUser) => setUsers(list => list.map(u => (u.id === updated.id ? updated : u)));

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: any = { ...newUser };
      if (payload.employee_id === NO_EMPLOYEE) delete payload.employee_id;
      const res = await settingsApi.addUser(payload);
      setUsers(list => [...list, res.data.user]);
      setAddOpen(false);
      setNewUser({ name: '', email: '', phone: '', role: 'pm', department: '', employee_id: NO_EMPLOYEE });
      setCredentials({ email: res.data.user.email, password: res.data.temp_password, smsSent: res.data.sms_sent, reason: 'created' });
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to create user'));
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (u: ManagedUser) => {
    setEditing(u);
    setEditForm({ role: u.role, phone: u.phone || '', email: u.email, employee_id: u.employee_id || NO_EMPLOYEE });
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    try {
      const payload: Record<string, string> = {};
      if (editForm.role !== editing.role) payload.role = editForm.role;
      if (editForm.phone !== (editing.phone || '')) payload.phone = editForm.phone;
      if (editForm.email !== editing.email) payload.email = editForm.email;
      const employeeId = editForm.employee_id === NO_EMPLOYEE ? '' : editForm.employee_id;
      if (employeeId !== (editing.employee_id || '')) payload.employee_id = employeeId;
      if (!Object.keys(payload).length) {
        setEditing(null);
        return;
      }
      const res = await settingsApi.updateUser(editing.id, payload);
      replaceUser(res.data);
      setEditing(null);
      toast.success('User updated');
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to update user'));
    } finally {
      setSaving(false);
    }
  };

  const runConfirmed = async () => {
    if (!confirm) return;
    const { user: target, action } = confirm;
    setBusyId(target.id);
    setConfirm(null);
    try {
      if (action === 'reset') {
        const res = await settingsApi.resetUserPassword(target.id);
        replaceUser(res.data.user);
        setCredentials({ email: target.email, password: res.data.temp_password, smsSent: res.data.sms_sent, reason: 'reset' });
      } else {
        const res = action === 'deactivate' ? await settingsApi.deactivateUser(target.id) : await settingsApi.reactivateUser(target.id);
        replaceUser(res.data);
        toast.success(action === 'deactivate' ? `${target.email} can no longer sign in` : `${target.email} can sign in again`);
      }
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Action failed'));
    } finally {
      setBusyId(null);
    }
  };

  const copyCredentials = async () => {
    if (!credentials) return;
    try {
      await navigator.clipboard.writeText(`Email: ${credentials.email}\nTemporary password: ${credentials.password}`);
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Could not copy. Select the password and copy it manually.');
    }
  };

  const roleOptions = isAdmin ? ROLE_OPTIONS : ROLE_OPTIONS.filter(r => r.value !== 'admin');
  const unlinkedEmployees = employees.filter(e => !linkedEmployeeIds.has(e.id));

  return (
    <Card className="border-none shadow-sm">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <CardTitle>Workspace Users</CardTitle>
          <CardDescription>
            New users get a one-time temporary password and must choose their own at first sign-in.
            {!isAdmin && ' Only administrators can change roles, deactivate accounts or reset passwords.'}
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8E9299]" />
            <Input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter users" className="pl-9 bg-[#F5F5F5] border-none rounded-xl w-48" />
          </div>
          <Button onClick={() => setAddOpen(true)} className="bg-[#141414] text-white gap-2 rounded-xl px-6"><Plus className="w-4 h-4" /> Add Member</Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>
        ) : visible.length === 0 ? (
          <p className="text-center text-sm text-[#8E9299] py-10">No users match.</p>
        ) : (
          <div className="space-y-3">
            {visible.map(u => {
              const locked = u.locked_until && new Date(u.locked_until) > new Date();
              return (
                <div key={u.id} className={`flex flex-col md:flex-row md:items-center justify-between gap-3 p-4 border border-[#F5F5F5] rounded-2xl ${u.is_active ? 'bg-[#F5F5F5]/50' : 'bg-red-50/40 opacity-80'}`}>
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold shrink-0">{(u.name || u.email)[0].toUpperCase()}</div>
                    <div className="min-w-0">
                      <p className="font-bold truncate">{u.name || u.email}</p>
                      <p className="text-xs text-[#8E9299] truncate">
                        {u.name ? `${u.email} · ` : ''}{u.phone || 'No phone'}{u.employee_id ? ` · ${u.employee_id}` : ''}
                      </p>
                      <p className="text-[11px] text-[#8E9299]">
                        {u.last_login_at ? `Last sign-in ${formatDistanceToNow(new Date(u.last_login_at), { addSuffix: true })}` : 'Never signed in'}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="rounded-lg font-bold uppercase text-[10px]">{roleLabel(u.role)}</Badge>
                    {!u.is_active && <Badge className="bg-red-100 text-red-700 border-none text-[10px]">Deactivated</Badge>}
                    {u.is_active && locked && <Badge className="bg-amber-100 text-amber-800 border-none text-[10px]">Locked</Badge>}
                    {u.is_active && u.must_change_password && <Badge className="bg-blue-100 text-blue-700 border-none text-[10px]">Awaiting first sign-in</Badge>}
                    {isAdmin && (
                      <>
                        <Button variant="ghost" size="icon" title="Edit" onClick={() => openEdit(u)} className="h-8 w-8 rounded-full"><Pencil className="w-4 h-4" /></Button>
                        <Button variant="ghost" size="icon" title="Reset password" disabled={busyId === u.id} onClick={() => setConfirm({ user: u, action: 'reset' })} className="h-8 w-8 rounded-full"><KeyRound className="w-4 h-4" /></Button>
                        {u.is_active ? (
                          <Button variant="ghost" size="icon" title="Deactivate" disabled={busyId === u.id || u.id === currentUser?.id} onClick={() => setConfirm({ user: u, action: 'deactivate' })} className="h-8 w-8 rounded-full text-red-600 hover:bg-red-50"><UserX className="w-4 h-4" /></Button>
                        ) : (
                          <Button variant="ghost" size="icon" title="Reactivate" disabled={busyId === u.id} onClick={() => setConfirm({ user: u, action: 'reactivate' })} className="h-8 w-8 rounded-full text-green-700 hover:bg-green-50"><UserCheck className="w-4 h-4" /></Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <form onSubmit={handleCreate}>
            <DialogHeader>
              <DialogTitle>Add Member</DialogTitle>
              <DialogDescription>A temporary password will be generated and shown once{' '}(and sent by SMS if SMS is configured).</DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Full name</Label><Input value={newUser.name} onChange={e => setNewUser({ ...newUser, name: e.target.value })} required={newUser.employee_id === NO_EMPLOYEE} className="bg-[#F5F5F5] border-none" /></div>
                <div className="space-y-2"><Label>Email</Label><Input type="email" value={newUser.email} onChange={e => setNewUser({ ...newUser, email: e.target.value })} required className="bg-[#F5F5F5] border-none" /></div>
                <div className="space-y-2"><Label>Phone</Label><Input value={newUser.phone} onChange={e => setNewUser({ ...newUser, phone: e.target.value })} placeholder="024 000 0000" className="bg-[#F5F5F5] border-none" /></div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Select value={newUser.role} onValueChange={v => setNewUser({ ...newUser, role: v })}>
                    <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue /></SelectTrigger>
                    <SelectContent>{roleOptions.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Employee record</Label>
                <Select value={newUser.employee_id} onValueChange={v => setNewUser({ ...newUser, employee_id: v })}>
                  <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_EMPLOYEE}>Create a new employee record</SelectItem>
                    {unlinkedEmployees.map(e => <SelectItem key={e.id} value={e.id}>{e.name} ({e.id})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {newUser.employee_id === NO_EMPLOYEE && (
                <div className="space-y-2"><Label>Department</Label><Input value={newUser.department} onChange={e => setNewUser({ ...newUser, department: e.target.value })} placeholder="General" className="bg-[#F5F5F5] border-none" /></div>
              )}
            </div>
            <DialogFooter><Button type="submit" className="bg-[#141414] text-white w-full rounded-xl" disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create Account'}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={open => { if (!open) setEditing(null); }}>
        <DialogContent>
          {editing && (
            <form onSubmit={handleEdit}>
              <DialogHeader>
                <DialogTitle>Edit {editing.name || editing.email}</DialogTitle>
                <DialogDescription>Role changes take effect within a minute, without the user signing out.</DialogDescription>
              </DialogHeader>
              <div className="py-4 space-y-4">
                <div className="space-y-2"><Label>Email</Label><Input type="email" value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })} required className="bg-[#F5F5F5] border-none" /></div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>Phone</Label><Input value={editForm.phone} onChange={e => setEditForm({ ...editForm, phone: e.target.value })} className="bg-[#F5F5F5] border-none" /></div>
                  <div className="space-y-2">
                    <Label>Role</Label>
                    <Select value={editForm.role} onValueChange={v => setEditForm({ ...editForm, role: v })}>
                      <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue /></SelectTrigger>
                      <SelectContent>{ROLE_OPTIONS.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Linked employee record</Label>
                  <Select value={editForm.employee_id} onValueChange={v => setEditForm({ ...editForm, employee_id: v })}>
                    <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_EMPLOYEE}>Not linked</SelectItem>
                      {employees.filter(e => e.id === editing.employee_id || !linkedEmployeeIds.has(e.id)).map(e => (
                        <SelectItem key={e.id} value={e.id}>{e.name} ({e.id})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-[#8E9299]">Payslips and leave in the user's profile come from this record.</p>
                </div>
              </div>
              <DialogFooter><Button type="submit" className="bg-[#141414] text-white w-full rounded-xl" disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Changes'}</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirm} onOpenChange={open => { if (!open) setConfirm(null); }}>
        <DialogContent>
          {confirm && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {confirm.action === 'reset' ? 'Reset password?' : confirm.action === 'deactivate' ? 'Deactivate account?' : 'Reactivate account?'}
                </DialogTitle>
                <DialogDescription>
                  {confirm.action === 'reset' && `${confirm.user.email} will be signed out everywhere and given a new temporary password.`}
                  {confirm.action === 'deactivate' && `${confirm.user.email} will be signed out and unable to sign in. Their records and history are kept.`}
                  {confirm.action === 'reactivate' && `${confirm.user.email} will be able to sign in again with their existing password.`}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setConfirm(null)} className="rounded-xl">Cancel</Button>
                <Button onClick={runConfirmed} className={`rounded-xl text-white ${confirm.action === 'deactivate' ? 'bg-red-600 hover:bg-red-700' : 'bg-[#141414]'}`}>
                  {confirm.action === 'reset' ? 'Reset Password' : confirm.action === 'deactivate' ? 'Deactivate' : 'Reactivate'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!credentials} onOpenChange={open => { if (!open) setCredentials(null); }}>
        <DialogContent onInteractOutside={e => e.preventDefault()}>
          {credentials && (
            <>
              <DialogHeader>
                <DialogTitle>{credentials.reason === 'created' ? 'Account created' : 'Password reset'}</DialogTitle>
                <DialogDescription>
                  This temporary password is shown only once. {credentials.smsSent ? 'It was also sent to the user by SMS.' : 'Share it with the user in person or by a private message.'}{' '}
                  They will be asked to choose a new password when they sign in.
                </DialogDescription>
              </DialogHeader>
              <div className="p-4 bg-[#F5F5F5] rounded-2xl space-y-2">
                <p className="text-xs font-bold uppercase text-[#8E9299]">Email</p>
                <p className="font-medium">{credentials.email}</p>
                <p className="text-xs font-bold uppercase text-[#8E9299] pt-2">Temporary password</p>
                <p className="font-mono text-xl font-bold tracking-wider select-all">{credentials.password}</p>
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={copyCredentials} className="rounded-xl gap-2"><Copy className="w-4 h-4" /> Copy</Button>
                <Button onClick={() => setCredentials(null)} className="bg-[#141414] text-white rounded-xl">Done</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
