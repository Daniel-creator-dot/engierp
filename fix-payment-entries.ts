import knex from 'knex';
import config from './knexfile';
const db = knex((config as any).development);

async function fixPaymentEntries() {
  const trx = await db.transaction();
  try {
    console.log('=== FIXING PAYMENT LEDGER ENTRIES ===\n');

    // Get AR account
    const arAccount = await trx('chart_of_accounts')
      .where('code', '1104')
      .first();
    
    if (!arAccount) {
      throw new Error('AR account not found');
    }
    console.log('AR Account:', arAccount.code, '-', arAccount.name, '(ID:', arAccount.id, ')');

    // Manual bank COA mapping based on the check results
    const bankCOAMapping: Record<number, number> = {
      5: 118, // Bank account ID 5 -> COA ID 118 (Bank – ADB Salary)
      6: 117  // Bank account ID 6 -> COA ID 117 (Bank – OmniBSIC)
    };

    // Get payments for invoices that don't have ledger entries yet
    const payments = await trx('payments')
      .where('target_type', 'Invoice')
      .select('*');
    
    console.log('Processing payments...\n');
    
    for (const payment of payments) {
      console.log(`Payment: ${payment.payment_id} - Amount: ${payment.amount} - Target: ${payment.target_id}`);
      
      // Check if journal entry exists for this payment
      const existingJournal = await trx('journal_entries')
        .where('reference_type', 'payment')
        .where('reference_id', String(payment.id))
        .first();
      
      if (!existingJournal) {
        console.log(`  → No journal entry found, creating one first`);
        
        // Get invoice to determine project
        const invoice = await trx('invoices').where('id', payment.target_id).first();
        const projectId = invoice ? invoice.project_id : null;

        // Create journal entry for payment
        const [insertedJournal] = await trx('journal_entries').insert({
          date: payment.date,
          description: `Payment ${payment.payment_id} for Invoice ${payment.target_id}`,
          project_id: projectId,
          reference_type: 'payment',
          reference_id: String(payment.id)
        }).returning('id');
        const journal_id = typeof insertedJournal === 'object' ? insertedJournal.id : insertedJournal;
        console.log(`  → Created journal entry (ID: ${journal_id})`);
      }

      // Check if ledger entries exist for this payment's journal
      const journalId = existingJournal ? existingJournal.id : (await trx('journal_entries')
        .where('reference_type', 'payment')
        .where('reference_id', String(payment.id))
        .first()).id;
      
      const existingLedgerEntries = await trx('ledger_entries')
        .where('journal_id', journalId);
      
      if (existingLedgerEntries.length > 0) {
        console.log(`  → Ledger entries already exist, skipping`);
        continue;
      }

      // Get bank COA from mapping
      const bankCoaId = bankCOAMapping[payment.bank_account_id];
      if (!bankCoaId) {
        console.log(`  → Warning: No COA mapping for bank account ${payment.bank_account_id}, skipping`);
        continue;
      }

      const bankCoa = await trx('chart_of_accounts').where('id', bankCoaId).first();
      console.log(`  → Bank COA: ${bankCoa.code} - ${bankCoa.name} (ID: ${bankCoa.id})`);

      const amount = Number(payment.amount || 0);

      // Create ledger entries: Debit Bank, Credit AR
      await trx('ledger_entries').insert([
        { journal_id: journalId, account_id: bankCoa.id, debit: amount, credit: 0 },
        { journal_id: journalId, account_id: arAccount.id, debit: 0, credit: amount }
      ]);
      console.log(`  → Created ledger entries: Debit Bank ${amount}, Credit AR ${amount}`);

      // Update COA balances
      await trx('chart_of_accounts').where({ id: bankCoa.id }).increment('balance', amount);
      await trx('chart_of_accounts').where({ id: arAccount.id }).decrement('balance', amount);
      console.log(`  → Updated COA balances: Bank +${amount}, AR -${amount}`);
    }

    await trx.commit();
    console.log('\n=== SUCCESS: Payment ledger entries created ===');
    
    // Show updated balances
    const updatedAR = await db('chart_of_accounts').where('id', arAccount.id).first();
    console.log(`\nUpdated AR Balance: ${updatedAR.balance}`);
    
    const bank117 = await db('chart_of_accounts').where('id', 117).first();
    const bank118 = await db('chart_of_accounts').where('id', 118).first();
    console.log(`Bank – OmniBSIC Balance: ${bank117.balance}`);
    console.log(`Bank – ADB Salary Balance: ${bank118.balance}`);
    
  } catch(e) {
    await trx.rollback();
    console.error("Error:", e);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

fixPaymentEntries();
