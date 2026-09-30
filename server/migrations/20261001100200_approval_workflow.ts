import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('approval_requests'))) {
    await knex.schema.createTable('approval_requests', (t) => {
      t.increments('id').primary();
      t.string('entity_type').notNullable(); // 'bill' | 'invoice' | 'payment' | 'journal'
      t.string('entity_id').notNullable();
      t.string('entity_label');
      t.string('action').notNullable(); // 'create' | 'correct' | 'void' | 'credit_note'
      t.string('status').notNullable().defaultTo('pending'); // 'pending' | 'approved' | 'rejected' | 'cancelled'
      t.text('reason').notNullable();
      t.json('original');
      t.json('proposed');
      t.json('original_summary');
      t.json('proposed_summary');
      t.integer('requested_by');
      t.string('requested_by_email');
      t.timestamp('requested_at', { useTz: true }).defaultTo(knex.fn.now());
      t.integer('decided_by');
      t.string('decided_by_email');
      t.timestamp('decided_at', { useTz: true });
      t.text('decision_comment');
      t.json('result');
      t.index(['status', 'requested_at']);
      t.index(['entity_type', 'entity_id']);
    });
    // At most one open request per document.
    await knex.raw(`CREATE UNIQUE INDEX approval_requests_one_pending ON approval_requests (entity_type, entity_id) WHERE status = 'pending'`);
  }

  const addColumn = async (table: string, column: string, build: (t: Knex.AlterTableBuilder) => void) => {
    if (!(await knex.schema.hasColumn(table, column))) await knex.schema.alterTable(table, build);
  };
  await addColumn('journal_entries', 'approval_request_id', (t) => t.integer('approval_request_id').index());
  await addColumn('journal_entries', 'status', (t) => t.string('status')); // null = active, 'reversed'
  await addColumn('journal_entries', 'reversed_by_journal_id', (t) => t.integer('reversed_by_journal_id'));
  await addColumn('payments', 'voided_at', (t) => t.timestamp('voided_at', { useTz: true }));
  await addColumn('payments', 'void_reason', (t) => t.string('void_reason'));
  await addColumn('payments', 'original_target_type', (t) => t.string('original_target_type'));
}

export async function down(knex: Knex): Promise<void> {
  const drop = async (table: string, cols: string[]) => {
    for (const col of cols) {
      if (await knex.schema.hasColumn(table, col)) await knex.schema.alterTable(table, (t) => t.dropColumn(col));
    }
  };
  await drop('payments', ['voided_at', 'void_reason', 'original_target_type']);
  await drop('journal_entries', ['approval_request_id', 'status', 'reversed_by_journal_id']);
  await knex.schema.dropTableIfExists('approval_requests');
}
