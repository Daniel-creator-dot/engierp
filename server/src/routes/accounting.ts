import { Router } from 'express';
import db from '../db';
import { authenticateToken, authorizeRole } from '../middleware/auth';

const router = Router();

// Transactions
router.get('/transactions', authenticateToken, async (req, res) => {
  try {
    const transactions = await db('transactions').select('*');
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching transactions' });
  }
});

router.post('/transactions', authenticateToken, authorizeRole(['accountant', 'admin']), async (req, res) => {
  try {
    const tx = req.body;
    await db('transactions').insert(tx);
    res.status(201).json(tx);
  } catch (error) {
    res.status(500).json({ message: 'Error adding transaction' });
  }
});

// Invoices
router.get('/invoices', authenticateToken, async (req, res) => {
  try {
    const invoices = await db('invoices').select('*');
    res.json(invoices);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching invoices' });
  }
});

router.post('/invoices', authenticateToken, authorizeRole(['accountant', 'admin']), async (req, res) => {
  try {
    const invoice = req.body;
    await db('invoices').insert(invoice);
    res.status(201).json(invoice);
  } catch (error) {
    res.status(500).json({ message: 'Error creating invoice' });
  }
});

// Taxes
router.get('/taxes', authenticateToken, authorizeRole(['accountant', 'admin']), async (req, res) => {
  try {
    const taxes = await db('taxes').select('*');
    res.json(taxes);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching tax records' });
  }
});

// Reports
router.get('/reports/receivables', authenticateToken, authorizeRole(['accountant', 'admin']), async (req, res) => {
  try {
    const data = await db('invoices')
      .whereNot('status', 'paid')
      .select('client', 'amount', 'dueDate', 'status');
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error generating receivables report' });
  }
});

router.get('/reports/payables', authenticateToken, authorizeRole(['accountant', 'admin']), async (req, res) => {
  try {
    // Payables = Expenses + Payroll
    const expenses = await db('transactions')
      .where('type', 'expense')
      .select('description as item', 'amount', 'date', 'status');
    
    const payroll = await db('employees')
      .select('name as item', 'salary as amount', 'status');
      
    res.json([...expenses, ...payroll.map(p => ({ ...p, date: 'Monthly', status: 'pending' }))]);
  } catch (error) {
    res.status(500).json({ message: 'Error generating payables report' });
  }
});

router.get('/reports/profit-loss', authenticateToken, authorizeRole(['accountant', 'admin']), async (req, res) => {
  try {
    const income = await db('transactions').where('type', 'income').sum('amount as total').first();
    const expenses = await db('transactions').where('type', 'expense').sum('amount as total').first();
    const payroll = await db('employees').sum('salary as total').first();
    
    const totalIncome = Number(income?.total || 0);
    const totalExpenses = Number(expenses?.total || 0) + Number(payroll?.total || 0);
    
    res.json({
      income: totalIncome,
      expenses: totalExpenses,
      profit: totalIncome - totalExpenses
    });
  } catch (error) {
    res.status(500).json({ message: 'Error generating P&L report' });
  }
});

// --- ADVANCED ACCOUNTING (ERP v3) ---

// Chart of Accounts
router.get('/coa', authenticateToken, async (req, res) => {
  try {
    const coa = await db('chart_of_accounts').orderBy('code', 'asc');
    res.json(coa);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching COA' });
  }
});

router.post('/coa', authenticateToken, authorizeRole(['admin', 'accountant']), async (req, res) => {
  try {
    const data = req.body;
    await db('chart_of_accounts').insert(data);
    res.status(201).json({ message: 'Account created' });
  } catch (error) {
    res.status(500).json({ message: 'Error creating account' });
  }
});

router.patch('/coa/:id', authenticateToken, authorizeRole(['admin', 'accountant']), async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;
    await db('chart_of_accounts').where({ id }).update(data);
    res.json({ message: 'Account updated' });
  } catch (error) {
    res.status(500).json({ message: 'Error updating account' });
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
  } catch (error) {
    res.status(500).json({ message: 'Error deleting account' });
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
    const [journal_id] = await trx('journal_entries').insert({
      date,
      description,
      project_id: req.body.project_id || null, // Enable project tracking
      reference_type: 'manual'
    }).returning('id');

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
  } catch (error) {
    await trx.rollback();
    res.status(500).json({ message: 'Error posting journal entry' });
  }
});

// Trial Balance Report
router.get('/reports/trial-balance', authenticateToken, authorizeRole(['accountant', 'admin']), async (req, res) => {
  try {
    const coa = await db('chart_of_accounts').orderBy('code', 'asc');
    res.json(coa);
  } catch (error) {
    res.status(500).json({ message: 'Error generating trial balance' });
  }
});

// --- ENTERPRISE FINANCE (Bank, AP, AR) ---

// Bank Accounts
router.get('/bank-accounts', authenticateToken, authorizeRole(['accountant', 'admin']), async (req, res) => {
  try {
    const accounts = await db('bank_accounts').orderBy('id', 'asc');
    res.json(accounts);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching bank accounts' });
  }
});

router.post('/bank-accounts', authenticateToken, authorizeRole(['admin', 'accountant']), async (req, res) => {
  try {
    const data = req.body;
    await db('bank_accounts').insert(data);
    res.status(201).json({ message: 'Bank account added' });
  } catch (error) {
    res.status(500).json({ message: 'Error adding bank account' });
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
  } catch (error) {
    res.status(500).json({ message: 'Error fetching bank transactions' });
  }
});

router.post('/bank-transactions', authenticateToken, authorizeRole(['accountant', 'admin']), async (req, res) => {
  try {
    const data = req.body;
    await db('bank_transactions').insert(data);
    res.status(201).json({ message: 'Bank transaction imported' });
  } catch (error) {
    res.status(500).json({ message: 'Error importing bank transaction' });
  }
});

// Vendor Bills (AP)
router.get('/bills', authenticateToken, authorizeRole(['accountant', 'admin']), async (req, res) => {
  try {
    const bills = await db('bills')
      .select('bills.*', 'suppliers.name as supplier_name')
      .join('suppliers', 'bills.supplier_id', 'suppliers.id')
      .orderBy('due_date', 'asc');
    res.json(bills);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching bills' });
  }
});

router.post('/bills', authenticateToken, authorizeRole(['accountant', 'admin']), async (req, res) => {
  try {
    const data = req.body;
    await db('bills').insert(data);
    res.status(201).json({ message: 'Bill recorded' });
  } catch (error) {
    res.status(500).json({ message: 'Error recording bill' });
  }
});

// Payments (Tracking)
router.post('/payments', authenticateToken, authorizeRole(['accountant', 'admin']), async (req, res) => {
  const trx = await db.transaction();
  try {
    const data = req.body; // { payment_id, date, amount, method, reference, target_type, target_id, bank_account_id }
    
    // 1. Record payment
    await trx('payments').insert(data);

    // 2. Update target status
    if (data.target_type === 'Invoice') {
      await trx('invoices').where('id', data.target_id).update({ status: 'paid' });
    } else if (data.target_type === 'Bill') {
      await trx('bills').where('id', data.target_id).update({ status: 'Paid' });
    }

    // 3. Update bank account balance
    const impact = data.target_type === 'Invoice' ? Number(data.amount) : -Number(data.amount);
    if (data.bank_account_id) {
       await trx('bank_accounts').where('id', data.bank_account_id).increment('balance', impact);
    }

    await trx.commit();
    res.status(201).json({ message: 'Payment recorded successfully' });
  } catch (error) {
    await trx.rollback();
    console.error(error)
    res.status(500).json({ message: 'Error recording payment' });
  }
});

export default router;
