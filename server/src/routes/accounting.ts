import { Router } from 'express';
import db from '../db';
import { authenticateToken, authorizeRole } from '../middleware/auth';

const router = Router();

// Transactions
// Transactions (General Ledger View)
router.get('/transactions', authenticateToken, async (req, res) => {
  try {
    const transactions = await db('journal_entries')
      .leftJoin('ledger_entries', 'journal_entries.id', 'ledger_entries.journal_id')
      .select(
        'journal_entries.id',
        'journal_entries.date',
        'journal_entries.description',
        'journal_entries.reference_type',
        db.raw('SUM(ledger_entries.debit) as total_amount')
      )
      .groupBy('journal_entries.id')
      .orderBy('journal_entries.date', 'desc');
    res.json(transactions);
  } catch (error: any) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ message: error.message || 'Error fetching transactions' });
  }
});

router.post('/transactions', authenticateToken, authorizeRole(['accountant', 'admin']), async (req, res) => {
  try {
    const tx = req.body;
    await db('transactions').insert(tx);
    res.status(201).json(tx);
  } catch (error: any) {
    console.error('Error adding transaction:', error);
    res.status(500).json({ message: error.message || 'Error adding transaction' });
  }
});

// Invoices
router.get('/invoices', authenticateToken, async (req, res) => {
  try {
    const invoices = await db('invoices as i')
      .leftJoin('payments as p', function() {
        this.on('p.target_id', 'i.id').andOn('p.target_type', db.raw('?', ['Invoice']));
      })
      .select('i.*', db.raw('COALESCE(SUM(p.amount), 0) as paid_amount'))
      .groupBy('i.id')
      .orderBy('i.created_at', 'desc');

    const enhancedInvoices = invoices.map((invoice: any) => {
      const amount = Number(invoice.amount || 0);
      const paidAmount = Number(invoice.paid_amount || 0);
      const balanceDue = Math.max(0, amount - paidAmount);
      let status = invoice.status;
      if (paidAmount >= amount && amount > 0) {
        status = 'paid';
      } else if (paidAmount > 0) {
        status = 'partially_paid';
      } else if (!status) {
        status = 'unpaid';
      }
      return { ...invoice, paid_amount: paidAmount, balance_due: balanceDue, status };
    });

    res.json(enhancedInvoices);
  } catch (error: any) {
    console.error('Error fetching invoices:', error);
    res.status(500).json({ message: error.message || 'Error fetching invoices' });
  }
});

router.post('/invoices', authenticateToken, authorizeRole(['accountant', 'admin']), async (req, res) => {
  const trx = await db.transaction();
  try {
    const invoice = req.body;
    const [inserted] = await trx('invoices').insert(invoice).returning('id');
    const invoiceId = typeof inserted === 'object' ? inserted.id : inserted;

    // Create a journal entry and ledger postings for the invoice (Debit: AR, Credit: Revenue)
    const [insertedJournal] = await trx('journal_entries').insert({
      date: new Date().toISOString().split('T')[0],
      description: `Sales Invoice: ${invoiceId}`,
      project_id: invoice.project_id || null,
      reference_type: 'invoice',
      reference_id: String(invoiceId)
    }).returning('id');
    const journal_id = typeof insertedJournal === 'object' ? insertedJournal.id : insertedJournal;

    const amount = Number(invoice.amount || invoice.subtotal || 0);

    // Try to locate Accounts Receivable account (handle both code variants used in seeds/migrations)
    let arAccount = await trx('chart_of_accounts').where(function() {
      this.where('code', '1003').orWhere('code', '1104').orWhere('name', 'ilike', '%accounts receivable%');
    }).first();
    if (!arAccount) {
      arAccount = await trx('chart_of_accounts').where('type', 'Asset').first();
    }

    // Locate a revenue/income account
    let revenueAcc = await trx('chart_of_accounts').where(function() {
      this.where('code', '4001').orWhere('code', '4101').orWhere('type', 'Income');
    }).first();
    if (!revenueAcc) {
      revenueAcc = await trx('chart_of_accounts').where('type', 'Income').first();
    }

    if (arAccount && revenueAcc && amount > 0) {
      await trx('ledger_entries').insert([
        { journal_id, account_id: arAccount.id, debit: amount, credit: 0 },
        { journal_id, account_id: revenueAcc.id, debit: 0, credit: amount }
      ]);

      // Update COA balances: Assets (AR) increase with debit; Income accounts keep a positive running total
      await trx('chart_of_accounts').where({ id: arAccount.id }).increment('balance', amount);
      await trx('chart_of_accounts').where({ id: revenueAcc.id }).increment('balance', amount);
    }

    await trx.commit();
    res.status(201).json({ ...invoice, id: invoiceId });
  } catch (error: any) {
    await trx.rollback();
    console.error('Error creating invoice:', error);
    res.status(500).json({ message: error.message || 'Error creating invoice' });
  }
});

// Taxes
router.get('/taxes', authenticateToken, authorizeRole(['accountant', 'admin']), async (req, res) => {
  try {
    const taxes = await db('taxes').select('*');
    res.json(taxes);
  } catch (error: any) {
    console.error('Error fetching tax records:', error);
    res.status(500).json({ message: error.message || 'Error fetching tax records' });
  }
});

// Advanced Ledger-Driven Reports are defined below


// --- ADVANCED ACCOUNTING (ERP v3) ---

// Chart of Accounts
router.get('/coa', authenticateToken, async (req, res) => {
  try {
    const coa = await db('chart_of_accounts').orderBy('code', 'asc');
    res.json(coa);
  } catch (error: any) {
    console.error('Error fetching COA:', error);
    res.status(500).json({ message: error.message || 'Error fetching COA' });
  }
});

router.post('/coa', authenticateToken, authorizeRole(['admin', 'accountant']), async (req, res) => {
  try {
    const data = req.body;
    await db('chart_of_accounts').insert(data);
    res.status(201).json({ message: 'Account created' });
  } catch (error: any) {
    console.error('Error creating account:', error);
    res.status(500).json({ message: error.message || 'Error creating account' });
  }
});

router.patch('/coa/:id', authenticateToken, authorizeRole(['admin', 'accountant']), async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;
    await db('chart_of_accounts').where({ id }).update(data);
    res.json({ message: 'Account updated' });
  } catch (error: any) {
    console.error('Error updating account:', error);
    res.status(500).json({ message: error.message || 'Error updating account' });
  }
});

router.delete('/coa/:id', authenticateToken, authorizeRole(['admin', 'accountant']), async (req, res) => {
  try {
    const { id } = req.params;
    // Check if account is used in ledger entries before deleting
    const inUse = await db('ledger_entries').where({ account_id: id }).first();
    if (inUse) {
      return res.status(400).json({ message: 'Cannot delete account because it is used in ledger entries' });
    }
    await db('chart_of_accounts').where({ id }).del();
    res.json({ message: 'Account deleted' });
  } catch (error: any) {
    console.error('Error deleting account:', error);
    res.status(500).json({ message: error.message || 'Error deleting account' });
  }
});

// Journal Entries with Double Entry Logic
router.post('/journal', authenticateToken, authorizeRole(['accountant', 'admin']), async (req, res) => {
  const trx = await db.transaction();
  try {
    const { date, description, items } = req.body; // items: [{ account_id, debit, credit }]

    // 1. Validate Balance (Sum of debits must equal sum of credits)
    const totalDebits = items.reduce((sum: number, item: any) => sum + Number(item.debit || 0), 0);
    const totalCredits = items.reduce((sum: number, item: any) => sum + Number(item.credit || 0), 0);
    
    if (Math.abs(totalDebits - totalCredits) > 0.01) {
      return res.status(400).json({ message: 'Journal entry is not balanced. Debits must equal Credits.' });
    }

    // 2. Create Journal Header
    const [insertedJournal] = await trx('journal_entries').insert({
      date,
      description,
      project_id: req.body.project_id || null, // Enable project tracking
      reference_type: 'manual'
    }).returning('id');
    const journal_id = typeof insertedJournal === 'object' ? insertedJournal.id : insertedJournal;

    // 3. Create Ledger Entries and Update Account Balances
    for (const item of items) {
      await trx('ledger_entries').insert({
        journal_id,
        account_id: item.account_id,
        debit: item.debit,
        credit: item.credit
      });

      // Update COA Balance
      const impact = Number(item.debit || 0) - Number(item.credit || 0);
      await trx('chart_of_accounts')
        .where({ id: item.account_id })
        .increment('balance', impact);
    }

    await trx.commit();
    res.status(201).json({ message: 'Journal entry posted successfully' });
  } catch (error: any) {
    await trx.rollback();
    console.error('Error posting journal entry:', error);
    res.status(500).json({ message: error.message || 'Error posting journal entry' });
  }
});

// Fetch ledger entries for a specific account (Drill-down)
router.get('/ledger-entries/:accountId', authenticateToken, async (req, res) => {
  try {
    const { accountId } = req.params;
    const { startDate, endDate } = req.query;

    let query = db('ledger_entries')
      .join('journal_entries', 'ledger_entries.journal_id', 'journal_entries.id')
      .where('ledger_entries.account_id', accountId)
      .select(
        'ledger_entries.journal_id',
        'journal_entries.date',
        'journal_entries.description',
        'journal_entries.reference_type',
        'journal_entries.reference_id',
        'ledger_entries.debit',
        'ledger_entries.credit'
      )
      .orderBy('journal_entries.date', 'desc');

    if (startDate) query = query.where('journal_entries.date', '>=', startDate as string);
    if (endDate) query = query.where('journal_entries.date', '<=', endDate as string);

    const entries = await query;
    res.json(entries);
  } catch (error: any) {
    console.error('Error fetching ledger entries:', error);
    res.status(500).json({ message: error.message || 'Error fetching ledger entries' });
  }
});

router.delete('/journal/:id', authenticateToken, authorizeRole(['accountant', 'admin']), async (req, res) => {
  const { id } = req.params;
  const trx = await db.transaction();
  try {
    // 1. Get ledger entries to reverse balances
    const entries = await trx('ledger_entries').where({ journal_id: id });
    
    // 2. Reverse impact on COA
    for (const entry of entries) {
      const impact = Number(entry.debit || 0) - Number(entry.credit || 0);
      await trx('chart_of_accounts')
        .where({ id: entry.account_id })
        .decrement('balance', impact);
    }
    
    // 3. Delete records
    await trx('ledger_entries').where({ journal_id: id }).del();
    await trx('journal_entries').where({ id }).del();
    
    await trx.commit();
    res.json({ message: 'Journal entry deleted and balances reversed' });
  } catch (error: any) {
    await trx.rollback();
    console.error('Error deleting journal:', error);
    res.status(500).json({ message: error.message || 'Error deleting journal' });
  }
});

// Fetch full journal details for editing
router.get('/journal/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const header = await db('journal_entries').where({ id }).first();
    const items = await db('ledger_entries').where({ journal_id: id });
    res.json({ ...header, items });
  } catch (error: any) {
    console.error('Error fetching journal details:', error);
    res.status(500).json({ message: error.message || 'Error fetching journal details' });
  }
});

// --- ADVANCED LEDGER REPORTS ---

router.get('/reports/trial-balance', authenticateToken, authorizeRole(['accountant', 'admin']), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    let query = db('chart_of_accounts')
      .leftJoin('ledger_entries', 'chart_of_accounts.id', 'ledger_entries.account_id')
      .leftJoin('journal_entries', 'ledger_entries.journal_id', 'journal_entries.id')
      .select(
        'chart_of_accounts.id',
        'chart_of_accounts.code',
        'chart_of_accounts.name',
        'chart_of_accounts.type',
        db.raw('COALESCE(SUM(ledger_entries.debit), 0) as total_debit'),
        db.raw('COALESCE(SUM(ledger_entries.credit), 0) as total_credit')
      )
      .groupBy('chart_of_accounts.id');

    if (startDate) query = query.where('journal_entries.date', '>=', startDate as string);
    if (endDate) query = query.where('journal_entries.date', '<=', endDate as string);

    const balances = await query;
    res.json(balances);
  } catch (error: any) {
    console.error('Error generating trial balance:', error);
    res.status(500).json({ message: error.message || 'Error generating trial balance' });
  }
});

router.get('/reports/income-statement', authenticateToken, authorizeRole(['accountant', 'admin']), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    let query = db('chart_of_accounts')
      .leftJoin('ledger_entries', 'chart_of_accounts.id', 'ledger_entries.account_id')
      .leftJoin('journal_entries', 'ledger_entries.journal_id', 'journal_entries.id')
      .whereIn('chart_of_accounts.type', ['Income', 'Expense'])
      .select(
        'chart_of_accounts.id',
        'chart_of_accounts.code',
        'chart_of_accounts.name',
        'chart_of_accounts.type',
        db.raw('COALESCE(SUM(ledger_entries.credit), 0) as total_credit'),
        db.raw('COALESCE(SUM(ledger_entries.debit), 0) as total_debit')
      )
      .groupBy('chart_of_accounts.id');

    if (startDate) query = query.where('journal_entries.date', '>=', startDate as string);
    if (endDate) query = query.where('journal_entries.date', '<=', endDate as string);

    const accounts = await query;
    res.json(accounts);
  } catch (error: any) {
    console.error('Error generating income statement:', error);
    res.status(500).json({ message: error.message || 'Error generating income statement' });
  }
});

router.get('/reports/balance-sheet', authenticateToken, authorizeRole(['accountant', 'admin']), async (req, res) => {
  try {
    const { asOfDate } = req.query;
    
    let query = db('chart_of_accounts')
      .leftJoin('ledger_entries', 'chart_of_accounts.id', 'ledger_entries.account_id')
      .leftJoin('journal_entries', 'ledger_entries.journal_id', 'journal_entries.id')
      .whereIn('chart_of_accounts.type', ['Asset', 'Liability', 'Equity'])
      .select(
        'chart_of_accounts.id',
        'chart_of_accounts.code',
        'chart_of_accounts.name',
        'chart_of_accounts.type',
        db.raw('COALESCE(SUM(ledger_entries.debit), 0) as total_debit'),
        db.raw('COALESCE(SUM(ledger_entries.credit), 0) as total_credit')
      )
      .groupBy('chart_of_accounts.id');

    if (asOfDate) query = query.where('journal_entries.date', '<=', asOfDate as string);

    const accounts = await query;

    // Need to compute Retained Earnings from Income - Expense
    let incomeQuery = db('chart_of_accounts')
      .leftJoin('ledger_entries', 'chart_of_accounts.id', 'ledger_entries.account_id')
      .leftJoin('journal_entries', 'ledger_entries.journal_id', 'journal_entries.id')
      .whereIn('chart_of_accounts.type', ['Income', 'Expense'])
      .select(
        'chart_of_accounts.type',
        db.raw('COALESCE(SUM(ledger_entries.debit), 0) as total_debit'),
        db.raw('COALESCE(SUM(ledger_entries.credit), 0) as total_credit')
      )
      .groupBy('chart_of_accounts.type');
      
    if (asOfDate) incomeQuery = incomeQuery.where('journal_entries.date', '<=', asOfDate as string);

    const incomeExp = await incomeQuery;
    let retainedEarnings = 0;
    incomeExp.forEach(r => {
      if (r.type === 'Income') retainedEarnings += Number(r.total_credit) - Number(r.total_debit);
      if (r.type === 'Expense') retainedEarnings -= Number(r.total_debit) - Number(r.total_credit);
    });

    res.json({ accounts, retainedEarnings });
  } catch (error: any) {
    console.error('Error generating balance sheet:', error);
    res.status(500).json({ message: error.message || 'Error generating balance sheet' });
  }
});

router.get('/reports/management', authenticateToken, authorizeRole(['accountant', 'admin']), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    // Quick summary fetching for dashboard
    let query = db('chart_of_accounts')
      .leftJoin('ledger_entries', 'chart_of_accounts.id', 'ledger_entries.account_id')
      .leftJoin('journal_entries', 'ledger_entries.journal_id', 'journal_entries.id')
      .select(
        'chart_of_accounts.type',
        db.raw('COALESCE(SUM(ledger_entries.debit), 0) as total_debit'),
        db.raw('COALESCE(SUM(ledger_entries.credit), 0) as total_credit')
      )
      .groupBy('chart_of_accounts.type');

    if (startDate) query = query.where('journal_entries.date', '>=', startDate as string);
    if (endDate) query = query.where('journal_entries.date', '<=', endDate as string);

    const rawStats = await query;
    const stats: Record<string, number> = { Asset: 0, Liability: 0, Equity: 0, Income: 0, Expense: 0 };
    
    rawStats.forEach(s => {
      if (s.type === 'Asset' || s.type === 'Expense') {
        stats[s.type] = Number(s.total_debit) - Number(s.total_credit);
      } else {
        stats[s.type] = Number(s.total_credit) - Number(s.total_debit);
      }
    });

    let payrollQuery = db('payroll').where('status', 'Paid').sum('net_pay as total_paid');
    if (startDate) payrollQuery = payrollQuery.where('payment_date', '>=', startDate as string);
    if (endDate) payrollQuery = payrollQuery.where('payment_date', '<=', endDate as string);
    
    const [payrollResult] = await payrollQuery;
    stats['TotalPayroll'] = Number(payrollResult?.total_paid || 0);

    res.json(stats);
  } catch (error: any) {
    console.error('Error generating management reports:', error);
    res.status(500).json({ message: error.message || 'Error generating management reports' });
  }
});

router.get('/reports/cash-flow', authenticateToken, authorizeRole(['accountant', 'admin']), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    // Direct Method Cash Flow
    // We analyze ledger entries for accounts of type 'Asset' that are likely Cash/Bank accounts
    // For this simple implementation, we'll look at all entries in accounts tagged as 'Asset' 
    // and filter for those with names containing 'Cash' or 'Bank'
    
    const cashAccounts = await db('chart_of_accounts')
      .where('type', 'Asset')
      .where(function() {
        this.where('name', 'ilike', '%cash%').orWhere('name', 'ilike', '%bank%');
      })
      .select('id');
    
    const accountIds = cashAccounts.map(a => a.id);
    
    if (accountIds.length === 0) return res.json({ operating: [], investing: [], financing: [] });

    let query = db('ledger_entries')
      .join('journal_entries', 'ledger_entries.journal_id', 'journal_entries.id')
      .join('chart_of_accounts', 'ledger_entries.account_id', 'chart_of_accounts.id')
      .whereIn('ledger_entries.account_id', accountIds)
      .select(
        'journal_entries.description',
        'journal_entries.date',
        'ledger_entries.debit',
        'ledger_entries.credit',
        'chart_of_accounts.name as account_name'
      );

    if (startDate) query = query.where('journal_entries.date', '>=', startDate as string);
    if (endDate) query = query.where('journal_entries.date', '<=', endDate as string);

    const movements = await query;
    
    // Categorize movements (Simplified logic)
    // Operating: Invoices, Bills, Payroll
    // Investing: Equipment, Assets
    // Financing: Loans, Equity
    
    const operatingMovements = movements.filter(m => !m.description.toLowerCase().includes('equipment') && !m.description.toLowerCase().includes('loan'));
    const investingMovements = movements.filter(m => m.description.toLowerCase().includes('equipment') || m.description.toLowerCase().includes('asset'));
    const financingMovements = movements.filter(m => m.description.toLowerCase().includes('loan') || m.description.toLowerCase().includes('equity'));

    const calculateTotals = (movs: any[]) => {
      const inflows = movs.reduce((sum, m) => sum + Number(m.debit || 0), 0);
      const outflows = movs.reduce((sum, m) => sum + Number(m.credit || 0), 0);
      return { inflows, outflows, net: inflows - outflows };
    };

    const operating = calculateTotals(operatingMovements);
    const investing = calculateTotals(investingMovements);
    const financing = calculateTotals(financingMovements);

    const report = {
      operating,
      investing,
      financing,
      netCashFlow: operating.net + investing.net + financing.net
    };

    res.json(report);
  } catch (error: any) {
    console.error('Error generating cash flow statement:', error);
    res.status(500).json({ message: error.message || 'Error generating cash flow statement' });
  }
});

// --- ENTERPRISE FINANCE (Bank, AP, AR) ---

// Bank Accounts
router.get('/bank-accounts', authenticateToken, authorizeRole(['accountant', 'admin']), async (req, res) => {
  try {
    const accounts = await db('bank_accounts').orderBy('id', 'asc');
    res.json(accounts);
  } catch (error: any) {
    console.error('Error fetching bank accounts:', error);
    res.status(500).json({ message: error.message || 'Error fetching bank accounts' });
  }
});

router.post('/bank-accounts', authenticateToken, authorizeRole(['admin', 'accountant']), async (req, res) => {
  try {
    const data = req.body;
    await db('bank_accounts').insert(data);
    res.status(201).json({ message: 'Bank account added' });
  } catch (error: any) {
    console.error('Error adding bank account:', error);
    res.status(500).json({ message: error.message || 'Error adding bank account' });
  }
});

// Bank Transactions (Feeds)
router.get('/bank-transactions', authenticateToken, authorizeRole(['accountant', 'admin']), async (req, res) => {
  try {
    const tx = await db('bank_transactions')
      .select('bank_transactions.*', 'bank_accounts.account_name', 'bank_accounts.bank_name')
      .join('bank_accounts', 'bank_transactions.bank_account_id', 'bank_accounts.id')
      .orderBy('date', 'desc');
    res.json(tx);
  } catch (error: any) {
    console.error('Error fetching bank transactions:', error);
    res.status(500).json({ message: error.message || 'Error fetching bank transactions' });
  }
});

router.post('/bank-transactions', authenticateToken, authorizeRole(['accountant', 'admin']), async (req, res) => {
  try {
    const data = req.body;
    await db('bank_transactions').insert(data);
    res.status(201).json({ message: 'Bank transaction imported' });
  } catch (error: any) {
    console.error('Error importing bank transaction:', error);
    res.status(500).json({ message: error.message || 'Error importing bank transaction' });
  }
});

router.patch('/bank-transactions/:id/reconcile', authenticateToken, authorizeRole(['accountant', 'admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { matched_ledger_id } = req.body;
    
    await db('bank_transactions')
      .where({ id })
      .update({ 
        status: 'Reconciled',
        matched_ledger_id: matched_ledger_id || null
      });
      
    res.json({ message: 'Transaction reconciled successfully' });
  } catch (error: any) {
    console.error('Error reconciling transaction:', error);
    res.status(500).json({ message: error.message || 'Error reconciling transaction' });
  }
});

router.delete('/bank-transactions/:id', authenticateToken, authorizeRole(['accountant', 'admin']), async (req, res) => {
  try {
    const { id } = req.params;
    await db('bank_transactions').where({ id }).del();
    res.json({ message: 'Bank transaction deleted' });
  } catch (error: any) {
    console.error('Error deleting bank transaction:', error);
    res.status(500).json({ message: error.message || 'Error deleting bank transaction' });
  }
});

router.patch('/bank-transactions/:id', authenticateToken, authorizeRole(['accountant', 'admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;
    await db('bank_transactions').where({ id }).update(data);
    res.json({ message: 'Bank transaction updated' });
  } catch (error: any) {
    console.error('Error updating bank transaction:', error);
    res.status(500).json({ message: error.message || 'Error updating bank transaction' });
  }
});

// Vendor Bills (AP)
router.get('/bills', authenticateToken, authorizeRole(['accountant', 'admin']), async (req, res) => {
  try {
    const bills = await db('bills as b')
      .join('suppliers', 'b.supplier_id', 'suppliers.id')
      .leftJoin('payments as p', function() {
        this.on('p.target_id', db.raw('CAST(b.id AS VARCHAR)')).andOn('p.target_type', db.raw('?', ['Bill']));
      })
      .select(
        'b.*',
        'suppliers.name as supplier_name',
        db.raw('COALESCE(SUM(p.amount), 0) as paid_amount')
      )
      .groupBy('b.id', 'suppliers.name')
      .orderBy('b.due_date', 'asc');

    const enhancedBills = bills.map((bill: any) => {
      const amount = Number(bill.amount || 0);
      const paidAmount = Number(bill.paid_amount || 0);
      const balanceDue = Math.max(0, amount - paidAmount);
      let status = bill.status || 'unpaid';
      if (paidAmount >= amount && amount > 0) {
        status = 'paid';
      } else if (paidAmount > 0) {
        status = 'partially_paid';
      } else {
        status = 'unpaid';
      }
      return { ...bill, paid_amount: paidAmount, balance_due: balanceDue, status };
    });

    res.json(enhancedBills);
  } catch (error: any) {
    console.error('Error fetching bills:', error);
    res.status(500).json({ message: error.message || 'Error fetching bills' });
  }
});

router.post('/bills', authenticateToken, authorizeRole(['accountant', 'admin']), async (req, res) => {
  const trx = await db.transaction();
  try {
    const { supplier_id, quantity, unit_price, amount, due_date, category, project_id, account_id } = req.body;
    
    // 1. Record the Bill
    const [insertedBill] = await trx('bills').insert({
      supplier_id,
      quantity,
      unit_price,
      amount,
      due_date,
      category,
      project_id,
      account_id,
      status: 'Unpaid'
    }).returning('id');
    const bill_id = typeof insertedBill === 'object' ? insertedBill.id : insertedBill;

    // 2. Create Journal Entry for the Expense
    const [insertedJournal] = await trx('journal_entries').insert({
      date: new Date().toISOString().split('T')[0],
      description: `Vendor Bill: ${category} (Bill ID: ${bill_id})`,
      project_id: project_id !== 'none' ? project_id : null,
      reference_type: 'bill',
      reference_id: String(bill_id)
    }).returning('id');
    const journal_id = typeof insertedJournal === 'object' ? insertedJournal.id : insertedJournal;

    // 3. Double Entry: Debit Expense, Credit Accounts Payable (Code: 2001)
    const ap_account = await trx('chart_of_accounts').where('code', '2001').first();
    if (!ap_account) throw new Error('Accounts Payable (2001) not found in COA');
    const ap_account_id = ap_account.id; 
    
    // Debit Expense
    await trx('ledger_entries').insert({
      journal_id,
      account_id: account_id,
      debit: amount,
      credit: 0
    });

    // Credit Accounts Payable
    await trx('ledger_entries').insert({
      journal_id,
      account_id: ap_account_id,
      debit: 0,
      credit: amount
    });

    // 4. Update Balances
    await trx('chart_of_accounts').where({ id: account_id }).increment('balance', amount);
    await trx('chart_of_accounts').where({ id: ap_account_id }).decrement('balance', amount); // Liabilities increase with credit (debit - credit < 0)

    await trx.commit();
    res.status(201).json({ message: 'Bill recorded and posted to ledger' });
  } catch (error: any) {
    await trx.rollback();
    console.error('Error recording bill:', error);
    res.status(500).json({ message: error.message || 'Error recording bill' });
  }
});

// Payments (Tracking)
router.post('/payments', authenticateToken, authorizeRole(['accountant', 'admin']), async (req, res) => {
  const trx = await db.transaction();
  try {
    const data = req.body; // { payment_id, date, amount, method, reference, target_type, target_id, bank_account_id }
    
    // Validate required fields
    if (!data.amount || Number(data.amount) <= 0) {
      return res.status(400).json({ message: 'Payment amount must be greater than 0' });
    }
    if (!data.target_type || !data.target_id) {
      return res.status(400).json({ message: 'target_type and target_id are required' });
    }
    // For non-cash payments, bank_account_id is required
    if (data.method !== 'Cash' && !data.bank_account_id) {
      return res.status(400).json({ message: 'bank_account_id is required for non-cash payments' });
    }
    // For non-cash payments, reference is required
    if (data.method !== 'Cash' && !data.reference) {
      return res.status(400).json({ message: 'reference is required for non-cash payments' });
    }

    // 1. Validate and get required accounts BEFORE recording payment
    let bankCoa: any = null;
    let arAccount: any = null;
    let apAccount: any = null;

    // Get bank account or cash account based on payment method
    if (data.method === 'Cash') {
      // For Cash payments, find the "Cash on Hand" account
      bankCoa = await trx('chart_of_accounts')
        .where('type', 'Asset')
        .where(function() {
          this.where('name', 'ilike', '%cash on hand%')
            .orWhere('name', 'ilike', '%cash%')
            .orWhere('code', '1001')
            .orWhere('code', '1101');
        })
        .first();
      if (!bankCoa) {
        return res.status(400).json({ message: 'Cash on Hand account not found in Chart of Accounts' });
      }
    } else if (data.bank_account_id) {
      // For non-cash payments, get the bank account
      const bankAccRow = await trx('bank_accounts').where('id', data.bank_account_id).first();
      if (bankAccRow) {
        // Try matching account_name under Asset type
        bankCoa = await trx('chart_of_accounts')
          .where('type', 'Asset')
          .where('name', 'ilike', `%${bankAccRow.account_name}%`)
          .first();
        
        // If not found, try matching bank_name (e.g. "ADB Bank" -> "ADB" or "omniBSIC Bank" -> "omniBSIC")
        if (!bankCoa && bankAccRow.bank_name) {
          const firstWord = bankAccRow.bank_name.split(' ')[0];
          bankCoa = await trx('chart_of_accounts')
            .where('type', 'Asset')
            .where('name', 'ilike', `%${firstWord}%`)
            .first();
        }
      }
    }
    if (!bankCoa && data.method !== 'Cash') {
      bankCoa = await trx('chart_of_accounts')
        .where('type', 'Asset')
        .where(function() {
          this.where('name', 'ilike', '%bank%').orWhere('name', 'ilike', '%cash%');
        }).first();
    }
    if (!bankCoa) {
      return res.status(400).json({ message: 'Bank or cash account not found in Chart of Accounts' });
    }

    // Get AR account if needed
    if (data.target_type === 'Invoice') {
      arAccount = await trx('chart_of_accounts').where(function() {
        this.where('code', '1003').orWhere('code', '1104').orWhere('name', 'ilike', '%accounts receivable%');
      }).first();
      if (!arAccount) arAccount = await trx('chart_of_accounts').where('type', 'Asset').first();
      if (!arAccount) {
        return res.status(400).json({ message: 'Accounts Receivable account not found' });
      }
    }

    // Get AP account if needed
    if (data.target_type === 'Bill') {
      apAccount = await trx('chart_of_accounts').where(function() {
        this.where('code', '2001').orWhere('name', 'ilike', '%accounts payable%');
      }).first();
      if (!apAccount) apAccount = await trx('chart_of_accounts').where('type', 'Liability').first();
      if (!apAccount) {
        return res.status(400).json({ message: 'Accounts Payable account not found' });
      }
    }

    // 2. Record payment (only after validation succeeds)
    const [inserted] = await trx('payments').insert(data).returning('id');
    const paymentId = typeof inserted === 'object' ? inserted.id : inserted;

    // 3. Update target status and build context for ledger posting
    let projectId: any = null;

    if (data.target_type === 'Invoice') {
      const paymentSummary: any = await trx('payments')
        .where({ target_type: 'Invoice', target_id: data.target_id })
        .sum('amount as total_paid')
        .first();
      const totalPaid = Number(paymentSummary?.total_paid || 0);
      const invoice = await trx('invoices').where('id', data.target_id).first();
      if (invoice) {
        projectId = invoice.project_id || null;
        let invoiceStatus = 'unpaid';
        if (totalPaid >= Number(invoice.amount)) {
          invoiceStatus = 'paid';
        } else if (totalPaid > 0) {
          invoiceStatus = 'partially_paid';
        }
        await trx('invoices').where('id', data.target_id).update({ status: invoiceStatus });
      }

      // Create journal entry: Debit Bank/Cash, Credit Accounts Receivable
      const [insertedJournal] = await trx('journal_entries').insert({
        date: data.date || new Date().toISOString().split('T')[0],
        description: `Payment ${data.payment_id} for Invoice ${data.target_id}`,
        project_id: projectId,
        reference_type: 'payment',
        reference_id: String(paymentId)
      }).returning('id');
      const journal_id = typeof insertedJournal === 'object' ? insertedJournal.id : insertedJournal;

      const amount = Number(data.amount || 0);

      // Debit bank (increase asset), Credit AR (decrease asset)
      await trx('ledger_entries').insert([
        { journal_id, account_id: bankCoa.id, debit: amount, credit: 0 },
        { journal_id, account_id: arAccount.id, debit: 0, credit: amount }
      ]);

      // Update COA balances
      await trx('chart_of_accounts').where({ id: bankCoa.id }).increment('balance', amount);
      await trx('chart_of_accounts').where({ id: arAccount.id }).decrement('balance', amount);

    } else if (data.target_type === 'Bill') {
      const paymentSummary: any = await trx('payments')
        .where({ target_type: 'Bill', target_id: data.target_id })
        .sum('amount as total_paid')
        .first();
      const totalPaid = Number(paymentSummary?.total_paid || 0);
      const bill = await trx('bills').where('id', data.target_id).first();
      if (bill) {
        projectId = bill.project_id || null;
        let billStatus = 'unpaid';
        if (totalPaid >= Number(bill.amount)) {
          billStatus = 'paid';
        } else if (totalPaid > 0) {
          billStatus = 'partially_paid';
        }
        await trx('bills').where('id', data.target_id).update({ status: billStatus });
      }

      // Create journal entry for vendor payment: Debit Accounts Payable, Credit Bank
      const [insertedJournal] = await trx('journal_entries').insert({
        date: data.date || new Date().toISOString().split('T')[0],
        description: `Payment ${data.payment_id} for Bill ${data.target_id}`,
        project_id: projectId,
        reference_type: 'payment',
        reference_id: String(paymentId)
      }).returning('id');
      const journal_id = typeof insertedJournal === 'object' ? insertedJournal.id : insertedJournal;

      const amount = Number(data.amount || 0);

      // Debit AP (reduce liability), Credit bank (reduce asset)
      await trx('ledger_entries').insert([
        { journal_id, account_id: apAccount.id, debit: amount, credit: 0 },
        { journal_id, account_id: bankCoa.id, debit: 0, credit: amount }
      ]);

      // Update COA balances: AP (liability) was previously decremented to show increase; increment it to reduce the liability
      await trx('chart_of_accounts').where({ id: apAccount.id }).increment('balance', amount);
      await trx('chart_of_accounts').where({ id: bankCoa.id }).decrement('balance', amount);
    }

    // 3. Update bank account balance and cheque sequence if applicable (kept for backward compat)
    const impact = data.target_type === 'Invoice' ? Number(data.amount) : -Number(data.amount);
    if (data.bank_account_id) {
       await trx('bank_accounts').where('id', data.bank_account_id).increment('balance', impact);
       
       // If payment method is Cheque, increment the next cheque number
       if (data.method === 'Cheque') {
         await trx('bank_accounts').where('id', data.bank_account_id).increment('next_cheque_number', 1);
       }
    }

    await trx.commit();
    res.status(201).json({ message: 'Payment recorded successfully' });
  } catch (error: any) {
    await trx.rollback();
    console.error('Error recording payment:', error);
    res.status(500).json({ message: error.message || 'Error recording payment' });
  }
});

// Opening Balances (Smart Journal Posting)
router.post('/opening-balances', authenticateToken, authorizeRole(['accountant', 'admin']), async (req, res) => {
  const trx = await db.transaction();
  try {
    const { balances, date } = req.body; // balances: [{ account_id, balance }]
    
    if (!balances || balances.length === 0) {
      return res.status(400).json({ message: 'No balances provided' });
    }

    // 1. Delete any previous opening balance journal entries
    const existingOB = await trx('journal_entries')
      .where('reference_type', 'opening_balance')
      .select('id');
    
    for (const ob of existingOB) {
      const entries = await trx('ledger_entries').where({ journal_id: ob.id });
      for (const entry of entries) {
        const impact = Number(entry.debit || 0) - Number(entry.credit || 0);
        await trx('chart_of_accounts').where({ id: entry.account_id }).decrement('balance', impact);
      }
      await trx('ledger_entries').where({ journal_id: ob.id }).del();
      await trx('journal_entries').where({ id: ob.id }).del();
    }

    // 2. Ensure Opening Balance Equity account exists
    let obeAccount = await trx('chart_of_accounts').where('code', '3900').first();
    if (!obeAccount) {
      const [inserted] = await trx('chart_of_accounts').insert({
        code: '3900',
        name: 'Opening Balance Equity',
        type: 'Equity',
        balance: 0
      }).returning('*');
      obeAccount = typeof inserted === 'object' ? inserted : { id: inserted };
    }

    // 3. Build journal items
    const items: { account_id: number, debit: number, credit: number }[] = [];
    let totalOffset = 0;

    for (const entry of balances) {
      const account = await trx('chart_of_accounts').where({ id: entry.account_id }).first();
      if (!account) continue;

      const newBalance = Number(entry.balance);
      if (newBalance === 0) continue;

      // For Asset/Expense: positive balance = debit
      // For Liability/Equity/Income: positive balance = credit
      if (['Asset', 'Expense'].includes(account.type)) {
        if (newBalance > 0) {
          items.push({ account_id: entry.account_id, debit: newBalance, credit: 0 });
          totalOffset += newBalance;
        } else {
          items.push({ account_id: entry.account_id, debit: 0, credit: Math.abs(newBalance) });
          totalOffset -= Math.abs(newBalance);
        }
      } else {
        // Liability, Equity, Income
        if (newBalance > 0) {
          items.push({ account_id: entry.account_id, debit: 0, credit: newBalance });
          totalOffset -= newBalance;
        } else {
          items.push({ account_id: entry.account_id, debit: Math.abs(newBalance), credit: 0 });
          totalOffset += Math.abs(newBalance);
        }
      }
    }

    if (items.length === 0) {
      await trx.rollback();
      return res.json({ message: 'No balances to post (all zero)' });
    }

    // 4. Add the offset to Opening Balance Equity
    if (totalOffset > 0) {
      items.push({ account_id: obeAccount.id, debit: 0, credit: totalOffset });
    } else if (totalOffset < 0) {
      items.push({ account_id: obeAccount.id, debit: Math.abs(totalOffset), credit: 0 });
    }

    // 5. Create Journal Entry
    const postDate = date || new Date().toISOString().split('T')[0];
    const [insertedJournal] = await trx('journal_entries').insert({
      date: postDate,
      description: 'Opening Balance Migration',
      reference_type: 'opening_balance'
    }).returning('id');
    const journal_id = typeof insertedJournal === 'object' ? insertedJournal.id : insertedJournal;

    // 6. Insert ledger entries and update COA balances
    for (const item of items) {
      await trx('ledger_entries').insert({
        journal_id,
        account_id: item.account_id,
        debit: item.debit,
        credit: item.credit
      });

      const impact = Number(item.debit) - Number(item.credit);
      await trx('chart_of_accounts').where({ id: item.account_id }).increment('balance', impact);
    }

    await trx.commit();
    res.status(201).json({ message: 'Opening balances posted successfully', journal_id });
  } catch (error: any) {
    await trx.rollback();
    console.error('Error posting opening balances:', error);
    res.status(500).json({ message: error.message || 'Error posting opening balances' });
  }
});

// Fiscal Year Settings
router.get('/settings/fiscal-year', authenticateToken, async (req, res) => {
  try {
    const setting = await db('settings').where({ key: 'fiscal_year' }).first();
    res.json(setting ? JSON.parse(setting.value) : { startMonth: 1, startDay: 1 });
  } catch (error: any) {
    res.status(500).json({ message: 'Error fetching fiscal year settings' });
  }
});

router.post('/settings/fiscal-year', authenticateToken, authorizeRole(['admin', 'accountant']), async (req, res) => {
  try {
    const value = JSON.stringify(req.body);
    const existing = await db('settings').where({ key: 'fiscal_year' }).first();
    if (existing) {
      await db('settings').where({ key: 'fiscal_year' }).update({ value });
    } else {
      await db('settings').insert({ key: 'fiscal_year', value });
    }
    res.json({ message: 'Fiscal year settings updated' });
  } catch (error: any) {
    res.status(500).json({ message: 'Error updating fiscal year settings' });
  }
});

export default router;
