import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
    await knex.schema.alterTable('purchase_orders', (table) => {
        table.string('carrier').nullable();
        table.string('tracking_number').nullable();
        table.string('shipping_status').defaultTo('Pending'); // Pending, In Transit, Delivered, Cancelled
        table.date('estimated_delivery').nullable();
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.alterTable('purchase_orders', (table) => {
        table.dropColumn('carrier');
        table.dropColumn('tracking_number');
        table.dropColumn('shipping_status');
        table.dropColumn('estimated_delivery');
    });
}
