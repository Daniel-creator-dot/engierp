import type { Knex } from "knex";

const DEFAULT_CATEGORIES: { type: string; name: string }[] = [
  // Previously hardcoded in the supplier forms
  { type: 'supplier', name: 'Heavy Materials' },
  { type: 'supplier', name: 'Finishing' },
  { type: 'supplier', name: 'Plant Hire' },
  { type: 'supplier', name: 'Safety' },
  { type: 'supplier', name: 'Vehicles' },
  // Previously hardcoded in the equipment forms
  { type: 'asset', name: 'Earthmoving' },
  { type: 'asset', name: 'Lifting' },
  { type: 'asset', name: 'Vehicles' },
  { type: 'asset', name: 'Tools' },
  // Previously every inventory item was saved as "Materials"
  { type: 'inventory', name: 'Materials' },
  { type: 'inventory', name: 'Tools & Consumables' },
  { type: 'inventory', name: 'Safety & PPE' },
  { type: 'inventory', name: 'Fuel & Lubricants' },
  { type: 'expense', name: 'Food & Refreshments' },
  { type: 'expense', name: 'Fuel & Lubricants' },
  { type: 'expense', name: 'Transport & Travel' },
  { type: 'expense', name: 'Utilities' },
  { type: 'expense', name: 'Office Supplies' },
  { type: 'expense', name: 'Repairs & Maintenance' },
  { type: 'expense', name: 'Communication' },
  { type: 'expense', name: 'Professional Fees' },
  { type: 'service', name: 'Construction' },
  { type: 'service', name: 'Consulting & Design' },
  { type: 'service', name: 'Equipment Hire' },
  { type: 'service', name: 'Maintenance' },
];

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('categories'))) {
    await knex.schema.createTable('categories', (table) => {
      table.increments('id').primary();
      table.string('name').notNullable();
      table.string('type').notNullable(); // expense, supplier, inventory, asset, service
      table.text('description');
      table.integer('account_id').references('id').inTable('chart_of_accounts').onDelete('SET NULL');
      table.boolean('is_active').notNullable().defaultTo(true);
      table.timestamps(true, true);
      table.unique(['type', 'name']);
    });
  }

  if (!(await knex.schema.hasTable('services'))) {
    await knex.schema.createTable('services', (table) => {
      table.increments('id').primary();
      table.string('name').notNullable().unique();
      table.text('description');
      table.integer('category_id').references('id').inTable('categories').onDelete('SET NULL');
      table.string('unit').defaultTo('job');
      table.decimal('default_price', 15, 2).notNullable().defaultTo(0);
      table.boolean('is_active').notNullable().defaultTo(true);
      table.timestamps(true, true);
    });
  }

  await knex('categories').insert(DEFAULT_CATEGORIES).onConflict(['type', 'name']).ignore();
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('services');
  await knex.schema.dropTableIfExists('categories');
}
