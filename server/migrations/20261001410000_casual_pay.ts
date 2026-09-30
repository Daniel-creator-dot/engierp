import type { Knex } from "knex";

type Column = [string, (t: Knex.AlterTableBuilder) => void];

// Daily-rated casual workers reuse employees.salary as the daily rate (wage_type = 'Daily').
const EMPLOYEE_COLUMNS: Column[] = [
  ['overtime_rate', t => t.decimal('overtime_rate', 12, 2).nullable()],    // per-hour override; null = config multiplier
  ['pay_frequency', t => t.string('pay_frequency').nullable()],           // casuals: Weekly (default) | Daily
  ['tax_treatment', t => t.string('tax_treatment').nullable()],           // casual_wht | paye | none; null = by pay basis
];

const RUN_COLUMNS: Column[] = [
  ['run_type', t => t.string('run_type').notNullable().defaultTo('monthly')], // monthly | casual
  ['frequency', t => t.string('frequency').nullable()],                      // casual runs: Weekly | Daily
  ['period_start', t => t.date('period_start').nullable()],
  ['period_end', t => t.date('period_end').nullable()],
];

const PAYROLL_COLUMNS: Column[] = [
  ['pay_type', t => t.string('pay_type').nullable()],                      // 'casual', or null for monthly pay
  ['days_worked', t => t.decimal('days_worked', 8, 2).nullable()],
  ['daily_rate', t => t.decimal('daily_rate', 12, 2).nullable()],
  ['overtime_rate', t => t.decimal('overtime_rate', 12, 2).nullable()],
  ['overtime_pay', t => t.decimal('overtime_pay', 14, 2).nullable()],
  ['wht', t => t.decimal('wht', 14, 2).nullable()],
  ['tax_treatment', t => t.string('tax_treatment').nullable()],
  ['period_start', t => t.date('period_start').nullable()],
  ['period_end', t => t.date('period_end').nullable()],
  ['project_breakdown', t => t.text('project_breakdown').nullable()],      // JSON: [{project_id, days, overtime_hours, amount}]
];

async function addMissingColumns(knex: Knex, table: string, columns: Column[]) {
  for (const [name, build] of columns) {
    if (!(await knex.schema.hasColumn(table, name))) await knex.schema.alterTable(table, build);
  }
}

async function dropColumns(knex: Knex, table: string, columns: Column[]) {
  for (const [name] of [...columns].reverse()) {
    if (await knex.schema.hasColumn(table, name)) await knex.schema.alterTable(table, t => { t.dropColumn(name); });
  }
}

async function mergeSetting(knex: Knex, key: string, patch: (current: Record<string, any>) => Record<string, any>) {
  const row = await knex('settings').where({ key }).first();
  let current: Record<string, any> = {};
  try { current = row?.value ? JSON.parse(row.value) : {}; } catch { current = {}; }
  const value = JSON.stringify(patch(current));
  if (row) await knex('settings').where({ key }).update({ value, updated_at: knex.fn.now() });
  else await knex('settings').insert({ key, value });
}

export async function up(knex: Knex): Promise<void> {
  await addMissingColumns(knex, 'employees', EMPLOYEE_COLUMNS);
  await addMissingColumns(knex, 'payroll_runs', RUN_COLUMNS);
  await addMissingColumns(knex, 'payroll', PAYROLL_COLUMNS);

  // The one-per-month rules only apply to monthly pay; casual pay is checked per worker per period in the API.
  await knex.raw('DROP INDEX IF EXISTS payroll_runs_period_unique');
  await knex.raw(`CREATE UNIQUE INDEX payroll_runs_period_unique ON payroll_runs (month, year) WHERE status <> 'Cancelled' AND run_type = 'monthly'`);
  await knex.raw('DROP INDEX IF EXISTS payroll_employee_period_unique');
  await knex.raw(`CREATE UNIQUE INDEX payroll_employee_period_unique ON payroll (employee_id, month, year) WHERE status IS DISTINCT FROM 'Rejected' AND pay_type IS NULL`);
  await knex.raw('CREATE INDEX IF NOT EXISTS payroll_casual_period_idx ON payroll (employee_id, period_start, period_end) WHERE pay_type IS NOT NULL');

  await mergeSetting(knex, 'payroll_config', c => ({
    ...c,
    casual_wht_rate: c.casual_wht_rate ?? 5,
    casual_overtime_multiplier: c.casual_overtime_multiplier ?? 1.5,
    casual_hours_per_day: c.casual_hours_per_day ?? 8,
  }));

  const accountId = async (code: string) => (await knex('chart_of_accounts').where({ code }).first())?.id ?? null;
  const wht = await accountId('2102');
  const cash = await accountId('1101');
  await mergeSetting(knex, 'payroll_accounts', a => ({
    ...a,
    casual_wht_payable_account_id: a.casual_wht_payable_account_id ?? wht,
    casual_payment_account_id: a.casual_payment_account_id ?? cash,
  }));
}

export async function down(knex: Knex): Promise<void> {
  await mergeSetting(knex, 'payroll_accounts', ({ casual_wht_payable_account_id, casual_payment_account_id, ...a }) => a);
  await mergeSetting(knex, 'payroll_config', ({ casual_wht_rate, casual_overtime_multiplier, casual_hours_per_day, ...c }) => c);
  await knex.raw('DROP INDEX IF EXISTS payroll_casual_period_idx');
  await knex.raw('DROP INDEX IF EXISTS payroll_employee_period_unique');
  await knex.raw(`CREATE UNIQUE INDEX payroll_employee_period_unique ON payroll (employee_id, month, year) WHERE status IS DISTINCT FROM 'Rejected'`);
  await knex.raw('DROP INDEX IF EXISTS payroll_runs_period_unique');
  await knex.raw(`CREATE UNIQUE INDEX payroll_runs_period_unique ON payroll_runs (month, year) WHERE status <> 'Cancelled'`);
  await dropColumns(knex, 'payroll', PAYROLL_COLUMNS);
  await dropColumns(knex, 'payroll_runs', RUN_COLUMNS);
  await dropColumns(knex, 'employees', EMPLOYEE_COLUMNS);
}
