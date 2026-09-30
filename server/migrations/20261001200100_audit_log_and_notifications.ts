import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('audit_log'))) {
    await knex.schema.createTable('audit_log', table => {
      table.bigIncrements('id').primary();
      table.integer('user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
      table.string('user_email').nullable();
      table.string('user_role').nullable();
      table.string('action', 64).notNullable();
      table.string('entity', 64).notNullable();
      table.string('entity_id').nullable();
      table.jsonb('before').nullable();
      table.jsonb('after').nullable();
      table.string('ip', 64).nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.index(['entity', 'entity_id']);
      table.index(['created_at']);
      table.index(['user_id']);
    });
  }

  if (!(await knex.schema.hasTable('notifications'))) {
    await knex.schema.createTable('notifications', table => {
      table.bigIncrements('id').primary();
      table.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.string('type', 64).notNullable().defaultTo('info');
      table.string('title').notNullable();
      table.text('body').nullable();
      table.string('link').nullable();
      table.timestamp('read_at', { useTz: true }).nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.index(['user_id', 'read_at']);
      table.index(['user_id', 'created_at']);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('notifications');
  await knex.schema.dropTableIfExists('audit_log');
}
