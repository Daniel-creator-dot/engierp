import type { Knex } from 'knex';

/**
 * Approval decisions write updated_at. Databases created before that column
 * existed reject the update. Add the column only; do not change any request.
 */
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('approval_requests'))) return;
  if (await knex.schema.hasColumn('approval_requests', 'updated_at')) return;
  await knex.schema.alterTable('approval_requests', (t) => {
    t.timestamp('updated_at', { useTz: true }).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('approval_requests'))) return;
  if (!(await knex.schema.hasColumn('approval_requests', 'updated_at'))) return;
  await knex.schema.alterTable('approval_requests', (t) => {
    t.dropColumn('updated_at');
  });
}
