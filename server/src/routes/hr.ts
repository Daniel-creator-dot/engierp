import { Router, Response } from 'express';
import type { Knex } from 'knex';
import db from '../db';
import { authenticateToken, authorizeRole, AuthRequest } from '../middleware/auth';
import { sendSMS } from '../utils/sms';
import { logAudit } from '../lib/audit';
import { notify } from '../lib/notify';
import { Conn, LedgerError, reverseJournal, round2, sendError, toIsoDate } from '../lib/ledger';
import {
  casualOvertimeRate, casualRowValues, effectiveTaxTreatment, isCasualWage, loadPayrollAccounts, loadPayrollConfig,
  parseBreakdown, parseItems, payrollRowValues, postPayroll,
  PAYROLL_ACCOUNT_DEFAULT_CODES, PAYROLL_ACCOUNT_LABELS, PayItem, PayrollConfig,
} from '../lib/payroll';
import {
  addDays, casualWeek, isStatutoryDeduction, isValidSsnit, MONTHS, normalisePayrollConfig, normaliseSsnit, workingDaysBetween,
} from '../../../src/lib/payrollCalc';

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
const WAGE_TYPES = ['Salaried', 'Hourly', 'Daily'];
const PAY_FREQUENCIES = ['Weekly', 'Daily'];
const TAX_TREATMENTS = ['casual_wht', 'paye', 'none'];
const EMPLOYMENT_TYPES = ['Permanent', 'Contract', 'Casual', 'Intern', 'National Service'];
const LEAVE_TYPES = ['Annual', 'Sick', 'Casual', 'Study', 'Maternity', 'Paternity', 'Compassionate', 'Unpaid'];
const ATTENDANCE_TYPES = ['Present', 'Half Day', 'Absent', 'Leave', 'Sick'];

const EMPLOYEE_FIELDS = [
  'name', 'role', 'department', 'salary', 'joinDate', 'status', 'ssnit', 'ghana_card', 'phone', 'address',
  'bank_name', 'account_name', 'account_number', 'branch', 'wage_type', 'date_of_birth', 'employment_type',
  'probation_end_date', 'contract_end_date', 'exit_date', 'annual_leave_days',
  'overtime_rate', 'pay_frequency', 'tax_treatment',
];
const PAY_SETUP_FIELDS = ['wage_type', 'salary', 'employment_type', 'pay_frequency', 'tax_treatment', 'overtime_rate'];
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
  if ('employment_type' in data) {
    if (!data.employment_type) data.employment_type = null;
    else if (!EMPLOYMENT_TYPES.includes(data.employment_type)) return `Employment type must be one of: ${EMPLOYMENT_TYPES.join(', ')}`;
  }
  if ('wage_type' in data && !WAGE_TYPES.includes(data.wage_type)) return 'Pay basis must be Salaried, Hourly or Daily';
  if (!partial && !data.wage_type) data.wage_type = data.employment_type === 'Casual' ? 'Daily' : 'Salaried';
  if (!partial && data.wage_type === 'Daily' && !data.pay_frequency) data.pay_frequency = 'Weekly';
  if ('pay_frequency' in data) {
    if (!data.pay_frequency) data.pay_frequency = null;
    else if (!PAY_FREQUENCIES.includes(data.pay_frequency)) return 'Pay frequency must be Weekly or Daily';
  }
  if ('tax_treatment' in data) {
    if (!data.tax_treatment) data.tax_treatment = null;
    else if (!TAX_TREATMENTS.includes(data.tax_treatment)) return 'Tax treatment must be casual_wht, paye or none';
  }
  if ('overtime_rate' in data) {
    if (data.overtime_rate === '' || data.overtime_rate == null) data.overtime_rate = null;
    else {
      const rate = Number(data.overtime_rate);
      if (!Number.isFinite(rate) || rate < 0) return 'Overtime rate must be a positive number';
      data.overtime_rate = round2(rate);
    }
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

// Sets pay basis / rate / employment type (and casual pay options) on several employees at once.
router.patch('/employees/bulk-pay', authenticateToken, authorizeRole(HR_ADMIN), async (req: AuthRequest, res) => {
  try {
    const ids: string[] = Array.isArray(req.body?.ids) ? [...new Set<string>(req.body.ids.map(String))] : [];
    if (ids.length === 0) return res.status(400).json({ message: 'Select at least one employee' });
    if (ids.length > 500) return res.status(400).json({ message: 'Update at most 500 employees at a time' });
    const updates = pick(req.body?.updates || {}, PAY_SETUP_FIELDS);
    if (Object.keys(updates).length === 0) return res.status(400).json({ message: 'Choose at least one field to change' });
    const error = normaliseEmployee(updates, true);
    if (error) return res.status(400).json({ message: error });
    if (updates.wage_type === 'Daily' && !('pay_frequency' in updates)) updates.pay_frequency = 'Weekly';

    const count = await db.transaction(async trx => {
      const existing = await trx('employees').whereIn('id', ids).select('id', ...PAY_SETUP_FIELDS);
      if (existing.length !== ids.length) throw new HttpError('One or more employees were not found', 404);
      await trx('employees').whereIn('id', ids).update({ ...updates, updated_at: trx.fn.now() });
      await logAudit(req, 'bulk_pay_update', 'employee', null, { employees: existing }, { ids, updates }, trx);
      return existing.length;
    });
    res.json({ message: `Pay setup updated for ${count} employee(s)`, count });
  } catch (error) {
    handle(res, error, 'Error updating pay setup');
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
      if (!data.ssnit && data.wage_type !== 'Daily') warnings.push('No SSNIT number');
      if (data.wage_type === 'Daily' && Number(data.salary) > 1000) warnings.push('Daily rate above GH₵ 1,000 looks like a monthly salary');
      if (data.wage_type === 'Hourly' && Number(data.salary) > 500) warnings.push('Hourly rate above GH₵ 500 looks like a monthly salary');
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
  'employees.phone as employee_phone', 'employees.employment_type',
];

const payrollQuery = (conn: Conn) => conn('payroll').select(PAYROLL_SELECT).join('employees', 'payroll.employee_id', 'employees.id');

async function assertNoDuplicatePayroll(conn: Conn, employeeId: string, month: string, year: number, exceptId?: number) {
  const query = conn('payroll').where({ employee_id: employeeId, month, year }).whereNull('pay_type').whereNot('status', 'Rejected');
  if (exceptId) query.whereNot('id', exceptId);
  const existing = await query.first();
  if (existing) throw new HttpError(`Payroll for ${month} ${year} already exists for this employee (status: ${existing.status})`, 409);
}

function cleanItems(value: unknown, label: string): PayItem[] {
  const items = parseItems(value);
  if (items.some(i => i.amount < 0)) throw new HttpError(`${label} cannot be negative`);
  return items;
}

// ---------------------------------------------------------------- Casual (daily-rated) pay

const periodLabel = (start: unknown, end: unknown) => {
  const s = toIsoDate(start as any), e = toIsoDate(end as any);
  return s === e ? s : `${s} to ${e}`;
};
const runLabel = (run: any) => run.run_type === 'casual'
  ? `Casual pay ${periodLabel(run.period_start, run.period_end)}`
  : `${run.month} ${run.year} payroll`;

// Serialises casual pay creation so two runs can't pay the same worker for the same days.
const lockCasualPay = (trx: Knex.Transaction) => trx.raw(`SELECT pg_advisory_xact_lock(hashtext('hr_casual_pay'))`);

/** Existing live casual entries per employee whose period overlaps start..end. */
async function casualOverlaps(conn: Conn, employeeIds: string[], start: string, end: string, exceptId?: number) {
  if (employeeIds.length === 0) return new Map<string, any>();
  const query = conn('payroll').where('pay_type', 'casual').whereIn('employee_id', employeeIds)
    .whereNot('status', 'Rejected').where('period_start', '<=', end).where('period_end', '>=', start)
    .select('id', 'employee_id', 'period_start', 'period_end', 'status');
  if (exceptId) query.whereNot('id', exceptId);
  const rows = await query;
  return new Map<string, any>(rows.map((r: any) => [r.employee_id, r]));
}

interface CasualAttendance { days: number; overtime: number; breakdown: { project_id: string | null; project_name: string | null; days: number; overtime_hours: number }[] }

/**
 * Days and overtime per worker from the attendance register: Present = 1 day, Half Day = 0.5. A worker marked on
 * more than one project on the same day is capped at one day, split between those projects.
 */
async function casualAttendance(conn: Conn, employeeIds: string[], start: string, end: string) {
  const result = new Map<string, CasualAttendance>();
  if (employeeIds.length === 0) return result;
  const rows = await conn('timesheets')
    .leftJoin('projects', 'timesheets.project_id', 'projects.id')
    .whereIn('timesheets.employee_id', employeeIds)
    .whereBetween('timesheets.date', [start, end])
    .select('timesheets.employee_id', 'timesheets.date', 'timesheets.project_id', 'timesheets.attendance', 'timesheets.overtime_hours', 'projects.name as project_name');
  const byDay = new Map<string, any[]>();
  for (const r of rows) {
    const key = `${r.employee_id}|${toIsoDate(r.date)}`;
    byDay.set(key, [...(byDay.get(key) || []), r]);
  }
  for (const [key, dayRows] of byDay) {
    const employeeId = key.split('|')[0];
    const units = dayRows.map(r => r.attendance === 'Present' ? 1 : r.attendance === 'Half Day' ? 0.5 : 0);
    const total = units.reduce((s, u) => s + u, 0);
    const scale = total > 1 ? 1 / total : 1;
    const a = result.get(employeeId) || { days: 0, overtime: 0, breakdown: [] };
    dayRows.forEach((r, i) => {
      const days = units[i] * scale;
      const overtime = units[i] ? Number(r.overtime_hours || 0) : 0;
      if (!days && !overtime) return;
      const projectId = r.project_id || null;
      let p = a.breakdown.find(b => b.project_id === projectId);
      if (!p) { p = { project_id: projectId, project_name: r.project_name || null, days: 0, overtime_hours: 0 }; a.breakdown.push(p); }
      p.days += days; p.overtime_hours += overtime;
      a.days += days; a.overtime += overtime;
    });
    result.set(employeeId, a);
  }
  for (const a of result.values()) {
    a.days = round2(a.days); a.overtime = round2(a.overtime);
    a.breakdown = a.breakdown.map(b => ({ ...b, days: round2(b.days), overtime_hours: round2(b.overtime_hours) }));
  }
  return result;
}

/** Payroll row values for a casual worker, with the per-project split priced at their rates. */
function casualEntry(employee: any, worked: { days: number; overtime: number; breakdown: CasualAttendance['breakdown'] },
  config: PayrollConfig, allowances: PayItem[], deductions: PayItem[], stored?: { daily_rate: number; overtime_rate: number; tax_treatment: string | null }) {
  const rate = stored ? stored.daily_rate : Number(employee.salary || 0);
  const otRate = stored ? stored.overtime_rate : casualOvertimeRate(rate, employee.overtime_rate, config);
  const taxTreatment = effectiveTaxTreatment(stored?.tax_treatment ? { tax_treatment: stored.tax_treatment } : employee);
  const { values, pay } = casualRowValues({
    days: worked.days, dailyRate: rate, overtimeHours: worked.overtime, overtimeRate: otRate, taxTreatment, allowances, deductions,
  }, config);
  const breakdown = worked.breakdown.map(b => ({ ...b, amount: round2(b.days * rate + b.overtime_hours * otRate) }));
  const projects = new Set(breakdown.map(b => b.project_id));
  return {
    pay,
    values: {
      ...values,
      project_breakdown: breakdown.length ? JSON.stringify(breakdown) : null,
      project_id: projects.size === 1 ? [...projects][0] : null,
    },
  };
}

/** Scales the stored per-project split to edited day / overtime totals. */
function rescaleBreakdown(raw: unknown, days: number, overtime: number) {
  const breakdown = parseBreakdown(raw);
  const oldDays = breakdown.reduce((s, b) => s + b.days, 0);
  const oldOt = breakdown.reduce((s, b) => s + b.overtime_hours, 0);
  if (breakdown.length === 0) return [];
  if ((days && !oldDays) || (overtime && !oldOt)) {
    // Can't scale from zero: put the extra on the project with the most attendance.
    const main = [...breakdown].sort((a, b) => b.days + b.overtime_hours - a.days - a.overtime_hours)[0];
    return [{ project_id: main.project_id, project_name: main.project_name ?? null, days, overtime_hours: overtime }];
  }
  return breakdown.map(b => ({
    project_id: b.project_id, project_name: b.project_name ?? null,
    days: oldDays ? round2(b.days * days / oldDays) : 0,
    overtime_hours: oldOt ? round2(b.overtime_hours * overtime / oldOt) : 0,
  }));
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
    const employee = await db('employees').where({ id: req.body.employee_id }).first();
    if (!employee) return res.status(404).json({ message: 'Employee not found' });
    if (isCasualWage(employee.wage_type)) return await createCasualPayment(req, res, employee);
    const { month, year } = assertPeriod(req.body.month, req.body.year);
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

// A one-off payment to a casual worker for days worked in a period (e.g. someone leaving mid-week).
async function createCasualPayment(req: AuthRequest, res: Response, employee: any) {
  const periodStart = String(req.body.period_start || req.body.payment_date || toIsoDate(null));
  const periodEnd = String(req.body.period_end || periodStart);
  if (!isValidIsoDate(periodStart) || !isValidIsoDate(periodEnd) || periodEnd < periodStart) {
    return res.status(400).json({ message: 'Choose a valid period (end on or after start)' });
  }
  if (periodEnd > addDays(periodStart, 30)) return res.status(400).json({ message: 'A casual payment can cover at most 31 days' });
  const days = Number(req.body.days_worked);
  const overtime = Number(req.body.overtime_hours || 0);
  const spanDays = Math.round((Date.parse(periodEnd) - Date.parse(periodStart)) / 86400000) + 1;
  if (!Number.isFinite(days) || days < 0 || days > spanDays) return res.status(400).json({ message: `Days worked must be between 0 and ${spanDays}` });
  if (!Number.isFinite(overtime) || overtime < 0 || overtime > spanDays * 16) return res.status(400).json({ message: 'Overtime hours look wrong' });
  if (!days && !overtime) return res.status(400).json({ message: 'Enter the days or overtime hours worked' });

  const config = await loadPayrollConfig(db);
  const projectId = req.body.project_id && req.body.project_id !== 'none' ? String(req.body.project_id) : null;
  const { values, pay } = casualEntry(employee, {
    days, overtime, breakdown: projectId ? [{ project_id: projectId, project_name: null, days, overtime_hours: overtime }] : [],
  }, config, cleanItems(req.body.allowances ?? [], 'Allowances'), cleanItems(req.body.deductions ?? [], 'Deductions'));
  if (pay.net_pay < 0) return res.status(400).json({ message: 'Deductions are larger than gross pay' });
  const end = new Date(`${periodEnd}T00:00:00Z`);
  const paymentDate = req.body.payment_date && isValidIsoDate(req.body.payment_date) ? req.body.payment_date : periodEnd;

  const id = await db.transaction(async trx => {
    await lockCasualPay(trx);
    const clash = (await casualOverlaps(trx, [employee.id], periodStart, periodEnd)).get(employee.id);
    if (clash) throw new HttpError(`${employee.name} already has casual pay for ${periodLabel(clash.period_start, clash.period_end)} (status: ${clash.status})`, 409);
    const [inserted] = await trx('payroll').insert({
      ...values,
      employee_id: employee.id, month: MONTHS[end.getUTCMonth()], year: end.getUTCFullYear(),
      period_start: periodStart, period_end: periodEnd, payment_date: paymentDate,
      notes: req.body.notes || null, status: 'Pending', created_by: req.user?.id ?? null,
    }).returning('id');
    return typeof inserted === 'object' ? inserted.id : inserted;
  });
  logAudit(req, 'create', 'payroll', id, undefined, { employee_id: employee.id, period_start: periodStart, period_end: periodEnd, days, overtime, net_pay: pay.net_pay });
  notify({ roles: PAYROLL_APPROVE }, 'Casual payment awaiting approval',
    `${employee.name}: ${periodLabel(periodStart, periodEnd)}, net pay GHS ${pay.net_pay.toLocaleString()}`,
    { type: 'hr', link: 'hr-payroll', excludeUserId: req.user?.id });
  return res.status(201).json({ id, message: 'Casual payment submitted for approval' });
}

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
      const [journalId] = await postPayroll(trx, {
        rows: [row],
        date: row.payment_date || toIsoDate(null),
        description: row.pay_type === 'casual'
          ? `Casual pay: ${employee?.name || row.employee_id} - ${periodLabel(row.period_start, row.period_end)}`
          : `Payroll: ${employee?.name || row.employee_id} - ${row.month} ${row.year}`,
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
      const period = entry.pay_type === 'casual' ? periodLabel(entry.period_start, entry.period_end) : `${entry.month} ${entry.year}`;
      notifyEmployee(entry.employee_id, 'Payment approved',
        `Your ${period} pay of GHS ${Number(entry.net_pay).toLocaleString()} has been approved.`, 'hr-payroll');
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
  db.raw('COALESCE(SUM(payroll.wht), 0) as total_wht'),
  db.raw('COALESCE(SUM(payroll.days_worked), 0) as total_days'),
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
    if (req.body.run_type === 'casual') return await createCasualRun(req, res);
    const { month, year } = assertPeriod(req.body.month, req.body.year);
    const paymentDate = req.body.payment_date && isValidIsoDate(req.body.payment_date) ? req.body.payment_date : null;
    const projectId = req.body.project_id && req.body.project_id !== 'none' ? req.body.project_id : null;
    const { end } = periodRange(month, year);

    const result = await db.transaction(async trx => {
      const clash = await trx('payroll_runs').where({ month, year, run_type: 'monthly' }).whereNot('status', 'Cancelled').first();
      if (clash) throw new HttpError(`A ${month} ${year} payroll run already exists (status: ${clash.status})`, 409);
      const config = await loadPayrollConfig(trx);
      const employees = await trx('employees')
        .whereIn('status', ['active', 'on-leave'])
        .where(q => q.whereNull('wage_type').orWhereNot('wage_type', 'Daily'))
        .where(q => q.whereNull('joinDate').orWhere('joinDate', '<=', end))
        .orderBy('name');
      const existing = await trx('payroll').where({ month, year }).whereNull('pay_type').whereNot('status', 'Rejected').select('employee_id');
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

// Casual run: weekly (Monday to Saturday, paid Saturday) or a single day, priced from the attendance register.
async function createCasualRun(req: AuthRequest, res: Response) {
  const frequency = req.body.frequency === 'Daily' ? 'Daily' : 'Weekly';
  const date = String(req.body.period_start || req.body.date || '');
  if (!isValidIsoDate(date)) return res.status(400).json({ message: frequency === 'Daily' ? 'Choose the day to pay for' : 'Choose a date in the week to pay for' });
  const { start, end } = frequency === 'Daily' ? { start: date, end: date } : casualWeek(date);
  if (start > toIsoDate(null)) return res.status(400).json({ message: 'That period has not started yet' });
  const paymentDate = req.body.payment_date && isValidIsoDate(req.body.payment_date) ? req.body.payment_date : end;
  const endDate = new Date(`${end}T00:00:00Z`);
  const month = MONTHS[endDate.getUTCMonth()];
  const year = endDate.getUTCFullYear();

  const result = await db.transaction(async trx => {
    await lockCasualPay(trx);
    const config = await loadPayrollConfig(trx);
    const workers = await trx('employees').where('wage_type', 'Daily')
      .where(q => frequency === 'Daily' ? q.where('pay_frequency', 'Daily') : q.whereNull('pay_frequency').orWhereNot('pay_frequency', 'Daily'))
      .where(q => q.whereNull('joinDate').orWhere('joinDate', '<=', end))
      .orderBy('name');
    const ids = workers.map((w: any) => w.id);
    const attendance = await casualAttendance(trx, ids, start, end);
    const overlaps = await casualOverlaps(trx, ids, start, end);

    const rows: any[] = [];
    const alreadyPaid: string[] = [];
    const noAttendance: string[] = [];
    for (const w of workers) {
      const worked = attendance.get(w.id);
      // Terminated workers are still paid for days they worked in the period.
      if (!worked || (!worked.days && !worked.overtime)) { if (w.status !== 'terminated') noAttendance.push(w.name); continue; }
      if (overlaps.has(w.id)) { alreadyPaid.push(w.name); continue; }
      const { values } = casualEntry(w, worked, config, [], []);
      rows.push({
        ...values,
        employee_id: w.id, month, year, period_start: start, period_end: end, payment_date: paymentDate,
        notes: Number(w.salary) > 0 ? null : 'No daily rate set on the employee file',
        status: 'Draft', created_by: req.user?.id ?? null,
      });
    }
    if (rows.length === 0) {
      throw new HttpError(alreadyPaid.length
        ? `Every casual worker with attendance for ${periodLabel(start, end)} is already in another casual run or payment`
        : `No attendance is recorded for ${frequency === 'Daily' ? 'daily-paid' : 'weekly-paid'} casual workers in ${periodLabel(start, end)}. Record it under HR > Attendance first.`, 400);
    }
    const [inserted] = await trx('payroll_runs').insert({
      run_type: 'casual', frequency, period_start: start, period_end: end, month, year,
      payment_date: paymentDate, notes: req.body.notes || null, status: 'Draft', created_by: req.user?.id ?? null,
    }).returning('id');
    const runId = typeof inserted === 'object' ? inserted.id : inserted;
    await trx('payroll').insert(rows.map(r => ({ ...r, run_id: runId })));
    await logAudit(req, 'create', 'payroll_run', runId, undefined, { run_type: 'casual', frequency, period_start: start, period_end: end, workers: rows.length }, trx);
    return { id: runId, count: rows.length, alreadyPaid, noAttendance };
  });

  const notes = [
    result.alreadyPaid.length ? `skipped ${result.alreadyPaid.length} already paid for these days` : '',
    result.noAttendance.length ? `${result.noAttendance.length} casual worker(s) had no attendance` : '',
  ].filter(Boolean).join('; ');
  return res.status(201).json({
    id: result.id, count: result.count, skipped: result.alreadyPaid, no_attendance: result.noAttendance,
    message: `Draft casual pay for ${periodLabel(start, end)} created for ${result.count} worker(s)${notes ? `; ${notes}` : ''}.`,
  });
}

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
        : parseItems(entry.detailed_deductions).filter(d => !isStatutoryDeduction(d.type));

      if (entry.pay_type === 'casual') {
        const days = 'days_worked' in req.body ? Number(req.body.days_worked) : Number(entry.days_worked || 0);
        const overtime = 'overtime_hours' in req.body ? Number(req.body.overtime_hours) : Number(entry.overtime_hours || 0);
        const span = Math.round((Date.parse(toIsoDate(entry.period_end)) - Date.parse(toIsoDate(entry.period_start))) / 86400000) + 1;
        if (!Number.isFinite(days) || days < 0 || days > span) throw new HttpError(`Days worked must be between 0 and ${span}`);
        if (!Number.isFinite(overtime) || overtime < 0 || overtime > span * 16) throw new HttpError('Overtime hours look wrong');
        const { values, pay } = casualEntry(employee || {}, {
          days, overtime, breakdown: rescaleBreakdown(entry.project_breakdown, days, overtime),
        }, config, allowances, deductions, {
          daily_rate: Number(entry.daily_rate || 0), overtime_rate: Number(entry.overtime_rate || 0), tax_treatment: entry.tax_treatment,
        });
        if (pay.net_pay < 0) throw new HttpError('Deductions are larger than gross pay');
        await trx('payroll').where({ id: entry.id }).update({
          ...values, notes: 'notes' in req.body ? (req.body.notes || null) : entry.notes, updated_at: trx.fn.now(),
        });
        if (run.status === 'Reviewed') await trx('payroll_runs').where({ id: run.id }).update({ status: 'Draft', reviewed_by: null, reviewed_at: null, updated_at: trx.fn.now() });
        return payrollQuery(trx).where('payroll.id', entry.id).first();
      }
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

// Re-prices a draft casual run from the attendance register (after late attendance corrections or rate changes),
// keeping any allowances and deductions typed in, and adds workers whose attendance was recorded since.
router.post('/payroll-runs/:id/refresh', authenticateToken, authorizeRole(PAYROLL_PREPARE), async (req: AuthRequest, res) => {
  try {
    const result = await db.transaction(async trx => {
      await lockCasualPay(trx);
      const run = await loadRun(trx, req.params.id, true);
      if (run.run_type !== 'casual') throw new HttpError('Only casual runs are priced from attendance', 400);
      if (!['Draft', 'Reviewed'].includes(run.status)) throw new HttpError(`A ${run.status.toLowerCase()} run can no longer be edited`, 409);
      const start = toIsoDate(run.period_start), end = toIsoDate(run.period_end);
      const config = await loadPayrollConfig(trx);
      const entries = await trx('payroll').where({ run_id: run.id });
      const inRun = new Set(entries.map((e: any) => e.employee_id));
      const workers = await trx('employees').where('wage_type', 'Daily')
        .where(q => run.frequency === 'Daily' ? q.where('pay_frequency', 'Daily') : q.whereNull('pay_frequency').orWhereNot('pay_frequency', 'Daily'))
        .orWhereIn('id', [...inRun]);
      const ids = workers.map((w: any) => w.id);
      const attendance = await casualAttendance(trx, ids, start, end);
      const overlaps = await casualOverlaps(trx, ids.filter((id: string) => !inRun.has(id)), start, end);
      let updated = 0, added = 0;
      for (const w of workers) {
        const worked = attendance.get(w.id) || { days: 0, overtime: 0, breakdown: [] };
        const entry = entries.find((e: any) => e.employee_id === w.id);
        if (entry) {
          const allowances = parseItems(entry.detailed_allowances).filter(a => !/^Overtime/i.test(a.type));
          const deductions = parseItems(entry.detailed_deductions).filter(d => !isStatutoryDeduction(d.type));
          const { values } = casualEntry(w, worked, config, allowances, deductions);
          await trx('payroll').where({ id: entry.id }).update({
            ...values, notes: worked.days || worked.overtime ? entry.notes : 'No attendance recorded for this period', updated_at: trx.fn.now(),
          });
          updated++;
        } else if ((worked.days || worked.overtime) && !overlaps.has(w.id) && isCasualWage(w.wage_type)) {
          const { values } = casualEntry(w, worked, config, [], []);
          await trx('payroll').insert({
            ...values, run_id: run.id, employee_id: w.id, month: run.month, year: run.year,
            period_start: start, period_end: end, payment_date: run.payment_date, status: 'Draft', created_by: req.user?.id ?? null,
          });
          added++;
        }
      }
      if (run.status === 'Reviewed') await trx('payroll').where({ run_id: run.id }).update({ status: 'Draft' });
      await trx('payroll_runs').where({ id: run.id }).update({ status: 'Draft', reviewed_by: null, reviewed_at: null, updated_at: trx.fn.now() });
      await logAudit(req, 'refresh', 'payroll_run', run.id, undefined, { updated, added }, trx);
      return { updated, added };
    });
    res.json({ ...result, message: `Re-priced ${result.updated} worker(s) from attendance${result.added ? `; added ${result.added}` : ''}` });
  } catch (error) {
    handle(res, error, 'Error refreshing casual run');
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
      `${runLabel(run)} for ${Number(count[0]?.count)} employee(s) is ready for approval.`,
      { type: 'hr', link: 'hr-payroll', excludeUserId: req.user?.id });
    return `${runLabel(run)} marked as reviewed and sent for approval`;
  }));

router.post('/payroll-runs/:id/reopen', authenticateToken, authorizeRole(PAYROLL_PREPARE), (req: AuthRequest, res) =>
  transition(req, res, ['Reviewed'], async (trx, run) => {
    await trx('payroll_runs').where({ id: run.id }).update({ status: 'Draft', reviewed_by: null, reviewed_at: null, updated_at: trx.fn.now() });
    await trx('payroll').where({ run_id: run.id }).update({ status: 'Draft', updated_at: trx.fn.now() });
    return 'Run reopened for editing';
  }));

// Approval posts the run to the ledger (one journal per project) and locks the period's attendance.
router.post('/payroll-runs/:id/approve', authenticateToken, authorizeRole(PAYROLL_APPROVE), (req: AuthRequest, res) =>
  transition(req, res, ['Reviewed'], async (trx, run) => {
    const rows = await trx('payroll').where({ run_id: run.id });
    const journalIds = await postPayroll(trx, {
      rows,
      date: run.payment_date || toIsoDate(null),
      description: run.run_type === 'casual'
        ? `${runLabel(run)} (${rows.length} workers)`
        : `Payroll run: ${run.month} ${run.year} (${rows.length} employees)`,
      referenceType: 'payroll_run',
      referenceId: run.id,
      projectId: run.project_id,
    });
    const journalId = journalIds[0];
    await trx('payroll_runs').where({ id: run.id }).update({
      status: 'Approved', journal_id: journalId, approved_by: req.user?.id ?? null, approved_at: trx.fn.now(), updated_at: trx.fn.now(),
    });
    await trx('payroll').where({ run_id: run.id }).update({ status: 'Approved', journal_id: journalId, approved_by: req.user?.id ?? null, updated_at: trx.fn.now() });
    await logAudit(req, 'approve', 'payroll_run', run.id, { status: run.status }, { status: 'Approved', journal_ids: journalIds, employees: rows.length }, trx);
    return `${runLabel(run)} approved and posted to the ledger${journalIds.length > 1 ? ` (${journalIds.length} journals, one per project)` : ''}`;
  }));

router.post('/payroll-runs/:id/mark-paid', authenticateToken, authorizeRole(PAYROLL_APPROVE), async (req: AuthRequest, res) => {
  let paidRun: any = null;
  await transition(req, res, ['Approved'], async (trx, run) => {
    await trx('payroll_runs').where({ id: run.id }).update({ status: 'Paid', paid_by: req.user?.id ?? null, paid_at: trx.fn.now(), updated_at: trx.fn.now() });
    await trx('payroll').where({ run_id: run.id }).update({ status: 'Paid', paid_at: trx.fn.now(), updated_at: trx.fn.now() });
    await logAudit(req, 'mark_paid', 'payroll_run', run.id, { status: run.status }, { status: 'Paid' }, trx);
    paidRun = run;
    return `${runLabel(run)} marked as paid; staff are being notified`;
  });
  if (paidRun) {
    const entries = await db('payroll').where({ run_id: paidRun.id }).select('employee_id', 'net_pay');
    const casual = paidRun.run_type === 'casual';
    for (const e of entries) {
      await notifyEmployee(e.employee_id, casual ? 'Pay released' : 'Salary paid',
        casual
          ? `Your pay for ${periodLabel(paidRun.period_start, paidRun.period_end)} of GHS ${Number(e.net_pay).toLocaleString()} has been paid.`
          : `Your ${paidRun.month} ${paidRun.year} salary of GHS ${Number(e.net_pay).toLocaleString()} has been paid. Your payslip is available in the ERP.`,
        'hr-payroll');
    }
  }
});

// Draft/reviewed runs are discarded; an approved run is reversed in the ledger first.
router.post('/payroll-runs/:id/cancel', authenticateToken, authorizeRole(PAYROLL_PREPARE), (req: AuthRequest, res) =>
  transition(req, res, ['Draft', 'Reviewed', 'Approved'], async (trx, run) => {
    if (run.status === 'Approved') {
      if (!hasRole(req, PAYROLL_APPROVE)) throw new HttpError('Only an admin or accountant can cancel an approved run', 403);
      const posted = await trx('journal_entries').where({ reference_type: 'payroll_run', reference_id: String(run.id) }).pluck('id');
      const journalIds = [...new Set([...posted, ...(run.journal_id ? [run.journal_id] : [])].map(Number))];
      for (const journalId of journalIds) {
        await reverseJournal(trx, journalId, {
          date: toIsoDate(null),
          description: `Reversal of ${runLabel(run)}`,
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
  'annual_leave_days', 'max_carry_over_days', 'overtime_multiplier', 'standard_hours_per_day',
  'casual_wht_rate', 'casual_overtime_multiplier', 'casual_hours_per_day'];

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
      for (const key of ['ssnit_employee', 'ssnit_employer', 'ssnit_tier1', 'ssnit_tier2', 'casual_wht_rate']) {
        if (key in incoming && !(Number(incoming[key]) >= 0 && Number(incoming[key]) <= 100)) return res.status(400).json({ message: `${key} must be a percentage` });
      }
      if ('casual_overtime_multiplier' in incoming && !(Number(incoming.casual_overtime_multiplier) >= 1 && Number(incoming.casual_overtime_multiplier) <= 5)) {
        return res.status(400).json({ message: 'Casual overtime multiplier must be between 1 and 5' });
      }
      if ('casual_hours_per_day' in incoming && !(Number(incoming.casual_hours_per_day) >= 1 && Number(incoming.casual_hours_per_day) <= 16)) {
        return res.status(400).json({ message: 'Casual hours per day must be between 1 and 16' });
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

// Attendance is locked for a worker once pay based on it is approved: the month for staff in an approved monthly
// run, or the exact period for a casual worker's approved pay.
async function assertPayrollOpen(conn: Conn, date: string, employeeIds: string[]) {
  const d = new Date(`${date}T00:00:00Z`);
  const month = MONTHS[d.getUTCMonth()];
  const locked = await conn('payroll').join('employees', 'payroll.employee_id', 'employees.id')
    .whereIn('payroll.employee_id', employeeIds)
    .whereIn('payroll.status', ['Approved', 'Paid'])
    .where(q => q
      .where(c => c.where('payroll.pay_type', 'casual').where('payroll.period_start', '<=', date).where('payroll.period_end', '>=', date))
      .orWhere(m => m.whereNull('payroll.pay_type').whereNotNull('payroll.run_id').where({ 'payroll.month': month, 'payroll.year': d.getUTCFullYear() })))
    .select('employees.name', 'payroll.pay_type', 'payroll.status');
  if (locked.length) {
    const names = [...new Set(locked.map((l: any) => l.name))];
    throw new HttpError(`Pay covering ${date} is already approved for ${names.slice(0, 5).join(', ')}${names.length > 5 ? ` and ${names.length - 5} more` : ''}; their attendance for that day is locked`, 409);
  }
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
      const ids = rows.map(r => r.employee_id);
      await assertPayrollOpen(trx, date, ids);
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
        'timesheets.date', 'employees.name', 'employees.department', 'employees.wage_type', 'employees.salary', 'employees.overtime_rate',
        'projects.name as project_name');

    const byEmployee = new Map<string, any>();
    for (const r of rows) {
      const e = byEmployee.get(r.employee_id) || {
        employee_id: r.employee_id, name: r.name, department: r.department, wage_type: r.wage_type, rate: Number(r.salary),
        overtime_rate: casualOvertimeRate(Number(r.salary), r.overtime_rate, config),
        days: new Set<string>(), days_present: 0, days_absent: 0, days_leave: 0, hours: 0, overtime_hours: 0, projects: new Map<string, any>(),
      };
      const units = r.attendance === 'Present' ? 1 : r.attendance === 'Half Day' ? 0.5 : 0;
      const date = toIsoDate(r.date);
      if (r.attendance === 'Present') { if (!e.days.has(date)) e.days_present += 1; e.days.add(date); }
      else if (r.attendance === 'Half Day') { if (!e.days.has(date)) e.days_present += 0.5; e.days.add(date); }
      else if (r.attendance === 'Absent') e.days_absent += 1;
      else e.days_leave += 1;
      e.hours += Number(r.hours || 0);
      e.overtime_hours += Number(r.overtime_hours || 0);
      const key = r.project_id || 'none';
      const p = e.projects.get(key) || { project_id: r.project_id, project_name: r.project_name || 'General / office', days: 0, hours: 0, overtime_hours: 0 };
      p.days += units;
      p.hours += Number(r.hours || 0);
      p.overtime_hours += Number(r.overtime_hours || 0);
      e.projects.set(key, p);
      byEmployee.set(r.employee_id, e);
    }

    const projectTotals = new Map<string, any>();
    const employees = [...byEmployee.values()].map(e => {
      const totalHours = e.hours + e.overtime_hours;
      const projects = [...e.projects.values()].map((p: any) => {
        const cost = e.wage_type === 'Daily'
          ? p.days * e.rate + p.overtime_hours * e.overtime_rate
          : e.wage_type === 'Hourly'
            ? p.hours * e.rate + p.overtime_hours * e.rate * config.overtime_multiplier
            : totalHours ? e.rate * ((p.hours + p.overtime_hours) / totalHours) : 0;
        const t = projectTotals.get(p.project_id || 'none') || { project_id: p.project_id, project_name: p.project_name, hours: 0, overtime_hours: 0, labour_cost: 0, employees: 0 };
        t.hours += p.hours; t.overtime_hours += p.overtime_hours; t.labour_cost += cost; t.employees += 1;
        projectTotals.set(p.project_id || 'none', t);
        return { ...p, labour_cost: round2(cost) };
      });
      const { days, ...rest } = e;
      const estimated = e.wage_type === 'Daily'
        ? e.days_present * e.rate + e.overtime_hours * e.overtime_rate
        : e.wage_type === 'Hourly' ? e.hours * e.rate + e.overtime_hours * e.rate * config.overtime_multiplier : e.rate;
      return {
        ...rest, projects,
        hours: round2(e.hours), overtime_hours: round2(e.overtime_hours),
        estimated_pay: round2(estimated),
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
