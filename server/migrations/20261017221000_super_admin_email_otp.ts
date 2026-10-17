import type { Knex } from 'knex';

/**
 * Email-code sign-in is opt-in per account. Existing password users are unchanged.
 * The super admin row itself is created at startup, not here, so this migration
 * never deletes or rewrites company data.
 */
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('users'))) return;

  const add = async (name: string, alter: (table: Knex.AlterTableBuilder) => void) => {
    if (!(await knex.schema.hasColumn('users', name))) {
      await knex.schema.alterTable('users', alter);
    }
  };

  await add('otp_login', t => t.boolean('otp_login').notNullable().defaultTo(false));
  await add('login_otp_hash', t => t.string('login_otp_hash').nullable());
  await add('login_otp_expires', t => t.timestamp('login_otp_expires', { useTz: true }).nullable());
  await add('login_otp_attempts', t => t.integer('login_otp_attempts').notNullable().defaultTo(0));
}

export async function down(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('users'))) return;
  for (const name of ['login_otp_attempts', 'login_otp_expires', 'login_otp_hash', 'otp_login']) {
    if (await knex.schema.hasColumn('users', name)) {
      await knex.schema.alterTable('users', t => { t.dropColumn(name); });
    }
  }
}
