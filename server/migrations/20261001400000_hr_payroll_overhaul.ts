import type { Knex } from "knex";

// GRA monthly PAYE bands effective 2024 (band widths; the last band is open-ended).
const GRA_2024_TIERS = [
  { threshold: 490, rate: 0 },
  { threshold: 110, rate: 5 },
  { threshold: 130, rate: 10 },
  { threshold: 3166.67, rate: 17.5 },
  { threshold: 16000, rate: 25 },
  { threshold: 30520, rate: 30 },
  { threshold: 999999, rate: 35 },
];

// Default payroll posting accounts, resolved by code from the live chart of accounts.
const ACCOUNT_CODES: Record<string, string> = {
  salary_expense_account_id: '6101',
  site_labour_account_id: '5102',
  employer_ssnit_account_id: '6101',
  paye_payable_account_id: '2103',
  ssnit_payable_account_id: '2104',
  other_deductions_account_id: '2106',
  bank_account_id: '1103',
};

const PAYROLL_COLUMNS: [string, (t: Knex.AlterTableBuilder) => void][] = [
  ['run_id', t => t.integer('run_id').nullable().references('id').inTable('payroll_runs').onDelete('CASCADE')],
  ['gross', t => t.decimal('gross', 14, 2).nullable()],
  ['ssnit_employee', t => t.decimal('ssnit_employee', 14, 2).nullable()],
  ['ssnit_employer', t => t.decimal('ssnit_employer', 14, 2).nullable()],
  ['paye', t => t.decimal('paye', 14, 2).nullable()],
  ['taxable_income', t => t.decimal('taxable_income', 14, 2).nullable()],
  ['other_deductions', t => t.decimal('other_deductions', 14, 2).nullable()],
  ['detailed_allowances', t => t.text('detailed_allowances').nullable()],
  ['hours_worked', t => t.decimal('hours_worked', 10, 2).nullable()],
  ['overtime_hours', t => t.decimal('overtime_hours', 10, 2).nullable()],
  ['journal_id', t => t.integer('journal_id').nullable()],
  ['approved_by', t => t.integer('approved_by').nullable()],
  ['created_by', t => t.integer('created_by').nullable()],
  ['notes', t => t.text('notes').nullable()],
];

async function addMissingColumns(knex: Knex, table: string, columns: [string, (t: Knex.AlterTableBuilder) => void][]) {
  for (const [name, build] of columns) {
    if (!(await knex.schema.hasColumn(table, name))) {
      await knex.schema.alterTable(table, build);
    }
  }
}

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('payroll_runs'))) {
    await knex.schema.createTable('payroll_runs', (table) => {
      table.increments('id').primary();
      table.string('month').notNullable();
      table.integer('year').notNullable();
      table.string('status').notNullable().defaultTo('Draft'); // Draft -> Reviewed -> Approved -> Paid, or Cancelled
      table.date('payment_date').nullable();
      table.string('project_id').nullable();
      table.text('notes').nullable();
      table.integer('journal_id').nullable();
      table.integer('created_by').nullable();
      table.integer('reviewed_by').nullable();
      table.integer('approved_by').nullable();
      table.integer('paid_by').nullable();
      table.timestamp('reviewed_at').nullable();
      table.timestamp('approved_at').nullable();
      table.timestamp('paid_at').nullable();
      table.timestamps(true, true);
    });
    await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS payroll_runs_period_unique ON payroll_runs (month, year) WHERE status <> 'Cancelled'`);
  }

  await addMissingColumns(knex, 'payroll', PAYROLL_COLUMNS);
  // One live payroll entry per employee per period; rejected entries don't block a re-run.
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS payroll_employee_period_unique ON payroll (employee_id, month, year) WHERE status IS DISTINCT FROM 'Rejected'`);

  await addMissingColumns(knex, 'employees', [
    ['annual_leave_days', t => t.integer('annual_leave_days').nullable()],
  ]);

  await addMissingColumns(knex, 'leave_requests', [
    ['days', t => t.decimal('days', 6, 1).nullable()],
    ['decided_by', t => t.integer('decided_by').nullable()],
    ['decided_at', t => t.timestamp('decided_at').nullable()],
    ['decision_note', t => t.text('decision_note').nullable()],
  ]);

  if (!(await knex.schema.hasTable('leave_balances'))) {
    await knex.schema.createTable('leave_balances', (table) => {
      table.increments('id').primary();
      table.string('employee_id').notNullable().references('id').inTable('employees').onDelete('CASCADE');
      table.integer('year').notNullable();
      table.decimal('entitlement', 6, 1).notNullable();
      table.decimal('carried_over', 6, 1).notNullable().defaultTo(0);
      table.decimal('used', 6, 1).notNullable().defaultTo(0);
      table.timestamps(true, true);
      table.unique(['employee_id', 'year']);
    });
  }

  await addMissingColumns(knex, 'timesheets', [
    ['attendance', t => t.string('attendance').notNullable().defaultTo('Present')],
    ['overtime_hours', t => t.decimal('overtime_hours', 6, 2).notNullable().defaultTo(0)],
    ['recorded_by', t => t.integer('recorded_by').nullable()],
  ]);
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS timesheets_employee_project_day_unique ON timesheets (employee_id, COALESCE(project_id, ''), date)`);

  // Employee numbers continue after the highest existing EMP-<n> id.
  const { rows } = await knex.raw(`SELECT COALESCE(MAX((substring(id FROM '^EMP-([0-9]+)$'))::bigint), 0) AS max FROM employees`);
  const next = Number(rows?.[0]?.max || 0) + 1;
  await knex.raw(`CREATE SEQUENCE IF NOT EXISTS employee_number_seq START WITH ${next}`);
  await knex.raw(`SELECT setval('employee_number_seq', GREATEST(${next}, (SELECT last_value FROM employee_number_seq)), false)`);

  // Update PAYE bands and add the new payroll/leave keys without touching anything else in the config.
  const configRow = await knex('settings').where({ key: 'payroll_config' }).first();
  let config: Record<string, any> = {};
  try { config = configRow?.value ? JSON.parse(configRow.value) : {}; } catch { config = {}; }
  const merged = {
    ssnit_employee: 5.5,
    ssnit_employer: 13,
    ssnit_tier1: 13.5,
    ssnit_tier2: 5,
    deduction_types: [],
    annual_leave_days: 15,
    max_carry_over_days: 5,
    overtime_multiplier: 1.5,
    standard_hours_per_day: 8,
    ...config,
    tax_tiers: GRA_2024_TIERS,
  };
  if (configRow) {
    await knex('settings').where({ key: 'payroll_config' }).update({ value: JSON.stringify(merged), updated_at: knex.fn.now() });
  } else {
    await knex('settings').insert({ key: 'payroll_config', value: JSON.stringify(merged) });
  }

  if (!(await knex('settings').where({ key: 'payroll_accounts' }).first())) {
    const accounts: Record<string, number | null> = {};
    for (const [key, code] of Object.entries(ACCOUNT_CODES)) {
      const account = await knex('chart_of_accounts').where({ code }).first();
      accounts[key] = account ? account.id : null;
    }
    await knex('settings').insert({ key: 'payroll_accounts', value: JSON.stringify(accounts) });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex('settings').where({ key: 'payroll_accounts' }).del();
  await knex.raw('DROP SEQUENCE IF EXISTS employee_number_seq');
  await knex.raw('DROP INDEX IF EXISTS timesheets_employee_project_day_unique');
  for (const column of ['attendance', 'overtime_hours', 'recorded_by']) {
    if (await knex.schema.hasColumn('timesheets', column)) await knex.schema.alterTable('timesheets', t => { t.dropColumn(column); });
  }
  await knex.schema.dropTableIfExists('leave_balances');
  for (const column of ['days', 'decided_by', 'decided_at', 'decision_note']) {
    if (await knex.schema.hasColumn('leave_requests', column)) await knex.schema.alterTable('leave_requests', t => { t.dropColumn(column); });
  }
  if (await knex.schema.hasColumn('employees', 'annual_leave_days')) await knex.schema.alterTable('employees', t => { t.dropColumn('annual_leave_days'); });
  await knex.raw('DROP INDEX IF EXISTS payroll_employee_period_unique');
  for (const [name] of [...PAYROLL_COLUMNS].reverse()) {
    if (await knex.schema.hasColumn('payroll', name)) await knex.schema.alterTable('payroll', t => { t.dropColumn(name); });
  }
  await knex.schema.dropTableIfExists('payroll_runs');
}
