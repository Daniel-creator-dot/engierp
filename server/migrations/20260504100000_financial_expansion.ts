import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('equipment', (table) => {
    table.date('purchase_date');
    table.decimal('initial_cost', 15, 2).defaultTo(0);
    table.float('useful_life').defaultTo(5); // in years
    table.decimal('residual_value', 15, 2).defaultTo(0);
    table.string('location');
    table.decimal('accumulated_depreciation', 15, 2).defaultTo(0);
    table.date('disposal_date');
    table.decimal('disposal_value', 15, 2).defaultTo(0);
    table.string('depreciation_method').defaultTo('Straight Line');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('equipment', (table) => {
    table.dropColumn('purchase_date');
    table.dropColumn('initial_cost');
    table.dropColumn('useful_life');
    table.dropColumn('residual_value');
    table.dropColumn('location');
    table.dropColumn('accumulated_depreciation');
    table.dropColumn('disposal_date');
    table.dropColumn('disposal_value');
    table.dropColumn('depreciation_method');
  });
}
