import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // --- FIELD OPERATIONS ---
  await knex.schema.createTable('site_reports', (table) => {
    table.increments('id').primary();
    table.string('project_id').references('id').inTable('projects').onDelete('CASCADE');
    table.integer('author_id').references('id').inTable('users');
    table.string('weather').notNullable();
    table.text('content').notNullable();
    table.text('issues');
    table.string('gps_lat');
    table.string('gps_lng');
    table.jsonb('photos'); // Array of base64 strings
    table.string('status').defaultTo('Pending Review'); // Pending, Approved, Rejected
    table.timestamps(true, true);
  });

  await knex.schema.createTable('site_tasks', (table) => {
    table.increments('id').primary();
    table.string('project_id').references('id').inTable('projects').onDelete('CASCADE');
    table.string('name').notNullable();
    table.string('status').defaultTo('Open'); // Open, In Progress, Completed, Delayed
    table.string('assigned_to');
    table.date('due_date');
    table.timestamps(true, true);
  });

  // --- ADVANCED ACCOUNTING (Double Entry) ---
  await knex.schema.createTable('chart_of_accounts', (table) => {
    table.increments('id').primary();
    table.string('code').unique().notNullable(); // e.g., 1001, 4000
    table.string('name').notNullable();
    table.string('type').notNullable(); // Asset, Liability, Equity, Income, Expense
    table.decimal('balance', 15, 2).defaultTo(0);
    table.timestamps(true, true);
  });

  await knex.schema.createTable('journal_entries', (table) => {
    table.increments('id').primary();
    table.date('date').notNullable();
    table.string('description').notNullable();
    table.string('reference_type'); // invoice, bill, payroll, manual
    table.string('reference_id');
    table.timestamps(true, true);
  });

  await knex.schema.createTable('ledger_entries', (table) => {
    table.increments('id').primary();
    table.integer('journal_id').references('id').inTable('journal_entries').onDelete('CASCADE');
    table.integer('account_id').references('id').inTable('chart_of_accounts');
    table.decimal('debit', 15, 2).defaultTo(0);
    table.decimal('credit', 15, 2).defaultTo(0);
  });

  await knex.schema.createTable('bills', (table) => {
    table.increments('id').primary();
    table.string('supplier_id').references('id').inTable('suppliers');
    table.decimal('amount', 15, 2).notNullable();
    table.date('due_date').notNullable();
    table.string('status').defaultTo('Unpaid'); // Unpaid, Partially Paid, Paid
    table.string('category');
    table.timestamps(true, true);
  });

  // --- ENGINEERING & VERTICAL ---
  await knex.schema.createTable('contracts', (table) => {
    table.string('id').primary(); // e.g., CONT-2024-001
    table.string('project_id').references('id').inTable('projects').onDelete('CASCADE');
    table.string('name').notNullable();
    table.decimal('value', 15, 2).notNullable();
    table.float('retention_pct').defaultTo(10);
    table.decimal('retention_amount', 15, 2).defaultTo(0);
    table.string('status').defaultTo('Draft'); // Draft, Active, Completed
    table.timestamps(true, true);
  });

  await knex.schema.createTable('equipment', (table) => {
    table.string('id').primary(); // e.g., EQ-001
    table.string('name').notNullable();
    table.string('category').notNullable(); // Excavator, Crane, etc.
    table.string('status').defaultTo('Available'); // Available, On Site, Maintenance
    table.decimal('daily_cost', 15, 2).defaultTo(0);
    table.date('last_maintenance');
    table.date('next_maintenance');
    table.timestamps(true, true);
  });

  await knex.schema.createTable('equipment_allocations', (table) => {
    table.increments('id').primary();
    table.string('equipment_id').references('id').inTable('equipment');
    table.string('project_id').references('id').inTable('projects');
    table.date('start_date').notNullable();
    table.date('end_date');
    table.timestamps(true, true);
  });

  // --- HR ADVANCED ---
  await knex.schema.createTable('appraisals', (table) => {
    table.increments('id').primary();
    table.string('employee_id').references('id').inTable('employees');
    table.integer('year').notNullable();
    table.string('period').notNullable(); // Q1, Q2, etc.
    table.integer('score').notNullable(); // 1-100
    table.text('feedback');
    table.string('status').defaultTo('Pending');
    table.timestamps(true, true);
  });

  await knex.schema.createTable('timesheets', (table) => {
    table.increments('id').primary();
    table.string('employee_id').references('id').inTable('employees');
    table.string('project_id').references('id').inTable('projects');
    table.date('date').notNullable();
    table.float('hours').notNullable();
    table.text('description');
    table.string('status').defaultTo('Submitted');
    table.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('timesheets');
  await knex.schema.dropTableIfExists('appraisals');
  await knex.schema.dropTableIfExists('equipment_allocations');
  await knex.schema.dropTableIfExists('equipment');
  await knex.schema.dropTableIfExists('contracts');
  await knex.schema.dropTableIfExists('bills');
  await knex.schema.dropTableIfExists('ledger_entries');
  await knex.schema.dropTableIfExists('journal_entries');
  await knex.schema.dropTableIfExists('chart_of_accounts');
  await knex.schema.dropTableIfExists('site_tasks');
  await knex.schema.dropTableIfExists('site_reports');
}
