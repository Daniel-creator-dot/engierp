import type { Knex } from 'knex';

/**
 * Tables that mean this database already belongs to a company.
 * Chart of accounts and category rows are excluded: empty-database migrations
 * insert those before the one-time demo seed.
 */
const COMPANY_TABLES = [
  'users',
  'employees',
  'projects',
  'journal_entries',
  'ledger_entries',
  'invoices',
  'bills',
  'payments',
  'bank_accounts',
  'bank_transactions',
  'payroll',
];

export async function databaseHasCompanyData(knex: Knex): Promise<boolean> {
  for (const table of COMPANY_TABLES) {
    if (!(await knex.schema.hasTable(table))) continue;
    const row = await knex(table).count('* as count').first();
    if (Number(row?.count || 0) > 0) return true;
  }
  if (await knex.schema.hasTable('settings')) {
    const company = await knex('settings').where({ key: 'company_name' }).first();
    if (company?.value && String(company.value).trim()) return true;
  }
  return false;
}
