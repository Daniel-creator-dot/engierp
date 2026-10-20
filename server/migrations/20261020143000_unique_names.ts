import type { Knex } from 'knex';

/**
 * A login and the employee file it is linked to were copying each other's name
 * and phone, so one person's name landed on the other. Put those two logins
 * and two staff phones back, then refuse a second row with the same name.
 * Nothing else is renamed or deleted.
 */
const NAME_INDEXES: { table: string; index: string; expr: string }[] = [
  { table: 'employees', index: 'employees_name_ci_unique', expr: `lower(regexp_replace(btrim(name), '\\s+', ' ', 'g'))` },
  { table: 'users', index: 'users_name_ci_unique', expr: `lower(regexp_replace(btrim(name), '\\s+', ' ', 'g'))` },
  { table: 'suppliers', index: 'suppliers_name_ci_unique', expr: `lower(regexp_replace(btrim(name), '\\s+', ' ', 'g'))` },
  { table: 'projects', index: 'projects_name_ci_unique', expr: `lower(regexp_replace(btrim(name), '\\s+', ' ', 'g'))` },
  { table: 'services', index: 'services_name_ci_unique', expr: `lower(regexp_replace(btrim(name), '\\s+', ' ', 'g'))` },
  { table: 'inventory_items', index: 'inventory_items_name_ci_unique', expr: `lower(regexp_replace(btrim(name), '\\s+', ' ', 'g'))` },
  { table: 'equipment', index: 'equipment_name_ci_unique', expr: `lower(regexp_replace(btrim(name), '\\s+', ' ', 'g'))` },
  {
    table: 'chart_of_accounts',
    index: 'chart_of_accounts_type_name_ci_unique',
    expr: `type, lower(regexp_replace(btrim(name), '\\s+', ' ', 'g'))`,
  },
];

async function stamp(knex: Knex, table: string, whereSql: string, values: Record<string, string>) {
  if (!(await knex.schema.hasTable(table))) return;
  const columns = Object.keys(values);
  const assignments = columns.map(column => `${column} = ?`).join(', ');
  const touch = await knex.schema.hasColumn(table, 'updated_at') ? ', updated_at = CURRENT_TIMESTAMP' : '';
  await knex.raw(`UPDATE ${table} SET ${assignments}${touch} WHERE ${whereSql}`, columns.map(column => values[column]));
}

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('users') && await knex.schema.hasColumn('users', 'name')) {
    await stamp(knex, 'users', `lower(email) = 'samuel@bytzforge.com' AND lower(btrim(name)) = 'eshun peter'`, { name: 'SAMUEL BANINI' });
    await stamp(knex, 'users', `lower(email) = 'oleria@bytzforge.com' AND lower(btrim(name)) = 'biney kobina'`, { name: 'OLERIA' });
  }
  if (await knex.schema.hasTable('employees') && await knex.schema.hasColumn('employees', 'phone')) {
    await stamp(
      knex,
      'employees',
      `id = 'EMP-3602' AND lower(btrim(name)) = 'eshun peter' AND regexp_replace(coalesce(phone, ''), '\\D', '', 'g') = '0246713101'`,
      { phone: '0595108270' },
    );
    await stamp(
      knex,
      'employees',
      `id = 'EMP-2733' AND lower(btrim(name)) = 'biney kobina' AND regexp_replace(coalesce(phone, ''), '\\D', '', 'g') = '0559659938'`,
      { phone: '0547884920' },
    );
  }

  for (const { table, index, expr } of NAME_INDEXES) {
    if (!(await knex.schema.hasTable(table))) continue;
    await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS ${index} ON ${table} (${expr})`);
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const { index } of NAME_INDEXES) {
    await knex.raw(`DROP INDEX IF EXISTS ${index}`);
  }
}
