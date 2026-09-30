import type { Knex } from 'knex';

type ColumnAdder = (table: Knex.AlterTableBuilder) => void;

async function addColumns(knex: Knex, tableName: string, columns: Record<string, ColumnAdder>) {
  for (const [column, add] of Object.entries(columns)) {
    if (!(await knex.schema.hasColumn(tableName, column))) {
      await knex.schema.alterTable(tableName, (table) => { add(table); });
    }
  }
}

async function dropColumns(knex: Knex, tableName: string, columns: string[]) {
  for (const column of columns) {
    if (await knex.schema.hasColumn(tableName, column)) {
      await knex.schema.alterTable(tableName, (table) => { table.dropColumn(column); });
    }
  }
}

export async function up(knex: Knex): Promise<void> {
  await addColumns(knex, 'suppliers', {
    tin: (t) => t.string('tin', 20),
    payment_terms_days: (t) => t.integer('payment_terms_days').defaultTo(30),
  });

  await addColumns(knex, 'purchase_orders', {
    created_by: (t) => t.integer('created_by').references('id').inTable('users').onDelete('SET NULL'),
    approved_by: (t) => t.integer('approved_by').references('id').inTable('users').onDelete('SET NULL'),
    approved_at: (t) => t.timestamp('approved_at'),
    rejection_reason: (t) => t.text('rejection_reason'),
    notes: (t) => t.text('notes'),
    bill_id: (t) => t.integer('bill_id').references('id').inTable('bills').onDelete('SET NULL'),
  });

  await addColumns(knex, 'po_items', {
    received_quantity: (t) => t.float('received_quantity').notNullable().defaultTo(0),
    inventory_item_id: (t) => t.string('inventory_item_id').references('id').inTable('inventory_items').onDelete('SET NULL'),
  });

  await addColumns(knex, 'bills', {
    po_id: (t) => t.string('po_id').references('id').inTable('purchase_orders').onDelete('SET NULL'),
  });

  if (!(await knex.schema.hasTable('goods_receipts'))) {
    await knex.schema.createTable('goods_receipts', (table) => {
      table.increments('id').primary();
      table.string('po_id').notNullable().references('id').inTable('purchase_orders').onDelete('CASCADE');
      table.date('receipt_date').notNullable();
      table.string('delivery_note');
      table.text('notes');
      table.integer('received_by').references('id').inTable('users').onDelete('SET NULL');
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.index(['po_id']);
    });
  }

  if (!(await knex.schema.hasTable('goods_receipt_items'))) {
    await knex.schema.createTable('goods_receipt_items', (table) => {
      table.increments('id').primary();
      table.integer('receipt_id').notNullable().references('id').inTable('goods_receipts').onDelete('CASCADE');
      table.integer('po_item_id').notNullable().references('id').inTable('po_items').onDelete('CASCADE');
      table.float('quantity').notNullable();
      table.string('inventory_item_id').references('id').inTable('inventory_items').onDelete('SET NULL');
    });
  }

  if (!(await knex.schema.hasTable('inventory_movements'))) {
    await knex.schema.createTable('inventory_movements', (table) => {
      table.increments('id').primary();
      table.string('item_id').notNullable().references('id').inTable('inventory_items').onDelete('CASCADE');
      table.string('movement_type').notNullable(); // receipt, issue, adjustment
      table.float('quantity').notNullable(); // signed: + into stock, - out of stock
      table.float('balance_after').notNullable();
      table.string('project_id').references('id').inTable('projects').onDelete('SET NULL');
      table.string('reference_type');
      table.string('reference_id');
      table.text('notes');
      table.integer('created_by').references('id').inTable('users').onDelete('SET NULL');
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.index(['item_id', 'created_at']);
    });

    // Give existing stock an opening entry so each item's history adds up to its quantity.
    const items = await knex('inventory_items').whereNot('quantity', 0).select('id', 'quantity', 'project_id');
    if (items.length) {
      await knex('inventory_movements').insert(items.map((item: any) => ({
        item_id: item.id,
        movement_type: 'adjustment',
        quantity: Number(item.quantity),
        balance_after: Number(item.quantity),
        project_id: item.project_id || null,
        reference_type: 'opening',
        notes: 'Opening balance when stock movements were introduced',
      })));
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('inventory_movements');
  await knex.schema.dropTableIfExists('goods_receipt_items');
  await knex.schema.dropTableIfExists('goods_receipts');
  await dropColumns(knex, 'bills', ['po_id']);
  await dropColumns(knex, 'po_items', ['received_quantity', 'inventory_item_id']);
  await dropColumns(knex, 'purchase_orders', ['created_by', 'approved_by', 'approved_at', 'rejection_reason', 'notes', 'bill_id']);
  await dropColumns(knex, 'suppliers', ['tin', 'payment_terms_days']);
}
