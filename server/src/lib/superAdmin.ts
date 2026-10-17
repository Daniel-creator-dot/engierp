import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import type { Knex } from 'knex';

/** The one account that signs in with an email code. Other users keep their passwords. */
export const SUPER_ADMIN_EMAIL = 'admin@bytzforge.com';

export function usesEmailOtp(user: { otp_login?: boolean | null } | null | undefined): boolean {
  return !!user?.otp_login;
}

/**
 * Make sure the super admin exists with full admin access and email-code sign-in.
 * Inserts one row when missing. Never deletes users, employees, projects, accounts, or settings.
 */
export async function ensureSuperAdmin(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('users'))) return;
  if (!(await knex.schema.hasColumn('users', 'otp_login'))) return;

  const existing = await knex('users').whereRaw('lower(email) = ?', [SUPER_ADMIN_EMAIL]).first();
  if (!existing) {
    await knex('users').insert({
      email: SUPER_ADMIN_EMAIL,
      name: 'Super Admin',
      // Unusable password. This account never signs in with one.
      password: await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10),
      role: 'admin',
      is_active: true,
      must_change_password: false,
      otp_login: true,
      login_otp_attempts: 0,
    });
    console.log(`ℹ️  Super admin ${SUPER_ADMIN_EMAIL} is ready. Sign in with an email code, not a password.`);
    return;
  }

  const updates: Record<string, unknown> = {};
  if (existing.role !== 'admin') updates.role = 'admin';
  if (existing.is_active === false) updates.is_active = true;
  if (existing.must_change_password) updates.must_change_password = false;
  if (!existing.otp_login) updates.otp_login = true;
  if (!String(existing.name || '').trim()) updates.name = 'Super Admin';
  if (!Object.keys(updates).length) return;

  await knex('users').where({ id: existing.id }).update({ ...updates, updated_at: knex.fn.now() });
  console.log(`ℹ️  Super admin ${SUPER_ADMIN_EMAIL} confirmed as an admin with email-code sign-in.`);
}
