import type { Knex } from 'knex';

// Photos live in Postgres because the app host's filesystem is wiped on every deploy.
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('site_report_photos'))) {
    await knex.schema.createTable('site_report_photos', (table) => {
      table.increments('id').primary();
      table.integer('report_id').notNullable().references('id').inTable('site_reports').onDelete('CASCADE');
      table.string('file_name');
      table.string('mime_type').notNullable();
      table.integer('size_bytes').notNullable();
      table.binary('data').notNullable();
      table.integer('uploaded_by').references('id').inTable('users').onDelete('SET NULL');
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.index(['report_id']);
    });
  }

  if (!(await knex.schema.hasColumn('site_reports', 'gps_accuracy'))) {
    await knex.schema.alterTable('site_reports', (table) => {
      table.float('gps_accuracy');
    });
  }
  if (!(await knex.schema.hasColumn('site_reports', 'reviewed_by'))) {
    await knex.schema.alterTable('site_reports', (table) => {
      table.integer('reviewed_by').references('id').inTable('users').onDelete('SET NULL');
    });
  }

  for (const [column, add] of [
    ['description', (t: Knex.AlterTableBuilder) => t.text('description')],
    ['created_by', (t: Knex.AlterTableBuilder) => t.integer('created_by').references('id').inTable('users').onDelete('SET NULL')],
    ['completed_at', (t: Knex.AlterTableBuilder) => t.timestamp('completed_at')],
  ] as const) {
    if (!(await knex.schema.hasColumn('site_tasks', column))) {
      await knex.schema.alterTable('site_tasks', (table) => { add(table); });
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('site_report_photos');
  for (const column of ['description', 'created_by', 'completed_at']) {
    if (await knex.schema.hasColumn('site_tasks', column)) {
      await knex.schema.alterTable('site_tasks', (table) => { table.dropColumn(column); });
    }
  }
  for (const column of ['gps_accuracy', 'reviewed_by']) {
    if (await knex.schema.hasColumn('site_reports', column)) {
      await knex.schema.alterTable('site_reports', (table) => { table.dropColumn(column); });
    }
  }
}
