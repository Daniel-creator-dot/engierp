import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('employees', (table) => {
    table.string('bank_name').nullable();
    table.string('account_name').nullable();
    table.string('account_number').nullable();
    table.string('branch').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('employees', (table) => {
    table.dropColumn('bank_name');
    table.dropColumn('account_name');
    table.dropColumn('account_number');
    table.dropColumn('branch');
  });
}
