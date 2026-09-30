import type { Knex } from "knex";
import crypto from "crypto";

const USER_COLUMNS: Array<[string, (t: Knex.AlterTableBuilder) => void]> = [
  ['must_change_password', t => t.boolean('must_change_password').notNullable().defaultTo(false)],
  ['is_active', t => t.boolean('is_active').notNullable().defaultTo(true)],
  ['failed_login_attempts', t => t.integer('failed_login_attempts').notNullable().defaultTo(0)],
  ['locked_until', t => t.timestamp('locked_until', { useTz: true }).nullable()],
  ['reset_attempts', t => t.integer('reset_attempts').notNullable().defaultTo(0)],
  ['last_login_at', t => t.timestamp('last_login_at', { useTz: true }).nullable()],
  ['password_changed_at', t => t.timestamp('password_changed_at', { useTz: true }).nullable()],
];

// md5 of the SMS gateway key that was hardcoded in app.ts and committed to git.
const LEAKED_SMS_KEY_MD5 = '6d8cfc8c44511fe6fd6319133c7e2faf';

export async function up(knex: Knex): Promise<void> {
  for (const [name, add] of USER_COLUMNS) {
    if (!(await knex.schema.hasColumn('users', name))) {
      await knex.schema.alterTable('users', add);
    }
  }

  // Reset codes are now stored as SHA-256 hashes; any outstanding plaintext code is void.
  await knex('users').update({ reset_token: null, reset_token_expires: null });

  if (!(await knex.schema.hasTable('app_secrets'))) {
    await knex.schema.createTable('app_secrets', table => {
      table.string('key').primary();
      table.text('value').notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
  }
  const existing = await knex('app_secrets').where({ key: 'jwt_secret' }).first();
  if (!existing) {
    await knex('app_secrets').insert({ key: 'jwt_secret', value: crypto.randomBytes(48).toString('hex') });
  }

  if (await knex.schema.hasTable('sms_configurations')) {
    await knex('sms_configurations')
      .whereRaw('md5(api_key) = ?', [LEAKED_SMS_KEY_MD5])
      .update({ api_key: '' });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('app_secrets');
  for (const [name] of USER_COLUMNS) {
    if (await knex.schema.hasColumn('users', name)) {
      await knex.schema.alterTable('users', t => { t.dropColumn(name); });
    }
  }
}
