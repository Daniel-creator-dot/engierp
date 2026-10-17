import type { Knex } from 'knex';

async function addColumn(knex: Knex, table: string, name: string, build: (t: Knex.AlterTableBuilder) => void) {
  if (!(await knex.schema.hasColumn(table, name))) {
    await knex.schema.alterTable(table, build);
  }
}

export async function up(knex: Knex): Promise<void> {
  // Columns the app already writes, which a fresh migrate never created.
  await addColumn(knex, 'employees', 'wage_type', (t) => t.string('wage_type').nullable().defaultTo('Salaried'));
  await knex('employees').whereNull('wage_type').update({ wage_type: 'Salaried' });

  await addColumn(knex, 'projects', 'completion_rate', (t) => t.decimal('completion_rate', 5, 2).notNullable().defaultTo(0));

  await addColumn(knex, 'invoices', 'items', (t) => t.text('items').nullable());
  await addColumn(knex, 'invoices', 'subtotal', (t) => t.decimal('subtotal', 15, 2).nullable());
  await addColumn(knex, 'invoices', 'tax_amount', (t) => t.decimal('tax_amount', 15, 2).nullable().defaultTo(0));
  await addColumn(knex, 'invoices', 'tax_rate', (t) => t.decimal('tax_rate', 8, 3).nullable().defaultTo(0));
  await addColumn(knex, 'invoices', 'tax_name', (t) => t.string('tax_name').nullable());
  await knex.raw('UPDATE invoices SET subtotal = amount WHERE subtotal IS NULL');

  await addColumn(knex, 'bills', 'quantity', (t) => t.decimal('quantity', 14, 3).nullable().defaultTo(1));
  await addColumn(knex, 'bills', 'unit_price', (t) => t.decimal('unit_price', 15, 2).nullable());
  await addColumn(knex, 'bills', 'project_id', (t) => t.string('project_id').references('id').inTable('projects').onDelete('SET NULL'));
  await addColumn(knex, 'bills', 'account_id', (t) => t.integer('account_id').references('id').inTable('chart_of_accounts').onDelete('SET NULL'));
  await knex.raw('UPDATE bills SET unit_price = amount WHERE unit_price IS NULL');

  if (!(await knex.schema.hasTable('boq_items'))) {
    await knex.schema.createTable('boq_items', (t) => {
      t.increments('id').primary();
      t.string('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
      t.string('item_no').notNullable();
      t.string('description').notNullable();
      t.string('unit').notNullable();
      t.decimal('quantity', 14, 3).notNullable();
      t.decimal('rate', 15, 2).notNullable();
      t.decimal('amount', 15, 2).notNullable();
      t.string('cost_code').nullable();
      t.timestamps(true, true);
      t.index(['project_id']);
    });
  }

  if (!(await knex.schema.hasTable('variations'))) {
    await knex.schema.createTable('variations', (t) => {
      t.string('id').primary();
      t.string('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
      t.integer('boq_item_id').nullable().references('id').inTable('boq_items').onDelete('SET NULL');
      t.string('title').notNullable();
      t.text('reason').nullable();
      t.decimal('amount', 15, 2).notNullable();
      t.string('status').notNullable().defaultTo('Draft');
      t.integer('requested_by').nullable().references('id').inTable('users').onDelete('SET NULL');
      t.timestamps(true, true);
    });
  }

  if (!(await knex.schema.hasTable('material_requisitions'))) {
    await knex.schema.createTable('material_requisitions', (t) => {
      t.string('id').primary();
      t.string('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
      t.date('needed_by').nullable();
      t.string('status').notNullable().defaultTo('Submitted');
      t.text('notes').nullable();
      t.json('lines').notNullable();
      t.integer('requested_by').nullable().references('id').inTable('users').onDelete('SET NULL');
      t.timestamps(true, true);
    });
  }

  if (!(await knex.schema.hasTable('work_orders'))) {
    await knex.schema.createTable('work_orders', (t) => {
      t.string('id').primary();
      t.string('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
      t.string('supplier_id').nullable().references('id').inTable('suppliers').onDelete('SET NULL');
      t.string('title').notNullable();
      t.text('scope').nullable();
      t.decimal('amount', 15, 2).notNullable().defaultTo(0);
      t.date('start_date').nullable();
      t.date('end_date').nullable();
      t.string('status').notNullable().defaultTo('Draft');
      t.integer('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
      t.timestamps(true, true);
    });
  }

  if (!(await knex.schema.hasTable('tenders'))) {
    await knex.schema.createTable('tenders', (t) => {
      t.string('id').primary();
      t.string('project_id').nullable().references('id').inTable('projects').onDelete('SET NULL');
      t.string('title').notNullable();
      t.date('closes_on').nullable();
      t.string('status').notNullable().defaultTo('Open');
      t.string('awarded_supplier_id').nullable().references('id').inTable('suppliers').onDelete('SET NULL');
      t.text('notes').nullable();
      t.integer('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
      t.timestamps(true, true);
    });
  }

  if (!(await knex.schema.hasTable('tender_quotes'))) {
    await knex.schema.createTable('tender_quotes', (t) => {
      t.increments('id').primary();
      t.string('tender_id').notNullable().references('id').inTable('tenders').onDelete('CASCADE');
      t.string('supplier_id').notNullable().references('id').inTable('suppliers').onDelete('CASCADE');
      t.decimal('amount', 15, 2).notNullable();
      t.integer('lead_days').nullable();
      t.text('notes').nullable();
      t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      t.unique(['tender_id', 'supplier_id']);
    });
  }

  if (!(await knex.schema.hasTable('project_milestones'))) {
    await knex.schema.createTable('project_milestones', (t) => {
      t.increments('id').primary();
      t.string('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
      t.string('name').notNullable();
      t.date('due_date').notNullable();
      t.string('status').notNullable().defaultTo('Planned');
      t.text('notes').nullable();
      t.timestamps(true, true);
    });
  }

  if (!(await knex.schema.hasTable('hse_incidents'))) {
    await knex.schema.createTable('hse_incidents', (t) => {
      t.increments('id').primary();
      t.string('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
      t.date('occurred_on').notNullable();
      t.string('kind').notNullable();
      t.string('severity').notNullable().defaultTo('Low');
      t.text('description').notNullable();
      t.text('action_taken').nullable();
      t.string('status').notNullable().defaultTo('Open');
      t.integer('reported_by').nullable().references('id').inTable('users').onDelete('SET NULL');
      t.timestamps(true, true);
    });
  }

  // No demo rows. A company database that already has projects must not receive sample BOQ,
  // tender, or safety records when this migration runs.
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('hse_incidents');
  await knex.schema.dropTableIfExists('project_milestones');
  await knex.schema.dropTableIfExists('tender_quotes');
  await knex.schema.dropTableIfExists('tenders');
  await knex.schema.dropTableIfExists('work_orders');
  await knex.schema.dropTableIfExists('material_requisitions');
  await knex.schema.dropTableIfExists('variations');
  await knex.schema.dropTableIfExists('boq_items');
}
