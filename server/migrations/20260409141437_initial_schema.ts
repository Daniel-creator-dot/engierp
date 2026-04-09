import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Employees table
  await knex.schema.createTable('employees', (table) => {
    table.string('id').primary(); // e.g., EMP-001
    table.string('name').notNullable();
    table.string('role').notNullable();
    table.string('department').notNullable();
    table.decimal('salary', 15, 2).notNullable();
    table.string('joinDate').notNullable();
    table.string('status').notNullable(); // active, on-leave, terminated
    table.timestamps(true, true);
  });

  // Users table
  await knex.schema.createTable('users', (table) => {
    table.increments('id').primary();
    table.string('email').unique().notNullable();
    table.string('password').notNullable();
    table.string('role').notNullable(); // hr, accountant, pm, procurement, admin
    table.string('employee_id').references('id').inTable('employees').onDelete('SET NULL');
    table.timestamps(true, true);
  });

  // Projects table
  await knex.schema.createTable('projects', (table) => {
    table.string('id').primary(); // e.g., PRJ-001
    table.string('name').notNullable();
    table.string('client').notNullable();
    table.decimal('budget', 15, 2).notNullable();
    table.decimal('spent', 15, 2).defaultTo(0);
    table.string('status').notNullable(); // active, completed, on-hold, draft
    table.string('startDate').notNullable();
    table.string('endDate').notNullable();
    table.string('manager').notNullable();
    table.integer('profitability').defaultTo(0);
    table.timestamps(true, true);
  });

  // Transactions table
  await knex.schema.createTable('transactions', (table) => {
    table.string('id').primary(); // e.g., TX-001
    table.string('date').notNullable();
    table.string('description').notNullable();
    table.string('category').notNullable();
    table.decimal('amount', 15, 2).notNullable();
    table.string('type').notNullable(); // income, expense
    table.string('status').notNullable(); // cleared, pending
    table.string('project_id').references('id').inTable('projects').onDelete('SET NULL');
    table.timestamps(true, true);
  });

  // Invoices table
  await knex.schema.createTable('invoices', (table) => {
    table.string('id').primary(); // e.g., INV-1001
    table.string('client').notNullable();
    table.decimal('amount', 15, 2).notNullable();
    table.string('dueDate').notNullable();
    table.string('status').notNullable(); // paid, unpaid, overdue
    table.string('project_id').references('id').inTable('projects').onDelete('SET NULL');
    table.timestamps(true, true);
  });

  // Taxes table
  await knex.schema.createTable('taxes', (table) => {
    table.string('id').primary(); // e.g., TAX-001
    table.string('period').notNullable();
    table.string('type').notNullable(); // VAT, PAYE, SSNIT
    table.decimal('amount', 15, 2).notNullable();
    table.string('status').notNullable(); // filed, pending
    table.timestamps(true, true);
  });

  // Leave Requests table
  await knex.schema.createTable('leave_requests', (table) => {
    table.increments('id').primary();
    table.string('employee_id').references('id').inTable('employees').onDelete('CASCADE').notNullable();
    table.string('type').notNullable(); // Annual, Sick, etc.
    table.string('startDate').notNullable();
    table.string('endDate').notNullable();
    table.string('status').notNullable(); // Pending, Approved, Rejected
    table.text('reason');
    table.timestamps(true, true);
  });

  // Settings table
  await knex.schema.createTable('settings', (table) => {
    table.increments('id').primary();
    table.string('key').unique().notNullable();
    table.string('value').notNullable();
    table.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('settings');
  await knex.schema.dropTableIfExists('leave_requests');
  await knex.schema.dropTableIfExists('taxes');
  await knex.schema.dropTableIfExists('invoices');
  await knex.schema.dropTableIfExists('transactions');
  await knex.schema.dropTableIfExists('projects');
  await knex.schema.dropTableIfExists('users');
  await knex.schema.dropTableIfExists('employees');
}
