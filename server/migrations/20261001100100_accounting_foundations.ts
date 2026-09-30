import type { Knex } from 'knex';

async function addColumns(knex: Knex, table: string, columns: Record<string, (t: Knex.AlterTableBuilder) => void>) {
  for (const [name, build] of Object.entries(columns)) {
    if (!(await knex.schema.hasColumn(table, name))) {
      await knex.schema.alterTable(table, build);
    }
  }
}

const NEW_ACCOUNTS = [
  { code: '2108', name: 'NHIL Payable', type: 'Liability' },
  { code: '2109', name: 'GETFund Levy Payable', type: 'Liability' },
  { code: '3900', name: 'Opening Balance Equity', type: 'Equity' },
];

export async function up(knex: Knex): Promise<void> {
  await addColumns(knex, 'invoices', {
    date: (t) => t.date('date'),
    tax_breakdown: (t) => t.json('tax_breakdown'),
    voided_at: (t) => t.timestamp('voided_at', { useTz: true }),
    void_reason: (t) => t.string('void_reason'),
    void_journal_id: (t) => t.integer('void_journal_id'),
  });
  await knex.raw('UPDATE invoices SET date = CAST(created_at AS DATE) WHERE date IS NULL');

  await addColumns(knex, 'bills', {
    date: (t) => t.date('date'),
    reference: (t) => t.string('reference'),
    description: (t) => t.text('description'),
    voided_at: (t) => t.timestamp('voided_at', { useTz: true }),
    void_reason: (t) => t.string('void_reason'),
    void_journal_id: (t) => t.integer('void_journal_id'),
  });
  await knex.raw('UPDATE bills SET date = CAST(created_at AS DATE) WHERE date IS NULL');

  await addColumns(knex, 'payments', {
    wht_rate: (t) => t.decimal('wht_rate', 6, 3).defaultTo(0),
    wht_amount: (t) => t.decimal('wht_amount', 15, 2).defaultTo(0),
    journal_id: (t) => t.integer('journal_id'),
  });

  await addColumns(knex, 'bank_accounts', {
    coa_account_id: (t) => t.integer('coa_account_id').references('id').inTable('chart_of_accounts').onDelete('SET NULL'),
  });

  for (const acc of NEW_ACCOUNTS) {
    const exists = await knex('chart_of_accounts').where({ code: acc.code }).first();
    if (!exists) await knex('chart_of_accounts').insert({ ...acc, balance: 0 });
  }

  // Link existing bank accounts to their ledger account using the same name match payments used.
  const banks = await knex('bank_accounts').whereNull('coa_account_id');
  for (const bank of banks) {
    let acc = await knex('chart_of_accounts').where('type', 'Asset').where('name', 'ilike', `%${bank.account_name}%`).orderBy('code').first();
    const firstWord = String(bank.bank_name || '').split(' ')[0];
    if (!acc && firstWord) {
      acc = await knex('chart_of_accounts').where('type', 'Asset').where('name', 'ilike', `%${firstWord}%`).orderBy('code').first();
    }
    if (acc) await knex('bank_accounts').where({ id: bank.id }).update({ coa_account_id: acc.id });
  }

  if (!(await knex.schema.hasTable('credit_notes'))) {
    await knex.schema.createTable('credit_notes', (t) => {
      t.string('id').primary();
      t.string('invoice_id').notNullable().index();
      t.string('client');
      t.date('date').notNullable();
      t.decimal('amount', 15, 2).notNullable();
      t.string('reason');
      t.integer('journal_id');
      t.integer('payment_row_id');
      t.timestamps(true, true);
    });
  }

  if (!(await knex.schema.hasTable('recurring_templates'))) {
    await knex.schema.createTable('recurring_templates', (t) => {
      t.increments('id').primary();
      t.string('name').notNullable();
      t.string('kind').notNullable(); // 'journal' | 'bill'
      t.string('frequency').notNullable(); // 'weekly' | 'monthly' | 'quarterly' | 'yearly'
      t.date('next_run_date').notNullable();
      t.date('end_date');
      t.boolean('is_active').defaultTo(true);
      t.json('payload').notNullable();
      t.timestamp('last_run_at', { useTz: true });
      t.timestamps(true, true);
    });
  }

  if (!(await knex.schema.hasTable('attachments'))) {
    await knex.schema.createTable('attachments', (t) => {
      t.increments('id').primary();
      t.string('entity_type').notNullable(); // 'invoice' | 'bill' | 'journal'
      t.string('entity_id').notNullable();
      t.string('file_name').notNullable();
      t.string('mime_type');
      t.integer('size_bytes').notNullable();
      t.binary('data').notNullable();
      t.string('uploaded_by');
      t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      t.index(['entity_type', 'entity_id']);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('attachments');
  await knex.schema.dropTableIfExists('recurring_templates');
  await knex.schema.dropTableIfExists('credit_notes');
  const drop = async (table: string, cols: string[]) => {
    for (const col of cols) {
      if (await knex.schema.hasColumn(table, col)) await knex.schema.alterTable(table, (t) => t.dropColumn(col));
    }
  };
  await drop('bank_accounts', ['coa_account_id']);
  await drop('payments', ['wht_rate', 'wht_amount', 'journal_id']);
  await drop('bills', ['date', 'reference', 'description', 'voided_at', 'void_reason', 'void_journal_id']);
  await drop('invoices', ['date', 'tax_breakdown', 'voided_at', 'void_reason', 'void_journal_id']);
}
