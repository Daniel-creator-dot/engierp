import { Router, Response } from 'express';
import type { Knex } from 'knex';
import db from '../db';
import { authenticateToken, authorizeRole, AuthRequest } from '../middleware/auth';
import { sendSMS } from '../utils/sms';
import { logAudit } from '../lib/audit';
import { notify } from '../lib/notify';
import { Conn, LedgerError, reverseJournal, round2, sendError, toIsoDate } from '../lib/ledger';
import {
  loadPayrollAccounts, loadPayrollConfig, parseItems, payrollRowValues, postPayroll,
  PAYROLL_ACCOUNT_DEFAULT_CODES, PAYROLL_ACCOUNT_LABELS, PayItem, PayrollConfig,
} from '../lib/payroll';
import { isValidSsnit, MONTHS, normalisePayrollConfig, normaliseSsnit, workingDaysBetween } from '../../../src/lib/payrollCalc';

const router = Router();

// Who may do what. Payroll is prepared by HR/accounts and approved by admin or an accountant;
// leave is approved by admin or HR; site attendance is recorded by HR or the project manager.
const HR_ADMIN = ['hr', 'admin'];
const PAYROLL_PREPARE = ['hr', 'accountant', 'admin'];
const PAYROLL_APPROVE = ['admin', 'accountant'];
const LEAVE_APPROVE = ['admin', 'hr'];
const ATTENDANCE_EDIT = ['admin', 'hr', 'pm'];
const ATTENDANCE_VIEW = ['admin', 'hr', 'pm', 'accountant'];

const EMPLOYEE_STATUSES = ['active', 'on-leave', 'terminated'];
const WAGE_TYPES = ['Salaried', 'Hourly'];
const EMPLOYMENT_TYPES = ['Permanent', 'Contract', 'Casual', 'Intern', 'National Service'];
const LEAVE_TYPES = ['Annual', 'Sick', 'Casual', 'Study', 'Maternity', 'Paternity', 'Compassionate', 'Unpaid'];
const ATTENDANCE_TYPES = ['Present', 'Half Day', 'Absent', 'Leave', 'Sick'];

const EMPLOYEE_FIELDS = [
  'name', 'role', 'department', 'salary', 'joinDate', 'status', 'ssnit', 'ghana_card', 'phone', 'address',
  'bank_name', 'account_name', 'account_number', 'branch', 'wage_type', 'date_of_birth', 'employment_type',
  'probation_end_date', 'contract_end_date', 'exit_date', 'annual_leave_days',
];
const REQUIRED_EMPLOYEE_FIELDS = ['name', 'role', 'department', 'joinDate'];
const EMPLOYEE_DATE_FIELDS = ['joinDate', 'date_of_birth', 'probation_end_date', 'contract_end_date', 'exit_date'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const isValidIsoDate = (value: string) => ISO_DATE.test(value) && !Number.isNaN(new Date(value).getTime());
const hasRole = (req: AuthRequest, roles: string[]) => roles.includes(req.user?.role || '');
const wantsOwn = (req: AuthRequest, privileged: string[]) => req.query.mine === '1' || !hasRole(req, privileged);

class HttpError extends LedgerError {}

const pick = (source: Record<string, any>, keys: string[]) =>
  Object.fromEntries(keys.filter(k => k in (source || {})).map(k => [k, source[k]]));

const monthIndex = (month: unknown) => MONTHS.indexOf(String(month));
const periodRange = (month: string, year: number) => {
  const m = monthIndex(month);
  const pad = (n: number) => String(n).padStart(2, '0');
  const lastDay = new Date(Date.UTC(year, m + 1, 0)).getUTCDate();
  return { start: `${year}-${pad(m + 1)}-01`, end: `${year}-${pad(m + 1)}-${pad(lastDay)}` };
};

function assertPeriod(month: unknown, year: unknown) {
  if (monthIndex(month) < 0) throw new HttpError('Choose a valid month');
  const y = Number(year);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) throw new HttpError('Choose a valid year');
  return { month: String(month), year: y };
}

const isUniqueViolation = (error: any) => error?.code === '23505';

function handle(res: Response, error: any, fallback: string) {
  if (isUniqueViolation(error)) return res.status(409).json({ message: 'That record already exists for this period.' });
  return sendError(res, error, fallback);
}

// In-app notification for the employee's linked login, plus an SMS to the phone on their employee
// record (most site staff have no login).
async function notifyEmployee(employeeId: string, title: string, body: string, link: string) {
  await notify({ employeeId }, title, body, { type: 'hr', link });
  try {
    const employee = await db('employees').where({ id: employeeId }).first();
    if (employee?.phone) await sendSMS(employee.phone, `${title}: ${body}`);
  } catch (error) {
    console.error(`[HR notify] SMS failed for ${employeeId}:`, (error as Error).message);
  }
}

// ---------------------------------------------------------------- Employees

/** Cleans and validates employee input in place. Returns an error message or null. */
function normaliseEmployee(data: Record<string, any>, partial: boolean): string | null {
  for (const key of Object.keys(data)) {
    if (typeof data[key] === 'string') data[key] = data[key].trim();
  }
  for (const field of REQUIRED_EMPLOYEE_FIELDS) {
    if ((!partial || field in data) && !data[field]) return `${field === 'joinDate' ? 'Commencement date' : field[0].toUpperCase() + field.slice(1)} is required`;
  }
  for (const field of EMPLOYEE_DATE_FIELDS) {
    if (!(field in data)) continue;
    const value = data[field] == null ? '' : String(data[field]).slice(0, 10);
    if (!value) data[field] = null;
    else if (!isValidIsoDate(value)) return `Invalid date for ${field}. Use the format YYYY-MM-DD.`;
    else data[field] = value;
  }
  if ('salary' in data) {
    const salary = Number(data.salary);
    if (!Number.isFinite(salary) || salary < 0) return 'Salary must be a positive number';
    data.salary = round2(salary);
  } else if (!partial) {
    data.salary = 0;
  }
  if ('status' in data && !EMPLOYEE_STATUSES.includes(data.status)) return 'Status must be active, on-leave or terminated';
  if (!partial && !data.status) data.status = 'active';
  if ('wage_type' in data && !WAGE_TYPES.includes(data.wage_type)) return 'Wage type must be Salaried or Hourly';
  if (!partial && !data.wage_type) data.wage_type = 'Salaried';
  if ('employment_type' in data) {
    if (!data.employment_type) data.employment_type = null;
    else if (!EMPLOYMENT_TYPES.includes(data.employment_type)) return `Employment type must be one of: ${EMPLOYMENT_TYPES.join(', ')}`;
  }
  if ('ssnit' in data) {
    if (!data.ssnit) data.ssnit = null;
    else {
      data.ssnit = normaliseSsnit(data.ssnit);
      if (!isValidSsnit(data.ssnit)) return 'SSNIT number must be a letter followed by 12 digits (e.g. C018012345678) or a Ghana Card PIN (GHA-123456789-0)';
    }
  }
  if ('annual_leave_days' in data) {
    if (data.annual_leave_days === '' || data.annual_leave_days == null) data.annual_leave_days = null;
    else {
      const days = Number(data.annual_leave_days);
      if (!Number.isInteger(days) || days < 0 || days > 60) return 'Annual leave entitlement must be a whole number of days between 0 and 60';
      data.annual_leave_days = days;
    }
  }
  for (const field of ['ghana_card', 'phone', 'address', 'bank_name', 'account_name', 'account_number', 'branch']) {
    if (field in data && !data[field]) data[field] = null;
  }
  return null;
}

function checkEmployeeDateOrder(data: Record<string, any>): string | null {
  const joinDate = isValidIsoDate(String(data.joinDate || '')) ? data.joinDate : null;
  if (!joinDate) return null;
  if (data.date_of_birth && data.date_of_birth >= joinDate) return 'Date of birth must be before the commencement date';
  for (const field of ['probation_end_date', 'contract_end_date', 'exit_date']) {
    if (data[field] && data[field] < joinDate) return `${field.replace(/_/g, ' ')} cannot be before the commencement date`;
  }
  return null;
}

async function nextEmployeeId(conn: Conn): Promise<string> {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const { rows } = await conn.raw(`SELECT nextval('employee_number_seq') AS n`);
    const id = `EMP-${String(rows[0].n).padStart(4, '0')}`;
    if (!(await conn('employees').where({ id }).first())) return id;
  }
  throw new Error('Could not allocate an employee number');
}

router.get('/employees', authenticateToken, authorizeRole(PAYROLL_PREPARE), async (req, res) => {
  try {
    const employees = await db('employees').select('*').orderBy('name');
    res.json(employees);
  } catch (error) {
    handle(res, error, 'Error fetching employees');
  }
});

router.post('/employees', authenticateToken, authorizeRole(HR_ADMIN), async (req: AuthRequest, res) => {
  try {
    const employee = pick(req.body, EMPLOYEE_FIELDS);
    const error = normaliseEmployee(employee, false) || checkEmployeeDateOrder(employee);
    if (error) return res.status(400).json({ message: error });
    const created = await db.transaction(async trx => {
      const id = await nextEmployeeId(trx);
      await trx('employees').insert({ ...employee, id });
      await logAudit(req, 'create', 'employee', id, undefined, employee, trx);
      return trx('employees').where({ id }).first();
    });
    res.status(201).json(created);
  } catch (error) {
    handle(res, error, 'Error adding employee');
  }
});

router.patch('/employees/:id', authenticateToken, authorizeRole(HR_ADMIN), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const updates = pick(req.body, EMPLOYEE_FIELDS);
    const existing = await db('employees').where({ id }).first();
    if (!existing) return res.status(404).json({ message: 'Employee not found' });
    const error = normaliseEmployee(updates, true) || checkEmployeeDateOrder({ ...existing, ...updates });
    if (error) return res.status(400).json({ message: error });
    if (Object.keys(updates).length === 0) return res.status(400).json({ message: 'Nothing to update' });
    await db('employees').where({ id }).update({ ...updates, updated_at: db.fn.now() });
    logAudit(req, 'update', 'employee', id, pick(existing, Object.keys(updates)), updates);
    res.json({ message: 'Employee file updated' });
  } catch (error) {
    handle(res, error, 'Error updating employee');
  }
});

// Validates a spreadsheet of employees. With dryRun (or any error) nothing is saved.
router.post('/employees/bulk', authenticateToken, authorizeRole(HR_ADMIN), async (req: AuthRequest, res) => {
  try {
    const rows: any[] = Array.isArray(req.body?.employees) ? req.body.employees : [];
    if (rows.length === 0) return res.status(400).json({ message: 'The file has no employee rows' });
    if (rows.length > 1000) return res.status(400).json({ message: 'Import at most 1,000 employees at a time' });

    const existing = await db('employees').select('name', 'ssnit', 'ghana_card');
    const seenSsnit = new Map<string, string>(existing.filter(e => e.ssnit).map(e => [normaliseSsnit(e.ssnit), `existing employee ${e.name}`]));
    const seenCard = new Map<string, string>(existing.filter(e => e.ghana_card).map(e => [String(e.ghana_card).toUpperCase(), `existing employee ${e.name}`]));
    const existingNames = new Set(existing.map(e => String(e.name).trim().toLowerCase()));

    const results = rows.map((raw, index) => {
      const data = pick(raw || {}, EMPLOYEE_FIELDS);
      const errors: string[] = [];
      const warnings: string[] = [];
      const error = normaliseEmployee(data, false) || checkEmployeeDateOrder(data);
      if (error) errors.push(error);
      if (data.ssnit) {
        const key = normaliseSsnit(data.ssnit);
        if (seenSsnit.has(key)) errors.push(`SSNIT number already used by ${seenSsnit.get(key)}`);
        else seenSsnit.set(key, `row ${index + 2}`);
      }
      if (data.ghana_card) {
        const key = String(data.ghana_card).toUpperCase();
        if (seenCard.has(key)) errors.push(`Ghana Card ID already used by ${seenCard.get(key)}`);
        else seenCard.set(key, `row ${index + 2}`);
      }
      if (data.name && existingNames.has(String(data.name).toLowerCase())) warnings.push('An employee with this name already exists');
      if (!data.ssnit) warnings.push('No SSNIT number');
      return { row: index + 2, data, errors, warnings };
    });

    const invalid = results.filter(r => r.errors.length);
    if (req.body?.dryRun || invalid.length) {
      return res.status(req.body?.dryRun ? 200 : 400).json({
        message: invalid.length ? `${invalid.length} row(s) need fixing before import` : `${results.length} row(s) ready to import`,
        valid: invalid.length === 0,
        results,
      });
    }

    const ids = await db.transaction(async trx => {
      const created: string[] = [];
      for (const r of results) {
        const id = await nextEmployeeId(trx);
        await trx('employees').insert({ ...r.data, id });
        created.push(id);
      }
      await logAudit(req, 'bulk_import', 'employee', null, undefined, { count: created.length, ids: created }, trx);
      return created;
    });
    res.status(201).json({ message: `Imported ${ids.length} employee(s)`, ids });
  } catch (error) {
    handle(res, error, 'Error importing employees');
  }
});

// ---------------------------------------------------------------- Leave

async function leaveBalance(conn: Conn, employeeId: string, year: number, config?: PayrollConfig) {
  const cfg = config || await loadPayrollConfig(conn);
  let row = await conn('leave_balances').where({ employee_id: employeeId, year }).first();
  if (!row) {
    const employee = await conn('employees').where({ id: employeeId }).first();
    if (!employee) throw new HttpError('Employee not found', 404);
    const previous = await conn('leave_balances').where({ employee_id: employeeId, year: year - 1 }).first();
    const carried = previous
      ? Math.min(cfg.max_carry_over_days, Math.max(0, Number(previous.entitlement) + Number(previous.carried_over) - Number(previous.used)))
      : 0;
    await conn('leave_balances')
      .insert({ employee_id: employeeId, year, entitlement: employee.annual_leave_days ?? cfg.annual_leave_days, carried_over: carried, used: 0 })
      .onConflict(['employee_id', 'year']).ignore();
    row = await conn('leave_balances').where({ employee_id: employeeId, year }).first();
  }
  const pendingRow = await conn('leave_requests')
    .where({ employee_id: employeeId, type: 'Annual', status: 'Pending' })
    .where('startDate', '>=', `${year}-01-01`).where('startDate', '<=', `${year}-12-31`)
    .sum({ days: 'days' }).first();
  const entitlement = Number(row.entitlement);
  const carriedOver = Number(row.carried_over);
  const used = Number(row.used);
  const pending = Number(pendingRow?.days || 0);
  return {
    employee_id: employeeId, year, entitlement, carried_over: carriedOver, used, pending,
    available: round2(entitlement + carriedOver - used),
    remaining_after_pending: round2(entitlement + carriedOver - used - pending),
  };
}

const LEAVE_SELECT = ['leave_requests.*', 'employees.name as employee_name', 'employees.department as employee_department'];

router.get('/leave-requests', authenticateToken, async (req: AuthRequest, res) => {
  try {
    let query = db('leave_requests').select(LEAVE_SELECT)
      .join('employees', 'leave_requests.employee_id', 'employees.id')
      .orderBy('leave_requests.created_at', 'desc');
    if (wantsOwn(req, LEAVE_APPROVE)) {
      if (!req.user?.employee_id) return res.json([]);
      query = query.where('leave_requests.employee_id', req.user.employee_id);
    }
    const requests = await query;
    res.json(requests.map(r => ({ ...r, days: r.days != null ? Number(r.days) : workingDaysBetween(r.startDate, r.endDate) })));
  } catch (error) {
    handle(res, error, 'Error fetching leave requests');
  }
});

router.post('/leave-requests', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { type, startDate, endDate } = req.body;
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : null;
    const empId = req.user?.employee_id;
    if (!empId) return res.status(400).json({ message: 'Your login is not linked to an employee record. Ask HR to link it.' });
    if (!LEAVE_TYPES.includes(type)) return res.status(400).json({ message: `Leave type must be one of: ${LEAVE_TYPES.join(', ')}` });
    if (!isValidIsoDate(String(startDate || '')) || !isValidIsoDate(String(endDate || ''))) {
      return res.status(400).json({ message: 'Start and end dates are required (YYYY-MM-DD)' });
    }
    if (endDate < startDate) return res.status(400).json({ message: 'End date cannot be before the start date' });
    const days = workingDaysBetween(startDate, endDate);
    if (days === 0) return res.status(400).json({ message: 'The selected dates fall on a weekend; choose at least one working day' });

    const overlap = await db('leave_requests')
      .where({ employee_id: empId }).whereIn('status', ['Pending', 'Approved'])
      .where('startDate', '<=', endDate).where('endDate', '>=', startDate).first();
    if (overlap) return res.status(409).json({ message: `This overlaps your ${overlap.status.toLowerCase()} ${overlap.type} leave from ${overlap.startDate} to ${overlap.endDate}` });

    if (type === 'Annual') {
      const balance = await leaveBalance(db, empId, Number(startDate.slice(0, 4)));
      if (days > balance.remaining_after_pending) {
        return res.status(400).json({
          message: `Not enough annual leave: this request is ${days} working day(s) but you have ${balance.remaining_after_pending} day(s) left${balance.pending ? ` after ${balance.pending} pending day(s)` : ''}.`,
        });
      }
    }

    const [inserted] = await db('leave_requests')
      .insert({ employee_id: empId, type, startDate, endDate, reason, days, status: 'Pending' })
      .returning('id');
    const id = typeof inserted === 'object' ? inserted.id : inserted;
    const employee = await db('employees').where({ id: empId }).first('name');
    notify({ roles: LEAVE_APPROVE }, 'Leave request awaiting approval',
      `${employee?.name || empId}: ${type} leave, ${days} working day(s) from ${startDate} to ${endDate}`,
      { type: 'hr', link: 'hr-leave', excludeUserId: req.user?.id });
    res.status(201).json({ id, days, message: 'Leave request submitted' });
  } catch (error) {
    handle(res, error, 'Error submitting leave request');
  }
});

router.patch('/leave-requests/:id', authenticateToken, authorizeRole(LEAVE_APPROVE), async (req: AuthRequest, res) => {
  try {
    const { status } = req.body;
    const note = typeof req.body.note === 'string' ? req.body.note.trim() || null : null;
    if (!['Approved', 'Rejected'].includes(status)) return res.status(400).json({ message: 'Status must be Approved or Rejected' });

    const request = await db.transaction(async trx => {
      const row = await trx('leave_requests').where({ id: req.params.id }).forUpdate().first();
      if (!row) throw new HttpError('Leave request not found', 404);
      if (row.status !== 'Pending') throw new HttpError(`This request has already been ${row.status.toLowerCase()}`, 409);
      if (row.employee_id === req.user?.employee_id && req.user?.role !== 'admin') {
        throw new HttpError('You cannot decide your own leave request', 403);
      }
      const days = row.days != null ? Number(row.days) : workingDaysBetween(row.startDate, row.endDate);
      if (status === 'Approved' && row.type === 'Annual') {
        const year = Number(String(row.startDate).slice(0, 4));
        const balance = await leaveBalance(trx, row.employee_id, year);
        if (days > balance.available) {
          throw new HttpError(`Only ${balance.available} day(s) of annual leave are available; this request needs ${days}.`);
        }
        await trx('leave_balances').where({ employee_id: row.employee_id, year }).increment('used', days);
      }
      await trx('leave_requests').where({ id: row.id }).update({
        status, days, decided_by: req.user?.id ?? null, decided_at: trx.fn.now(), decision_note: note, updated_at: trx.fn.now(),
      });
      await logAudit(req, status === 'Approved' ? 'approve' : 'reject', 'leave_request', row.id, { status: row.status }, { status, days, note }, trx);
      return { ...row, days };
    });

    notifyEmployee(request.employee_id, `Leave ${status.toLowerCase()}`,
      `Your ${request.type} leave (${request.startDate} to ${request.endDate}) has been ${status.toLowerCase()}.${note ? ` Note: ${note}` : ''}`, 'hr-leave');
    res.json({ message: `Leave request ${status.toLowerCase()}` });
  } catch (error) {
    handle(res, error, 'Error updating leave request');
  }
});

// The requester can withdraw a request that has not been decided yet.
router.patch('/leave-requests/:id/cancel', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const row = await db('leave_requests').where({ id: req.params.id }).first();
    if (!row) return res.status(404).json({ message: 'Leave request not found' });
    if (row.employee_id !== req.user?.employee_id) return res.status(403).json({ message: 'You can only withdraw your own requests' });
    if (row.status !== 'Pending') return res.status(409).json({ message: 'Only pending requests can be withdrawn' });
    await db('leave_requests').where({ id: row.id }).update({ status: 'Cancelled', updated_at: db.fn.now() });
    res.json({ message: 'Leave request withdrawn' });
  } catch (error) {
    handle(res, error, 'Error withdrawing leave request');
  }
});

router.get('/leave-balances', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const year = Number(req.query.year) || new Date().getFullYear();
    const config = await loadPayrollConfig(db);
    if (wantsOwn(req, LEAVE_APPROVE)) {
      if (!req.user?.employee_id) return res.json([]);
      return res.json([await leaveBalance(db, req.user.employee_id, year, config)]);
    }
    const employees = await db('employees').whereNot('status', 'terminated').select('id', 'name', 'department').orderBy('name');
    const balances = [];
    for (const e of employees) balances.push({ ...(await leaveBalance(db, e.id, year, config)), name: e.name, department: e.department });
    res.json(balances);
  } catch (error) {
    handle(res, error, 'Error fetching leave balances');
  }
});

router.put('/leave-balances/:employeeId', authenticateToken, authorizeRole(HR_ADMIN), async (req: AuthRequest, res) => {
  try {
    const year = Number(req.body.year);
    const entitlement = Number(req.body.entitlement);
    const carriedOver = Number(req.body.carried_over ?? 0);
    if (!Number.isInteger(year)) return res.status(400).json({ message: 'Year is required' });
    if (!(entitlement >= 0 && entitlement <= 60) || !(carriedOver >= 0 && carriedOver <= 60)) {
      return res.status(400).json({ message: 'Entitlement and carry-over must be between 0 and 60 days' });
    }
    const before = await leaveBalance(db, req.params.employeeId, year);
    await db('leave_balances').where({ employee_id: req.params.employeeId, year })
      .update({ entitlement, carried_over: carriedOver, updated_at: db.fn.now() });
    logAudit(req, 'update', 'leave_balance', `${req.params.employeeId}/${year}`,
      { entitlement: before.entitlement, carried_over: before.carried_over }, { entitlement, carried_over: carriedOver });
    res.json(await leaveBalance(db, req.params.employeeId, year));
  } catch (error) {
    handle(res, error, 'Error updating leave balance');
  }
});

// ---------------------------------------------------------------- Payroll

const PAYROLL_SELECT = [
  'payroll.*',
  'employees.name', 'employees.department', 'employees.role as employee_role', 'employees.wage_type',
  'employees.ssnit as employee_ssnit', 'employees.ghana_card as employee_ghana_card',
  'employees.bank_name', 'employees.account_name', 'employees.account_number', 'employees.branch',
];

const payrollQuery = (conn: Conn) => conn('payroll').select(PAYROLL_SELECT).join('employees', 'payroll.employee_id', 'employees.id');

async function assertNoDuplicatePayroll(conn: Conn, employeeId: string, month: string, year: number, exceptId?: number) {
  const query = conn('payroll').where({ employee_id: employeeId, month, year }).whereNot('status', 'Rejected');
  if (exceptId) query.whereNot('id', exceptId);
  const existing = await query.first();
  if (existing) throw new HttpError(`Payroll for ${month} ${year} already exists for this employee (status: ${existing.status})`, 409);
}

function cleanItems(value: unknown, label: string): PayItem[] {
  const items = parseItems(value);
  if (items.some(i => i.amount < 0)) throw new HttpError(`${label} cannot be negative`);
  return items;
}

// Own payslips (approved or paid) for everyone; the full register for HR, accounts and admin.
router.get('/payroll', authenticateToken, async (req: AuthRequest, res) => {
  try {
    let query = payrollQuery(db);
    if (wantsOwn(req, PAYROLL_PREPARE)) {
      if (!req.user?.employee_id) return res.json([]);
      query = query.where('payroll.employee_id', req.user.employee_id).whereIn('payroll.status', ['Approved', 'Paid']);
    } else if (req.query.run_id) {
      query = query.where('payroll.run_id', Number(req.query.run_id));
    } else if (req.query.standalone === '1') {
      query = query.whereNull('payroll.run_id');
    }
    const rows = await query.orderBy('payroll.year', 'desc').orderBy('payroll.created_at', 'desc');
    res.json(rows);
  } catch (error) {
    handle(res, error, 'Error fetching payroll');
  }
});

// A one-off payroll entry for one employee (outside a payroll run). It waits for approval.
router.post('/payroll', authenticateToken, authorizeRole(PAYROLL_PREPARE), async (req: AuthRequest, res) => {
  try {
    const { month, year } = assertPeriod(req.body.month, req.body.year);
    const employee = await db('employees').where({ id: req.body.employee_id }).first();
    if (!employee) return res.status(404).json({ message: 'Employee not found' });
    await assertNoDuplicatePayroll(db, employee.id, month, year);
    const config = await loadPayrollConfig(db);
    const hours = req.body.hours_worked != null && req.body.hours_worked !== '' ? Number(req.body.hours_worked) : null;
    const basic = employee.wage_type === 'Hourly' && hours != null ? hours * Number(employee.salary) : Number(req.body.basic ?? req.body.base_salary);
    if (!Number.isFinite(basic) || basic < 0) return res.status(400).json({ message: 'Basic pay must be zero or more' });
    const { values, pay } = payrollRowValues({
      basic,
      allowances: cleanItems(req.body.allowances ?? [], 'Allowances'),
      deductions: cleanItems(req.body.deductions ?? [], 'Deductions'),
    }, config);
    if (pay.net_pay < 0) return res.status(400).json({ message: 'Deductions are larger than gross pay' });
    const paymentDate = req.body.payment_date && isValidIsoDate(req.body.payment_date) ? req.body.payment_date : null;
    const [inserted] = await db('payroll').insert({
      ...values,
      employee_id: employee.id, month, year,
      payment_date: paymentDate,
      hours_worked: hours,
      project_id: req.body.project_id && req.body.project_id !== 'none' ? req.body.project_id : null,
      notes: req.body.notes || null,
      status: 'Pending',
      created_by: req.user?.id ?? null,
    }).returning('id');
    const id = typeof inserted === 'object' ? inserted.id : inserted;
    logAudit(req, 'create', 'payroll', id, undefined, { employee_id: employee.id, month, year, net_pay: pay.net_pay });
    notify({ roles: PAYROLL_APPROVE }, 'Payroll payment awaiting approval',
      `${employee.name}: ${month} ${year}, net pay GHS ${pay.net_pay.toLocaleString()}`,
      { type: 'hr', link: 'hr-payroll', excludeUserId: req.user?.id });
    res.status(201).json({ id, message: 'Payroll entry submitted for approval' });
  } catch (error) {
    handle(res, error, 'Error processing payroll');
  }
});

// Approve (post to the ledger and mark paid) or reject a one-off payroll entry.
router.patch('/payroll/:id', authenticateToken, authorizeRole(PAYROLL_APPROVE), async (req: AuthRequest, res) => {
  try {
    const status = req.body.status === 'Approved' ? 'Paid' : req.body.status;
    if (!['Paid', 'Rejected'].includes(status)) return res.status(400).json({ message: 'Status must be Paid or Rejected' });
    const entry = await db.transaction(async trx => {
      const row = await trx('payroll').where({ id: req.params.id }).forUpdate().first();
      if (!row) throw new HttpError('Payroll entry not found', 404);
      if (row.run_id) throw new HttpError('This entry belongs to a payroll run; approve the run instead', 409);
      if (row.status !== 'Pending') throw new HttpError(`This entry is already ${row.status}`, 409);
      if (status === 'Rejected') {
        await trx('payroll').where({ id: row.id }).update({ status, updated_at: trx.fn.now() });
        await logAudit(req, 'reject', 'payroll', row.id, { status: row.status }, { status }, trx);
        return row;
      }
      const employee = await trx('employees').where({ id: row.employee_id }).first();
      const journalId = await postPayroll(trx, {
        rows: [row],
        date: row.payment_date || toIsoDate(null),
        description: `Payroll: ${employee?.name || row.employee_id} - ${row.month} ${row.year}`,
        referenceType: 'payroll',
        referenceId: row.id,
        projectId: row.project_id,
      });
      await trx('payroll').where({ id: row.id }).update({
        status, journal_id: journalId, approved_by: req.user?.id ?? null, paid_at: trx.fn.now(), updated_at: trx.fn.now(),
      });
      await logAudit(req, 'approve', 'payroll', row.id, { status: row.status }, { status, journal_id: journalId }, trx);
      return row;
    });
    if (status === 'Paid') {
      notifyEmployee(entry.employee_id, 'Payment approved',
        `Your ${entry.month} ${entry.year} pay of GHS ${Number(entry.net_pay).toLocaleString()} has been approved.`, 'hr-payroll');
    }
    res.json({ message: status === 'Paid' ? 'Payroll approved and posted to the ledger' : 'Payroll entry rejected' });
  } catch (error) {
    handle(res, error, 'Error updating payroll status');
  }
});

router.delete('/payroll/:id', authenticateToken, authorizeRole(PAYROLL_PREPARE), async (req, res) => {
  try {
    const row = await db('payroll').where({ id: req.params.id }).first();
    if (!row) return res.status(404).json({ message: 'Payroll entry not found' });
    if (row.run_id) return res.status(409).json({ message: 'Remove it from its payroll run instead' });
    if (!['Pending', 'Rejected'].includes(row.status)) return res.status(409).json({ message: 'Only pending or rejected entries can be deleted' });
    await db('payroll').where({ id: row.id }).del();
    res.json({ message: 'Payroll entry deleted' });
  } catch (error) {
    handle(res, error, 'Error deleting payroll entry');
  }
});

// ---------------------------------------------------------------- Payroll runs

const RUN_TOTALS = [
  db.raw('COUNT(payroll.id)::int as employee_count'),
  db.raw('COALESCE(SUM(payroll.gross), 0) as total_gross'),
  db.raw('COALESCE(SUM(payroll.net_pay), 0) as total_net'),
  db.raw('COALESCE(SUM(payroll.paye), 0) as total_paye'),
  db.raw('COALESCE(SUM(payroll.ssnit_employee), 0) as total_ssnit_employee'),
  db.raw('COALESCE(SUM(payroll.ssnit_employer), 0) as total_ssnit_employer'),
  db.raw('COALESCE(SUM(payroll.other_deductions), 0) as total_other_deductions'),
];

async function loadRun(conn: Conn, id: number | string, lock = false) {
  const query = conn('payroll_runs').where({ id });
  if (lock) query.forUpdate();
  const run = await query.first();
  if (!run) throw new HttpError('Payroll run not found', 404);
  return run;
}

async function hourlyTimesheetTotals(conn: Conn, month: string, year: number) {
  const { start, end } = periodRange(month, year);
  const rows = await conn('timesheets')
    .whereBetween('date', [start, end])
    .groupBy('employee_id')
    .select('employee_id', db.raw('COALESCE(SUM(hours), 0) as hours'), db.raw('COALESCE(SUM(overtime_hours), 0) as overtime'));
  return new Map(rows.map((r: any) => [r.employee_id, { hours: Number(r.hours), overtime: Number(r.overtime) }]));
}

function hourlyPay(rate: number, hours: number, overtime: number, config: PayrollConfig, allowances: PayItem[]) {
  const basic = round2(hours * rate);
  const withoutOvertime = allowances.filter(a => a.type !== 'Overtime');
  const overtimePay = round2(overtime * rate * config.overtime_multiplier);
  return { basic, allowances: overtimePay ? [...withoutOvertime, { type: 'Overtime', amount: overtimePay }] : withoutOvertime };
}

router.get('/payroll-runs', authenticateToken, authorizeRole(PAYROLL_PREPARE), async (req, res) => {
  try {
    const runs = await db('payroll_runs')
      .leftJoin('payroll', 'payroll.run_id', 'payroll_runs.id')
      .groupBy('payroll_runs.id')
      .select('payroll_runs.*', ...RUN_TOTALS)
      .orderBy('payroll_runs.year', 'desc')
      .orderBy('payroll_runs.created_at', 'desc');
    res.json(runs.map(r => ({ ...r, month_index: monthIndex(r.month) })).sort((a, b) => b.year - a.year || b.month_index - a.month_index));
  } catch (error) {
    handle(res, error, 'Error fetching payroll runs');
  }
});

router.get('/payroll-runs/:id', authenticateToken, authorizeRole(PAYROLL_PREPARE), async (req, res) => {
  try {
    const run = await loadRun(db, req.params.id);
    const entries = await payrollQuery(db).where('payroll.run_id', run.id).orderBy('employees.name');
    res.json({ ...run, entries });
  } catch (error) {
    handle(res, error, 'Error fetching payroll run');
  }
});

// Creates a draft run with an entry for every active employee who has no payroll for the period yet.
router.post('/payroll-runs', authenticateToken, authorizeRole(PAYROLL_PREPARE), async (req: AuthRequest, res) => {
  try {
    const { month, year } = assertPeriod(req.body.month, req.body.year);
    const paymentDate = req.body.payment_date && isValidIsoDate(req.body.payment_date) ? req.body.payment_date : null;
    const projectId = req.body.project_id && req.body.project_id !== 'none' ? req.body.project_id : null;
    const { end } = periodRange(month, year);

    const result = await db.transaction(async trx => {
      const clash = await trx('payroll_runs').where({ month, year }).whereNot('status', 'Cancelled').first();
      if (clash) throw new HttpError(`A ${month} ${year} payroll run already exists (status: ${clash.status})`, 409);
      const config = await loadPayrollConfig(trx);
      const employees = await trx('employees')
        .whereIn('status', ['active', 'on-leave'])
        .where(q => q.whereNull('joinDate').orWhere('joinDate', '<=', end))
        .orderBy('name');
      const existing = await trx('payroll').where({ month, year }).whereNot('status', 'Rejected').select('employee_id');
      const already = new Set(existing.map((e: any) => e.employee_id));
      const hours = await hourlyTimesheetTotals(trx, month, year);

      const [inserted] = await trx('payroll_runs').insert({
        month, year, payment_date: paymentDate, project_id: projectId, notes: req.body.notes || null,
        status: 'Draft', created_by: req.user?.id ?? null,
      }).returning('id');
      const runId = typeof inserted === 'object' ? inserted.id : inserted;

      const skipped: string[] = [];
      const rows = [];
      for (const e of employees) {
        if (already.has(e.id)) { skipped.push(e.name); continue; }
        const isHourly = e.wage_type === 'Hourly';
        const worked = hours.get(e.id) || { hours: 0, overtime: 0 };
        const pay = isHourly
          ? hourlyPay(Number(e.salary), worked.hours, worked.overtime, config, [])
          : { basic: Number(e.salary), allowances: [] as PayItem[] };
        const { values } = payrollRowValues({ basic: pay.basic, allowances: pay.allowances, deductions: [] }, config);
        rows.push({
          ...values,
          run_id: runId, employee_id: e.id, month, year, payment_date: paymentDate, project_id: projectId,
          hours_worked: isHourly ? worked.hours : null, overtime_hours: isHourly ? worked.overtime : null,
          notes: isHourly && worked.hours === 0 ? 'No attendance recorded for this month' : null,
          status: 'Draft', created_by: req.user?.id ?? null,
        });
      }
      if (rows.length) await trx('payroll').insert(rows);
      return { id: runId, count: rows.length, skipped };
    });

    res.status(201).json({
      ...result,
      message: `Draft ${month} ${year} payroll created for ${result.count} employee(s)${result.skipped.length ? `; skipped ${result.skipped.length} already paid this period` : ''}.`,
    });
  } catch (error) {
    handle(res, error, 'Error creating payroll run');
  }
});

// Edit one employee's pay in a draft or reviewed run (a reviewed run goes back to draft).
router.patch('/payroll-runs/:id/entries/:entryId', authenticateToken, authorizeRole(PAYROLL_PREPARE), async (req, res) => {
  try {
    const updated = await db.transaction(async trx => {
      const run = await loadRun(trx, req.params.id, true);
      if (!['Draft', 'Reviewed'].includes(run.status)) throw new HttpError(`A ${run.status.toLowerCase()} run can no longer be edited`, 409);
      const entry = await trx('payroll').where({ id: req.params.entryId, run_id: run.id }).first();
      if (!entry) throw new HttpError('Entry not found in this run', 404);
      const employee = await trx('employees').where({ id: entry.employee_id }).first();
      const config = await loadPayrollConfig(trx);

      let allowances = 'allowances' in req.body ? cleanItems(req.body.allowances, 'Allowances') : parseItems(entry.detailed_allowances);
      const deductions = 'deductions' in req.body
        ? cleanItems(req.body.deductions, 'Deductions')
        : parseItems(entry.detailed_deductions).filter(d => !/^SSNIT employee|^PAYE/.test(d.type));
      let basic = Number(entry.base_salary);
      let hoursWorked = entry.hours_worked != null ? Number(entry.hours_worked) : null;
      let overtime = entry.overtime_hours != null ? Number(entry.overtime_hours) : null;

      if (employee?.wage_type === 'Hourly') {
        if ('hours_worked' in req.body) hoursWorked = Number(req.body.hours_worked) || 0;
        if ('overtime_hours' in req.body) overtime = Number(req.body.overtime_hours) || 0;
        if ((hoursWorked ?? 0) < 0 || (overtime ?? 0) < 0) throw new HttpError('Hours cannot be negative');
        const pay = hourlyPay(Number(employee.salary), hoursWorked || 0, overtime || 0, config, allowances);
        basic = pay.basic;
        allowances = pay.allowances;
      } else if ('basic' in req.body) {
        basic = Number(req.body.basic);
        if (!Number.isFinite(basic) || basic < 0) throw new HttpError('Basic pay must be zero or more');
      }

      const { values, pay } = payrollRowValues({ basic, allowances, deductions }, config);
      if (pay.net_pay < 0) throw new HttpError('Deductions are larger than gross pay');
      await trx('payroll').where({ id: entry.id }).update({
        ...values, hours_worked: hoursWorked, overtime_hours: overtime,
        notes: 'notes' in req.body ? (req.body.notes || null) : entry.notes,
        updated_at: trx.fn.now(),
      });
      if (run.status === 'Reviewed') await trx('payroll_runs').where({ id: run.id }).update({ status: 'Draft', reviewed_by: null, reviewed_at: null, updated_at: trx.fn.now() });
      return payrollQuery(trx).where('payroll.id', entry.id).first();
    });
    res.json(updated);
  } catch (error) {
    handle(res, error, 'Error updating payroll entry');
  }
});

router.delete('/payroll-runs/:id/entries/:entryId', authenticateToken, authorizeRole(PAYROLL_PREPARE), async (req, res) => {
  try {
    await db.transaction(async trx => {
      const run = await loadRun(trx, req.params.id, true);
      if (!['Draft', 'Reviewed'].includes(run.status)) throw new HttpError(`A ${run.status.toLowerCase()} run can no longer be edited`, 409);
      const deleted = await trx('payroll').where({ id: req.params.entryId, run_id: run.id }).del();
      if (!deleted) throw new HttpError('Entry not found in this run', 404);
      if (run.status === 'Reviewed') await trx('payroll_runs').where({ id: run.id }).update({ status: 'Draft', reviewed_by: null, reviewed_at: null, updated_at: trx.fn.now() });
    });
    res.json({ message: 'Employee removed from this run' });
  } catch (error) {
    handle(res, error, 'Error removing payroll entry');
  }
});

async function transition(req: AuthRequest, res: Response, from: string[], apply: (trx: Knex.Transaction, run: any) => Promise<string>) {
  try {
    const message = await db.transaction(async trx => {
      const run = await loadRun(trx, req.params.id, true);
      if (!from.includes(run.status)) throw new HttpError(`This run is ${run.status}; that step is not available`, 409);
      return apply(trx, run);
    });
    res.json({ message });
  } catch (error) {
    handle(res, error, 'Error updating payroll run');
  }
}

router.post('/payroll-runs/:id/review', authenticateToken, authorizeRole(PAYROLL_PREPARE), (req: AuthRequest, res) =>
  transition(req, res, ['Draft'], async (trx, run) => {
    const count = await trx('payroll').where({ run_id: run.id }).count<{ count: string }[]>('id as count');
    if (!Number(count[0]?.count)) throw new HttpError('The run has no employees');
    await trx('payroll_runs').where({ id: run.id }).update({ status: 'Reviewed', reviewed_by: req.user?.id ?? null, reviewed_at: trx.fn.now(), updated_at: trx.fn.now() });
    await trx('payroll').where({ run_id: run.id }).update({ status: 'Reviewed', updated_at: trx.fn.now() });
    await logAudit(req, 'review', 'payroll_run', run.id, { status: run.status }, { status: 'Reviewed' }, trx);
    notify({ roles: PAYROLL_APPROVE }, 'Payroll awaiting approval',
      `${run.month} ${run.year} payroll for ${Number(count[0]?.count)} employee(s) is ready for approval.`,
      { type: 'hr', link: 'hr-payroll', excludeUserId: req.user?.id });
    return `${run.month} ${run.year} payroll marked as reviewed and sent for approval`;
  }));

router.post('/payroll-runs/:id/reopen', authenticateToken, authorizeRole(PAYROLL_PREPARE), (req: AuthRequest, res) =>
  transition(req, res, ['Reviewed'], async (trx, run) => {
    await trx('payroll_runs').where({ id: run.id }).update({ status: 'Draft', reviewed_by: null, reviewed_at: null, updated_at: trx.fn.now() });
    await trx('payroll').where({ run_id: run.id }).update({ status: 'Draft', updated_at: trx.fn.now() });
    return 'Run reopened for editing';
  }));

// Approval posts one journal for the whole run.
router.post('/payroll-runs/:id/approve', authenticateToken, authorizeRole(PAYROLL_APPROVE), (req: AuthRequest, res) =>
  transition(req, res, ['Reviewed'], async (trx, run) => {
    const rows = await trx('payroll').where({ run_id: run.id });
    const journalId = await postPayroll(trx, {
      rows,
      date: run.payment_date || toIsoDate(null),
      description: `Payroll run: ${run.month} ${run.year} (${rows.length} employees)`,
      referenceType: 'payroll_run',
      referenceId: run.id,
      projectId: run.project_id,
    });
    await trx('payroll_runs').where({ id: run.id }).update({
      status: 'Approved', journal_id: journalId, approved_by: req.user?.id ?? null, approved_at: trx.fn.now(), updated_at: trx.fn.now(),
    });
    await trx('payroll').where({ run_id: run.id }).update({ status: 'Approved', journal_id: journalId, approved_by: req.user?.id ?? null, updated_at: trx.fn.now() });
    await logAudit(req, 'approve', 'payroll_run', run.id, { status: run.status }, { status: 'Approved', journal_id: journalId, employees: rows.length }, trx);
    return `${run.month} ${run.year} payroll approved and posted to the ledger`;
  }));

router.post('/payroll-runs/:id/mark-paid', authenticateToken, authorizeRole(PAYROLL_APPROVE), async (req: AuthRequest, res) => {
  let paidRun: any = null;
  await transition(req, res, ['Approved'], async (trx, run) => {
    await trx('payroll_runs').where({ id: run.id }).update({ status: 'Paid', paid_by: req.user?.id ?? null, paid_at: trx.fn.now(), updated_at: trx.fn.now() });
    await trx('payroll').where({ run_id: run.id }).update({ status: 'Paid', paid_at: trx.fn.now(), updated_at: trx.fn.now() });
    await logAudit(req, 'mark_paid', 'payroll_run', run.id, { status: run.status }, { status: 'Paid' }, trx);
    paidRun = run;
    return `${run.month} ${run.year} payroll marked as paid; staff are being notified`;
  });
  if (paidRun) {
    const entries = await db('payroll').where({ run_id: paidRun.id }).select('employee_id', 'net_pay');
    for (const e of entries) {
      await notifyEmployee(e.employee_id, 'Salary paid',
        `Your ${paidRun.month} ${paidRun.year} salary of GHS ${Number(e.net_pay).toLocaleString()} has been paid. Your payslip is available in the ERP.`, 'hr-payroll');
    }
  }
});

// Draft/reviewed runs are discarded; an approved run is reversed in the ledger first.
router.post('/payroll-runs/:id/cancel', authenticateToken, authorizeRole(PAYROLL_PREPARE), (req: AuthRequest, res) =>
  transition(req, res, ['Draft', 'Reviewed', 'Approved'], async (trx, run) => {
    if (run.status === 'Approved') {
      if (!hasRole(req, PAYROLL_APPROVE)) throw new HttpError('Only an admin or accountant can cancel an approved run', 403);
      if (run.journal_id) {
        await reverseJournal(trx, run.journal_id, {
          date: toIsoDate(null),
          description: `Reversal of payroll run: ${run.month} ${run.year}`,
          reference_type: 'payroll_run_reversal',
          reference_id: run.id,
        });
      }
    }
    await trx('payroll').where({ run_id: run.id }).del();
    await trx('payroll_runs').where({ id: run.id }).update({ status: 'Cancelled', updated_at: trx.fn.now() });
    await logAudit(req, 'cancel', 'payroll_run', run.id, { status: run.status, journal_id: run.journal_id }, { status: 'Cancelled' }, trx);
    return run.status === 'Approved' ? 'Run cancelled and its journal reversed' : 'Run cancelled';
  }));

// ---------------------------------------------------------------- Payroll settings

const CONFIG_KEYS = ['ssnit_employee', 'ssnit_employer', 'ssnit_tier1', 'ssnit_tier2', 'tax_tiers', 'deduction_types',
  'annual_leave_days', 'max_carry_over_days', 'overtime_multiplier', 'standard_hours_per_day'];

router.get('/payroll-settings', authenticateToken, authorizeRole(PAYROLL_PREPARE), async (req, res) => {
  try {
    const [config, accounts, chart] = await Promise.all([
      loadPayrollConfig(db),
      loadPayrollAccounts(db),
      db('chart_of_accounts').select('id', 'code', 'name', 'type').orderBy('code'),
    ]);
    res.json({ config, accounts, account_labels: PAYROLL_ACCOUNT_LABELS, default_codes: PAYROLL_ACCOUNT_DEFAULT_CODES, chart });
  } catch (error) {
    handle(res, error, 'Error fetching payroll settings');
  }
});

router.put('/payroll-settings', authenticateToken, authorizeRole(PAYROLL_PREPARE), async (req: AuthRequest, res) => {
  try {
    if (req.body.config) {
      const incoming = pick(req.body.config, CONFIG_KEYS);
      const tiers = incoming.tax_tiers;
      if (tiers !== undefined) {
        if (!Array.isArray(tiers) || tiers.length === 0) return res.status(400).json({ message: 'Add at least one PAYE band' });
        for (const t of tiers) {
          if (!(Number(t.threshold) >= 0) || !(Number(t.rate) >= 0 && Number(t.rate) <= 100)) {
            return res.status(400).json({ message: 'Each PAYE band needs a width of 0 or more and a rate between 0 and 100' });
          }
        }
      }
      for (const key of ['ssnit_employee', 'ssnit_employer', 'ssnit_tier1', 'ssnit_tier2']) {
        if (key in incoming && !(Number(incoming[key]) >= 0 && Number(incoming[key]) <= 100)) return res.status(400).json({ message: `${key} must be a percentage` });
      }
      const row = await db('settings').where({ key: 'payroll_config' }).first();
      let current: Record<string, any> = {};
      try { current = row?.value ? JSON.parse(row.value) : {}; } catch { current = {}; }
      const value = JSON.stringify(normalisePayrollConfig({ ...current, ...incoming }));
      logAudit(req, 'update', 'payroll_config', 'payroll_config', pick(current, Object.keys(incoming)), incoming);
      if (row) await db('settings').where({ key: 'payroll_config' }).update({ value, updated_at: db.fn.now() });
      else await db('settings').insert({ key: 'payroll_config', value });
    }
    if (req.body.accounts) {
      if (!hasRole(req, PAYROLL_APPROVE)) return res.status(403).json({ message: 'Only an admin or accountant can change payroll accounts' });
      const accounts: Record<string, number | null> = {};
      for (const key of Object.keys(PAYROLL_ACCOUNT_DEFAULT_CODES)) {
        const id = Number(req.body.accounts[key]);
        if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: `Choose an account for: ${(PAYROLL_ACCOUNT_LABELS as any)[key]}` });
        accounts[key] = id;
      }
      const found = await db('chart_of_accounts').whereIn('id', [...new Set(Object.values(accounts))] as number[]).select('id');
      if (found.length !== new Set(Object.values(accounts)).size) return res.status(400).json({ message: 'One or more accounts do not exist' });
      const value = JSON.stringify(accounts);
      logAudit(req, 'update', 'payroll_accounts', 'payroll_accounts', await loadPayrollAccounts(db), accounts);
      if (await db('settings').where({ key: 'payroll_accounts' }).first()) await db('settings').where({ key: 'payroll_accounts' }).update({ value, updated_at: db.fn.now() });
      else await db('settings').insert({ key: 'payroll_accounts', value });
    }
    res.json({ message: 'Payroll settings saved' });
  } catch (error) {
    handle(res, error, 'Error saving payroll settings');
  }
});

// ---------------------------------------------------------------- Appraisals

router.get('/appraisals', authenticateToken, async (req: AuthRequest, res) => {
  try {
    let query = db('appraisals').select('appraisals.*', 'employees.name')
      .join('employees', 'appraisals.employee_id', 'employees.id')
      .orderBy('appraisals.year', 'desc').orderBy('appraisals.created_at', 'desc');
    if (wantsOwn(req, HR_ADMIN)) {
      if (!req.user?.employee_id) return res.json([]);
      query = query.where('appraisals.employee_id', req.user.employee_id);
    }
    res.json(await query);
  } catch (error) {
    handle(res, error, 'Error fetching appraisals');
  }
});

router.post('/appraisals', authenticateToken, authorizeRole(HR_ADMIN), async (req, res) => {
  try {
    const data = pick(req.body, ['employee_id', 'year', 'period', 'score', 'feedback']);
    const score = Number(data.score);
    const year = Number(data.year);
    if (!data.employee_id || !(await db('employees').where({ id: data.employee_id }).first())) return res.status(400).json({ message: 'Choose an employee' });
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return res.status(400).json({ message: 'Enter a valid year' });
    if (!String(data.period || '').trim()) return res.status(400).json({ message: 'Enter the review period (e.g. Q1 or H2)' });
    if (!Number.isFinite(score) || score < 0 || score > 100) return res.status(400).json({ message: 'Score must be between 0 and 100' });
    await db('appraisals').insert({
      employee_id: data.employee_id, year, period: String(data.period).trim(), score: Math.round(score),
      feedback: data.feedback ? String(data.feedback).trim() : null, status: 'Approved',
    });
    res.status(201).json({ message: 'Appraisal recorded' });
  } catch (error) {
    handle(res, error, 'Error recording appraisal');
  }
});

// ---------------------------------------------------------------- Attendance & timesheets

async function assertPayrollOpen(conn: Conn, date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  const month = MONTHS[d.getUTCMonth()];
  const run = await conn('payroll_runs').where({ month, year: d.getUTCFullYear() }).whereIn('status', ['Approved', 'Paid']).first();
  if (run) throw new HttpError(`${month} ${d.getUTCFullYear()} payroll has been ${run.status.toLowerCase()}; attendance for that month is locked`, 409);
}

router.get('/attendance/roster', authenticateToken, authorizeRole(ATTENDANCE_EDIT), async (req, res) => {
  try {
    const employees = await db('employees').whereIn('status', ['active', 'on-leave'])
      .select('id', 'name', 'department', 'role', 'wage_type', 'status').orderBy('name');
    res.json(employees);
  } catch (error) {
    handle(res, error, 'Error fetching roster');
  }
});

router.get('/attendance', authenticateToken, authorizeRole(ATTENDANCE_VIEW), async (req, res) => {
  try {
    const date = String(req.query.date || '');
    if (!isValidIsoDate(date)) return res.status(400).json({ message: 'Choose a date' });
    const query = db('timesheets')
      .select('timesheets.*', 'employees.name as employee_name', 'projects.name as project_name')
      .join('employees', 'timesheets.employee_id', 'employees.id')
      .leftJoin('projects', 'timesheets.project_id', 'projects.id')
      .where('timesheets.date', date);
    if (req.query.project_id) {
      if (req.query.project_id === 'none') query.whereNull('timesheets.project_id');
      else query.where('timesheets.project_id', String(req.query.project_id));
    }
    res.json(await query.orderBy('employees.name'));
  } catch (error) {
    handle(res, error, 'Error fetching attendance');
  }
});

// Saves one day's attendance sheet for a project (or general/office when project_id is empty).
router.put('/attendance', authenticateToken, authorizeRole(ATTENDANCE_EDIT), async (req: AuthRequest, res) => {
  try {
    const date = String(req.body.date || '');
    if (!isValidIsoDate(date)) return res.status(400).json({ message: 'Choose a date' });
    if (date > toIsoDate(null)) return res.status(400).json({ message: 'Attendance cannot be recorded for a future date' });
    const projectId = req.body.project_id && req.body.project_id !== 'none' ? String(req.body.project_id) : null;
    const entries: any[] = Array.isArray(req.body.entries) ? req.body.entries : [];
    if (entries.length === 0) return res.status(400).json({ message: 'Mark at least one employee' });

    const rows = entries.map(e => {
      const attendance = ATTENDANCE_TYPES.includes(e.attendance) ? e.attendance : 'Present';
      const worked = ['Present', 'Half Day'].includes(attendance);
      const hours = worked ? Number(e.hours) || 0 : 0;
      const overtime = worked ? Number(e.overtime_hours) || 0 : 0;
      if (hours < 0 || hours > 24 || overtime < 0 || hours + overtime > 24) throw new HttpError('Hours per day must be between 0 and 24');
      return {
        employee_id: String(e.employee_id), project_id: projectId, date, attendance, hours, overtime_hours: overtime,
        description: e.description ? String(e.description).slice(0, 500) : null, status: 'Recorded', recorded_by: req.user?.id ?? null,
      };
    });

    await db.transaction(async trx => {
      await assertPayrollOpen(trx, date);
      const ids = rows.map(r => r.employee_id);
      const known = await trx('employees').whereIn('id', ids).select('id');
      if (known.length !== new Set(ids).size) throw new HttpError('One or more employees were not found');
      const del = trx('timesheets').where({ date }).whereIn('employee_id', ids);
      if (projectId) del.where({ project_id: projectId }); else del.whereNull('project_id');
      await del.del();
      await trx('timesheets').insert(rows);
    });
    res.json({ message: `Attendance saved for ${rows.length} employee(s)` });
  } catch (error) {
    handle(res, error, 'Error saving attendance');
  }
});

// Monthly totals per employee and per project, with labour cost: hourly staff at their rate
// (overtime at the configured multiplier); salaried staff split across projects by hours logged.
router.get('/attendance/summary', authenticateToken, authorizeRole(ATTENDANCE_VIEW), async (req, res) => {
  try {
    const { month, year } = assertPeriod(req.query.month, Number(req.query.year));
    const { start, end } = periodRange(month, year);
    const config = await loadPayrollConfig(db);
    const rows = await db('timesheets')
      .join('employees', 'timesheets.employee_id', 'employees.id')
      .leftJoin('projects', 'timesheets.project_id', 'projects.id')
      .whereBetween('timesheets.date', [start, end])
      .select('timesheets.employee_id', 'timesheets.project_id', 'timesheets.attendance', 'timesheets.hours', 'timesheets.overtime_hours',
        'timesheets.date', 'employees.name', 'employees.department', 'employees.wage_type', 'employees.salary', 'projects.name as project_name');

    const byEmployee = new Map<string, any>();
    for (const r of rows) {
      const e = byEmployee.get(r.employee_id) || {
        employee_id: r.employee_id, name: r.name, department: r.department, wage_type: r.wage_type, rate: Number(r.salary),
        days: new Set<string>(), days_present: 0, days_absent: 0, days_leave: 0, hours: 0, overtime_hours: 0, projects: new Map<string, any>(),
      };
      const date = toIsoDate(r.date);
      if (r.attendance === 'Present') { if (!e.days.has(date)) e.days_present += 1; e.days.add(date); }
      else if (r.attendance === 'Half Day') { if (!e.days.has(date)) e.days_present += 0.5; e.days.add(date); }
      else if (r.attendance === 'Absent') e.days_absent += 1;
      else e.days_leave += 1;
      e.hours += Number(r.hours || 0);
      e.overtime_hours += Number(r.overtime_hours || 0);
      const key = r.project_id || 'none';
      const p = e.projects.get(key) || { project_id: r.project_id, project_name: r.project_name || 'General / office', hours: 0, overtime_hours: 0 };
      p.hours += Number(r.hours || 0);
      p.overtime_hours += Number(r.overtime_hours || 0);
      e.projects.set(key, p);
      byEmployee.set(r.employee_id, e);
    }

    const projectTotals = new Map<string, any>();
    const employees = [...byEmployee.values()].map(e => {
      const totalHours = e.hours + e.overtime_hours;
      const projects = [...e.projects.values()].map((p: any) => {
        const cost = e.wage_type === 'Hourly'
          ? p.hours * e.rate + p.overtime_hours * e.rate * config.overtime_multiplier
          : totalHours ? e.rate * ((p.hours + p.overtime_hours) / totalHours) : 0;
        const t = projectTotals.get(p.project_id || 'none') || { project_id: p.project_id, project_name: p.project_name, hours: 0, overtime_hours: 0, labour_cost: 0, employees: 0 };
        t.hours += p.hours; t.overtime_hours += p.overtime_hours; t.labour_cost += cost; t.employees += 1;
        projectTotals.set(p.project_id || 'none', t);
        return { ...p, labour_cost: round2(cost) };
      });
      const { days, ...rest } = e;
      return {
        ...rest, projects,
        hours: round2(e.hours), overtime_hours: round2(e.overtime_hours),
        estimated_pay: round2(e.wage_type === 'Hourly' ? e.hours * e.rate + e.overtime_hours * e.rate * config.overtime_multiplier : e.rate),
      };
    }).sort((a, b) => a.name.localeCompare(b.name));

    res.json({
      month, year,
      employees,
      projects: [...projectTotals.values()].map(p => ({ ...p, hours: round2(p.hours), overtime_hours: round2(p.overtime_hours), labour_cost: round2(p.labour_cost) })),
    });
  } catch (error) {
    handle(res, error, 'Error building attendance summary');
  }
});

export default router;
