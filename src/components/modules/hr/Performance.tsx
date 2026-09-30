import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Award, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/card';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Textarea } from '../../ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { hrApi } from '../../../lib/api';
import { useAuth } from '../../../contexts/AuthContext';
import type { Appraisal, Employee } from './types';
import { HR_ADMIN_ROLES, errorMessage, yearOptions } from './utils';

interface AppraisalRow extends Appraisal {
  created_at?: string | null;
}

const emptyForm = () => ({ employee_id: '', period: '', year: String(new Date().getFullYear()), score: '', feedback: '' });

const createdTime = (a: AppraisalRow) => (a.created_at ? new Date(a.created_at).getTime() || 0 : 0);

const scoreColour = (score: number) =>
  score >= 75 ? 'text-green-600' : score >= 50 ? 'text-blue-600' : 'text-red-600';

export default function Performance() {
  const { user } = useAuth();
  const isHrAdmin = HR_ADMIN_ROLES.includes(user?.role || '');

  const [appraisals, setAppraisals] = useState<AppraisalRow[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [yearFilter, setYearFilter] = useState('all');
  const [search, setSearch] = useState('');

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [isSaving, setIsSaving] = useState(false);

  const loadAppraisals = useCallback(async () => {
    try {
      const res = await hrApi.getAppraisals();
      setAppraisals(Array.isArray(res.data) ? res.data : []);
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to load performance reviews'));
    }
  }, []);

  const loadEmployees = useCallback(async () => {
    if (!isHrAdmin) return;
    try {
      const res = await hrApi.getEmployees();
      const list: Employee[] = Array.isArray(res.data) ? res.data : [];
      setEmployees(list.filter(e => e.status !== 'terminated').sort((a, b) => a.name.localeCompare(b.name)));
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to load employees'));
    }
  }, [isHrAdmin]);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    Promise.all([loadAppraisals(), loadEmployees()]).finally(() => {
      if (active) setIsLoading(false);
    });
    return () => { active = false; };
  }, [loadAppraisals, loadEmployees]);

  const years = useMemo(() => {
    const set = new Set<number>(yearOptions());
    appraisals.forEach(a => { if (Number(a.year)) set.add(Number(a.year)); });
    return Array.from(set).sort((a, b) => b - a);
  }, [appraisals]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return appraisals
      .filter(a => (yearFilter === 'all' || Number(a.year) === Number(yearFilter)) &&
        (!isHrAdmin || !term || (a.name || '').toLowerCase().includes(term)))
      .sort((a, b) => Number(b.year) - Number(a.year) || createdTime(b) - createdTime(a) || b.id - a.id);
  }, [appraisals, yearFilter, search, isHrAdmin]);

  const openCreate = () => {
    setForm(emptyForm());
    setIsCreateOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const score = Number(form.score);
    const year = Number(form.year);
    if (!form.employee_id) return toast.error('Choose an employee');
    if (!form.period.trim()) return toast.error('Enter the review period (e.g. Q1 or H2)');
    if (form.score === '' || !Number.isFinite(score) || score < 0 || score > 100) return toast.error('Score must be between 0 and 100');
    setIsSaving(true);
    try {
      await hrApi.submitAppraisal({
        employee_id: form.employee_id,
        year,
        period: form.period.trim(),
        score,
        feedback: form.feedback.trim(),
      });
      toast.success('Performance review recorded');
      setIsCreateOpen(false);
      await loadAppraisals();
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to save performance review'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-bold mr-auto">{isHrAdmin ? 'Performance reviews' : 'My performance reviews'}</h2>
        {isHrAdmin && (
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#8E9299]" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search staff..." className="pl-9 w-56 bg-white rounded-xl" />
          </div>
        )}
        <Select value={yearFilter} onValueChange={setYearFilter}>
          <SelectTrigger className="w-32 bg-white rounded-xl"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All years</SelectItem>
            {years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
          </SelectContent>
        </Select>
        {isHrAdmin && (
          <Button onClick={openCreate} className="bg-[#141414] text-white gap-2 rounded-xl h-10 px-6">
            <Award className="w-4 h-4" /> New performance review
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-[#8E9299]" /></div>
      ) : visible.length === 0 ? (
        <div className="py-12 text-center text-[#8E9299]">
          {appraisals.length === 0
            ? (isHrAdmin ? 'No performance reviews recorded yet.' : 'You have no performance reviews yet.')
            : 'No reviews match these filters.'}
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {visible.map(a => (
            <Card key={a.id} className="border-none shadow-sm rounded-2xl overflow-hidden">
              <CardHeader className="bg-[#F5F5F5]/30 flex flex-row items-center justify-between pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white shadow-sm flex items-center justify-center"><Award className="w-5 h-5 text-blue-600" /></div>
                  <div>
                    <CardTitle className="text-lg">{a.name}</CardTitle>
                    <CardDescription>{a.period} {a.year} review</CardDescription>
                  </div>
                </div>
                <div className="text-right">
                  <div className={`text-2xl font-black ${scoreColour(Number(a.score))}`}>{a.score}</div>
                  <div className="text-[10px] font-bold uppercase text-[#8E9299]">Score</div>
                </div>
              </CardHeader>
              <CardContent className="p-6">
                {a.feedback
                  ? <div className="p-4 bg-[#F5F5F5] rounded-xl text-sm italic text-[#141414]/70 whitespace-pre-line">{a.feedback}</div>
                  : <div className="text-sm text-[#8E9299]">No feedback recorded.</div>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {isHrAdmin && (
        <Dialog open={isCreateOpen} onOpenChange={open => { if (!isSaving) setIsCreateOpen(open); }}>
          <DialogContent className="max-w-2xl">
            <form onSubmit={handleSubmit}>
              <DialogHeader>
                <DialogTitle>New performance review</DialogTitle>
                <DialogDescription>The employee can see this review once it is saved.</DialogDescription>
              </DialogHeader>
              <div className="py-4 grid gap-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>Employee</Label>
                    <Select value={form.employee_id} onValueChange={employee_id => setForm(f => ({ ...f, employee_id }))}>
                      <SelectTrigger className="bg-[#F5F5F5] border-none rounded-xl h-11"><SelectValue placeholder="Select staff..." /></SelectTrigger>
                      <SelectContent>
                        {employees.length === 0
                          ? <div className="p-3 text-sm text-[#8E9299]">No active employees.</div>
                          : employees.map(e => <SelectItem key={e.id} value={String(e.id)}>{e.name}{e.department ? ` (${e.department})` : ''}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="grid gap-2">
                      <Label>Period</Label>
                      <Input value={form.period} onChange={e => setForm(f => ({ ...f, period: e.target.value }))} placeholder="Q1" required className="bg-[#F5F5F5] border-none rounded-xl h-11" />
                    </div>
                    <div className="grid gap-2">
                      <Label>Year</Label>
                      <Select value={form.year} onValueChange={year => setForm(f => ({ ...f, year }))}>
                        <SelectTrigger className="bg-[#F5F5F5] border-none rounded-xl h-11"><SelectValue /></SelectTrigger>
                        <SelectContent>{yearOptions().map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>Score (0-100)</Label>
                  <Input type="number" min="0" max="100" required value={form.score} onChange={e => setForm(f => ({ ...f, score: e.target.value }))} className="bg-[#F5F5F5] border-none rounded-xl h-11" />
                </div>
                <div className="grid gap-2">
                  <Label>Feedback</Label>
                  <Textarea value={form.feedback} onChange={e => setForm(f => ({ ...f, feedback: e.target.value }))} placeholder="Describe performance and development areas..." className="bg-[#F5F5F5] border-none rounded-xl min-h-[120px]" />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)} disabled={isSaving} className="rounded-xl">Cancel</Button>
                <Button type="submit" disabled={isSaving} className="bg-[#141414] text-white rounded-xl h-11 font-bold gap-2">
                  {isSaving && <Loader2 className="w-4 h-4 animate-spin" />} Save review
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
