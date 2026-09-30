import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarCheck,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  Eraser,
  Loader2,
  Save,
  Search,
  Timer,
  UserCheck,
  Users,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Badge } from '../../ui/badge';
import { Checkbox } from '../../ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui/tabs';
import { hrApi, projectsApi, settingsApi } from '../../../lib/api';
import { MONTHS } from '../../../lib/payrollCalc';
import { formatDate, todayIso } from '../../../lib/dates';
import { useAuth } from '../../../contexts/AuthContext';
import type { AttendanceRow, Employee, Setting } from './types';
import {
  ATTENDANCE_EDIT_ROLES,
  ATTENDANCE_VIEW_ROLES,
  currencySymbol,
  downloadWorkbook,
  errorMessage,
  getSetting,
  money,
  yearOptions,
} from './utils';

const ATTENDANCE_TYPES = ['Present', 'Half Day', 'Absent', 'Leave', 'Sick'] as const;
type AttendanceType = (typeof ATTENDANCE_TYPES)[number];
const GENERAL = 'none';

type RosterEmployee = Pick<Employee, 'id' | 'name' | 'department' | 'role' | 'status'> & { wage_type?: string | null };

interface ProjectOption { id: string; name: string }

interface SheetRow {
  employee_id: string;
  name: string;
  department: string;
  wage_type: string;
  include: boolean;
  attendance: AttendanceType;
  hours: string;
  overtime_hours: string;
  description: string;
}

interface SummaryProject {
  project_id: string | null;
  project_name: string;
  hours: number;
  overtime_hours: number;
  labour_cost: number;
  employees?: number;
}

interface SummaryEmployee {
  employee_id: string;
  name: string;
  department?: string | null;
  wage_type?: string | null;
  rate: number;
  days_present: number;
  days_absent: number;
  days_leave: number;
  hours: number;
  overtime_hours: number;
  estimated_pay: number;
  projects: SummaryProject[];
}

interface AttendanceSummary {
  month: string;
  year: number;
  employees: SummaryEmployee[];
  projects: SummaryProject[];
}

const isWorked = (a: string) => a === 'Present' || a === 'Half Day';
const toAttendance = (value: unknown): AttendanceType =>
  (ATTENDANCE_TYPES as readonly string[]).includes(String(value)) ? (value as AttendanceType) : 'Present';
const num = (value: unknown) => Number(value) || 0;
const fmtHours = (value: unknown) => num(value).toLocaleString(undefined, { maximumFractionDigits: 2 });

const labelClass = 'text-[10px] font-bold uppercase text-[#8E9299]';
const fieldClass = 'bg-[#F5F5F5] border-none rounded-xl h-11';

function WageBadge({ type }: { type?: string | null }) {
  const hourly = type === 'Hourly';
  return (
    <Badge className={`border-none text-[10px] uppercase ${hourly ? 'bg-blue-100 text-blue-700' : 'bg-[#F5F5F5] text-[#141414]'}`}>
      {type || 'Salaried'}
    </Badge>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <Card className="border-none shadow-sm rounded-2xl">
      <CardContent className="p-5 flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-[#F5F5F5] flex items-center justify-center">
          <Icon className="w-5 h-5 text-[#141414]" />
        </div>
        <div>
          <p className={labelClass}>{label}</p>
          <p className="text-xl font-bold text-[#141414]">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Attendance() {
  const { user } = useAuth();
  const role = user?.role || '';
  const canEdit = ATTENDANCE_EDIT_ROLES.includes(role);
  const canView = canEdit || ATTENDANCE_VIEW_ROLES.includes(role);

  const [tab, setTab] = useState('register');
  const [metaLoading, setMetaLoading] = useState(true);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [roster, setRoster] = useState<RosterEmployee[]>([]);
  const [standardHours, setStandardHours] = useState(8);
  const [symbol, setSymbol] = useState('GH₵');

  const [date, setDate] = useState(todayIso());
  const [projectId, setProjectId] = useState(GENERAL);
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [hasSavedSheet, setHasSavedSheet] = useState(false);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const sheetRequest = useRef(0);

  const [month, setMonth] = useState(MONTHS[new Date().getMonth()]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [summary, setSummary] = useState<AttendanceSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const summaryRequest = useRef(0);

  useEffect(() => {
    if (!canView) return;
    (async () => {
      setMetaLoading(true);
      const [settingsRes, projectsRes, rosterRes] = await Promise.allSettled([
        settingsApi.getSettings(),
        projectsApi.getProjects(),
        canEdit ? hrApi.getAttendanceRoster() : Promise.resolve({ data: [] }),
      ]);
      if (settingsRes.status === 'fulfilled') {
        const settings: Setting[] = Array.isArray(settingsRes.value.data) ? settingsRes.value.data : [];
        setSymbol(currencySymbol(settings));
        try {
          const config = JSON.parse(getSetting(settings, 'payroll_config') || '{}');
          const hrs = Number(config?.standard_hours_per_day);
          if (hrs > 0 && hrs <= 24) setStandardHours(hrs);
        } catch {
          // Malformed payroll config: keep the 8-hour default.
        }
      }
      if (projectsRes.status === 'fulfilled') {
        const list: any[] = Array.isArray(projectsRes.value.data) ? projectsRes.value.data : [];
        setProjects(list.map(p => ({ id: String(p.id), name: String(p.name || p.id) })));
      } else {
        toast.error(errorMessage(projectsRes.reason, 'Could not load projects'));
      }
      if (rosterRes.status === 'fulfilled') {
        setRoster(Array.isArray(rosterRes.value.data) ? rosterRes.value.data : []);
      } else {
        toast.error(errorMessage(rosterRes.reason, 'Could not load the employee roster'));
      }
      setMetaLoading(false);
    })();
  }, [canEdit, canView]);

  const loadSheet = useCallback(async () => {
    const request = ++sheetRequest.current;
    setSheetLoading(true);
    try {
      const res = await hrApi.getAttendance(date, projectId);
      if (request !== sheetRequest.current) return;
      const existing: AttendanceRow[] = Array.isArray(res.data) ? res.data : [];
      const saved = new Map(existing.map(r => [String(r.employee_id), r]));
      const hasSaved = existing.length > 0;

      const fromSaved = (r: AttendanceRow, base?: RosterEmployee): SheetRow => {
        const attendance = toAttendance(r.attendance);
        return {
          employee_id: String(r.employee_id),
          name: base?.name || r.employee_name || String(r.employee_id),
          department: base?.department || '',
          wage_type: base?.wage_type || '',
          include: true,
          attendance,
          hours: String(isWorked(attendance) ? num(r.hours) : 0),
          overtime_hours: String(isWorked(attendance) ? num(r.overtime_hours) : 0),
          description: r.description || '',
        };
      };

      let next: SheetRow[];
      if (canEdit) {
        next = roster.map(emp => {
          const r = saved.get(String(emp.id));
          if (r) return fromSaved(r, emp);
          return {
            employee_id: String(emp.id),
            name: emp.name,
            department: emp.department || '',
            wage_type: emp.wage_type || '',
            include: !hasSaved,
            attendance: 'Present',
            hours: String(standardHours),
            overtime_hours: '0',
            description: '',
          };
        });
        // Saved rows for employees no longer on the roster (e.g. terminated since) stay visible.
        const rosterIds = new Set(roster.map(e => String(e.id)));
        existing.filter(r => !rosterIds.has(String(r.employee_id))).forEach(r => next.push(fromSaved(r)));
      } else {
        next = existing.map(r => fromSaved(r));
      }
      setRows(next);
      setHasSavedSheet(hasSaved);
    } catch (error) {
      if (request !== sheetRequest.current) return;
      setRows([]);
      setHasSavedSheet(false);
      toast.error(errorMessage(error, 'Could not load attendance'));
    } finally {
      if (request === sheetRequest.current) setSheetLoading(false);
    }
  }, [date, projectId, roster, canEdit, standardHours]);

  useEffect(() => {
    if (canView && !metaLoading && date) loadSheet();
  }, [canView, metaLoading, date, loadSheet]);

  const loadSummary = useCallback(async () => {
    const request = ++summaryRequest.current;
    setSummaryLoading(true);
    try {
      const res = await hrApi.getAttendanceSummary(month, year);
      if (request !== summaryRequest.current) return;
      setSummary(res.data);
      setExpanded(new Set());
    } catch (error) {
      if (request !== summaryRequest.current) return;
      setSummary(null);
      toast.error(errorMessage(error, 'Could not load the attendance summary'));
    } finally {
      if (request === summaryRequest.current) setSummaryLoading(false);
    }
  }, [month, year]);

  useEffect(() => {
    if (canView && tab === 'summary') loadSummary();
  }, [canView, tab, loadSummary]);

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => `${r.name} ${r.department} ${r.employee_id}`.toLowerCase().includes(q));
  }, [rows, search]);

  const counts = useMemo(() => {
    const included = rows.filter(r => r.include);
    return {
      included: included.length,
      present: included.filter(r => isWorked(r.attendance)).length,
      absent: included.filter(r => r.attendance === 'Absent').length,
      leave: included.filter(r => r.attendance === 'Leave' || r.attendance === 'Sick').length,
      hours: included.reduce((sum, r) => sum + (isWorked(r.attendance) ? num(r.hours) + num(r.overtime_hours) : 0), 0),
    };
  }, [rows]);

  const updateRow = (id: string, patch: Partial<SheetRow>) =>
    setRows(rs => rs.map(r => (r.employee_id === id ? { ...r, ...patch } : r)));

  const changeAttendance = (row: SheetRow, value: AttendanceType) => {
    const half = standardHours / 2;
    const patch: Partial<SheetRow> = { attendance: value, include: true };
    if (!isWorked(value)) {
      patch.hours = '0';
      patch.overtime_hours = '0';
    } else if (!isWorked(row.attendance) || num(row.hours) === 0) {
      patch.hours = String(value === 'Half Day' ? half : standardHours);
    } else if (value === 'Half Day' && num(row.hours) === standardHours) {
      patch.hours = String(half);
    } else if (value === 'Present' && num(row.hours) === half) {
      patch.hours = String(standardHours);
    }
    updateRow(row.employee_id, patch);
  };

  const visibleIds = useMemo(() => new Set(visibleRows.map(r => r.employee_id)), [visibleRows]);
  const allVisibleIncluded = visibleRows.length > 0 && visibleRows.every(r => r.include);

  const setVisibleIncluded = (include: boolean) =>
    setRows(rs => rs.map(r => (visibleIds.has(r.employee_id) ? { ...r, include } : r)));

  const markAllPresent = () =>
    setRows(rs => rs.map(r => (visibleIds.has(r.employee_id)
      ? { ...r, include: true, attendance: 'Present', hours: String(standardHours) }
      : r)));

  const handleSave = async () => {
    if (date > todayIso()) return toast.error('Attendance cannot be recorded for a future date');
    const included = rows.filter(r => r.include);
    if (included.length === 0) return toast.error('Tick at least one employee to save');
    const invalid = included.find(r => {
      if (!isWorked(r.attendance)) return false;
      const h = Number(r.hours);
      const ot = Number(r.overtime_hours || 0);
      return !Number.isFinite(h) || !Number.isFinite(ot) || h < 0 || ot < 0 || h + ot > 24;
    });
    if (invalid) return toast.error(`${invalid.name}: hours plus overtime must be between 0 and 24`);

    setSaving(true);
    try {
      const res = await hrApi.saveAttendance({
        date,
        project_id: projectId === GENERAL ? null : projectId,
        entries: included.map(r => {
          const worked = isWorked(r.attendance);
          return {
            employee_id: r.employee_id,
            attendance: r.attendance,
            hours: worked ? num(r.hours) : 0,
            overtime_hours: worked ? num(r.overtime_hours) : 0,
            description: r.description.trim() || null,
          };
        }),
      });
      toast.success(res.data?.message || 'Attendance saved');
      await loadSheet();
    } catch (error) {
      toast.error(errorMessage(error, 'Could not save attendance'));
    } finally {
      setSaving(false);
    }
  };

  const summaryTotals = useMemo(() => {
    const employees = summary?.employees || [];
    return {
      employees: employees.length,
      hours: employees.reduce((s, e) => s + num(e.hours), 0),
      overtime: employees.reduce((s, e) => s + num(e.overtime_hours), 0),
      cost: employees.reduce((s, e) => s + num(e.estimated_pay), 0),
    };
  }, [summary]);

  const toggleExpanded = (id: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const exportSummary = () => {
    if (!summary) return;
    downloadWorkbook(`Attendance_${summary.month}_${summary.year}.xlsx`, [
      {
        name: 'Employees',
        rows: [
          ['Employee ID', 'Name', 'Department', 'Wage type', 'Rate', 'Days present', 'Days absent', 'Days leave', 'Hours', 'Overtime hours', 'Estimated pay'],
          ...summary.employees.map(e => [
            e.employee_id, e.name, e.department || '', e.wage_type || 'Salaried', num(e.rate),
            num(e.days_present), num(e.days_absent), num(e.days_leave), num(e.hours), num(e.overtime_hours), num(e.estimated_pay),
          ]),
        ],
      },
      {
        name: 'Projects',
        rows: [
          ['Project ID', 'Project', 'Employees', 'Hours', 'Overtime hours', 'Labour cost'],
          ...summary.projects.map(p => [
            p.project_id || '', p.project_name, num(p.employees), num(p.hours), num(p.overtime_hours), num(p.labour_cost),
          ]),
        ],
      },
      {
        name: 'Employee by project',
        rows: [
          ['Employee ID', 'Name', 'Project ID', 'Project', 'Hours', 'Overtime hours', 'Labour cost'],
          ...summary.employees.flatMap(e => e.projects.map(p => [
            e.employee_id, e.name, p.project_id || '', p.project_name, num(p.hours), num(p.overtime_hours), num(p.labour_cost),
          ])),
        ],
      },
    ]);
  };

  if (!canView) {
    return (
      <Card className="border-none shadow-sm rounded-2xl">
        <CardContent className="p-10 text-center text-sm text-[#8E9299]">
          You do not have access to attendance records.
        </CardContent>
      </Card>
    );
  }

  if (metaLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-[#141414]" />
      </div>
    );
  }

  const projectLabel = projectId === GENERAL
    ? 'General / office'
    : `${projectId} - ${projects.find(p => p.id === projectId)?.name || ''}`;

  return (
    <Tabs value={tab} onValueChange={setTab} className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-[#141414]">Attendance & timesheets</h2>
          <p className="text-sm text-[#8E9299]">Daily site and office register, with monthly hours and labour cost.</p>
        </div>
        <TabsList className="bg-white rounded-xl shadow-sm h-11">
          <TabsTrigger value="register" className="rounded-lg">Daily register</TabsTrigger>
          <TabsTrigger value="summary" className="rounded-lg">Monthly summary</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="register" className="space-y-6 mt-0">
        <Card className="border-none shadow-sm rounded-2xl">
          <CardContent className="p-5 grid gap-4 md:grid-cols-[180px_minmax(0,1fr)_minmax(0,1fr)]">
            <div className="grid gap-2">
              <Label className={labelClass}>Date</Label>
              <Input type="date" value={date} max={todayIso()} onChange={e => setDate(e.target.value)} className={fieldClass} />
            </div>
            <div className="grid gap-2">
              <Label className={labelClass}>Project / site</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger className={fieldClass}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={GENERAL}>General / office</SelectItem>
                  {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.id} - {p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label className={labelClass}>Search employees</Label>
              <div className="relative">
                <Search className="w-4 h-4 text-[#8E9299] absolute left-3 top-1/2 -translate-y-1/2" />
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, department or ID" className={`${fieldClass} pl-9`} />
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          <StatCard icon={UserCheck} label="Present" value={String(counts.present)} />
          <StatCard icon={Users} label="Absent" value={String(counts.absent)} />
          <StatCard icon={CalendarCheck} label="On leave / sick" value={String(counts.leave)} />
          <StatCard icon={Clock} label="Total hours" value={fmtHours(counts.hours)} />
        </div>

        <Card className="border-none shadow-sm rounded-2xl overflow-hidden">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
            <div>
              <CardTitle className="text-base font-bold">{formatDate(date)} · {projectLabel}</CardTitle>
              <p className="text-xs text-[#8E9299] mt-1">
                {hasSavedSheet ? 'A sheet has been saved for this day.' : 'No sheet saved for this day yet.'}
                {canEdit && ` ${counts.included} of ${rows.length} employee(s) ticked. Unticked employees are left unchanged.`}
              </p>
            </div>
            {canEdit ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" className="rounded-xl" onClick={markAllPresent} disabled={sheetLoading || saving || visibleRows.length === 0}>
                  <UserCheck className="w-4 h-4 mr-2" /> Mark all present
                </Button>
                <Button variant="outline" className="rounded-xl" onClick={() => setVisibleIncluded(false)} disabled={sheetLoading || saving || visibleRows.length === 0} title="Untick all shown employees">
                  <Eraser className="w-4 h-4 mr-2" /> Clear
                </Button>
                <Button className="bg-[#141414] text-white rounded-xl" onClick={handleSave} disabled={sheetLoading || saving || counts.included === 0}>
                  {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />} Save attendance
                </Button>
              </div>
            ) : (
              <Badge className="bg-[#F5F5F5] text-[#8E9299] border-none">Read only</Badge>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {sheetLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-6 h-6 animate-spin text-[#141414]" />
              </div>
            ) : rows.length === 0 ? (
              <div className="py-16 text-center text-sm text-[#8E9299]">
                {canEdit ? 'No active employees on the roster.' : 'No attendance recorded for this day and project.'}
              </div>
            ) : visibleRows.length === 0 ? (
              <div className="py-16 text-center text-sm text-[#8E9299]">No employees match your search.</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-[#F5F5F5]/50">
                      {canEdit && (
                        <TableHead className="w-10">
                          <Checkbox checked={allVisibleIncluded} onCheckedChange={checked => setVisibleIncluded(!!checked)} aria-label="Include all" />
                        </TableHead>
                      )}
                      <TableHead>Employee</TableHead>
                      <TableHead className="w-[150px]">Attendance</TableHead>
                      <TableHead className="w-[100px]">Hours</TableHead>
                      <TableHead className="w-[100px]">Overtime</TableHead>
                      <TableHead>Note</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleRows.map(r => {
                      const worked = isWorked(r.attendance);
                      const locked = !canEdit;
                      return (
                        <TableRow key={r.employee_id} className={canEdit && !r.include ? 'opacity-50' : ''}>
                          {canEdit && (
                            <TableCell>
                              <Checkbox checked={r.include} onCheckedChange={checked => updateRow(r.employee_id, { include: !!checked })} aria-label={`Include ${r.name}`} />
                            </TableCell>
                          )}
                          <TableCell>
                            <div className="font-semibold text-[#141414]">{r.name}</div>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-xs text-[#8E9299]">{r.department || r.employee_id}</span>
                              {r.wage_type && <WageBadge type={r.wage_type} />}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Select value={r.attendance} onValueChange={v => changeAttendance(r, toAttendance(v))} disabled={locked}>
                              <SelectTrigger className="h-9 rounded-lg"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {ATTENDANCE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Input type="number" min={0} max={24} step={0.5} value={r.hours} disabled={locked || !worked}
                              onChange={e => updateRow(r.employee_id, { hours: e.target.value, include: true })} className="h-9 rounded-lg" />
                          </TableCell>
                          <TableCell>
                            <Input type="number" min={0} max={24} step={0.5} value={r.overtime_hours} disabled={locked || !worked}
                              onChange={e => updateRow(r.employee_id, { overtime_hours: e.target.value, include: true })} className="h-9 rounded-lg" />
                          </TableCell>
                          <TableCell>
                            <Input value={r.description} maxLength={500} disabled={locked} placeholder={locked ? '' : 'Task or remark'}
                              onChange={e => updateRow(r.employee_id, { description: e.target.value, include: true })} className="h-9 rounded-lg min-w-[160px]" />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="summary" className="space-y-6 mt-0">
        <Card className="border-none shadow-sm rounded-2xl">
          <CardContent className="p-5 flex flex-wrap items-end gap-4">
            <div className="grid gap-2 w-[180px]">
              <Label className={labelClass}>Month</Label>
              <Select value={month} onValueChange={setMonth}>
                <SelectTrigger className={fieldClass}><SelectValue /></SelectTrigger>
                <SelectContent>{MONTHS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-2 w-[140px]">
              <Label className={labelClass}>Year</Label>
              <Select value={String(year)} onValueChange={v => setYear(Number(v))}>
                <SelectTrigger className={fieldClass}><SelectValue /></SelectTrigger>
                <SelectContent>{yearOptions().map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button className="bg-[#141414] text-white rounded-xl h-11 ml-auto" onClick={exportSummary}
              disabled={summaryLoading || !summary || summary.employees.length === 0}>
              <Download className="w-4 h-4 mr-2" /> Export Excel
            </Button>
          </CardContent>
        </Card>

        {summaryLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-[#141414]" />
          </div>
        ) : !summary || summary.employees.length === 0 ? (
          <Card className="border-none shadow-sm rounded-2xl">
            <CardContent className="py-16 text-center text-sm text-[#8E9299]">
              No attendance recorded for {month} {year}.
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
              <StatCard icon={Users} label="Employees with attendance" value={String(summaryTotals.employees)} />
              <StatCard icon={Clock} label="Total hours" value={fmtHours(summaryTotals.hours)} />
              <StatCard icon={Timer} label="Total overtime" value={fmtHours(summaryTotals.overtime)} />
              <StatCard icon={Wallet} label="Estimated labour cost" value={money(summaryTotals.cost, symbol)} />
            </div>

            <Card className="border-none shadow-sm rounded-2xl overflow-hidden">
              <CardHeader><CardTitle className="text-base font-bold">By employee</CardTitle></CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-[#F5F5F5]/50">
                      <TableHead className="w-8" />
                      <TableHead>Employee</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead>Wage type</TableHead>
                      <TableHead className="text-right">Present</TableHead>
                      <TableHead className="text-right">Absent</TableHead>
                      <TableHead className="text-right">Leave</TableHead>
                      <TableHead className="text-right">Hours</TableHead>
                      <TableHead className="text-right">Overtime</TableHead>
                      <TableHead className="text-right">Estimated pay</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.employees.map(e => {
                      const open = expanded.has(e.employee_id);
                      return (
                        <React.Fragment key={e.employee_id}>
                          <TableRow className="cursor-pointer" onClick={() => toggleExpanded(e.employee_id)}>
                            <TableCell>
                              {open ? <ChevronDown className="w-4 h-4 text-[#8E9299]" /> : <ChevronRight className="w-4 h-4 text-[#8E9299]" />}
                            </TableCell>
                            <TableCell>
                              <div className="font-semibold text-[#141414]">{e.name}</div>
                              <div className="text-xs text-[#8E9299]">{e.employee_id}</div>
                            </TableCell>
                            <TableCell className="text-sm">{e.department || '—'}</TableCell>
                            <TableCell><WageBadge type={e.wage_type} /></TableCell>
                            <TableCell className="text-right">{fmtHours(e.days_present)}</TableCell>
                            <TableCell className="text-right">{fmtHours(e.days_absent)}</TableCell>
                            <TableCell className="text-right">{fmtHours(e.days_leave)}</TableCell>
                            <TableCell className="text-right">{fmtHours(e.hours)}</TableCell>
                            <TableCell className="text-right">{fmtHours(e.overtime_hours)}</TableCell>
                            <TableCell className="text-right font-semibold">{money(e.estimated_pay, symbol)}</TableCell>
                          </TableRow>
                          {open && (
                            <TableRow className="bg-[#F5F5F5]/30 hover:bg-[#F5F5F5]/30">
                              <TableCell />
                              <TableCell colSpan={9} className="py-3">
                                {e.projects.length === 0 ? (
                                  <p className="text-xs text-[#8E9299]">No hours logged against a project.</p>
                                ) : (
                                  <div className="grid gap-1">
                                    <div className={`grid grid-cols-4 gap-4 ${labelClass}`}>
                                      <span>Project</span><span className="text-right">Hours</span><span className="text-right">Overtime</span><span className="text-right">Labour cost</span>
                                    </div>
                                    {e.projects.map(p => (
                                      <div key={p.project_id || GENERAL} className="grid grid-cols-4 gap-4 text-sm">
                                        <span>{p.project_id ? `${p.project_id} - ${p.project_name}` : p.project_name}</span>
                                        <span className="text-right">{fmtHours(p.hours)}</span>
                                        <span className="text-right">{fmtHours(p.overtime_hours)}</span>
                                        <span className="text-right">{money(p.labour_cost, symbol)}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card className="border-none shadow-sm rounded-2xl overflow-hidden">
              <CardHeader><CardTitle className="text-base font-bold">By project</CardTitle></CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                {summary.projects.length === 0 ? (
                  <div className="py-10 text-center text-sm text-[#8E9299]">No project hours this month.</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-[#F5F5F5]/50">
                        <TableHead>Project</TableHead>
                        <TableHead className="text-right">Employees</TableHead>
                        <TableHead className="text-right">Hours</TableHead>
                        <TableHead className="text-right">Overtime</TableHead>
                        <TableHead className="text-right">Labour cost</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {summary.projects.map(p => (
                        <TableRow key={p.project_id || GENERAL}>
                          <TableCell className="font-semibold text-[#141414]">
                            {p.project_id ? `${p.project_id} - ${p.project_name}` : p.project_name}
                          </TableCell>
                          <TableCell className="text-right">{num(p.employees)}</TableCell>
                          <TableCell className="text-right">{fmtHours(p.hours)}</TableCell>
                          <TableCell className="text-right">{fmtHours(p.overtime_hours)}</TableCell>
                          <TableCell className="text-right font-semibold">{money(p.labour_cost, symbol)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </>
        )}

        <p className="text-xs text-[#8E9299] leading-relaxed">
          Hourly staff are costed at their hourly rate, with overtime at the multiplier set in payroll settings. Salaried staff
          are costed at their monthly salary, split across projects in proportion to the hours they logged. Once a month's
          payroll is approved, attendance for that month is locked and can no longer be changed.
        </p>
      </TabsContent>
    </Tabs>
  );
}
