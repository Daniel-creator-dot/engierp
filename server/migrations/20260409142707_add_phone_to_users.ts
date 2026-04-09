import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (table) => {
    table.string('phone').nullable();
    table.string('reset_token').nullable();
    table.timestamp('reset_token_expires').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('phone');
    table.dropColumn('reset_token');
    table.dropColumn('reset_token_expires');
  });
}
