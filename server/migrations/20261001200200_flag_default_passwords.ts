import type { Knex } from "knex";
import bcrypt from "bcryptjs";

// Passwords that were handed out by old code: the shared new-user default and the reset script's value.
const KNOWN_DEFAULTS = ['zxcv123$$', 'Admin', 'admin', 'admin123', 'password'];

export async function up(knex: Knex): Promise<void> {
  const users = await knex('users').select('id', 'email', 'password');
  const flagged: Array<{ id: number; email: string }> = [];
  for (const user of users) {
    if (!user.password) continue;
    for (const candidate of KNOWN_DEFAULTS) {
      if (await bcrypt.compare(candidate, user.password)) {
        flagged.push({ id: user.id, email: user.email });
        break;
      }
    }
  }
  if (!flagged.length) return;

  await knex('users').whereIn('id', flagged.map(u => u.id)).update({ must_change_password: true });
  console.warn(`⚠️  ${flagged.length} account(s) still used a default password and must change it at next sign-in: ${flagged.map(u => u.email).join(', ')}`);

  if (await knex.schema.hasTable('audit_log')) {
    await knex('audit_log').insert(flagged.map(u => ({
      action: 'default_password_flagged',
      entity: 'user',
      entity_id: String(u.id),
      after: JSON.stringify({ email: u.email, must_change_password: true }),
    })));
  }

  if (await knex.schema.hasTable('notifications')) {
    const admins = await knex('users').where({ role: 'admin' }).select('id');
    if (admins.length) {
      await knex('notifications').insert(admins.map(a => ({
        user_id: a.id,
        type: 'security',
        title: 'Accounts using a default password',
        body: `${flagged.map(u => u.email).join(', ')} still used a shared default password. They must set a new one at next sign-in; consider resetting their passwords in Settings → Users.`,
        link: 'settings',
      })));
    }
  }
}

export async function down(): Promise<void> {
  // Flags are not reverted: clearing them would re-expose default passwords.
}
