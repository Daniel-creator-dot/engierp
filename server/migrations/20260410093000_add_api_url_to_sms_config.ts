import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('sms_configurations', (table) => {
    table.string('api_url').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('sms_configurations', (table) => {
    table.dropColumn('api_url');
  });
}
