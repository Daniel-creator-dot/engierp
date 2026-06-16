import knex from 'knex';
import config from './knexfile';
const db = knex((config as any).development);

async function diagnoseAR() {
  try {
    console.log('=== AR DIAGNOSTIC REPORT ===\n');

    // 1. Check AR Account in Chart of Accounts
    console.log('1. CHART OF ACCOUNTS - AR Account:');
    const arAccounts = await db('chart_of_accounts')
      .where(function() {
        this.where('code', '1003').orWhere('code', '1104').orWhere('name', 'ilike', '%accounts receivable%');
      });
    console.log(JSON.stringify(arAccounts, null, 2));

    // 2. Check all invoices
    console.log('\n2. ALL INVOICES:');
    const invoices = await db('invoices').select('*').orderBy('created_at', 'desc');
    console.log(JSON.stringify(invoices, null, 2));

    // 3. Check all payments
    console.log('\n3. ALL PAYMENTS:');
    const payments = await db('payments').select('*').orderBy('date', 'desc');
    console.log(JSON.stringify(payments, null, 2));

    // 4. Check payments specifically for invoices
    console.log('\n4. PAYMENTS FOR INVOICES:');
    const invoicePayments = await db('payments')
      .where('target_type', 'Invoice')
      .select('*');
    console.log(JSON.stringify(invoicePayments, null, 2));

    // 5. Check journal entries related to invoices
    console.log('\n5. JOURNAL ENTRIES RELATED TO INVOICES:');
    const invoiceJournalEntries = await db('journal_entries')
      .where('reference_type', 'invoice')
      .select('*');
    console.log(JSON.stringify(invoiceJournalEntries, null, 2));

    // 6. Check journal entries related to payments
    console.log('\n6. JOURNAL ENTRIES RELATED TO PAYMENTS:');
    const paymentJournalEntries = await db('journal_entries')
      .where('reference_type', 'payment')
      .select('*');
    console.log(JSON.stringify(paymentJournalEntries, null, 2));

    // 7. Check ledger entries for AR account
    const arAccount = await db('chart_of_accounts')
      .where(function() {
        this.where('code', '1003').orWhere('code', '1104').orWhere('name', 'ilike', '%accounts receivable%');
      }).first();
    
    if (arAccount) {
      console.log('\n7. LEDGER ENTRIES FOR AR ACCOUNT (ID:', arAccount.id, '):');
      const arLedgerEntries = await db('ledger_entries')
        .join('journal_entries', 'ledger_entries.journal_id', 'journal_entries.id')
        .where('ledger_entries.account_id', arAccount.id)
        .select(
          'ledger_entries.*',
          'journal_entries.date',
          'journal_entries.description',
          'journal_entries.reference_type',
          'journal_entries.reference_id'
        )
        .orderBy('journal_entries.date', 'desc');
      console.log(JSON.stringify(arLedgerEntries, null, 2));

      // Calculate AR balance from ledger entries
      console.log('\n8. AR BALANCE CALCULATION FROM LEDGER:');
      const arBalanceCalc = await db('ledger_entries')
        .where('account_id', arAccount.id)
        .select(
          db.raw('SUM(debit) as total_debit'),
          db.raw('SUM(credit) as total_credit'),
          db.raw('SUM(debit) - SUM(credit) as calculated_balance')
        )
        .first();
      console.log(JSON.stringify(arBalanceCalc, null, 2));
    }

    // 9. Check bank accounts
    console.log('\n9. BANK ACCOUNTS:');
    const bankAccounts = await db('bank_accounts').select('*');
    console.log(JSON.stringify(bankAccounts, null, 2));

  } catch(e) {
    console.error("DB Error:", e);
  } finally {
    process.exit(0);
  }
}

diagnoseAR();
