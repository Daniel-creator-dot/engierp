import type { Knex } from 'knex';
import { JournalLine, LedgerError, postJournal, reverseJournal, round2, toIsoDate } from './ledger';
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

export async function createInvoice(trx: Knex.Transaction, input: InvoiceInput) {
  const items = (Array.isArray(input.items) ? input.items : [])
    .map((it) => ({
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

  const applyTax = input.apply_tax !== false;
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

  const id = await nextDocNumber(trx, 'invoices', 'id', 'INV', date);
  await trx('invoices').insert({
    id,
    client,
    project_id: projectId,
    date,
    dueDate,
    items: JSON.stringify(items),
    subtotal,
    tax_amount: taxAmount,
    tax_rate: round2(breakdown.reduce((s, b) => s + b.rate, 0)),
    tax_name: breakdown.length ? breakdown.map((b) => `${b.name} ${b.rate}%`).join(' + ') : 'No tax',
    tax_breakdown: JSON.stringify(breakdown),
    amount: total,
    status: 'unpaid',
  });

  const ar = await receivableAccount(trx);
  const lines: JournalLine[] = [{ account_id: ar.id, debit: total }];
  for (const [accountId, amount] of revenueByAccount) lines.push({ account_id: accountId, credit: amount });
  for (const b of breakdown) lines.push({ account_id: b.account_id, credit: b.amount });

  const journalId = await postJournal(trx, {
    date,
    description: `Sales Invoice ${id} - ${client}`,
    reference_type: 'invoice',
    reference_id: id,
    project_id: projectId,
    lines,
  });
  return { id, amount: total, subtotal, tax_amount: taxAmount, journal_id: journalId };
}

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

export async function createBill(trx: Knex.Transaction, input: BillInput) {
  const supplier = await trx('suppliers').where({ id: input.supplier_id }).first();
  if (!supplier) throw new LedgerError('Supplier not found');
  const account = await trx('chart_of_accounts').where({ id: Number(input.account_id) }).first();
  if (!account || !['Expense', 'Asset'].includes(account.type)) throw new LedgerError('Choose an expense or asset account for the bill');

  const quantity = input.quantity !== undefined && input.quantity !== '' ? Number(input.quantity) : 1;
  const unitPrice = input.unit_price !== undefined && input.unit_price !== '' ? Number(input.unit_price) : Number(input.amount || 0);
  const amount = round2(quantity * unitPrice);
  if (!(quantity > 0) || !(amount > 0)) throw new LedgerError('Bill amount must be greater than zero');

  const date = toIsoDate(input.date);
  const projectId = input.project_id && input.project_id !== 'none' ? String(input.project_id) : null;
  const category = input.category || account.name;

  const [inserted] = await trx('bills').insert({
    supplier_id: supplier.id,
    quantity,
    unit_price: unitPrice,
    amount,
    date,
    due_date: input.due_date ? toIsoDate(input.due_date) : date,
    category,
    project_id: projectId,
    account_id: account.id,
    reference: input.reference || null,
    description: input.description || null,
    status: 'unpaid',
  }).returning('id');
  const billId = typeof inserted === 'object' ? inserted.id : inserted;

  const ap = await payableAccount(trx);
  const journalId = await postJournal(trx, {
    date,
    description: `Vendor Bill ${billId}: ${supplier.name} - ${category}${input.reference ? ` (${input.reference})` : ''}`,
    reference_type: 'bill',
    reference_id: billId,
    project_id: projectId,
    lines: [
      { account_id: account.id, debit: amount },
      { account_id: ap.id, credit: amount },
    ],
  });
  return { id: billId, amount, journal_id: journalId };
}

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

export async function recordPayment(trx: Knex.Transaction, input: PaymentInput) {
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
  if (String(target.status || '').toLowerCase() === 'void') throw new LedgerError(`This ${input.target_type.toLowerCase()} is void`);

  const settled = await paidOn(trx, input.target_type, targetId);
  const balanceDue = round2(Number(target.amount) - settled.total);
  if (amount > balanceDue + 0.01) throw new LedgerError(`Payment exceeds the balance due (${balanceDue.toFixed(2)})`);

  const moneyAccount = method === 'Cash' ? await cashOnHandAccount(trx) : (await bankLedgerAccount(trx, input.bank_account_id!)).account;
  const whtRate = Math.max(0, Number(input.wht_rate) || 0);
  const whtAmount = round2(amount * whtRate / 100);
  const cashAmount = round2(amount - whtAmount);
  const date = toIsoDate(input.date);

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

  const paymentId = input.payment_id || (await nextDocNumber(trx, 'payments', 'payment_id', 'PAY', date));
  const [inserted] = await trx('payments').insert({
    payment_id: paymentId,
    date,
    amount,
    method,
    reference: input.reference || (method === 'Cash' ? 'Cash' : null),
    target_type: input.target_type,
    target_id: targetId,
    bank_account_id: method === 'Cash' ? null : Number(input.bank_account_id),
    wht_rate: whtRate,
    wht_amount: whtAmount,
  }).returning('id');
  const rowId = typeof inserted === 'object' ? inserted.id : inserted;

  const journalId = await postJournal(trx, {
    date,
    description: `${description} (${paymentId})`,
    reference_type: 'payment',
    reference_id: rowId,
    project_id: target.project_id || null,
    lines,
  });
  await trx('payments').where({ id: rowId }).update({ journal_id: journalId });

  const newStatus = statusFor(Number(target.amount), settled.total + amount);
  if (isInvoice) await trx('invoices').where({ id: targetId }).update({ status: newStatus });
  else await trx('bills').where({ id: target.id }).update({ status: newStatus });

  if (method === 'Cheque' && input.bank_account_id) {
    await trx('bank_accounts').where({ id: Number(input.bank_account_id) }).increment('next_cheque_number', 1);
  }
  return { id: rowId, payment_id: paymentId, journal_id: journalId, wht_amount: whtAmount };
}

async function sourceJournal(trx: Knex.Transaction, referenceType: string, referenceId: string) {
  return trx('journal_entries').where({ reference_type: referenceType, reference_id: referenceId }).orderBy('id').first();
}

export async function voidInvoice(trx: Knex.Transaction, id: string, opts: { date?: string; reason?: string }) {
  const invoice = await trx('invoices').where({ id }).first();
  if (!invoice) throw new LedgerError('Invoice not found', 404);
  if (String(invoice.status).toLowerCase() === 'void') throw new LedgerError('Invoice is already void');
  const settled = await paidOn(trx, 'Invoice', id);
  if (settled.total > 0) throw new LedgerError('This invoice has payments or credit notes. Issue a credit note for the remaining balance instead of voiding it.');

  const journal = await sourceJournal(trx, 'invoice', id);
  const voidJournalId = journal
    ? await reverseJournal(trx, journal.id, { date: opts.date, description: `VOID Sales Invoice ${id}${opts.reason ? ` - ${opts.reason}` : ''}`, reference_type: 'invoice_void', reference_id: id })
    : null;
  await trx('invoices').where({ id }).update({ status: 'void', voided_at: trx.fn.now(), void_reason: opts.reason || null, void_journal_id: voidJournalId });
  return { void_journal_id: voidJournalId };
}

export async function voidBill(trx: Knex.Transaction, id: number, opts: { date?: string; reason?: string }) {
  const bill = await trx('bills').where({ id }).first();
  if (!bill) throw new LedgerError('Bill not found', 404);
  if (String(bill.status).toLowerCase() === 'void') throw new LedgerError('Bill is already void');
  const settled = await paidOn(trx, 'Bill', id);
  if (settled.total > 0) throw new LedgerError('This bill has payments recorded and cannot be voided');

  const journal = await sourceJournal(trx, 'bill', String(id));
  const voidJournalId = journal
    ? await reverseJournal(trx, journal.id, { date: opts.date, description: `VOID Vendor Bill ${id}${opts.reason ? ` - ${opts.reason}` : ''}`, reference_type: 'bill_void', reference_id: id })
    : null;
  await trx('bills').where({ id }).update({ status: 'void', voided_at: trx.fn.now(), void_reason: opts.reason || null, void_journal_id: voidJournalId });
  return { void_journal_id: voidJournalId };
}

/** Credits part of an invoice: reverses revenue and tax in proportion and reduces the receivable. */
export async function createCreditNote(trx: Knex.Transaction, invoiceId: string, opts: { date?: string; amount: number | string; reason?: string }) {
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

  const date = toIsoDate(opts.date);
  const id = await nextDocNumber(trx, 'credit_notes', 'id', 'CN', date);
  const journalId = await postJournal(trx, {
    date,
    description: `Credit Note ${id} on Invoice ${invoiceId}${opts.reason ? ` - ${opts.reason}` : ''}`,
    reference_type: 'credit_note',
    reference_id: id,
    project_id: invoice.project_id || null,
    lines: [
      ...creditLines.map((l) => ({ account_id: l.account_id, debit: l.amount })),
      { account_id: ar.id, credit: amount },
    ],
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
  return { id, journal_id: journalId };
}
