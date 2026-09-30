import type { Knex } from 'knex';

// Resets every chart_of_accounts.balance to SUM(debit) - SUM(credit) from the ledger,
// logging each change to reconciliation_logs so it can be reviewed or undone.
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('reconciliation_logs'))) {
    await knex.schema.createTable('reconciliation_logs', (table) => {
      table.increments('id').primary();
      table.string('run_id').notNullable();
      table.integer('account_id').notNullable();
      table.string('account_code');
      table.decimal('old_balance', 15, 2).notNullable();
      table.decimal('new_balance', 15, 2).notNullable();
      table.decimal('difference', 15, 2).notNullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  const runId = `recompute-${new Date().toISOString()}`;
  const rows = await knex('chart_of_accounts as c')
    .leftJoin('ledger_entries as l', 'l.account_id', 'c.id')
    .groupBy('c.id', 'c.code', 'c.balance')
    .select('c.id', 'c.code', 'c.balance', knex.raw('COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0) AS ledger_balance'));

  for (const row of rows as any[]) {
    const oldBalance = Number(Number(row.balance || 0).toFixed(2));
    const newBalance = Number(Number(row.ledger_balance || 0).toFixed(2));
    if (oldBalance === newBalance) continue;
    await knex('reconciliation_logs').insert({
      run_id: runId,
      account_id: row.id,
      account_code: row.code,
      old_balance: oldBalance,
      new_balance: newBalance,
      difference: Number((newBalance - oldBalance).toFixed(2)),
    });
    await knex('chart_of_accounts').where({ id: row.id }).update({ balance: newBalance });
  }
}

export async function down(knex: Knex): Promise<void> {
  const last = await knex('reconciliation_logs').where('run_id', 'like', 'recompute-%').orderBy('created_at', 'desc').first();
  if (!last) return;
  const entries = await knex('reconciliation_logs').where({ run_id: last.run_id });
  for (const e of entries) {
    await knex('chart_of_accounts').where({ id: e.account_id }).update({ balance: e.old_balance });
  }
  await knex('reconciliation_logs').where({ run_id: last.run_id }).del();
}
