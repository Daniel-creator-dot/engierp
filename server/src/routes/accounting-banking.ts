import { Router } from 'express';
import db from '../db';
import { LedgerError, postJournal, round2, sendError, toIsoDate } from '../lib/ledger';
import { bankLedgerAccount, pick } from '../lib/accounting';

// Mounted inside routes/accounting.ts, which already enforces admin/accountant access.
const router = Router();

const BANK_FIELDS = ['account_name', 'account_number', 'bank_name', 'type', 'currency', 'cheque_prefix', 'next_cheque_number', 'coa_account_id'] as const;
const TX_FIELDS = ['bank_account_id', 'date', 'description', 'amount', 'type'] as const;
const MATCH_WINDOW_DAYS = 7;

async function nextBankCode() {
  const codes: string[] = await db('chart_of_accounts').where('code', '>=', '1100').where('code', '<', '1200').pluck('code');
  const used = new Set(codes.map(Number));
  for (let n = 1102; n < 1200; n++) if (!used.has(n)) return String(n);
  throw new LedgerError('No free account code between 1100 and 1199 for a new bank account');
}

router.get('/bank-accounts', async (req, res) => {
  try {
    const accounts = await db('bank_accounts as b')
      .leftJoin('chart_of_accounts as c', 'b.coa_account_id', 'c.id')
      .select('b.*', 'c.code as coa_code', 'c.name as coa_name', 'c.balance as ledger_balance')
      .orderBy('b.id', 'asc');
    res.json(accounts.map((a: any) => ({ ...a, ledger_balance: a.coa_account_id ? round2(a.ledger_balance) : null })));
  } catch (error) {
    sendError(res, error, 'Error fetching bank accounts');
  }
});

async function validateCoaLink(id: any) {
  if (!id) return null;
  const acc = await db('chart_of_accounts').where({ id: Number(id) }).first();
  if (!acc || acc.type !== 'Asset') throw new LedgerError('Link the bank account to an asset account');
  return acc.id;
}

// Creates the bank account and, unless an existing ledger account is chosen, a new asset account for it.
router.post('/bank-accounts', async (req, res) => {
  try {
    const data: any = pick(req.body, BANK_FIELDS);
    for (const f of ['account_name', 'bank_name'] as const) {
      if (!String(data[f] || '').trim()) throw new LedgerError(`${f.replace('_', ' ')} is required`);
    }
    const created = await db.transaction(async (trx) => {
      let coaId = await validateCoaLink(data.coa_account_id);
      if (!coaId) {
        const last4 = String(data.account_number || '').slice(-4);
        const [acc] = await trx('chart_of_accounts').insert({
          code: await nextBankCode(),
          name: `Bank – ${data.bank_name}${last4 ? ` ${last4}` : ''}`,
          type: 'Asset',
          balance: 0,
        }).returning('*');
        coaId = acc.id;
      }
      const [row] = await trx('bank_accounts').insert({ ...data, coa_account_id: coaId, balance: 0 }).returning('*');
      return row;
    });
    res.status(201).json({ message: 'Bank account added', account: created });
  } catch (error) {
    sendError(res, error, 'Error adding bank account');
  }
});

router.patch('/bank-accounts/:id', async (req, res) => {
  try {
    const data: any = pick(req.body, BANK_FIELDS);
    if (data.coa_account_id !== undefined) data.coa_account_id = await validateCoaLink(data.coa_account_id);
    await db('bank_accounts').where({ id: req.params.id }).update({ ...data, updated_at: db.fn.now() });
    res.json({ message: 'Bank account updated' });
  } catch (error) {
    sendError(res, error, 'Error updating bank account');
  }
});

// --- Statement lines ---

function cleanTx(raw: any) {
  const data: any = pick(raw, TX_FIELDS);
  const amount = round2(data.amount);
  if (!data.bank_account_id) throw new LedgerError('bank_account_id is required');
  if (!data.date) throw new LedgerError('date is required');
  if (!(Math.abs(amount) > 0)) throw new LedgerError('amount must not be zero');
  const type = data.type === 'Credit' || data.type === 'Debit' ? data.type : amount >= 0 ? 'Credit' : 'Debit';
  return {
    bank_account_id: Number(data.bank_account_id),
    date: toIsoDate(String(data.date)),
    description: String(data.description || '').trim().slice(0, 250) || '(no description)',
    amount: Math.abs(amount),
    type,
  };
}

router.get('/bank-transactions', async (req, res) => {
  try {
    const q = db('bank_transactions')
      .select('bank_transactions.*', 'bank_accounts.account_name', 'bank_accounts.bank_name')
      .join('bank_accounts', 'bank_transactions.bank_account_id', 'bank_accounts.id')
      .orderBy([{ column: 'bank_transactions.date', order: 'desc' }, { column: 'bank_transactions.id', order: 'desc' }]);
    if (req.query.bank_account_id) q.where('bank_transactions.bank_account_id', Number(req.query.bank_account_id));
    if (req.query.status) q.where('bank_transactions.status', String(req.query.status));
    res.json(await q);
  } catch (error) {
    sendError(res, error, 'Error fetching bank transactions');
  }
});

router.post('/bank-transactions', async (req, res) => {
  try {
    const [row] = await db('bank_transactions').insert({ ...cleanTx(req.body), status: 'Unreconciled' }).returning('*');
    res.status(201).json(row);
  } catch (error) {
    sendError(res, error, 'Error adding bank transaction');
  }
});

// Bulk statement import; skips lines already imported (same account, date, amount, type and description).
router.post('/bank-transactions/import', async (req, res) => {
  try {
    const bankAccountId = Number(req.body?.bank_account_id);
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!bankAccountId) throw new LedgerError('Choose the bank account for this statement');
    if (rows.length === 0) throw new LedgerError('The statement has no rows');
    if (rows.length > 5000) throw new LedgerError('Import at most 5000 rows at a time');
    const bank = await db('bank_accounts').where({ id: bankAccountId }).first();
    if (!bank) throw new LedgerError('Bank account not found');

    const result = await db.transaction(async (trx) => {
      let imported = 0;
      let skipped = 0;
      const errors: string[] = [];
      for (const [index, raw] of rows.entries()) {
        let tx;
        try {
          tx = cleanTx({ ...raw, bank_account_id: bankAccountId });
        } catch (e: any) {
          errors.push(`Row ${index + 1}: ${e.message}`);
          continue;
        }
        const exists = await trx('bank_transactions').where({ bank_account_id: tx.bank_account_id, date: tx.date, amount: tx.amount, type: tx.type, description: tx.description }).first();
        if (exists) { skipped++; continue; }
        await trx('bank_transactions').insert({ ...tx, status: 'Unreconciled' });
        imported++;
      }
      return { imported, skipped, errors: errors.slice(0, 50) };
    });
    res.status(201).json({ message: `Imported ${result.imported} line(s), skipped ${result.skipped} duplicate(s)`, ...result });
  } catch (error) {
    sendError(res, error, 'Error importing bank statement');
  }
});

router.patch('/bank-transactions/:id', async (req, res) => {
  try {
    const existing = await db('bank_transactions').where({ id: req.params.id }).first();
    if (!existing) throw new LedgerError('Bank transaction not found', 404);
    if (existing.status === 'Reconciled') throw new LedgerError('Unreconcile this line before editing it');
    const data = cleanTx({ ...existing, ...pick(req.body, TX_FIELDS) });
    await db('bank_transactions').where({ id: req.params.id }).update({ ...data, updated_at: db.fn.now() });
    res.json({ message: 'Bank transaction updated' });
  } catch (error) {
    sendError(res, error, 'Error updating bank transaction');
  }
});

router.delete('/bank-transactions/:id', async (req, res) => {
  try {
    await db('bank_transactions').where({ id: req.params.id }).del();
    res.json({ message: 'Bank transaction deleted' });
  } catch (error) {
    sendError(res, error, 'Error deleting bank transaction');
  }
});

/** Ledger postings on the bank's ledger account with the same amount and direction, near the date, not yet matched. */
async function candidatesFor(tx: any, limit = 10) {
  const { account } = await bankLedgerAccount(db, tx.bank_account_id);
  const column = tx.type === 'Credit' ? 'le.debit' : 'le.credit';
  const date = toIsoDate(tx.date);
  const from = new Date(Date.parse(date) - MATCH_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
  const to = new Date(Date.parse(date) + MATCH_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
  const rows = await db('ledger_entries as le')
    .join('journal_entries as j', 'le.journal_id', 'j.id')
    .where('le.account_id', account.id)
    .where(column, Number(tx.amount))
    .whereBetween('j.date', [from, to])
    .whereNotExists(function () {
      this.select(db.raw('1')).from('bank_transactions as bt').whereRaw('bt.matched_ledger_id = j.id').whereNot('bt.id', tx.id);
    })
    .select('j.id as journal_id', 'j.date', 'j.description', 'j.reference_type', 'le.debit', 'le.credit')
    .orderByRaw('ABS(j.date - CAST(? AS DATE))', [date])
    .limit(limit);
  return rows;
}

router.get('/bank-transactions/:id/candidates', async (req, res) => {
  try {
    const tx = await db('bank_transactions').where({ id: req.params.id }).first();
    if (!tx) throw new LedgerError('Bank transaction not found', 404);
    res.json(await candidatesFor(tx));
  } catch (error) {
    sendError(res, error, 'Error finding matches');
  }
});

// Reconciles every unreconciled line that has exactly one candidate.
router.post('/bank-transactions/auto-match', async (req, res) => {
  try {
    const q = db('bank_transactions').where('status', '<>', 'Reconciled');
    if (req.body?.bank_account_id) q.where('bank_account_id', Number(req.body.bank_account_id));
    const open = await q.orderBy('date');
    let matched = 0;
    let unlinked = 0;
    const claimed = new Set<number>();
    for (const tx of open) {
      let candidates: any[];
      try {
        candidates = (await candidatesFor(tx, 2)).filter((c) => !claimed.has(c.journal_id));
      } catch {
        unlinked++;
        continue;
      }
      if (candidates.length !== 1) continue;
      claimed.add(candidates[0].journal_id);
      await db('bank_transactions').where({ id: tx.id }).update({ status: 'Reconciled', matched_ledger_id: candidates[0].journal_id, updated_at: db.fn.now() });
      matched++;
    }
    res.json({ message: `Matched ${matched} of ${open.length} open line(s)`, matched, open: open.length, unlinked });
  } catch (error) {
    sendError(res, error, 'Error auto-matching');
  }
});

// matched_ledger_id stores the journal entry id.
router.patch('/bank-transactions/:id/reconcile', async (req, res) => {
  try {
    const journalId = req.body?.matched_ledger_id ? Number(req.body.matched_ledger_id) : null;
    if (journalId) {
      const journal = await db('journal_entries').where({ id: journalId }).first();
      if (!journal) throw new LedgerError('Journal entry not found');
    }
    await db('bank_transactions').where({ id: req.params.id }).update({ status: 'Reconciled', matched_ledger_id: journalId, updated_at: db.fn.now() });
    res.json({ message: 'Transaction reconciled successfully' });
  } catch (error) {
    sendError(res, error, 'Error reconciling transaction');
  }
});

router.post('/bank-transactions/:id/unreconcile', async (req, res) => {
  try {
    await db('bank_transactions').where({ id: req.params.id }).update({ status: 'Unreconciled', matched_ledger_id: null, updated_at: db.fn.now() });
    res.json({ message: 'Transaction unreconciled' });
  } catch (error) {
    sendError(res, error, 'Error unreconciling transaction');
  }
});

// Posts a journal for a statement line with no ledger match (e.g. bank charges) and reconciles it.
router.post('/bank-transactions/:id/post', async (req, res) => {
  try {
    const counterAccountId = Number(req.body?.account_id);
    if (!counterAccountId) throw new LedgerError('Choose the account to post against');
    const journalId = await db.transaction(async (trx) => {
      const tx = await trx('bank_transactions').where({ id: req.params.id }).first();
      if (!tx) throw new LedgerError('Bank transaction not found', 404);
      if (tx.status === 'Reconciled') throw new LedgerError('This line is already reconciled');
      const { account } = await bankLedgerAccount(trx, tx.bank_account_id);
      const amount = round2(tx.amount);
      const id = await postJournal(trx, {
        date: tx.date,
        description: String(req.body?.description || tx.description),
        reference_type: 'manual',
        project_id: req.body?.project_id || null,
        lines: tx.type === 'Credit'
          ? [{ account_id: account.id, debit: amount }, { account_id: counterAccountId, credit: amount }]
          : [{ account_id: counterAccountId, debit: amount }, { account_id: account.id, credit: amount }],
      });
      await trx('bank_transactions').where({ id: tx.id }).update({ status: 'Reconciled', matched_ledger_id: id, updated_at: trx.fn.now() });
      return id;
    });
    res.status(201).json({ message: 'Posted to the ledger and reconciled', journal_id: journalId });
  } catch (error) {
    sendError(res, error, 'Error posting bank transaction');
  }
});

export default router;
