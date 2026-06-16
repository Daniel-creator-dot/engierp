import knex from 'knex';
import config from './knexfile';
const db = knex((config as any).development);

async function fixAREntries() {
  const trx = await db.transaction();
  try {
    console.log('=== FIXING AR ACCOUNTING ENTRIES ===\n');

    // Get AR account
    const arAccount = await trx('chart_of_accounts')
      .where('code', '1104')
      .first();
    
    if (!arAccount) {
      throw new Error('AR account not found');
    }
    console.log('AR Account:', arAccount.code, '-', arAccount.name, '(ID:', arAccount.id, ')');

    // Get Revenue account
    const revenueAccount = await trx('chart_of_accounts')
      .where('code', '4101')
      .first();
    
    if (!revenueAccount) {
      throw new Error('Revenue account not found');
    }
    console.log('Revenue Account:', revenueAccount.code, '-', revenueAccount.name, '(ID:', revenueAccount.id, ')');

    // Get Bank accounts
    const bankAccounts = await trx('bank_accounts').select('*');
    console.log('\nBank Accounts:', bankAccounts.map(b => `${b.account_name} (ID: ${b.id})`).join(', '));

    // Get invoices
    const invoices = await trx('invoices').select('*');
    console.log('\n--- PROCESSING INVOICES ---');
    
    for (const invoice of invoices) {
      console.log(`\nInvoice: ${invoice.id} - Amount: ${invoice.amount}`);
      
      // Check if journal entry already exists for this invoice
      const existingJournal = await trx('journal_entries')
        .where('reference_type', 'invoice')
        .where('reference_id', invoice.id)
        .first();
      
      if (existingJournal) {
        console.log(`  → Journal entry already exists (ID: ${existingJournal.id}), skipping`);
        continue;
      }

      // Create journal entry for invoice
      const [insertedJournal] = await trx('journal_entries').insert({
        date: invoice.created_at ? new Date(invoice.created_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        description: `Sales Invoice: ${invoice.id}`,
        project_id: invoice.project_id || null,
        reference_type: 'invoice',
        reference_id: String(invoice.id)
      }).returning('id');
      const journal_id = typeof insertedJournal === 'object' ? insertedJournal.id : insertedJournal;
      console.log(`  → Created journal entry (ID: ${journal_id})`);

      const amount = Number(invoice.amount || 0);
      
      // Create ledger entries: Debit AR, Credit Revenue
      await trx('ledger_entries').insert([
        { journal_id, account_id: arAccount.id, debit: amount, credit: 0 },
        { journal_id, account_id: revenueAccount.id, debit: 0, credit: amount }
      ]);
      console.log(`  → Created ledger entries: Debit AR ${amount}, Credit Revenue ${amount}`);

      // Update COA balances
      await trx('chart_of_accounts').where({ id: arAccount.id }).increment('balance', amount);
      await trx('chart_of_accounts').where({ id: revenueAccount.id }).increment('balance', amount);
      console.log(`  → Updated COA balances: AR +${amount}, Revenue +${amount}`);
    }

    // Get payments for invoices
    const payments = await trx('payments')
      .where('target_type', 'Invoice')
      .select('*');
    
    console.log('\n--- PROCESSING PAYMENTS ---');
    
    for (const payment of payments) {
      console.log(`\nPayment: ${payment.payment_id} - Amount: ${payment.amount} - Target: ${payment.target_id}`);
      
      // Check if journal entry already exists for this payment
      const existingJournal = await trx('journal_entries')
        .where('reference_type', 'payment')
        .where('reference_id', String(payment.id))
        .first();
      
      if (existingJournal) {
        console.log(`  → Journal entry already exists (ID: ${existingJournal.id}), skipping`);
        continue;
      }

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

      const amount = Number(payment.amount || 0);

      // Get bank account COA
      let bankCoa = null;
      if (payment.bank_account_id) {
        const bankAcc = await trx('bank_accounts').where('id', payment.bank_account_id).first();
        if (bankAcc) {
          bankCoa = await trx('chart_of_accounts').where('name', 'ilike', `%${bankAcc.account_name}%`).first();
        }
      }
      
      if (!bankCoa) {
        console.log(`  → Warning: Could not find matching COA for bank account, skipping ledger entries`);
        continue;
      }
      
      console.log(`  → Bank COA: ${bankCoa.code} - ${bankCoa.name} (ID: ${bankCoa.id})`);

      // Create ledger entries: Debit Bank, Credit AR
      await trx('ledger_entries').insert([
        { journal_id, account_id: bankCoa.id, debit: amount, credit: 0 },
        { journal_id, account_id: arAccount.id, debit: 0, credit: amount }
      ]);
      console.log(`  → Created ledger entries: Debit Bank ${amount}, Credit AR ${amount}`);

      // Update COA balances
      await trx('chart_of_accounts').where({ id: bankCoa.id }).increment('balance', amount);
      await trx('chart_of_accounts').where({ id: arAccount.id }).decrement('balance', amount);
      console.log(`  → Updated COA balances: Bank +${amount}, AR -${amount}`);
    }

    await trx.commit();
    console.log('\n=== SUCCESS: All missing entries created ===');
    
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

fixAREntries();
