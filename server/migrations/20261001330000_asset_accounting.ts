import type { Knex } from 'knex';

/** Accounts the asset module posts to that the standard chart did not include. */
const REQUIRED_ACCOUNTS = [
  { name: 'Depreciation Expense', type: 'Expense', match: '%depreciation expense%', codes: ['6207', '6208', '6209', '6299'] },
  { name: 'Gain/Loss on Disposal of Assets', type: 'Expense', match: '%disposal%', codes: ['7106', '7107', '7108', '7199'] },
];

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('depreciation_runs'))) {
    await knex.schema.createTable('depreciation_runs', (table) => {
      table.increments('id').primary();
      table.string('period', 7).notNullable().unique(); // YYYY-MM; one run per month
      table.date('period_end').notNullable();
      table.integer('journal_id').references('id').inTable('journal_entries').onDelete('SET NULL');
      table.decimal('total', 15, 2).notNullable().defaultTo(0);
      table.integer('asset_count').notNullable().defaultTo(0);
      table.integer('created_by').references('id').inTable('users').onDelete('SET NULL');
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasTable('depreciation_run_lines'))) {
    await knex.schema.createTable('depreciation_run_lines', (table) => {
      table.increments('id').primary();
      table.integer('run_id').notNullable().references('id').inTable('depreciation_runs').onDelete('CASCADE');
      table.string('equipment_id').notNullable().references('id').inTable('equipment').onDelete('CASCADE');
      table.decimal('amount', 15, 2).notNullable();
      table.integer('expense_account_id');
      table.integer('accumulated_account_id');
      table.index(['equipment_id']);
    });
  }

  if (!(await knex.schema.hasColumn('equipment', 'disposal_journal_id'))) {
    await knex.schema.alterTable('equipment', (table) => {
      table.integer('disposal_journal_id').references('id').inTable('journal_entries').onDelete('SET NULL');
    });
  }

  for (const account of REQUIRED_ACCOUNTS) {
    const existing = await knex('chart_of_accounts').whereILike('name', account.match).first();
    if (existing) continue;
    const taken = new Set((await knex('chart_of_accounts').whereIn('code', account.codes).select('code')).map((r: any) => r.code));
    const code = account.codes.find(c => !taken.has(c));
    if (!code) continue;
    await knex('chart_of_accounts').insert({ code, name: account.name, type: account.type, balance: 0 });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('equipment', 'disposal_journal_id')) {
    await knex.schema.alterTable('equipment', (table) => { table.dropColumn('disposal_journal_id'); });
  }
  await knex.schema.dropTableIfExists('depreciation_run_lines');
  await knex.schema.dropTableIfExists('depreciation_runs');
  // The added accounts are left in place: journals may already reference them.
}
