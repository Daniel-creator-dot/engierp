import type { Knex } from 'knex';
import { JournalLine, LedgerError, assertPeriodOpen, openPostingDate, postJournal, reverseJournal, round2, toIsoDate } from './ledger';
import {
  CREDIT_NOTE_METHOD,
  bankLedgerAccount,
  cashOnHandAccount,
  defaultIncomeAccount,
  getAccountingConfig,
  nextDocNumber,
  paidOn,
  payableAccount,
  receivableAccount,
  statusFor,
  whtPayableAccount,
  whtReceivableAccount,
} from './accounting';

/** Links postings made while applying an approved request back to that request. */
export interface ApprovalContext {
  requestId?: number | null;
}

const correctionNote = (ctx: ApprovalContext, shifted: boolean, date: string) =>
  `${ctx.requestId ? ` [approval #${ctx.requestId}]` : ''}${shifted ? ` [original period closed; posted ${date}]` : ''}`;

/** The document's current (not reversed) posting, if it has one. */
export async function sourceJournal(trx: Knex.Transaction, referenceType: string, referenceId: string | number) {
  return trx('journal_entries')
    .where({ reference_type: referenceType, reference_id: String(referenceId) })
    .whereNull('status')
    .orderBy('id', 'desc')
    .first();
}

/** Reverses a journal as part of a correction, on the first open date if its own period is closed. */
async function reverseForCorrection(trx: Knex.Transaction, journal: any, description: string, ctx: ApprovalContext) {
  const { date, shifted } = await openPostingDate(trx, journal.date);
  return reverseJournal(trx, journal.id, {
    date,
    description: `REVERSAL of #${journal.id}: ${description}${correctionNote(ctx, shifted, date)}`,
    reference_type: 'reversal',
    reference_id: journal.reference_id,
    approval_request_id: ctx.requestId,
  });
}

async function unreconcileJournal(trx: Knex.Transaction, journalId: number) {
  await trx('bank_transactions').where({ matched_ledger_id: journalId }).update({ status: 'Unreconciled', matched_ledger_id: null, updated_at: trx.fn.now() });
}

// --- Invoices ---

export interface InvoiceItemInput {
  description?: string;
  quantity?: number | string;
  unitPrice?: number | string;
  service_id?: number | string | null;
}

export interface InvoiceInput {
  client?: string;
  project_id?: string | null;
  date?: string;
  dueDate?: string;
  items: InvoiceItemInput[];
  apply_tax?: boolean;
}

/** Validates an invoice and works out its revenue split, taxes and total without writing anything. */
export async function buildInvoice(trx: Knex.Transaction, input: InvoiceInput) {
  let rawItems: any = input.items;
  if (typeof rawItems === 'string') {
    try { rawItems = JSON.parse(rawItems); } catch { rawItems = []; }
  }
  const items = (Array.isArray(rawItems) ? rawItems : [])
    .map((it: InvoiceItemInput) => ({
      description: String(it.description || '').trim(),
      quantity: Number(it.quantity) || 0,
      unitPrice: Number(it.unitPrice) || 0,
      service_id: it.service_id ? Number(it.service_id) : null,
    }))
    .filter((it) => it.description && it.quantity > 0);
  if (items.length === 0) throw new LedgerError('Add at least one line item with a description and quantity');
  if (items.some((it) => it.unitPrice < 0)) throw new LedgerError('Unit prices cannot be negative');

  let client = String(input.client || '').trim();
  const projectId = input.project_id && input.project_id !== 'none' ? String(input.project_id) : null;
  if (projectId) {
    const project = await trx('projects').where({ id: projectId }).first();
    if (!project) throw new LedgerError('Project not found');
    client = client || project.client || '';
  }
  if (!client) throw new LedgerError('Client is required');

  const date = toIsoDate(input.date);
  const dueDate = input.dueDate ? toIsoDate(input.dueDate) : date;
  const config = await getAccountingConfig(trx);
  const fallbackIncome = await defaultIncomeAccount(trx, config);

  // Revenue account per line: the service category's income account, else the default.
  const revenueByAccount = new Map<number, number>();
  for (const item of items) {
    let accountId = fallbackIncome.id;
    if (item.service_id) {
      const linked = await trx('services as s')
        .join('categories as c', 's.category_id', 'c.id')
        .join('chart_of_accounts as a', 'c.account_id', 'a.id')
        .where('s.id', item.service_id)
        .where('a.type', 'Income')
        .select('a.id')
        .first();
      if (linked) accountId = linked.id;
    }
    revenueByAccount.set(accountId, round2((revenueByAccount.get(accountId) || 0) + item.quantity * item.unitPrice));
  }
  const subtotal = round2([...revenueByAccount.values()].reduce((s, v) => s + v, 0));
  if (subtotal <= 0) throw new LedgerError('Invoice total must be greater than zero');

  const applyTax = input.apply_tax !== false && (input.apply_tax as any) !== 'false';
  const breakdown: { code: string; name: string; rate: number; amount: number; account_id: number }[] = [];
  if (applyTax) {
    for (const comp of config.tax_components) {
      if (!comp.rate) continue;
      const acc = await trx('chart_of_accounts').where({ code: comp.account_code }).first();
      if (!acc) throw new LedgerError(`Tax account ${comp.account_code} for ${comp.name} is missing from the chart of accounts`);
      breakdown.push({ code: comp.code, name: comp.name, rate: comp.rate, amount: round2(subtotal * comp.rate / 100), account_id: acc.id });
    }
  }
  const taxAmount = round2(breakdown.reduce((s, b) => s + b.amount, 0));
  const total = round2(subtotal + taxAmount);
  return { client, projectId, date, dueDate, items, subtotal, breakdown, taxAmount, total, revenueByAccount, applyTax };
}

type BuiltInvoice = Awaited<ReturnType<typeof buildInvoice>>;

const invoiceColumns = (b: BuiltInvoice) => ({
  client: b.client,
  project_id: b.projectId,
  date: b.date,
  dueDate: b.dueDate,
  items: JSON.stringify(b.items),
  subtotal: b.subtotal,
  tax_amount: b.taxAmount,
  tax_rate: round2(b.breakdown.reduce((s, x) => s + x.rate, 0)),
  tax_name: b.breakdown.length ? b.breakdown.map((x) => `${x.name} ${x.rate}%`).join(' + ') : 'No tax',
  tax_breakdown: JSON.stringify(b.breakdown),
  amount: b.total,
});

async function postInvoiceJournal(trx: Knex.Transaction, id: string, b: BuiltInvoice, date: string, suffix: string, ctx: ApprovalContext = {}) {
  const ar = await receivableAccount(trx);
  const lines: JournalLine[] = [{ account_id: ar.id, debit: b.total }];
  for (const [accountId, amount] of b.revenueByAccount) lines.push({ account_id: accountId, credit: amount });
  for (const x of b.breakdown) lines.push({ account_id: x.account_id, credit: x.amount });
  return postJournal(trx, {
    date,
    description: `Sales Invoice ${id} - ${b.client}${suffix}`,
    reference_type: 'invoice',
    reference_id: id,
    project_id: b.projectId,
    lines,
    approval_request_id: ctx.requestId,
  });
}

export async function createInvoice(trx: Knex.Transaction, input: InvoiceInput) {
  const b = await buildInvoice(trx, input);
  const id = await nextDocNumber(trx, 'invoices', 'id', 'INV', b.date);
  await trx('invoices').insert({ id, ...invoiceColumns(b), status: 'unpaid' });
  const journalId = await postInvoiceJournal(trx, id, b, b.date, '');
  return { id, amount: b.total, subtotal: b.subtotal, tax_amount: b.taxAmount, journal_id: journalId };
}

export async function correctInvoice(trx: Knex.Transaction, id: string, input: InvoiceInput, ctx: ApprovalContext = {}) {
  const invoice = await trx('invoices').where({ id }).first();
  if (!invoice) throw new LedgerError('Invoice not found', 404);
  if (String(invoice.status).toLowerCase() === 'void') throw new LedgerError('Invoice is void');
  const b = await buildInvoice(trx, input);
  const settled = await paidOn(trx, 'Invoice', id);
  if (b.total < settled.total - 0.005) throw new LedgerError(`The corrected total (${b.total.toFixed(2)}) is less than what has already been paid or credited (${settled.total.toFixed(2)})`);

  const journalIds: number[] = [];
  const original = await sourceJournal(trx, 'invoice', id);
  if (original) journalIds.push(await reverseForCorrection(trx, original, `Sales Invoice ${id}`, ctx));
  const { date, shifted } = await openPostingDate(trx, b.date);
  journalIds.push(await postInvoiceJournal(trx, id, b, date, ` (corrected)${correctionNote(ctx, shifted, date)}`, ctx));
  await trx('invoices').where({ id }).update({ ...invoiceColumns(b), status: statusFor(b.total, settled.total) });
  return { journal_ids: journalIds, amount: b.total, subtotal: b.subtotal, tax_amount: b.taxAmount };
}

// --- Bills ---

export interface BillInput {
  supplier_id: string;
  quantity?: number | string;
  unit_price?: number | string;
  amount?: number | string;
  date?: string;
  due_date?: string;
  category?: string;
  project_id?: string | null;
  account_id: number | string;
  reference?: string;
  description?: string;
}

export async function buildBill(trx: Knex.Transaction, input: BillInput) {
  const supplier = await trx('suppliers').where({ id: input.supplier_id }).first();
  if (!supplier) throw new LedgerError('Supplier not found');
  const account = await trx('chart_of_accounts').where({ id: Number(input.account_id) }).first();
  if (!account || !['Expense', 'Asset'].includes(account.type)) throw new LedgerError('Choose an expense or asset account for the bill');

  const quantity = input.quantity !== undefined && input.quantity !== '' && input.quantity !== null ? Number(input.quantity) : 1;
  const unitPrice = input.unit_price !== undefined && input.unit_price !== '' && input.unit_price !== null ? Number(input.unit_price) : Number(input.amount || 0);
  const amount = round2(quantity * unitPrice);
  if (!(quantity > 0) || !(amount > 0)) throw new LedgerError('Bill amount must be greater than zero');

  const date = toIsoDate(input.date);
  const dueDate = input.due_date ? toIsoDate(input.due_date) : date;
  return {
    supplier,
    account,
    columns: {
      supplier_id: supplier.id,
      quantity,
      unit_price: unitPrice,
      amount,
      date,
      due_date: dueDate,
      category: input.category || account.name,
      project_id: input.project_id && input.project_id !== 'none' ? String(input.project_id) : null,
      account_id: account.id,
      reference: input.reference || null,
      description: input.description || null,
    },
  };
}

/** Dr expense/asset, Cr Accounts Payable for a bill row. */
export async function postBillJournal(trx: Knex.Transaction, bill: any, date: string, suffix = '', ctx: ApprovalContext = {}) {
  const supplier = await trx('suppliers').where({ id: bill.supplier_id }).first();
  const ap = await payableAccount(trx);
  return postJournal(trx, {
    date,
    description: `Vendor Bill ${bill.id}: ${supplier?.name || bill.supplier_id} - ${bill.category || 'Bill'}${bill.reference ? ` (${bill.reference})` : ''}${suffix}`,
    reference_type: 'bill',
    reference_id: bill.id,
    project_id: bill.project_id || null,
    lines: [
      { account_id: Number(bill.account_id), debit: round2(bill.amount) },
      { account_id: ap.id, credit: round2(bill.amount) },
    ],
    approval_request_id: ctx.requestId,
  });
}

/** Saves a bill. With `pending`, it waits for approval and posts nothing to the ledger. */
export async function createBill(trx: Knex.Transaction, input: BillInput, opts: { pending?: boolean } = {}) {
  const { columns } = await buildBill(trx, input);
  if (opts.pending) await assertPeriodOpen(trx, columns.date);
  const [inserted] = await trx('bills').insert({ ...columns, status: opts.pending ? 'pending_approval' : 'unpaid' }).returning('id');
  const billId = typeof inserted === 'object' ? inserted.id : inserted;
  const journalId = opts.pending ? null : await postBillJournal(trx, { ...columns, id: billId }, columns.date);
  return { id: billId, amount: columns.amount, journal_id: journalId, pending: !!opts.pending };
}

/** Posts a bill that was waiting for approval. */
export async function approvePendingBill(trx: Knex.Transaction, id: number, ctx: ApprovalContext = {}) {
  const bill = await trx('bills').where({ id }).first();
  if (!bill) throw new LedgerError('Bill not found', 404);
  if (bill.status !== 'pending_approval') throw new LedgerError('This bill is not waiting for approval');
  const { date, shifted } = await openPostingDate(trx, bill.date || bill.created_at);
  const journalId = await postBillJournal(trx, bill, date, correctionNote(ctx, shifted, date), ctx);
  await trx('bills').where({ id }).update({ status: 'unpaid', updated_at: trx.fn.now() });
  return { journal_ids: [journalId] };
}

export async function correctBill(trx: Knex.Transaction, id: number, input: BillInput, ctx: ApprovalContext = {}) {
  const bill = await trx('bills').where({ id }).first();
  if (!bill) throw new LedgerError('Bill not found', 404);
  const status = String(bill.status).toLowerCase();
  if (status === 'void') throw new LedgerError('Bill is void');
  if (status === 'pending_approval') throw new LedgerError('This bill is still waiting for approval');
  const { columns } = await buildBill(trx, input);
  const settled = await paidOn(trx, 'Bill', id);
  if (columns.amount < settled.total - 0.005) throw new LedgerError(`The corrected amount (${columns.amount.toFixed(2)}) is less than what has already been paid (${settled.total.toFixed(2)})`);

  const journalIds: number[] = [];
  const original = await sourceJournal(trx, 'bill', id);
  if (original) journalIds.push(await reverseForCorrection(trx, original, `Vendor Bill ${id}`, ctx));
  const { date, shifted } = await openPostingDate(trx, columns.date);
  journalIds.push(await postBillJournal(trx, { ...columns, id }, date, ` (corrected)${correctionNote(ctx, shifted, date)}`, ctx));
  await trx('bills').where({ id }).update({ ...columns, status: statusFor(columns.amount, settled.total), updated_at: trx.fn.now() });
  return { journal_ids: journalIds, amount: columns.amount };
}

// --- Payments ---

export interface PaymentInput {
  payment_id?: string;
  date?: string;
  amount: number | string;
  method?: string;
  reference?: string;
  target_type: 'Invoice' | 'Bill';
  target_id: string | number;
  bank_account_id?: number | string | null;
  wht_rate?: number | string | null;
}

async function refreshTargetStatus(trx: Knex.Transaction, targetType: string, targetId: string | number) {
  if (targetType === 'Invoice') {
    const inv = await trx('invoices').where({ id: String(targetId) }).first();
    if (inv) await trx('invoices').where({ id: inv.id }).update({ status: statusFor(Number(inv.amount), (await paidOn(trx, 'Invoice', inv.id)).total, inv.status) });
  } else if (targetType === 'Bill') {
    const bill = await trx('bills').where({ id: Number(targetId) || -1 }).first();
    if (bill) await trx('bills').where({ id: bill.id }).update({ status: statusFor(Number(bill.amount), (await paidOn(trx, 'Bill', bill.id)).total, bill.status) });
  }
}

/**
 * Records a payment and posts it. With `existingRowId` (an approved correction) the existing
 * payment row is rewritten in place so it keeps its payment number.
 */
export async function recordPayment(trx: Knex.Transaction, input: PaymentInput, opts: { existingRowId?: number; ctx?: ApprovalContext; suffix?: string } = {}) {
  const amount = round2(input.amount);
  const method = String(input.method || '').trim();
  if (!(amount > 0)) throw new LedgerError('Payment amount must be greater than 0');
  if (!['Invoice', 'Bill'].includes(input.target_type) || !input.target_id) throw new LedgerError('target_type and target_id are required');
  if (!method) throw new LedgerError('Payment method is required');
  if (method === CREDIT_NOTE_METHOD) throw new LedgerError('Use the credit note action to credit an invoice');
  if (method !== 'Cash' && !input.bank_account_id) throw new LedgerError('bank_account_id is required for non-cash payments');
  if (method !== 'Cash' && !String(input.reference || '').trim()) throw new LedgerError('reference is required for non-cash payments');

  const isInvoice = input.target_type === 'Invoice';
  const targetId = String(input.target_id);
  const target = isInvoice
    ? await trx('invoices').where({ id: targetId }).first()
    : await trx('bills').where({ id: Number(targetId) || -1 }).first();
  if (!target) throw new LedgerError(`${input.target_type} not found`, 404);
  const targetStatus = String(target.status || '').toLowerCase();
  if (targetStatus === 'void') throw new LedgerError(`This ${input.target_type.toLowerCase()} is void`);
  if (targetStatus === 'pending_approval') throw new LedgerError('This bill is waiting for admin approval and cannot be paid yet');
  if (!opts.existingRowId) {
    const pendingVoid = await trx('approval_requests').where({ entity_type: input.target_type.toLowerCase(), entity_id: targetId, status: 'pending', action: 'void' }).first();
    if (pendingVoid) throw new LedgerError(`A request to void this ${input.target_type.toLowerCase()} is waiting for approval`);
  }

  const settled = await paidOn(trx, input.target_type, targetId);
  const balanceDue = round2(Number(target.amount) - settled.total);
  if (amount > balanceDue + 0.01) throw new LedgerError(`Payment exceeds the balance due (${balanceDue.toFixed(2)})`);

  const moneyAccount = method === 'Cash' ? await cashOnHandAccount(trx) : (await bankLedgerAccount(trx, input.bank_account_id!)).account;
  const whtRate = Math.max(0, Number(input.wht_rate) || 0);
  const whtAmount = round2(amount * whtRate / 100);
  const cashAmount = round2(amount - whtAmount);
  const wanted = toIsoDate(input.date);
  const { date, shifted } = opts.existingRowId ? await openPostingDate(trx, wanted) : { date: wanted, shifted: false };

  const lines: JournalLine[] = [];
  let description: string;
  if (isInvoice) {
    const ar = await receivableAccount(trx);
    lines.push({ account_id: moneyAccount.id, debit: cashAmount });
    if (whtAmount > 0) lines.push({ account_id: (await whtReceivableAccount(trx)).id, debit: whtAmount });
    lines.push({ account_id: ar.id, credit: amount });
    description = `Receipt for Invoice ${targetId} - ${target.client}`;
  } else {
    const ap = await payableAccount(trx);
    const supplier = await trx('suppliers').where({ id: target.supplier_id }).first();
    lines.push({ account_id: ap.id, debit: amount });
    lines.push({ account_id: moneyAccount.id, credit: cashAmount });
    if (whtAmount > 0) lines.push({ account_id: (await whtPayableAccount(trx)).id, credit: whtAmount });
    description = `Payment for Bill ${targetId}${supplier ? ` - ${supplier.name}` : ''}`;
  }

  const row = {
    date: wanted,
    amount,
    method,
    reference: input.reference || (method === 'Cash' ? 'Cash' : null),
    target_type: input.target_type,
    target_id: targetId,
    bank_account_id: method === 'Cash' ? null : Number(input.bank_account_id),
    wht_rate: whtRate,
    wht_amount: whtAmount,
  };
  let rowId: number;
  let paymentId: string;
  if (opts.existingRowId) {
    const existing = await trx('payments').where({ id: opts.existingRowId }).first();
    paymentId = existing.payment_id;
    rowId = existing.id;
    await trx('payments').where({ id: rowId }).update({ ...row, original_target_type: null, voided_at: null, void_reason: null, updated_at: trx.fn.now() });
  } else {
    paymentId = input.payment_id || (await nextDocNumber(trx, 'payments', 'payment_id', 'PAY', wanted));
    const [inserted] = await trx('payments').insert({ payment_id: paymentId, ...row }).returning('id');
    rowId = typeof inserted === 'object' ? inserted.id : inserted;
  }

  const journalId = await postJournal(trx, {
    date,
    description: `${description} (${paymentId})${opts.suffix || ''}${correctionNote(opts.ctx || {}, shifted, date)}`,
    reference_type: 'payment',
    reference_id: rowId,
    project_id: target.project_id || null,
    lines,
    approval_request_id: opts.ctx?.requestId,
  });
  await trx('payments').where({ id: rowId }).update({ journal_id: journalId });
  await refreshTargetStatus(trx, input.target_type, targetId);

  if (!opts.existingRowId && method === 'Cheque' && input.bank_account_id) {
    await trx('bank_accounts').where({ id: Number(input.bank_account_id) }).increment('next_cheque_number', 1);
  }
  return { id: rowId, payment_id: paymentId, journal_id: journalId, wht_amount: whtAmount };
}

async function loadPayment(trx: Knex.Transaction, rowId: number) {
  const payment = await trx('payments').where({ id: rowId }).first();
  if (!payment) throw new LedgerError('Payment not found', 404);
  if (payment.target_type === 'Void') throw new LedgerError('This payment has already been voided');
  if (payment.method === CREDIT_NOTE_METHOD) throw new LedgerError('Credit notes cannot be changed as payments');
  return payment;
}

/** Reverses a payment's posting and detaches it from its invoice/bill so that balance recalculates. */
async function detachPayment(trx: Knex.Transaction, payment: any, reason: string, ctx: ApprovalContext) {
  const journal = payment.journal_id
    ? await trx('journal_entries').where({ id: payment.journal_id }).whereNull('status').first()
    : await sourceJournal(trx, 'payment', payment.id);
  const journalIds: number[] = [];
  if (journal) {
    journalIds.push(await reverseForCorrection(trx, journal, `Payment ${payment.payment_id}`, ctx));
    await unreconcileJournal(trx, journal.id);
  }
  await trx('payments').where({ id: payment.id }).update({
    target_type: 'Void',
    original_target_type: payment.target_type,
    voided_at: trx.fn.now(),
    void_reason: reason.slice(0, 250),
    updated_at: trx.fn.now(),
  });
  await refreshTargetStatus(trx, payment.target_type, payment.target_id);
  return journalIds;
}

export async function voidPayment(trx: Knex.Transaction, rowId: number, reason: string, ctx: ApprovalContext = {}) {
  const payment = await loadPayment(trx, rowId);
  return { journal_ids: await detachPayment(trx, payment, reason, ctx) };
}

export async function correctPayment(trx: Knex.Transaction, rowId: number, input: PaymentInput, ctx: ApprovalContext = {}) {
  const payment = await loadPayment(trx, rowId);
  const journalIds = await detachPayment(trx, payment, 'Replaced by correction', ctx);
  const result = await recordPayment(trx, input, { existingRowId: payment.id, ctx, suffix: ' (corrected)' });
  return { journal_ids: [...journalIds, result.journal_id], wht_amount: result.wht_amount };
}

// --- Voids and credit notes ---

export async function voidInvoice(trx: Knex.Transaction, id: string, opts: { date?: string; reason?: string }, ctx: ApprovalContext = {}) {
  const invoice = await trx('invoices').where({ id }).first();
  if (!invoice) throw new LedgerError('Invoice not found', 404);
  if (String(invoice.status).toLowerCase() === 'void') throw new LedgerError('Invoice is already void');
  const settled = await paidOn(trx, 'Invoice', id);
  if (settled.total > 0) throw new LedgerError('This invoice has payments or credit notes. Void those first, or issue a credit note for the remaining balance.');

  const journal = await sourceJournal(trx, 'invoice', id);
  let voidJournalId: number | null = null;
  if (journal) {
    const { date, shifted } = await openPostingDate(trx, opts.date);
    voidJournalId = await reverseJournal(trx, journal.id, {
      date,
      description: `VOID Sales Invoice ${id}${opts.reason ? ` - ${opts.reason}` : ''}${correctionNote(ctx, shifted, date)}`,
      reference_type: 'invoice_void',
      reference_id: id,
      approval_request_id: ctx.requestId,
    });
  }
  await trx('invoices').where({ id }).update({ status: 'void', voided_at: trx.fn.now(), void_reason: opts.reason || null, void_journal_id: voidJournalId });
  return { void_journal_id: voidJournalId, journal_ids: voidJournalId ? [voidJournalId] : [] };
}

export async function voidBill(trx: Knex.Transaction, id: number, opts: { date?: string; reason?: string }, ctx: ApprovalContext = {}) {
  const bill = await trx('bills').where({ id }).first();
  if (!bill) throw new LedgerError('Bill not found', 404);
  if (String(bill.status).toLowerCase() === 'void') throw new LedgerError('Bill is already void');
  const settled = await paidOn(trx, 'Bill', id);
  if (settled.total > 0) throw new LedgerError('This bill has payments recorded. Void the payments first.');

  const journal = await sourceJournal(trx, 'bill', id);
  let voidJournalId: number | null = null;
  if (journal) {
    const { date, shifted } = await openPostingDate(trx, opts.date);
    voidJournalId = await reverseJournal(trx, journal.id, {
      date,
      description: `VOID Vendor Bill ${id}${opts.reason ? ` - ${opts.reason}` : ''}${correctionNote(ctx, shifted, date)}`,
      reference_type: 'bill_void',
      reference_id: id,
      approval_request_id: ctx.requestId,
    });
  }
  await trx('bills').where({ id }).update({ status: 'void', voided_at: trx.fn.now(), void_reason: opts.reason || null, void_journal_id: voidJournalId });
  await releasePurchaseOrder(trx, id);
  return { void_journal_id: voidJournalId, journal_ids: voidJournalId ? [voidJournalId] : [] };
}

/** Lets a purchase order be billed again once its bill is voided or rejected. */
export async function releasePurchaseOrder(trx: Knex.Transaction, billId: number) {
  await trx('purchase_orders').where({ bill_id: billId }).update({ bill_id: null, updated_at: trx.fn.now() });
}

/** Credits part of an invoice: reverses revenue and tax in proportion and reduces the receivable. */
export async function createCreditNote(trx: Knex.Transaction, invoiceId: string, opts: { date?: string; amount: number | string; reason?: string }, ctx: ApprovalContext = {}) {
  const invoice = await trx('invoices').where({ id: invoiceId }).first();
  if (!invoice) throw new LedgerError('Invoice not found', 404);
  if (String(invoice.status).toLowerCase() === 'void') throw new LedgerError('Invoice is void');
  const amount = round2(opts.amount);
  if (!(amount > 0)) throw new LedgerError('Credit note amount must be greater than 0');
  const settled = await paidOn(trx, 'Invoice', invoiceId);
  const balanceDue = round2(Number(invoice.amount) - settled.total);
  if (amount > balanceDue + 0.01) throw new LedgerError(`Credit exceeds the balance due (${balanceDue.toFixed(2)})`);

  const ar = await receivableAccount(trx);
  const journal = await sourceJournal(trx, 'invoice', invoiceId);
  const creditLines: { account_id: number; amount: number }[] = [];
  if (journal) {
    const entries = await trx('ledger_entries').where({ journal_id: journal.id }).where('credit', '>', 0);
    const total = entries.reduce((s: number, e: any) => s + Number(e.credit), 0);
    for (const e of entries) creditLines.push({ account_id: e.account_id, amount: round2(amount * Number(e.credit) / total) });
  } else {
    creditLines.push({ account_id: (await defaultIncomeAccount(trx)).id, amount });
  }
  const drift = round2(amount - creditLines.reduce((s, l) => s + l.amount, 0));
  if (drift !== 0) creditLines[0].amount = round2(creditLines[0].amount + drift);

  const wanted = toIsoDate(opts.date);
  const { date, shifted } = await openPostingDate(trx, wanted);
  const id = await nextDocNumber(trx, 'credit_notes', 'id', 'CN', date);
  const journalId = await postJournal(trx, {
    date,
    description: `Credit Note ${id} on Invoice ${invoiceId}${opts.reason ? ` - ${opts.reason}` : ''}${correctionNote(ctx, shifted, date)}`,
    reference_type: 'credit_note',
    reference_id: id,
    project_id: invoice.project_id || null,
    lines: [
      ...creditLines.map((l) => ({ account_id: l.account_id, debit: l.amount })),
      { account_id: ar.id, credit: amount },
    ],
    approval_request_id: ctx.requestId,
  });

  const [paymentRow] = await trx('payments').insert({
    payment_id: id,
    date,
    amount,
    method: CREDIT_NOTE_METHOD,
    reference: opts.reason || id,
    target_type: 'Invoice',
    target_id: invoiceId,
    journal_id: journalId,
  }).returning('id');
  const paymentRowId = typeof paymentRow === 'object' ? paymentRow.id : paymentRow;

  await trx('credit_notes').insert({ id, invoice_id: invoiceId, client: invoice.client, date, amount, reason: opts.reason || null, journal_id: journalId, payment_row_id: paymentRowId });
  await trx('invoices').where({ id: invoiceId }).update({ status: statusFor(Number(invoice.amount), settled.total + amount) });
  return { id, journal_id: journalId, journal_ids: [journalId] };
}

// --- Manual journals ---

export async function loadManualJournal(trx: Knex.Transaction | Knex, id: number | string) {
  const header = await trx('journal_entries').where({ id }).first();
  if (!header) throw new LedgerError('Journal entry not found', 404);
  if (header.reference_type !== 'manual') {
    throw new LedgerError(`This entry was created by a ${String(header.reference_type || 'system').replace(/_/g, ' ')} document; correct it from that document instead.`);
  }
  if (header.status === 'reversed') throw new LedgerError('This journal has already been reversed');
  return header;
}

export async function correctJournal(
  trx: Knex.Transaction,
  id: number,
  input: { date?: string; description: string; project_id?: string | null; lines: JournalLine[] },
  ctx: ApprovalContext = {}
) {
  const header = await loadManualJournal(trx, id);
  const description = String(input.description || '').replace(/\s*\(corrects #\d+\).*$/, '').trim();
  if (!description) throw new LedgerError('Description is required');
  const reversalId = await reverseForCorrection(trx, header, header.description, ctx);
  const { date, shifted } = await openPostingDate(trx, input.date);
  const newId = await postJournal(trx, {
    date,
    description: `${description} (corrects #${id})${correctionNote(ctx, shifted, date)}`,
    reference_type: 'manual',
    project_id: input.project_id || null,
    lines: input.lines,
    approval_request_id: ctx.requestId,
  });
  await unreconcileJournal(trx, header.id);
  await trx('attachments').where({ entity_type: 'journal', entity_id: String(id) }).update({ entity_id: String(newId) });
  return { journal_ids: [reversalId, newId], new_journal_id: newId };
}

export async function voidJournal(trx: Knex.Transaction, id: number, reason: string, ctx: ApprovalContext = {}) {
  const header = await loadManualJournal(trx, id);
  const reversalId = await reverseForCorrection(trx, header, `${header.description}${reason ? ` - ${reason}` : ''}`, ctx);
  await unreconcileJournal(trx, header.id);
  return { journal_ids: [reversalId] };
}
