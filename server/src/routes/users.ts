import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import db from '../db';
import { authenticateToken, authorizeRole, invalidateUserCache, AuthRequest } from '../middleware/auth';
import { generateTempPassword } from '../lib/passwords';
import { logAudit } from '../lib/audit';
import { notify } from '../lib/notify';
import { sendSMS, isSmsConfigured, normalizePhone } from '../utils/sms';

const router = Router();

export const ROLES = ['admin', 'accountant', 'hr', 'pm', 'procurement'] as const;
const isRole = (role: unknown): role is typeof ROLES[number] => typeof role === 'string' && (ROLES as readonly string[]).includes(role);

const USER_FIELDS = [
  'users.id', 'users.email', 'users.role', 'users.phone', 'users.employee_id', 'users.is_active',
  'users.must_change_password', 'users.last_login_at', 'users.locked_until', 'users.created_at',
];

const loadUser = (id: number | string) => db('users')
  .leftJoin('employees', 'users.employee_id', 'employees.id')
  .where('users.id', id)
  .first([...USER_FIELDS, 'employees.name as name', 'employees.department as department']);

async function activeAdminCount(excludeId?: number) {
  const q = db('users').where({ role: 'admin', is_active: true });
  if (excludeId) q.whereNot({ id: excludeId });
  const row = await q.count('id as count').first();
  return Number(row?.count || 0);
}

async function newEmployeeId(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const id = `EMP-${crypto.randomInt(1000, 100000)}`;
    if (!(await db('employees').where({ id }).first('id'))) return id;
  }
  throw new Error('Could not allocate an employee ID');
}

async function deliverTempPassword(phone: string | null, email: string, tempPassword: string) {
  if (!phone || !(await isSmsConfigured())) return false;
  const sms = await sendSMS(phone, `Your bytzforge ERP login: ${email} / temporary password ${tempPassword}. You will be asked to change it when you sign in.`);
  return sms.success;
}

router.get('/', authenticateToken, authorizeRole(['admin', 'hr']), async (_req, res) => {
  try {
    const users = await db('users')
      .leftJoin('employees', 'users.employee_id', 'employees.id')
      .select([...USER_FIELDS, 'employees.name as name', 'employees.department as department'])
      .orderBy('users.email');
    res.json(users);
  } catch (error) {
    console.error('GET /settings/users failed:', error);
    res.status(500).json({ message: 'Error fetching users' });
  }
});

router.post('/', authenticateToken, authorizeRole(['admin', 'hr']), async (req: AuthRequest, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const role = req.body?.role;
  const phone = String(req.body?.phone || '').trim();
  const name = String(req.body?.name || '').trim();
  const department = String(req.body?.department || '').trim() || 'General';
  const linkEmployeeId = String(req.body?.employee_id || '').trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: 'Enter a valid email address' });
  if (!isRole(role)) return res.status(400).json({ message: `Role must be one of: ${ROLES.join(', ')}` });
  if (role === 'admin' && req.user?.role !== 'admin') return res.status(403).json({ message: 'Only administrators can create admin accounts' });
  if (phone && normalizePhone(phone).length < 9) return res.status(400).json({ message: 'Enter a valid phone number' });

  try {
    if (await db('users').whereRaw('lower(email) = ?', [email]).first('id')) {
      return res.status(409).json({ message: 'A user with that email already exists' });
    }
    if (linkEmployeeId) {
      const emp = await db('employees').where({ id: linkEmployeeId }).first('id');
      if (!emp) return res.status(400).json({ message: 'Employee record not found' });
      const linked = await db('users').where({ employee_id: linkEmployeeId }).first('email');
      if (linked) return res.status(409).json({ message: `That employee is already linked to ${linked.email}` });
    }

    const tempPassword = generateTempPassword();
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    const created = await db.transaction(async trx => {
      let employeeId = linkEmployeeId;
      if (!employeeId) {
        employeeId = await newEmployeeId();
        await trx('employees').insert({
          id: employeeId,
          name: name || email.split('@')[0],
          role: role.toUpperCase(),
          department,
          salary: 0,
          joinDate: new Date().toISOString().split('T')[0],
          status: 'active',
          phone: phone || null,
        });
      }
      const [inserted] = await trx('users').insert({
        email,
        role,
        phone: phone || null,
        password: hashedPassword,
        employee_id: employeeId,
        must_change_password: true,
        is_active: true,
      }).returning('id');
      const id = typeof inserted === 'object' ? inserted.id : inserted;
      await logAudit(req, 'user_created', 'user', id, undefined, { email, role, phone, employee_id: employeeId, linked_existing_employee: !!linkEmployeeId }, trx);
      return { id, employeeId };
    });

    const smsSent = await deliverTempPassword(phone || null, email, tempPassword);
    await notify({ roles: ['admin'] }, 'New user account', `${email} was added as ${role} by ${req.user?.email}.`, {
      type: 'user', link: 'settings', excludeUserId: req.user?.id,
    });

    res.status(201).json({
      user: await loadUser(created.id),
      temp_password: tempPassword,
      sms_sent: smsSent,
      message: smsSent ? 'User created; the temporary password was also sent by SMS.' : 'User created. Share the temporary password with them securely.',
    });
  } catch (error) {
    console.error('POST /settings/users failed:', error);
    res.status(500).json({ message: 'Error creating user' });
  }
});

router.patch('/:id', authenticateToken, authorizeRole(['admin']), async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  try {
    const existing = await db('users').where({ id }).first();
    if (!existing) return res.status(404).json({ message: 'User not found' });

    const updates: Record<string, any> = {};
    if (req.body?.role !== undefined) {
      if (!isRole(req.body.role)) return res.status(400).json({ message: `Role must be one of: ${ROLES.join(', ')}` });
      if (existing.role === 'admin' && req.body.role !== 'admin') {
        if (id === req.user?.id) return res.status(400).json({ message: 'You cannot remove your own admin role' });
        if ((await activeAdminCount(id)) === 0) return res.status(400).json({ message: 'At least one active admin is required' });
      }
      updates.role = req.body.role;
    }
    if (req.body?.phone !== undefined) {
      const phone = String(req.body.phone || '').trim();
      if (phone && normalizePhone(phone).length < 9) return res.status(400).json({ message: 'Enter a valid phone number' });
      updates.phone = phone || null;
    }
    if (req.body?.email !== undefined) {
      const email = String(req.body.email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: 'Enter a valid email address' });
      if (await db('users').whereRaw('lower(email) = ?', [email]).whereNot({ id }).first('id')) {
        return res.status(409).json({ message: 'That email is already used by another account' });
      }
      updates.email = email;
    }
    if (req.body?.employee_id !== undefined) {
      const employeeId = String(req.body.employee_id || '').trim();
      if (employeeId) {
        if (!(await db('employees').where({ id: employeeId }).first('id'))) return res.status(400).json({ message: 'Employee record not found' });
        const linked = await db('users').where({ employee_id: employeeId }).whereNot({ id }).first('email');
        if (linked) return res.status(409).json({ message: `That employee is already linked to ${linked.email}` });
      }
      updates.employee_id = employeeId || null;
    }
    if (!Object.keys(updates).length) return res.status(400).json({ message: 'Nothing to update' });

    await db('users').where({ id }).update({ ...updates, updated_at: db.fn.now() });
    invalidateUserCache(id);
    const before = Object.fromEntries(Object.keys(updates).map(k => [k, existing[k]]));
    await logAudit(req, 'user_updated', 'user', id, before, updates);
    if (updates.role && updates.role !== existing.role) {
      await notify({ userId: id }, 'Your access changed', `Your role is now ${updates.role}.`, { type: 'security' });
    }
    res.json(await loadUser(id));
  } catch (error) {
    console.error('PATCH /settings/users/:id failed:', error);
    res.status(500).json({ message: 'Error updating user' });
  }
});

router.post('/:id/deactivate', authenticateToken, authorizeRole(['admin']), async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  try {
    const existing = await db('users').where({ id }).first();
    if (!existing) return res.status(404).json({ message: 'User not found' });
    if (id === req.user?.id) return res.status(400).json({ message: 'You cannot deactivate your own account' });
    if (existing.role === 'admin' && (await activeAdminCount(id)) === 0) {
      return res.status(400).json({ message: 'At least one active admin is required' });
    }
    await db('users').where({ id }).update({ is_active: false, updated_at: db.fn.now() });
    invalidateUserCache(id);
    await logAudit(req, 'user_deactivated', 'user', id, { is_active: existing.is_active }, { is_active: false });
    res.json(await loadUser(id));
  } catch (error) {
    console.error('POST /settings/users/:id/deactivate failed:', error);
    res.status(500).json({ message: 'Error deactivating user' });
  }
});

router.post('/:id/reactivate', authenticateToken, authorizeRole(['admin']), async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  try {
    const existing = await db('users').where({ id }).first();
    if (!existing) return res.status(404).json({ message: 'User not found' });
    await db('users').where({ id }).update({ is_active: true, failed_login_attempts: 0, locked_until: null, updated_at: db.fn.now() });
    invalidateUserCache(id);
    await logAudit(req, 'user_reactivated', 'user', id, { is_active: existing.is_active }, { is_active: true });
    res.json(await loadUser(id));
  } catch (error) {
    console.error('POST /settings/users/:id/reactivate failed:', error);
    res.status(500).json({ message: 'Error reactivating user' });
  }
});

router.post('/:id/reset-password', authenticateToken, authorizeRole(['admin']), async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  try {
    const existing = await db('users').where({ id }).first();
    if (!existing) return res.status(404).json({ message: 'User not found' });

    const tempPassword = generateTempPassword();
    await db('users').where({ id }).update({
      password: await bcrypt.hash(tempPassword, 10),
      must_change_password: true,
      failed_login_attempts: 0,
      locked_until: null,
      reset_token: null,
      reset_token_expires: null,
      password_changed_at: new Date(),
      updated_at: db.fn.now(),
    });
    invalidateUserCache(id);
    await logAudit(req, 'password_reset_by_admin', 'user', id);

    const smsSent = await deliverTempPassword(existing.phone, existing.email, tempPassword);
    await notify({ userId: id }, 'Password reset by administrator', `${req.user?.email} reset your password. Sign in with the temporary password and choose a new one.`, { type: 'security' });

    res.json({
      user: await loadUser(id),
      temp_password: tempPassword,
      sms_sent: smsSent,
      message: smsSent ? 'Password reset; the temporary password was also sent by SMS.' : 'Password reset. Share the temporary password with the user securely.',
    });
  } catch (error) {
    console.error('POST /settings/users/:id/reset-password failed:', error);
    res.status(500).json({ message: 'Error resetting password' });
  }
});

router.get('/security-summary', authenticateToken, authorizeRole(['admin']), async (_req, res) => {
  try {
    const users = await db('users').select('id', 'email', 'role', 'is_active', 'must_change_password', 'last_login_at', 'locked_until');
    const now = Date.now();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    res.json({
      total_users: users.length,
      active_users: users.filter(u => u.is_active !== false).length,
      inactive_users: users.filter(u => u.is_active === false).length,
      pending_password_change: users.filter(u => u.must_change_password && u.is_active !== false).map(u => u.email),
      locked_accounts: users.filter(u => u.locked_until && new Date(u.locked_until).getTime() > now).map(u => u.email),
      never_logged_in: users.filter(u => !u.last_login_at && u.is_active !== false).map(u => u.email),
      dormant_30_days: users.filter(u => u.last_login_at && now - new Date(u.last_login_at).getTime() > thirtyDays && u.is_active !== false).map(u => u.email),
      admins: users.filter(u => u.role === 'admin' && u.is_active !== false).map(u => u.email),
      sms_configured: await isSmsConfigured(),
      jwt_secret_from_env: !!process.env.JWT_SECRET?.trim(),
      sms_key_from_env: !!process.env.SMS_API_KEY?.trim(),
    });
  } catch (error) {
    console.error('GET /settings/users/security-summary failed:', error);
    res.status(500).json({ message: 'Error loading security summary' });
  }
});

export default router;
