import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('settings', (table) => {
    table.text('value').alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('settings', (table) => {
    table.string('value', 255).alter();
  });
}
