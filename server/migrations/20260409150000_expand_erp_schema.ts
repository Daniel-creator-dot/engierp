import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Payroll Table
  await knex.schema.createTable('payroll', (table) => {
    table.increments('id').primary();
    table.string('employee_id').references('id').inTable('employees').onDelete('CASCADE');
    table.string('month').notNullable();
    table.integer('year').notNullable();
    table.decimal('base_salary', 15, 2).notNullable();
    table.decimal('allowances', 15, 2).defaultTo(0);
    table.decimal('deductions', 15, 2).defaultTo(0);
    table.decimal('net_pay', 15, 2).notNullable();
    table.string('status').defaultTo('Pending');
    table.timestamp('paid_at');
    table.timestamps(true, true);
  });

  // Suppliers Table
  await knex.schema.createTable('suppliers', (table) => {
    table.string('id').primary();
    table.string('name').notNullable();
    table.string('category').notNullable();
    table.string('contact_person');
    table.string('email');
    table.string('phone');
    table.string('address');
    table.float('rating').defaultTo(0);
    table.timestamps(true, true);
  });

  // Inventory Items Table
  await knex.schema.createTable('inventory_items', (table) => {
    table.string('id').primary();
    table.string('name').notNullable();
    table.string('category').notNullable();
    table.float('quantity').defaultTo(0);
    table.string('unit').notNullable(); // bags, tons, units
    table.float('reorder_level').defaultTo(10);
    table.string('project_id'); // Optional: tracking if assigned to a site
    table.timestamps(true, true);
  });

  // Purchase Orders Table
  await knex.schema.createTable('purchase_orders', (table) => {
    table.string('id').primary();
    table.string('supplier_id').references('id').inTable('suppliers');
    table.string('project_id').references('id').inTable('projects');
    table.decimal('total_amount', 15, 2).notNullable();
    table.string('status').defaultTo('Pending Approval');
    table.date('order_date').notNullable();
    table.date('delivery_date');
    table.timestamps(true, true);
  });

  // PO Items Table (for detail)
  await knex.schema.createTable('po_items', (table) => {
    table.increments('id').primary();
    table.string('po_id').references('id').inTable('purchase_orders').onDelete('CASCADE');
    table.string('item_name').notNullable();
    table.float('quantity').notNullable();
    table.decimal('unit_price', 15, 2).notNullable();
    table.decimal('total_price', 15, 2).notNullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('po_items');
  await knex.schema.dropTableIfExists('purchase_orders');
  await knex.schema.dropTableIfExists('inventory_items');
  await knex.schema.dropTableIfExists('suppliers');
  await knex.schema.dropTableIfExists('payroll');
}
