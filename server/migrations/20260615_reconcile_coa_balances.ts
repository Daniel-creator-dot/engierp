import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  const trx = await knex.transaction();
  try {
    // Ensure reconciliation_logs table exists
    const hasTable = await trx.schema.hasTable('reconciliation_logs');
    if (!hasTable) {
      await trx.schema.createTable('reconciliation_logs', (table) => {
        table.increments('id').primary();
        table.string('run_id').notNullable();
        table.integer('account_id').notNullable();
        table.string('account_code');
        table.decimal('old_balance', 15, 2).notNullable();
        table.decimal('new_balance', 15, 2).notNullable();
        table.decimal('difference', 15, 2).notNullable();
        table.timestamp('created_at').defaultTo(trx.fn.now());
      });
    }

    const runId = new Date().toISOString();

    const accounts = await trx('chart_of_accounts').select('id', 'code', 'name', 'balance');

    for (const acc of accounts) {
      // Calculate ledger balance: SUM(debit) - SUM(credit)
      const sums: any = await trx('ledger_entries').where('account_id', acc.id)
        .sum({ debit: 'debit' })
        .sum({ credit: 'credit' })
        .first();

      const debit = Number(sums?.debit || 0);
      const credit = Number(sums?.credit || 0);
      const ledgerBalance = Number((debit - credit).toFixed(2));
      const currentBalance = Number(Number(acc.balance || 0).toFixed(2));

      if (ledgerBalance !== currentBalance) {
        const diff = Number((ledgerBalance - currentBalance).toFixed(2));

        // Log the reconciliation
        await trx('reconciliation_logs').insert({
          run_id: runId,
          account_id: acc.id,
          account_code: acc.code,
          old_balance: currentBalance,
          new_balance: ledgerBalance,
          difference: diff
        });

        // Update the COA balance to match ledger
        await trx('chart_of_accounts').where({ id: acc.id }).update({ balance: ledgerBalance });
      }
    }

    await trx.commit();
  } catch (err) {
    await trx.rollback();
    throw err;
  }
}

export async function down(knex: Knex): Promise<void> {
  const trx = await knex.transaction();
  try {
    // Revert the last reconciliation run by run_id (most recent created_at)
    const last = await trx('reconciliation_logs').orderBy('created_at', 'desc').first();
    if (!last) {
      await trx.commit();
      return;
    }

    const runId = last.run_id;
    const entries = await trx('reconciliation_logs').where({ run_id }).select('account_id', 'old_balance');

    for (const e of entries) {
      await trx('chart_of_accounts').where({ id: e.account_id }).update({ balance: e.old_balance });
    }

    // Remove the log entries for that run
    await trx('reconciliation_logs').where({ run_id }).del();

    await trx.commit();
  } catch (err) {
    await trx.rollback();
    throw err;
  }
}
