import knex from 'knex';
import config from './knexfile';
const db = knex((config as any).development);

async function checkJournal296() {
  try {
    console.log('=== CHECKING JOURNAL 296 ===\n');

    // Get journal 296 details
    const journal = await db('journal_entries').where('id', 296).first();
    console.log('Journal Entry:', journal);

    // Get all ledger entries for this journal
    const ledgerEntries = await db('ledger_entries')
      .join('chart_of_accounts', 'ledger_entries.account_id', 'chart_of_accounts.id')
      .where('journal_id', 296)
      .select(
        'ledger_entries.id',
        'ledger_entries.debit',
        'ledger_entries.credit',
        'chart_of_accounts.code',
        'chart_of_accounts.name',
        'chart_of_accounts.type'
      );
    
    console.log('\nLedger Entries:');
    let totalDebit = 0;
    let totalCredit = 0;
    for (const entry of ledgerEntries) {
      console.log(`  ${entry.code} ${entry.name} (${entry.type}): Debit ${entry.debit}, Credit ${entry.credit}`);
      totalDebit += Number(entry.debit || 0);
      totalCredit += Number(entry.credit || 0);
    }
    
    console.log(`\nTotals: Debit ${totalDebit}, Credit ${totalCredit}`);
    console.log(`Balance: ${totalDebit - totalCredit}`);

  } catch(e) {
    console.error("Error:", e);
  } finally {
    process.exit(0);
  }
}

checkJournal296();
