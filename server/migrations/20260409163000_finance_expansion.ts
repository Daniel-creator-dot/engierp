import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // 1. Bank Accounts Registry
  await knex.schema.createTable('bank_accounts', (table) => {
    table.increments('id').primary();
    table.string('account_name').notNullable();
    table.string('account_number').notNullable();
    table.string('bank_name').notNullable();
    table.string('type').notNullable(); // Current, Savings, Mobile Money, Petty Cash
    table.decimal('balance', 15, 2).defaultTo(0);
    table.string('currency').defaultTo('GHS');
    table.timestamps(true, true);
  });

  // 2. Bank Transactions (Feeds)
  await knex.schema.createTable('bank_transactions', (table) => {
    table.increments('id').primary();
    table.integer('bank_account_id').references('id').inTable('bank_accounts').onDelete('CASCADE');
    table.date('date').notNullable();
    table.string('description').notNullable();
    table.decimal('amount', 15, 2).notNullable();
    table.string('type').notNullable(); // Credit, Debit
    table.string('status').defaultTo('Unreconciled'); // Unreconciled, Reconciled
    table.integer('matched_ledger_id').references('id').inTable('ledger_entries');
    table.timestamps(true, true);
  });

  // 3. Unified Payments Tracking
  await knex.schema.createTable('payments', (table) => {
    table.increments('id').primary();
    table.string('payment_id').unique().notNullable(); // e.g. PAY-123
    table.date('date').notNullable();
    table.decimal('amount', 15, 2).notNullable();
    table.string('method').notNullable(); // Bank Transfer, Momo, Cash, Cheque
    table.string('reference').notNullable(); // TX Ref or Cheque No
    table.string('target_type').notNullable(); // Invoice, Bill, Payroll
    table.string('target_id').notNullable(); // ID of invoice/bill/payroll
    table.integer('bank_account_id').references('id').inTable('bank_accounts');
    table.timestamps(true, true);
  });

  // 4. Data Patch: Link Admin to Employee for testing
  await knex('users')
    .where('email', 'admin@engierp.com')
    .update({ employee_id: 'EMP-001' });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('payments');
  await knex.schema.dropTableIfExists('bank_transactions');
  await knex.schema.dropTableIfExists('bank_accounts');
}
