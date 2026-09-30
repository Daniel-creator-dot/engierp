import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import db from '../db';
import { sendSMS, isSmsConfigured, normalizePhone } from '../utils/sms';
import { authenticateToken, invalidateUserCache, AuthRequest } from '../middleware/auth';
import { getJwtSecret } from '../lib/secrets';
import { validatePassword, hashToken, tokenMatches, PASSWORD_POLICY } from '../lib/passwords';
import { logAudit } from '../lib/audit';
import { notify } from '../lib/notify';

const router = Router();

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;
const MAX_RESET_ATTEMPTS = 5;
const RESET_CODE_MINUTES = 10;

const limiter = (windowMinutes: number, limit: number, message: string) => rateLimit({
  windowMs: windowMinutes * 60 * 1000,
  limit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message },
});

const loginLimiter = limiter(15, 20, 'Too many login attempts from this network. Try again in 15 minutes.');
const forgotLimiter = limiter(15, 5, 'Too many reset requests. Try again in 15 minutes.');
const resetLimiter = limiter(15, 10, 'Too many reset attempts. Try again in 15 minutes.');

const signToken = (user: any) => jwt.sign(
  { id: user.id, email: user.email, role: user.role, employee_id: user.employee_id },
  getJwtSecret(),
  { expiresIn: '24h' }
);

const publicUser = (user: any, employee?: any) => ({
  id: user.id,
  email: user.email,
  role: user.role,
  phone: user.phone,
  employee_id: user.employee_id,
  name: employee?.name || null,
  must_change_password: !!user.must_change_password,
  last_login_at: user.last_login_at || null,
});

async function findUserByPhone(phone: string) {
  const target = normalizePhone(phone);
  if (target.length < 9) return null;
  const candidates = await db('users').whereNotNull('phone').select('*');
  return candidates.find(u => normalizePhone(u.phone) === target && u.is_active !== false) || null;
}

router.post('/login', loginLimiter, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!email || !password) return res.status(400).json({ message: 'Email and password are required' });

  try {
    const user = await db('users').whereRaw('lower(email) = ?', [email]).first();
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const minutes = Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000);
      return res.status(429).json({ message: `Too many failed attempts. This account is locked for ${minutes} more minute(s), or ask an administrator to reset your password.` });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      const attempts = (user.failed_login_attempts || 0) + 1;
      const lock = attempts >= MAX_FAILED_LOGINS;
      await db('users').where({ id: user.id }).update({
        failed_login_attempts: lock ? 0 : attempts,
        locked_until: lock ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000) : user.locked_until,
      });
      if (lock) {
        await logAudit(req as AuthRequest, 'account_locked', 'user', user.id, undefined, { email: user.email, reason: 'failed_logins' });
        return res.status(429).json({ message: `Too many failed attempts. This account is locked for ${LOCKOUT_MINUTES} minutes.` });
      }
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    if (user.is_active === false) {
      return res.status(403).json({ message: 'This account has been deactivated. Contact an administrator.' });
    }

    const lastLogin = new Date();
    await db('users').where({ id: user.id }).update({ failed_login_attempts: 0, locked_until: null, last_login_at: lastLogin });
    (req as AuthRequest).user = { id: user.id, email: user.email, role: user.role };
    await logAudit(req as AuthRequest, 'login', 'user', user.id);
    const employee = user.employee_id ? await db('employees').where({ id: user.employee_id }).first('name') : null;

    res.json({ token: signToken(user), user: publicUser({ ...user, last_login_at: lastLogin }, employee) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/me', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const user = await db('users').where({ id: req.user!.id }).first();
    if (!user) return res.status(401).json({ message: 'This account no longer exists.', code: 'TOKEN_INVALID' });
    const employee = user.employee_id ? await db('employees').where({ id: user.employee_id }).first('name') : null;
    res.json(publicUser(user, employee));
  } catch (error) {
    console.error('GET /auth/me failed:', error);
    res.status(500).json({ message: 'Could not load your account' });
  }
});

router.get('/password-policy', (_req, res) => res.json(PASSWORD_POLICY));

router.post('/change-password', authenticateToken, async (req: AuthRequest, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const policyError = validatePassword(newPassword);
  if (policyError) return res.status(400).json({ message: policyError });

  try {
    const user = await db('users').where({ id: req.user!.id }).first();
    if (!user) return res.status(401).json({ message: 'This account no longer exists.', code: 'TOKEN_INVALID' });
    if (!(await bcrypt.compare(String(currentPassword || ''), user.password))) {
      return res.status(400).json({ message: 'Your current password is incorrect' });
    }
    if (await bcrypt.compare(newPassword, user.password)) {
      return res.status(400).json({ message: 'Choose a password different from your current one' });
    }

    // Round down so the token issued below (iat in whole seconds) stays valid while older ones are revoked.
    const changedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
    await db('users').where({ id: user.id }).update({
      password: await bcrypt.hash(newPassword, 10),
      must_change_password: false,
      password_changed_at: changedAt,
      updated_at: db.fn.now(),
    });
    invalidateUserCache(user.id);
    await logAudit(req, 'password_changed', 'user', user.id);
    await notify({ userId: user.id }, 'Password changed', 'Your password was changed. If this wasn\'t you, contact an administrator immediately.', { type: 'security' });

    const updated = { ...user, must_change_password: false };
    const employee = user.employee_id ? await db('employees').where({ id: user.employee_id }).first('name') : null;
    res.json({ message: 'Password changed', token: signToken(updated), user: publicUser(updated, employee) });
  } catch (error) {
    console.error('POST /auth/change-password failed:', error);
    res.status(500).json({ message: 'Could not change password' });
  }
});

router.get('/profile', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const user = await db('users').where({ id: req.user!.id }).first();
    if (!user) return res.status(401).json({ message: 'This account no longer exists.', code: 'TOKEN_INVALID' });
    const employee = user.employee_id
      ? await db('employees').where({ id: user.employee_id })
          .first('id', 'name', 'role', 'department', 'joinDate', 'status', 'phone', 'employment_type', 'ssnit', 'bank_name', 'account_number', 'branch')
      : null;
    res.json({ user: publicUser(user, employee), employee: employee || null });
  } catch (error) {
    console.error('GET /auth/profile failed:', error);
    res.status(500).json({ message: 'Could not load your profile' });
  }
});

router.patch('/profile', authenticateToken, async (req: AuthRequest, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : undefined;
  const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : undefined;
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : undefined;

  if (email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: 'Enter a valid email address' });
  if (phone !== undefined && phone && normalizePhone(phone).length < 9) return res.status(400).json({ message: 'Enter a valid phone number' });
  if (name !== undefined && !name) return res.status(400).json({ message: 'Name cannot be empty' });

  try {
    const user = await db('users').where({ id: req.user!.id }).first();
    if (!user) return res.status(401).json({ message: 'This account no longer exists.', code: 'TOKEN_INVALID' });

    if (email && email !== String(user.email).toLowerCase()) {
      const taken = await db('users').whereRaw('lower(email) = ?', [email]).whereNot({ id: user.id }).first();
      if (taken) return res.status(409).json({ message: 'That email is already used by another account' });
    }

    const userUpdates: Record<string, any> = {};
    if (email !== undefined) userUpdates.email = email;
    if (phone !== undefined) userUpdates.phone = phone || null;
    const employeeUpdates: Record<string, any> = {};
    if (name !== undefined) employeeUpdates.name = name;
    if (phone !== undefined) employeeUpdates.phone = phone || null;

    const before = { email: user.email, phone: user.phone };
    await db.transaction(async trx => {
      if (Object.keys(userUpdates).length) await trx('users').where({ id: user.id }).update({ ...userUpdates, updated_at: trx.fn.now() });
      if (user.employee_id && Object.keys(employeeUpdates).length) {
        await trx('employees').where({ id: user.employee_id }).update({ ...employeeUpdates, updated_at: trx.fn.now() });
      }
      await logAudit(req, 'profile_updated', 'user', user.id, before, { ...userUpdates, ...employeeUpdates }, trx);
    });
    invalidateUserCache(user.id);

    const updated = await db('users').where({ id: user.id }).first();
    const employee = updated.employee_id ? await db('employees').where({ id: updated.employee_id }).first('name') : null;
    res.json({ message: 'Profile updated', token: signToken(updated), user: publicUser(updated, employee) });
  } catch (error) {
    console.error('PATCH /auth/profile failed:', error);
    res.status(500).json({ message: 'Could not update your profile' });
  }
});

router.post('/forgot-password', forgotLimiter, async (req, res) => {
  const phone = String(req.body?.phone || '').trim();
  if (!phone) return res.status(400).json({ message: 'Enter your registered phone number' });

  try {
    if (!(await isSmsConfigured())) {
      return res.status(503).json({ message: 'Password reset by SMS is not available right now. Ask an administrator to reset your password.' });
    }

    const genericReply = { message: 'If that number belongs to an account, a reset code has been sent by SMS.' };
    const user = await findUserByPhone(phone);
    if (!user) return res.json(genericReply);

    const code = crypto.randomInt(100000, 1000000).toString();
    await db('users').where({ id: user.id }).update({
      reset_token: hashToken(code),
      reset_token_expires: new Date(Date.now() + RESET_CODE_MINUTES * 60 * 1000),
      reset_attempts: 0,
    });

    const sms = await sendSMS(user.phone, `Your bytzforge reset code is: ${code}. Valid for ${RESET_CODE_MINUTES} minutes. Do not share it.`);
    if (!sms.success) {
      console.error(`forgot-password: SMS to user ${user.id} failed:`, sms.error);
      return res.status(502).json({ message: 'We could not send the SMS. Try again shortly or ask an administrator to reset your password.' });
    }
    await logAudit(req as AuthRequest, 'password_reset_requested', 'user', user.id);
    res.json(genericReply);
  } catch (error) {
    console.error('POST /auth/forgot-password failed:', error);
    res.status(500).json({ message: 'Error processing request' });
  }
});

router.post('/reset-password', resetLimiter, async (req, res) => {
  const phone = String(req.body?.phone || '').trim();
  const code = String(req.body?.code || '').trim();
  const newPassword = req.body?.newPassword;

  const policyError = validatePassword(newPassword);
  if (policyError) return res.status(400).json({ message: policyError });

  try {
    const user = await findUserByPhone(phone);
    const invalid = () => res.status(400).json({ message: 'Invalid or expired code' });
    if (!user || !user.reset_token || !user.reset_token_expires || new Date(user.reset_token_expires) < new Date()) {
      return invalid();
    }

    if ((user.reset_attempts || 0) >= MAX_RESET_ATTEMPTS) {
      await db('users').where({ id: user.id }).update({ reset_token: null, reset_token_expires: null, reset_attempts: 0 });
      return res.status(400).json({ message: 'Too many incorrect codes. Request a new code.' });
    }

    if (!tokenMatches(code, user.reset_token)) {
      await db('users').where({ id: user.id }).increment('reset_attempts', 1);
      return invalid();
    }

    await db('users').where({ id: user.id }).update({
      password: await bcrypt.hash(newPassword, 10),
      reset_token: null,
      reset_token_expires: null,
      reset_attempts: 0,
      failed_login_attempts: 0,
      locked_until: null,
      must_change_password: false,
      password_changed_at: new Date(),
      updated_at: db.fn.now(),
    });
    invalidateUserCache(user.id);
    await logAudit(req as AuthRequest, 'password_reset_completed', 'user', user.id, undefined, { via: 'sms_code' });
    await notify({ userId: user.id }, 'Password reset', 'Your password was reset using an SMS code. If this wasn\'t you, contact an administrator.', { type: 'security' });

    res.json({ message: 'Password reset successful' });
  } catch (error) {
    console.error('POST /auth/reset-password failed:', error);
    res.status(500).json({ message: 'Error resetting password' });
  }
});

export default router;
