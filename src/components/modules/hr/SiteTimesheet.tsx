import React, { useMemo, useRef, useState } from 'react';
import { Download, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Badge } from '../../ui/badge';
import { Card, CardContent } from '../../ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/table';
import { hrApi } from '../../../lib/api';
import { formatDate, todayIso } from '../../../lib/dates';
import { casualWeek } from '../../../lib/payrollCalc';
import { parseTimesheet, timesheetTemplate, weekDates, type TimesheetEntry, type TimesheetIssue } from '../../../lib/siteTimesheet';
import { downloadWorkbook, errorMessage } from './utils';

const GENERAL = 'none';
const labelClass = 'text-[10px] font-bold uppercase text-[#8E9299]';
const fieldClass = 'bg-[#F5F5F5] border-none rounded-xl h-11';

interface ProjectOption { id: string; name: string }
interface RosterEmployee { id: string; name: string; role?: string | null; wage_type?: string | null; status?: string | null }

const payLabel = (entry: TimesheetEntry) => {
  if (entry.attendance === 'Present') return '1 day';
  if (entry.attendance === 'Half Day') return 'Half day';
  if (entry.attendance === 'Absent') return 'Absent';
  return entry.attendance;
};

async function readSheets(file: File) {
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: 'array', cellDates: true });
  return wb.SheetNames.map(name => ({
    name,
    rows: XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name], { defval: '', raw: false, dateNF: 'yyyy-mm-dd' }),
  }));
}

function pickSheet(sheets: { name: string; rows: Record<string, unknown>[] }[]) {
  const score = (rows: Record<string, unknown>[]) => {
    const keys = Object.keys(rows[0] || {}).map(k => k.toLowerCase());
    let n = 0;
    if (keys.some(k => k.includes('staff') || k.includes('employee'))) n += 2;
    if (keys.some(k => k.includes('hours') && /\d{4}/.test(k))) n += 3;
    if (keys.some(k => k === 'date' || k.startsWith('date'))) n += 2;
    return n;
  };
  return [...sheets].sort((a, b) => score(b.rows) - score(a.rows))[0];
}

export default function SiteTimesheet({
  canEdit,
  projects,
  roster,
  fullDay,
  initialDate,
  onImported,
}: {
  canEdit: boolean;
  projects: ProjectOption[];
  roster: RosterEmployee[];
  fullDay: number;
  initialDate: string;
  onImported: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [weekOf, setWeekOf] = useState(initialDate || todayIso());
  const [projectId, setProjectId] = useState(GENERAL);
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState('');
  const [entries, setEntries] = useState<TimesheetEntry[]>([]);
  const [issues, setIssues] = useState<TimesheetIssue[]>([]);
  const [saving, setSaving] = useState(false);

  const dates = useMemo(() => weekDates(weekOf), [weekOf]);
  const range = `${formatDate(dates[0])} – ${formatDate(dates[dates.length - 1])}`;
  const casuals = roster.filter(e => e.wage_type === 'Daily');
  const projectName = projects.find(p => p.id === projectId)?.name || '';

  const download = () => {
    const { start } = casualWeek(weekOf);
    downloadWorkbook(`Site_Timesheet_${start}.xlsx`, timesheetTemplate({
      weekOf,
      projectId: projectId === GENERAL ? '' : projectId,
      projectName,
      fullDay,
      workers: casuals.map(e => ({ id: e.id, name: e.name, role: e.role || '' })),
      projects,
    }));
    toast.success(casuals.length
      ? `Timesheet downloaded with ${casuals.length} casual worker${casuals.length === 1 ? '' : 's'}`
      : 'Timesheet downloaded. Add staff IDs for anyone who worked.');
  };

  const onFile = async (file?: File) => {
    if (!file) return;
    setFileName(file.name);
    try {
      const sheets = await readSheets(file);
      const sheet = pickSheet(sheets);
      if (!sheet || sheet.rows.length === 0) {
        setEntries([]);
        setIssues([{ row: 0, message: 'The file has no timesheet rows.' }]);
        setOpen(true);
        return;
      }
      const parsed = parseTimesheet(sheet.rows, {
        defaultProjectId: projectId === GENERAL ? null : projectId,
        fullDay,
        today: todayIso(),
      });
      setEntries(parsed.entries);
      setIssues(parsed.issues);
      setOpen(true);
    } catch (error) {
      toast.error(errorMessage(error, 'Could not read that spreadsheet'));
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const save = async () => {
    if (!entries.length || issues.length) return;
    setSaving(true);
    try {
      const res = await hrApi.importAttendance({
        entries: entries.map(e => ({
          row: e.row,
          employee_id: e.employee_id,
          name: e.name,
          date: e.date,
          project_id: e.project_id,
          hours: e.hours,
          overtime_hours: e.overtime_hours,
          attendance: e.attendance,
          description: e.description,
        })),
      });
      const skipped = Array.isArray(res.data?.skipped) ? res.data.skipped : [];
      toast.success(res.data?.message || 'Timesheet saved');
      if (skipped.length) {
        toast.warning(`${skipped.length} row${skipped.length === 1 ? '' : 's'} skipped`, {
          description: skipped.slice(0, 3).map((s: { message?: string }) => s.message).filter(Boolean).join(' '),
        });
      }
      setOpen(false);
      onImported();
    } catch (error) {
      toast.error(errorMessage(error, 'Could not save the timesheet'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Card className="border-none shadow-sm rounded-2xl">
        <CardContent className="p-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <p className="font-bold text-[#141414] flex items-center gap-2"><FileSpreadsheet className="w-4 h-4" /> Site timesheet</p>
            <p className="text-sm text-[#8E9299] max-w-xl">
              Download the week for casual workers, fill in the hours sent from site, and upload it. Those days and overtime are what casual pay uses.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[180px_220px_auto_auto] lg:items-end">
            <div className="grid gap-2">
              <Label className={labelClass}>Any day in the week</Label>
              <Input type="date" value={weekOf} max={todayIso()} onChange={e => e.target.value && setWeekOf(e.target.value)} className={fieldClass} />
            </div>
            <div className="grid gap-2">
              <Label className={labelClass}>Site on the sheet</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger className={fieldClass}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={GENERAL}>General / office</SelectItem>
                  {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.id} - {p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" className="rounded-xl h-11" onClick={download}>
              <Download className="w-4 h-4 mr-2" /> Download
            </Button>
            {canEdit && (
              <Button className="bg-[#141414] text-white rounded-xl h-11" onClick={() => fileRef.current?.click()}>
                <Upload className="w-4 h-4 mr-2" /> Upload
              </Button>
            )}
          </div>
          {canEdit && <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => onFile(e.target.files?.[0])} />}
        </CardContent>
        <div className="px-5 pb-4 -mt-2 text-xs text-[#8E9299]">{range} · {casuals.length} casual worker{casuals.length === 1 ? '' : 's'} on the download</div>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Upload site timesheet</DialogTitle>
            <DialogDescription>
              {fileName ? `${fileName}. ` : ''}
              {entries.length} day{entries.length === 1 ? '' : 's'} ready to save
              {issues.length ? `, ${issues.length} need fixing before anything is saved` : ''}.
              Blank days are left as they are.
            </DialogDescription>
          </DialogHeader>

          {issues.length > 0 && (
            <div className="rounded-2xl bg-red-50 text-red-800 text-sm p-4 space-y-1">
              {issues.slice(0, 8).map((issue, i) => (
                <p key={`${issue.row}-${i}`}>{issue.row ? `Row ${issue.row}: ` : ''}{issue.message}</p>
              ))}
              {issues.length > 8 && <p>And {issues.length - 8} more.</p>}
            </div>
          )}

          {entries.length > 0 && (
            <div className="overflow-x-auto max-h-80 rounded-xl border border-[#F5F5F5]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Worker</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Hours</TableHead>
                    <TableHead>Overtime</TableHead>
                    <TableHead>Pay</TableHead>
                    <TableHead>Site</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.slice(0, 80).map((e, i) => (
                    <TableRow key={`${e.employee_id}-${e.date}-${i}`}>
                      <TableCell>
                        <div className="font-semibold">{e.name || e.employee_id}</div>
                        <div className="text-xs text-[#8E9299]">{e.employee_id}</div>
                      </TableCell>
                      <TableCell>{formatDate(e.date)}</TableCell>
                      <TableCell>{e.hours}</TableCell>
                      <TableCell>{e.overtime_hours}</TableCell>
                      <TableCell>
                        <Badge className="border-none bg-[#F5F5F5] text-[#141414]">{payLabel(e)}</Badge>
                        {e.warning && <p className="text-[11px] text-amber-700 mt-1 max-w-[180px]">{e.warning}</p>}
                      </TableCell>
                      <TableCell className="text-xs">{e.project_id || 'General / office'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {entries.length > 80 && <p className="text-xs text-[#8E9299] p-3">Showing the first 80 of {entries.length} days.</p>}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" className="rounded-xl" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button className="bg-[#141414] text-white rounded-xl" onClick={save} disabled={saving || !canEdit || !entries.length || issues.length > 0}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Save to attendance
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
