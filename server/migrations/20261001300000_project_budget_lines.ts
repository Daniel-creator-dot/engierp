import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('project_budget_lines'))) {
    await knex.schema.createTable('project_budget_lines', (table) => {
      table.increments('id').primary();
      table.string('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
      table.integer('account_id').notNullable().references('id').inTable('chart_of_accounts').onDelete('CASCADE');
      table.decimal('amount', 15, 2).notNullable().defaultTo(0);
      table.text('notes');
      table.timestamps(true, true);
      table.unique(['project_id', 'account_id']);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('project_budget_lines');
}
