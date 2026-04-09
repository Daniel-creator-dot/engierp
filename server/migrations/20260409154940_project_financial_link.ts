import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Add project_id to journal_entries to enable Job Costing
  await knex.schema.alterTable('journal_entries', (table) => {
    table.string('project_id').references('id').inTable('projects').onDelete('SET NULL');
  });

  // Add revised budget and estimated cost to projects for WIP accuracy
  await knex.schema.alterTable('projects', (table) => {
    table.decimal('revised_budget', 15, 2);
    table.decimal('estimated_cost_at_completion', 15, 2);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('projects', (table) => {
    table.dropColumn('estimated_cost_at_completion');
    table.dropColumn('revised_budget');
  });
  await knex.schema.alterTable('journal_entries', (table) => {
    table.dropColumn('project_id');
  });
}
