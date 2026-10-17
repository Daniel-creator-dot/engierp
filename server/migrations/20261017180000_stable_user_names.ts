import type { Knex } from 'knex';

/**
 * Adds a stable login name. Where a login is already linked to an employee and
 * has no name of its own, the employee name is copied once. Employee rows,
 * account names, project names, and company settings are not modified.
 */
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('users'))) return;
  if (!(await knex.schema.hasColumn('users', 'name'))) {
    await knex.schema.alterTable('users', (table) => {
      table.string('name').nullable();
    });
  }
  if (await knex.schema.hasTable('employees')) {
    await knex.raw(`
      UPDATE users AS u
      SET name = e.name
      FROM employees AS e
      WHERE u.employee_id = e.id
        AND (u.name IS NULL OR btrim(u.name) = '')
        AND e.name IS NOT NULL
        AND btrim(e.name) <> ''
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('users', 'name')) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('name');
    });
  }
}
