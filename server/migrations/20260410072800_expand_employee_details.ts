import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('employees', (table) => {
    table.string('ssnit').nullable();
    table.string('ghana_card').nullable();
    table.string('phone').nullable();
    table.text('address').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('employees', (table) => {
    table.dropColumn('ssnit');
    table.dropColumn('ghana_card');
    table.dropColumn('phone');
    table.dropColumn('address');
  });
}
