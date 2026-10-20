import { addDays, casualWeek } from './payrollCalc';

export type SheetAttendance = 'Present' | 'Half Day' | 'Absent' | 'Leave' | 'Sick';

export interface TimesheetEntry {
  row: number;
  employee_id: string;
  name: string;
  date: string;
  project_id: string | null;
  hours: number;
  overtime_hours: number;
  attendance: SheetAttendance;
  description: string | null;
  warning?: string;
}

export interface TimesheetIssue {
  row: number;
  message: string;
}

export interface TimesheetWorker {
  id: string;
  name: string;
  role: string;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_INDEX: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function weekDates(anchor: string): string[] {
  const { start } = casualWeek(anchor);
  return Array.from({ length: 6 }, (_, i) => addDays(start, i));
}

export function dayHeading(iso: string, kind: 'hours' | 'overtime'): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${kind}`;
}

const keyOf = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

function headerDate(header: string): { date: string; kind: 'hours' | 'overtime' } | null {
  const text = header.trim().toLowerCase().replace(/\s+/g, ' ');
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})\s+(hours|overtime)(?:\s+hours)?$/);
  if (iso) return { date: `${iso[1]}-${iso[2]}-${iso[3]}`, kind: iso[4] === 'hours' ? 'hours' : 'overtime' };
  const named = text.match(/^(?:mon|tue|wed|thu|fri|sat|sun)\s+(\d{1,2})\s+([a-z]+)\s+(\d{4})\s+(hours|overtime)(?:\s+hours)?$/);
  if (!named) return null;
  const month = MONTH_INDEX[named[2].slice(0, 3)];
  if (month === undefined) return null;
  const day = Number(named[1]);
  const year = Number(named[3]);
  const isoDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const check = new Date(`${isoDate}T00:00:00Z`);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month || check.getUTCDate() !== day) return null;
  return { date: isoDate, kind: named[4] === 'hours' ? 'hours' : 'overtime' };
}

function column(row: Record<string, unknown>, aliases: string[]): unknown {
  const wanted = new Set(aliases.map(keyOf));
  for (const [header, value] of Object.entries(row)) {
    if (wanted.has(keyOf(header))) return value;
  }
  return undefined;
}

interface ParsedCell {
  blank: boolean;
  hours: number;
  attendance?: SheetAttendance;
  message?: string;
}

function parseCell(raw: unknown, fullDay: number): ParsedCell {
  const text = String(raw ?? '').trim();
  if (!text) return { blank: true, hours: 0 };
  const token = text.toLowerCase();
  if (token === 'a' || token === 'absent') return { blank: false, hours: 0, attendance: 'Absent' };
  if (token === 'h' || token === 'half' || token === 'half day') return { blank: false, hours: round2(fullDay / 2), attendance: 'Half Day' };
  if (token === 'p' || token === 'present') return { blank: false, hours: fullDay, attendance: 'Present' };
  if (token === 'l' || token === 'leave') return { blank: false, hours: 0, attendance: 'Leave' };
  if (token === 's' || token === 'sick') return { blank: false, hours: 0, attendance: 'Sick' };
  const n = Number(text.replace(/,/g, ''));
  if (!Number.isFinite(n)) return { blank: false, hours: 0, message: `"${text}" is not a number of hours` };
  return { blank: false, hours: round2(n) };
}

function interpretDay(hoursCell: ParsedCell, overtimeCell: ParsedCell, fullDay: number): {
  skip: boolean;
  hours: number;
  overtime: number;
  attendance: SheetAttendance;
  warning?: string;
  message?: string;
} {
  if (hoursCell.message) return { skip: false, hours: 0, overtime: 0, attendance: 'Absent', message: hoursCell.message };
  if (overtimeCell.message) return { skip: false, hours: 0, overtime: 0, attendance: 'Absent', message: overtimeCell.message };
  if (hoursCell.blank && overtimeCell.blank) return { skip: true, hours: 0, overtime: 0, attendance: 'Absent' };

  let attendance = hoursCell.attendance;
  let hours = hoursCell.blank ? 0 : hoursCell.hours;
  let overtime = overtimeCell.blank ? 0 : overtimeCell.hours;
  let warning: string | undefined;

  if (!attendance && overtimeCell.blank && hours > fullDay) {
    overtime = round2(hours - fullDay);
    hours = fullDay;
    warning = `${round2(hours + overtime)} hours: ${fullDay} count as the day and ${overtime} as overtime`;
  }

  if (hours < 0 || overtime < 0 || hours > 24 || overtime > 24 || hours + overtime > 24) {
    return { skip: false, hours, overtime, attendance: 'Absent', message: 'Hours and overtime together must be between 0 and 24' };
  }

  if (!attendance) {
    if (hours === 0 && overtime === 0) attendance = 'Absent';
    else if (hours > 0 && hours <= fullDay / 2 && overtime === 0) attendance = 'Half Day';
    else attendance = 'Present';
  }
  if (attendance === 'Absent' || attendance === 'Leave' || attendance === 'Sick') {
    hours = 0;
    overtime = 0;
  }
  return { skip: false, hours, overtime, attendance, warning };
}

/** Turns a filled site timesheet into one row per worker per day. Blank days are left out. */
export function parseTimesheet(
  rows: Record<string, unknown>[],
  opts: { defaultProjectId?: string | null; fullDay?: number; today?: string } = {},
): { entries: TimesheetEntry[]; issues: TimesheetIssue[] } {
  const fullDay = opts.fullDay && opts.fullDay > 0 ? opts.fullDay : 8;
  const defaultProject = String(opts.defaultProjectId || '').trim() || null;
  const entries: TimesheetEntry[] = [];
  const issues: TimesheetIssue[] = [];
  const seen = new Set<string>();

  const dayColumns = rows.length
    ? Object.keys(rows[0]).map(header => ({ header, parsed: headerDate(header) })).filter(c => c.parsed)
    : [];
  const longForm = dayColumns.length === 0;

  rows.forEach((row, index) => {
    const rowNo = index + 2;
    const employeeId = String(column(row, ['staff id', 'employee id', 'employee_id', 'id']) ?? '').trim();
    const name = String(column(row, ['name', 'full name', 'employee name', 'worker']) ?? '').trim();
    const note = String(column(row, ['note', 'notes', 'description', 'remarks']) ?? '').trim();
    const projectRaw = String(column(row, ['project id', 'project', 'site']) ?? '').trim();
    const projectId = projectRaw || defaultProject;
    if (!employeeId && !name) return;

    const days: { date: string; hours: ParsedCell; overtime: ParsedCell }[] = [];
    if (longForm) {
      const date = String(column(row, ['date', 'day']) ?? '').trim().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        issues.push({ row: rowNo, message: `${name || employeeId}: date must be YYYY-MM-DD` });
        return;
      }
      days.push({
        date,
        hours: parseCell(column(row, ['hours', 'hours worked', 'normal hours']), fullDay),
        overtime: parseCell(column(row, ['overtime', 'overtime hours', 'ot', 'ot hours']), fullDay),
      });
    } else {
      const byDate = new Map<string, { hours: ParsedCell; overtime: ParsedCell }>();
      for (const col of dayColumns) {
        const date = col.parsed!.date;
        const slot = byDate.get(date) || { hours: { blank: true, hours: 0 }, overtime: { blank: true, hours: 0 } };
        slot[col.parsed!.kind] = parseCell(row[col.header], fullDay);
        byDate.set(date, slot);
      }
      for (const [date, slot] of byDate) days.push({ date, ...slot });
    }

    for (const day of days) {
      const interpreted = interpretDay(day.hours, day.overtime, fullDay);
      if (interpreted.skip) continue;
      if (interpreted.message) {
        issues.push({ row: rowNo, message: `${name || employeeId} on ${day.date}: ${interpreted.message}` });
        continue;
      }
      if (opts.today && day.date > opts.today) {
        issues.push({ row: rowNo, message: `${name || employeeId} on ${day.date} is still in the future` });
        continue;
      }
      const stamp = `${(employeeId || name).toLowerCase()}|${day.date}|${(projectId || '').toLowerCase()}`;
      if (seen.has(stamp)) {
        issues.push({ row: rowNo, message: `${name || employeeId} is listed twice for ${day.date}` });
        continue;
      }
      seen.add(stamp);
      entries.push({
        row: rowNo,
        employee_id: employeeId,
        name,
        date: day.date,
        project_id: projectId,
        hours: interpreted.hours,
        overtime_hours: interpreted.overtime,
        attendance: interpreted.attendance,
        description: note || null,
        warning: interpreted.warning,
      });
    }
  });

  return { entries, issues };
}

export function timesheetTemplate(opts: {
  weekOf: string;
  projectId: string;
  projectName: string;
  fullDay: number;
  workers: TimesheetWorker[];
  projects: { id: string; name: string }[];
}): { name: string; rows: (string | number | null)[][] }[] {
  const dates = weekDates(opts.weekOf);
  const fullDay = opts.fullDay > 0 ? opts.fullDay : 8;
  const headers = [
    'Staff ID', 'Name', 'Trade', 'Project ID',
    ...dates.flatMap(date => [dayHeading(date, 'hours'), dayHeading(date, 'overtime')]),
    'Note',
  ];
  const body = opts.workers.map(worker => [
    worker.id,
    worker.name,
    worker.role,
    opts.projectId,
    ...dates.flatMap(() => ['', '']),
    '',
  ]);
  return [
    { name: 'Timesheet', rows: [headers, ...body] },
    {
      name: 'How to fill',
      rows: [
        ['Site timesheet'],
        [],
        [`Week ${dates[0]} to ${dates[dates.length - 1]}`],
        [`Site: ${opts.projectId ? `${opts.projectId} - ${opts.projectName}` : 'General / office'}`],
        [],
        ['Do not change Staff ID or the date headings.'],
        ['Leave a day blank if that worker was not on site. The upload will not change that day.'],
        ['Type 0, or A, if they were absent.'],
        [`A normal day is ${fullDay} hours and is paid as one day. ${fullDay / 2} hours or less is paid as half a day.`],
        [`Hours above ${fullDay} are saved as overtime when the Overtime column is left blank, so casual pay includes them.`],
        ['You can also type P for a full day, H for half a day, L for leave, or S for sick.'],
        ['Project ID is the site. Change it on a row only if that worker was on another project. Codes are on the Projects sheet.'],
        ['Upload this file under HR → Attendance & Timesheets. Then run casual pay for the week.'],
      ],
    },
    {
      name: 'Projects',
      rows: [
        ['Project ID', 'Project'],
        ['', 'General / office'],
        ...opts.projects.map(p => [p.id, p.name]),
      ],
    },
  ];
}
