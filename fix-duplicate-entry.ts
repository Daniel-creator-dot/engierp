import knex from 'knex';
import config from './knexfile';
const db = knex((config as any).development);

async function fixDuplicateEntry() {
  const trx = await db.transaction();
  try {
    console.log('=== REMOVING DUPLICATE MANUAL ENTRY ===\n');

    // Get AR account
    const arAccount = await trx('chart_of_accounts')
      .where('code', '1104')
      .first();
    
    if (!arAccount) {
      throw new Error('AR account not found');
    }
    console.log('AR Account:', arAccount.code, '-', arAccount.name, '(ID:', arAccount.id, ')');

    // Find the duplicate manual entry
    const manualEntry = await trx('ledger_entries')
      .join('journal_entries', 'ledger_entries.journal_id', 'journal_entries.id')
      .where('ledger_entries.account_id', arAccount.id)
      .where('journal_entries.reference_type', 'manual')
      .where('journal_entries.description', 'ilike', '%Payment Received from PIC Gh.ltd.%')
      .select('ledger_entries.id as ledger_id', 'ledger_entries.journal_id', 'ledger_entries.credit', 'journal_entries.description')
      .first();

    if (!manualEntry) {
      console.log('No duplicate manual entry found');
      await trx.rollback();
      process.exit(0);
    }

    console.log('Found duplicate manual entry:');
    console.log(`  Ledger ID: ${manualEntry.ledger_id}`);
    console.log(`  Journal ID: ${manualEntry.journal_id}`);
    console.log(`  Credit Amount: ${manualEntry.credit}`);
    console.log(`  Description: ${manualEntry.description}`);

    // Check if there are other ledger entries in the same journal
    const otherLedgerEntries = await trx('ledger_entries')
      .where('journal_id', manualEntry.journal_id)
      .where('id', '!=', manualEntry.ledger_id);

    if (otherLedgerEntries.length > 0) {
      console.log(`\nJournal ${manualEntry.journal_id} has ${otherLedgerEntries.length} other ledger entries`);
      console.log('This is a balanced journal entry that has been superseded by proper payment processing');
      console.log('Deleting the entire journal entry to maintain balance');
    }

    // Get the other ledger entry details to reverse the balance impact
    let bankAccountId = null;
    let bankAmount = 0;
    if (otherLedgerEntries.length > 0) {
      const bankEntry = otherLedgerEntries[0];
      bankAccountId = bankEntry.account_id;
      bankAmount = Number(bankEntry.debit || 0) - Number(bankEntry.credit || 0);
      console.log(`Bank account impact: ${bankAmount}`);
    }

    // Delete the manual journal entry (which will cascade delete all ledger entries)
    await trx('journal_entries').where('id', manualEntry.journal_id).del();
    console.log(`\nDeleted manual journal entry (ID: ${manualEntry.journal_id})`);

    // Reverse the balance impact
    await trx('chart_of_accounts').where({ id: arAccount.id }).increment('balance', Number(manualEntry.credit));
    console.log(`Updated AR balance by +${manualEntry.credit}`);
    
    if (bankAccountId && bankAmount !== 0) {
      await trx('chart_of_accounts').where({ id: bankAccountId }).decrement('balance', bankAmount);
      console.log(`Updated bank account balance by -${bankAmount}`);
    }

    await trx.commit();
    console.log('\n=== SUCCESS: Duplicate entry removed ===');
    
    // Show updated AR balance
    const updatedAR = await db('chart_of_accounts').where('id', arAccount.id).first();
    console.log(`\nUpdated AR Balance: ${updatedAR.balance}`);
    
  } catch(e) {
    await trx.rollback();
    console.error("Error:", e);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

fixDuplicateEntry();
