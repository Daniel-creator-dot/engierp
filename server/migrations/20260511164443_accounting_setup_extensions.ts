import type { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('bank_accounts', (table) => {
    table.integer('next_cheque_number').defaultTo(1);
    table.string('cheque_prefix').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('bank_accounts', (table) => {
    table.dropColumn('next_cheque_number');
    table.dropColumn('cheque_prefix');
  });
}

