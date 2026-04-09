import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('sms_configurations', (table) => {
    table.increments('id').primary();
    table.string('provider').notNullable(); // e.g., 'Hubtel', 'Twilio'
    table.string('api_key').notNullable();
    table.string('api_secret');
    table.string('sender_id');
    table.boolean('is_active').defaultTo(true);
    table.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('sms_configurations');
}
