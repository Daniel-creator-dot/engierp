import { Router } from 'express';
import db from '../db';
import { authenticateToken, authorizeRole, AuthRequest } from '../middleware/auth';
import {
  JournalLine,
  LedgerError,
  assertBalanced,
  deleteJournal,
  getBooksClosedThrough,
  naturalBalance,
  postJournal,
  round2,
  sendError,
  toIsoDate,
  PERIOD_LOCK_KEY,
} from '../lib/ledger';
import { CREDIT_NOTE_METHOD, getAccountingConfig, getSettingValue, pick, saveSettingValue, statusFor } from '../lib/accounting';
import { createInvoice, recordPayment } from '../lib/accountingDocs';
import { createBillWithApprovalLimit, createRequest, notifyAdminsOfRequest, pendingRequestMap } from '../lib/approvals';
import reportsRouter from './accounting-reports';
import bankingRouter from './accounting-banking';
import extrasRouter from './accounting-extras';
import approvalsRouter from './accounting-approvals';

const router = Router();
const ACCOUNT_TYPES = ['Asset', 'Liability', 'Equity', 'Income', 'Expense'];
const EDITABLE_JOURNAL_TYPES = ['manual'];

// The whole finance module (ledger, invoices, bills, reports) is for admins and accountants only.
router.use(authenticateToken, authorizeRole(['admin', 'accountant']));

router.use(reportsRouter);
router.use(bankingRouter);
router.use(extrasRouter);
router.use(approvalsRouter);

/** Corrections, voids and credit notes go to an admin for approval instead of posting directly. */
async function submitRequest(req: AuthRequest, res: any, entity_type: string, entity_id: string, action: string, proposed: any = {}) {
  const out = await createRequest(req, { entity_type, entity_id, action, reason: req.body?.reason ?? req.query?.reason, proposed });
  res.status(out.applied ? 200 : 202).json({ ...out, pending: !out.applied });
}

const withPending = (rows: any[], map: Map<string, { id: number; action: string }>, key = 'id') =>
  rows.map((r) => ({ ...r, pending_request: map.get(String(r[key])) || null }));

// --- General ledger ---

function applyJournalFilters(query: any, params: any) {
  const { q, startDate, endDate, type, accountId } = params;
  if (startDate) query.where('j.date', '>=', String(startDate));
  if (endDate) query.where('j.date', '<=', String(endDate));
  if (type && type !== 'all') query.where('j.reference_type', String(type));
  if (accountId) {
    query.whereExists(function (this: any) {
      this.select(db.raw('1')).from('ledger_entries as lf').whereRaw('lf.journal_id = j.id').andWhere('lf.account_id', Number(accountId));
    });
  }
  if (q && String(q).trim()) {
    const term = `%${String(q).trim()}%`;
    query.where(function (this: any) {
      this.where('j.description', 'ilike', term)
        .orWhere('j.reference_id', 'ilike', term)
        .orWhereRaw('CAST(j.id AS VARCHAR) = ?', [String(q).trim()]);
    });
  }
  return query;
}

router.get('/transactions', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize) || 50));
    const base = applyJournalFilters(db('journal_entries as j'), req.query);

    const [{ count }] = await base.clone().count({ count: 'j.id' });
    const rows = await base.clone()
      .select(
        'j.id', 'j.date', 'j.description', 'j.reference_type', 'j.reference_id', 'j.project_id', 'j.status', 'j.reversed_by_journal_id', 'j.approval_request_id',
        db.raw('(SELECT COALESCE(SUM(le.debit), 0) FROM ledger_entries le WHERE le.journal_id = j.id) AS total_amount'),
        db.raw(`(SELECT string_agg(DISTINCT c.code || ' ' || c.name, ', ') FROM ledger_entries le JOIN chart_of_accounts c ON c.id = le.account_id WHERE le.journal_id = j.id) AS accounts`)
      )
      .orderBy([{ column: 'j.date', order: 'desc' }, { column: 'j.id', order: 'desc' }])
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    res.json({ rows: withPending(rows, await pendingRequestMap(db, 'journal')), total: Number(count), page, pageSize });
  } catch (error) {
    sendError(res, error, 'Error fetching transactions');
  }
});

// Line-level export of the filtered ledger.
router.get('/transactions/export', async (req, res) => {
  try {
    const journals = applyJournalFilters(db('journal_entries as j'), req.query).select('j.id');
    const rows = await db('ledger_entries as le')
      .join('journal_entries as j', 'le.journal_id', 'j.id')
      .join('chart_of_accounts as c', 'le.account_id', 'c.id')
      .whereIn('j.id', journals)
      .select('j.id as journal_id', 'j.date', 'j.description', 'j.reference_type', 'j.reference_id', 'j.project_id', 'c.code as account_code', 'c.name as account_name', 'le.debit', 'le.credit')
      .orderBy([{ column: 'j.date', order: 'desc' }, { column: 'j.id', order: 'desc' }, { column: 'le.id', order: 'asc' }])
      .limit(50000);
    res.json(rows);
  } catch (error) {
    sendError(res, error, 'Error exporting ledger');
  }
});

// --- Invoices (AR) ---

router.get('/invoices', async (req, res) => {
  try {
    const invoices = await db('invoices as i')
      .leftJoin('payments as p', function () {
        this.on('p.target_id', 'i.id').andOn('p.target_type', db.raw('?', ['Invoice']));
      })
      .select(
        'i.*',
        db.raw(`COALESCE(SUM(CASE WHEN p.method = ? THEN 0 ELSE p.amount END), 0) AS paid_amount`, [CREDIT_NOTE_METHOD]),
        db.raw(`COALESCE(SUM(CASE WHEN p.method = ? THEN p.amount ELSE 0 END), 0) AS credited_amount`, [CREDIT_NOTE_METHOD])
      )
      .groupBy('i.id')
      .orderBy('i.created_at', 'desc');

    const pending = await pendingRequestMap(db, 'invoice');
    res.json(invoices.map((inv: any) => {
      const amount = Number(inv.amount || 0);
      const paid = Number(inv.paid_amount || 0);
      const credited = Number(inv.credited_amount || 0);
      const isVoid = String(inv.status || '').toLowerCase() === 'void';
      return {
        ...inv,
        paid_amount: paid,
        credited_amount: credited,
        balance_due: isVoid ? 0 : Math.max(0, round2(amount - paid - credited)),
        status: statusFor(amount, paid + credited, inv.status),
        pending_request: pending.get(String(inv.id)) || null,
      };
    }));
  } catch (error) {
    sendError(res, error, 'Error fetching invoices');
  }
});

router.post('/invoices', async (req, res) => {
  try {
    const body = pick(req.body, ['client', 'project_id', 'date', 'dueDate', 'items', 'apply_tax'] as const);
    let items = body.items;
    if (typeof items === 'string') {
      try { items = JSON.parse(items); } catch { items = []; }
    }
    const result = await db.transaction((trx) => createInvoice(trx, { ...body, items, apply_tax: body.apply_tax !== false && body.apply_tax !== 'false' }));
    res.status(201).json(result);
  } catch (error) {
    sendError(res, error, 'Error creating invoice');
  }
});

router.post('/invoices/:id/void', async (req: AuthRequest, res) => {
  try {
    await submitRequest(req, res, 'invoice', req.params.id, 'void', { date: req.body?.date });
  } catch (error) {
    sendError(res, error, 'Error requesting invoice void');
  }
});

router.get('/invoices/:id/credit-notes', async (req, res) => {
  try {
    res.json(await db('credit_notes').where({ invoice_id: req.params.id }).orderBy('date'));
  } catch (error) {
    sendError(res, error, 'Error fetching credit notes');
  }
});

router.post('/invoices/:id/credit-notes', async (req: AuthRequest, res) => {
  try {
    const { date, amount } = pick(req.body, ['date', 'amount'] as const);
    await submitRequest(req, res, 'invoice', req.params.id, 'credit_note', { date, amount });
  } catch (error) {
    sendError(res, error, 'Error requesting credit note');
  }
});

// Taxes (legacy table)
router.get('/taxes', async (req, res) => {
  try {
    res.json(await db('taxes').select('*'));
  } catch (error) {
    sendError(res, error, 'Error fetching tax records');
  }
});

// --- Chart of accounts ---

router.get('/coa', async (req, res) => {
  try {
    const coa = await db('chart_of_accounts').orderBy('code', 'asc');
    res.json(coa.map((a: any) => ({ ...a, natural_balance: naturalBalance(a.type, a.balance) })));
  } catch (error) {
    sendError(res, error, 'Error fetching COA');
  }
});

function validateAccountFields(data: any, partial: boolean) {
  if (!partial || data.code !== undefined) {
    data.code = String(data.code || '').trim();
    if (!data.code) throw new LedgerError('Account code is required');
  }
  if (!partial || data.name !== undefined) {
    data.name = String(data.name || '').trim();
    if (!data.name) throw new LedgerError('Account name is required');
  }
  if (!partial || data.type !== undefined) {
    if (!ACCOUNT_TYPES.includes(data.type)) throw new LedgerError(`Account type must be one of ${ACCOUNT_TYPES.join(', ')}`);
  }
  return data;
}

router.post('/coa', async (req, res) => {
  try {
    const data = validateAccountFields(pick(req.body, ['code', 'name', 'type'] as const), false);
    const clash = await db('chart_of_accounts').where({ code: data.code }).first();
    if (clash) throw new LedgerError(`Account code ${data.code} is already used by ${clash.name}`);
    const [created] = await db('chart_of_accounts').insert({ ...data, balance: 0 }).returning('*');
    res.status(201).json(created);
  } catch (error) {
    sendError(res, error, 'Error creating account');
  }
});

router.patch('/coa/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const data = validateAccountFields(pick(req.body, ['code', 'name', 'type'] as const), true);
    if (Object.keys(data).length === 0) throw new LedgerError('Nothing to update');
    if (data.code) {
      const clash = await db('chart_of_accounts').where({ code: data.code }).whereNot({ id }).first();
      if (clash) throw new LedgerError(`Account code ${data.code} is already used by ${clash.name}`);
    }
    await db('chart_of_accounts').where({ id }).update({ ...data, updated_at: db.fn.now() });
    res.json({ message: 'Account updated' });
  } catch (error) {
    sendError(res, error, 'Error updating account');
  }
});

router.delete('/coa/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const inUse = await db('ledger_entries').where({ account_id: id }).first();
    if (inUse) throw new LedgerError('Cannot delete account because it is used in ledger entries');
    await db('chart_of_accounts').where({ id }).del();
    res.json({ message: 'Account deleted' });
  } catch (error) {
    sendError(res, error, 'Error deleting account');
  }
});

// --- Manual journals ---

function journalLinesFrom(body: any): JournalLine[] {
  const items = Array.isArray(body?.items) ? body.items : [];
  return items
    .filter((i: any) => i && i.account_id !== '' && i.account_id != null)
    .map((i: any) => ({ account_id: Number(i.account_id), debit: round2(i.debit), credit: round2(i.credit) }));
}

async function findDuplicateJournal(date: string, description: string, total: number, excludeId?: number | string) {
  const q = db('journal_entries as j')
    .where('j.date', date)
    .whereRaw('LOWER(TRIM(j.description)) = LOWER(TRIM(?))', [description])
    .whereRaw('(SELECT COALESCE(SUM(le.debit), 0) FROM ledger_entries le WHERE le.journal_id = j.id) = ?', [total])
    .select('j.id');
  if (excludeId) q.whereNot('j.id', excludeId);
  return q.first();
}

router.post('/journal', async (req, res) => {
  try {
    const description = String(req.body?.description || '').trim();
    if (!description) throw new LedgerError('Description is required');
    const date = toIsoDate(req.body?.date);
    const lines = journalLinesFrom(req.body);
    const total = assertBalanced(lines);

    if (!req.body?.force) {
      const dup = await findDuplicateJournal(date, description, total);
      if (dup) {
        return res.status(409).json({ duplicate: true, journal_id: dup.id, message: `Journal #${dup.id} already has the same date, description and amount. Post anyway?` });
      }
    }

    const journalId = await db.transaction((trx) =>
      postJournal(trx, { date, description, reference_type: 'manual', project_id: req.body?.project_id || null, lines })
    );
    res.status(201).json({ message: 'Journal entry posted successfully', id: journalId });
  } catch (error) {
    sendError(res, error, 'Error posting journal entry');
  }
});

router.get('/journal/:id', async (req, res) => {
  try {
    const header = await db('journal_entries').where({ id: req.params.id }).first();
    if (!header) throw new LedgerError('Journal entry not found', 404);
    const items = await db('ledger_entries as le')
      .join('chart_of_accounts as c', 'le.account_id', 'c.id')
      .where('le.journal_id', req.params.id)
      .select('le.*', 'c.code as account_code', 'c.name as account_name', 'c.type as account_type')
      .orderBy('le.id');
    const pending = await db('approval_requests').where({ entity_type: 'journal', entity_id: String(header.id), status: 'pending' }).first('id', 'action');
    res.json({
      ...header,
      items,
      editable: EDITABLE_JOURNAL_TYPES.includes(header.reference_type) && header.status !== 'reversed',
      pending_request: pending || null,
    });
  } catch (error) {
    sendError(res, error, 'Error fetching journal details');
  }
});

// Changing or removing a posted journal is a correction/void request that an admin approves.
router.put('/journal/:id', async (req: AuthRequest, res) => {
  try {
    const description = String(req.body?.description || '').trim();
    if (!description) throw new LedgerError('Description is required');
    const lines = journalLinesFrom(req.body);
    assertBalanced(lines);
    await submitRequest(req, res, 'journal', req.params.id, 'correct', { date: req.body?.date, description, project_id: req.body?.project_id || null, lines });
  } catch (error) {
    sendError(res, error, 'Error requesting journal correction');
  }
});

router.delete('/journal/:id', async (req: AuthRequest, res) => {
  try {
    await submitRequest(req, res, 'journal', req.params.id, 'void');
  } catch (error) {
    sendError(res, error, 'Error requesting journal void');
  }
});

// Account drill-down
router.get('/ledger-entries/:accountId', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const query = db('ledger_entries')
      .join('journal_entries', 'ledger_entries.journal_id', 'journal_entries.id')
      .where('ledger_entries.account_id', req.params.accountId)
      .select(
        'ledger_entries.journal_id',
        'journal_entries.date',
        'journal_entries.description',
        'journal_entries.reference_type',
        'journal_entries.reference_id',
        'ledger_entries.debit',
        'ledger_entries.credit'
      )
      .orderBy([{ column: 'journal_entries.date', order: 'desc' }, { column: 'journal_entries.id', order: 'desc' }]);
    if (startDate) query.where('journal_entries.date', '>=', String(startDate));
    if (endDate) query.where('journal_entries.date', '<=', String(endDate));
    res.json(await query);
  } catch (error) {
    sendError(res, error, 'Error fetching ledger entries');
  }
});

// --- Bills (AP) ---

router.get('/bills', async (req, res) => {
  try {
    const bills = await db('bills as b')
      .join('suppliers', 'b.supplier_id', 'suppliers.id')
      .leftJoin('payments as p', function () {
        this.on('p.target_id', db.raw('CAST(b.id AS VARCHAR)')).andOn('p.target_type', db.raw('?', ['Bill']));
      })
      .select(
        'b.*',
        'suppliers.name as supplier_name',
        db.raw('COALESCE(SUM(p.amount), 0) as paid_amount'),
        db.raw('COALESCE(SUM(p.wht_amount), 0) as wht_amount')
      )
      .groupBy('b.id', 'suppliers.name')
      .orderBy('b.due_date', 'asc');

    const pending = await pendingRequestMap(db, 'bill');
    res.json(bills.map((bill: any) => {
      const amount = Number(bill.amount || 0);
      const paid = Number(bill.paid_amount || 0);
      const status = statusFor(amount, paid, bill.status);
      return {
        ...bill,
        paid_amount: paid,
        wht_amount: Number(bill.wht_amount || 0),
        balance_due: status === 'void' || status === 'pending_approval' ? 0 : Math.max(0, round2(amount - paid)),
        status,
        pending_request: pending.get(String(bill.id)) || null,
      };
    }));
  } catch (error) {
    sendError(res, error, 'Error fetching bills');
  }
});

router.post('/bills', async (req: AuthRequest, res) => {
  try {
    const body = pick(req.body, ['supplier_id', 'quantity', 'unit_price', 'amount', 'date', 'due_date', 'category', 'project_id', 'account_id', 'reference', 'description'] as const);
    if (!body.supplier_id || !body.account_id) throw new LedgerError('Supplier and account are required');
    const result = await db.transaction((trx) => createBillWithApprovalLimit(trx, body as any, req));
    if (result.request) await notifyAdminsOfRequest(result.request);
    res.status(201).json({
      message: result.request
        ? 'Bill saved and sent for admin approval. It will post to the ledger once approved.'
        : 'Bill recorded and posted to ledger',
      ...result,
    });
  } catch (error) {
    sendError(res, error, 'Error recording bill');
  }
});

router.post('/bills/:id/void', async (req: AuthRequest, res) => {
  try {
    await submitRequest(req, res, 'bill', req.params.id, 'void', { date: req.body?.date });
  } catch (error) {
    sendError(res, error, 'Error requesting bill void');
  }
});

// --- Payments ---

router.get('/payments', async (req, res) => {
  try {
    const q = db('payments').orderBy([{ column: 'date', order: 'desc' }, { column: 'id', order: 'desc' }]);
    const targetType = req.query.target_type ? String(req.query.target_type) : '';
    if (targetType && req.query.include_void) {
      q.where((w) => w.where('target_type', targetType).orWhere((v) => v.where('target_type', 'Void').where('original_target_type', targetType)));
    } else if (targetType) {
      q.where('target_type', targetType);
    }
    if (req.query.target_id) q.where('target_id', String(req.query.target_id));
    res.json(withPending(await q.limit(1000), await pendingRequestMap(db, 'payment')));
  } catch (error) {
    sendError(res, error, 'Error fetching payments');
  }
});

router.post('/payments', async (req, res) => {
  try {
    const body = pick(req.body, ['payment_id', 'date', 'amount', 'method', 'reference', 'target_type', 'target_id', 'bank_account_id', 'wht_rate'] as const);
    const result = await db.transaction((trx) => recordPayment(trx, body as any));
    res.status(201).json({ message: 'Payment recorded successfully', ...result });
  } catch (error) {
    sendError(res, error, 'Error recording payment');
  }
});

// --- Opening balances ---

async function openingBalanceState(asOf?: string) {
  const journal = await db('journal_entries').where({ reference_type: 'opening_balance' }).orderBy('id', 'desc').first();
  const lines = journal
    ? await db('ledger_entries as le').join('chart_of_accounts as c', 'le.account_id', 'c.id').where('le.journal_id', journal.id)
        .select('le.account_id', 'c.type', 'c.code', 'le.debit', 'le.credit')
    : [];
  const date = asOf || (journal ? toIsoDate(journal.date) : null);
  const others = db('journal_entries').whereNot('reference_type', 'opening_balance');
  const [before] = date ? await others.clone().where('date', '<=', date).count({ n: 'id' }) : [{ n: 0 }];
  const [after] = date ? await others.clone().where('date', '>', date).count({ n: 'id' }) : await others.clone().count({ n: 'id' });
  return {
    journal: journal ? { id: journal.id, date: toIsoDate(journal.date) } : null,
    balances: lines
      .filter((l: any) => l.code !== '3900')
      .map((l: any) => ({ account_id: l.account_id, amount: naturalBalance(l.type, Number(l.debit) - Number(l.credit)) })),
    entries_on_or_before: Number(before.n),
    entries_after: Number(after.n),
  };
}

router.get('/opening-balances', async (req, res) => {
  try {
    res.json(await openingBalanceState(req.query.date ? toIsoDate(String(req.query.date)) : undefined));
  } catch (error) {
    sendError(res, error, 'Error loading opening balances');
  }
});

// Replaces the single opening-balance journal. Amounts are entered with their natural sign.
router.post('/opening-balances', async (req, res) => {
  try {
    const { balances, date } = req.body || {};
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new LedgerError('Choose the as-of date for the opening balances');
    const entries = (Array.isArray(balances) ? balances : [])
      .map((b: any) => ({ account_id: Number(b.account_id), amount: round2(b.amount ?? b.balance) }))
      .filter((b: any) => b.account_id && b.amount !== 0);

    const journalId = await db.transaction(async (trx) => {
      const obe = await trx('chart_of_accounts').where({ code: '3900' }).first();
      if (!obe) throw new LedgerError('Opening Balance Equity account (3900) is missing');

      const accounts = await trx('chart_of_accounts').whereIn('id', entries.map((e: any) => e.account_id));
      const byId = new Map(accounts.map((a: any) => [a.id, a]));
      const lines: JournalLine[] = [];
      let net = 0;
      for (const e of entries) {
        const acc: any = byId.get(e.account_id);
        if (!acc || acc.id === obe.id) continue;
        const debitMinusCredit = ['Asset', 'Expense'].includes(acc.type) ? e.amount : -e.amount;
        lines.push(debitMinusCredit > 0 ? { account_id: acc.id, debit: debitMinusCredit } : { account_id: acc.id, credit: -debitMinusCredit });
        net = round2(net + debitMinusCredit);
      }
      if (net > 0) lines.push({ account_id: obe.id, credit: net });
      else if (net < 0) lines.push({ account_id: obe.id, debit: -net });

      const existing = await trx('journal_entries').where({ reference_type: 'opening_balance' });
      for (const j of existing) await deleteJournal(trx, j.id);
      if (lines.length === 0) return null;
      return postJournal(trx, { date, description: `Opening Balances as of ${date}`, reference_type: 'opening_balance', lines });
    });
    res.status(201).json({ message: journalId ? 'Opening balances posted' : 'Opening balances cleared', journal_id: journalId });
  } catch (error) {
    sendError(res, error, 'Error posting opening balances');
  }
});

// --- Settings ---

router.get('/settings/fiscal-year', async (req, res) => {
  try {
    const value = await getSettingValue(db, 'fiscal_year');
    res.json(value ? JSON.parse(value) : { startMonth: 1, startDay: 1 });
  } catch (error) {
    sendError(res, error, 'Error fetching fiscal year settings');
  }
});

router.post('/settings/fiscal-year', async (req, res) => {
  try {
    const startMonth = Math.min(12, Math.max(1, Number(req.body?.startMonth) || 1));
    const startDay = Math.min(31, Math.max(1, Number(req.body?.startDay) || 1));
    await saveSettingValue(db, 'fiscal_year', JSON.stringify({ startMonth, startDay }));
    res.json({ message: 'Fiscal year settings updated' });
  } catch (error) {
    sendError(res, error, 'Error updating fiscal year settings');
  }
});

router.get('/settings/tax', async (req, res) => {
  try {
    const config = await getAccountingConfig(db);
    res.json({ tax_components: config.tax_components, default_income_account_id: config.default_income_account_id, wht_rate: config.wht_rate });
  } catch (error) {
    sendError(res, error, 'Error loading tax settings');
  }
});

router.put('/settings/tax', async (req, res) => {
  try {
    const current = await getAccountingConfig(db);
    const components = (Array.isArray(req.body?.tax_components) ? req.body.tax_components : []).map((c: any) => ({
      code: String(c.code || '').trim().toUpperCase(),
      name: String(c.name || '').trim(),
      rate: round2(c.rate),
      account_code: String(c.account_code || '').trim(),
    }));
    for (const c of components) {
      if (!c.code || !c.name || !c.account_code) throw new LedgerError('Each tax needs a code, name and liability account');
      if (c.rate < 0 || c.rate > 100) throw new LedgerError(`${c.name} rate must be between 0 and 100`);
      const acc = await db('chart_of_accounts').where({ code: c.account_code }).first();
      if (!acc || acc.type !== 'Liability') throw new LedgerError(`${c.name}: account ${c.account_code} must be an existing liability account`);
    }
    const next = {
      ...current,
      tax_components: components,
      sales_tax_rate: String(round2(components.reduce((s: number, c: any) => s + c.rate, 0))),
      tax_name: components.map((c: any) => c.name).join(' + ') || 'No tax',
      default_income_account_id: req.body?.default_income_account_id ? Number(req.body.default_income_account_id) : null,
      wht_rate: req.body?.wht_rate !== undefined ? round2(req.body.wht_rate) : current.wht_rate,
    };
    await saveSettingValue(db, 'accounting_config', JSON.stringify(next));
    res.json({ message: 'Tax settings saved' });
  } catch (error) {
    sendError(res, error, 'Error saving tax settings');
  }
});

router.get('/settings/period-lock', async (req, res) => {
  try {
    res.json({ closed_through: await getBooksClosedThrough(db) });
  } catch (error) {
    sendError(res, error, 'Error loading period lock');
  }
});

// Accountants can move the lock forward; only admins can reopen a closed period.
router.put('/settings/period-lock', async (req: AuthRequest, res) => {
  try {
    const value = req.body?.closed_through ? String(req.body.closed_through) : '';
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new LedgerError('Use a YYYY-MM-DD date');
    const current = await getBooksClosedThrough(db);
    const reopening = current && (!value || value < current);
    if (reopening && req.user?.role !== 'admin') throw new LedgerError('Only an admin can reopen a closed period', 403);
    await saveSettingValue(db, PERIOD_LOCK_KEY, value);
    res.json({ message: value ? `Books closed through ${value}` : 'Period lock removed', closed_through: value || null });
  } catch (error) {
    sendError(res, error, 'Error saving period lock');
  }
});

export default router;
