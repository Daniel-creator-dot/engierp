import type { Knex } from 'knex';
import db from '../db';
import type { AuthRequest } from '../middleware/auth';
import { logAudit } from './audit';
import { notify } from './notify';
import { Conn, JournalLine, LedgerError, round2, toIsoDate } from './ledger';
import { getSettingValue, paidOn, pick, statusFor } from './accounting';
import {
  BillInput,
  approvePendingBill,
  buildBill,
  correctBill,
  createBill,
  correctInvoice,
  correctJournal,
  correctPayment,
  createCreditNote,
  releasePurchaseOrder,
  voidBill,
  voidInvoice,
  voidJournal,
  voidPayment,
} from './accountingDocs';

export const BILL_APPROVAL_THRESHOLD_KEY = 'bill_approval_threshold';

type EntityType = 'bill' | 'invoice' | 'payment' | 'journal';
type Actor = { id: number; email: string; role: string };

const ALLOWED_ACTIONS: Record<EntityType, string[]> = {
  bill: ['correct', 'void'],
  invoice: ['correct', 'void', 'credit_note'],
  payment: ['correct', 'void'],
  journal: ['correct', 'void'],
};

const ACTION_TEXT: Record<string, string> = {
  create: 'New bill above the approval limit',
  correct: 'Correction',
  void: 'Void',
  credit_note: 'Credit note',
};

export interface SummaryField { label: string; value: string }

const money = (n: any) => round2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (d: any) => (d ? toIsoDate(d) : '-');
const text = (v: any) => (v === null || v === undefined || String(v).trim() === '' ? '-' : String(v));
const human = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const parseJson = (v: any) => (typeof v === 'string' ? JSON.parse(v) : v);

// --- Threshold for new bills ---

export async function getBillApprovalThreshold(conn: Conn) {
  const value = Number(await getSettingValue(conn, BILL_APPROVAL_THRESHOLD_KEY));
  return value > 0 ? value : 0;
}

/** New bills above the threshold wait for an admin, unless an admin is the one entering them. */
export async function billNeedsApproval(conn: Conn, amount: number, user?: Actor | null) {
  if (user?.role === 'admin') return false;
  const threshold = await getBillApprovalThreshold(conn);
  return threshold > 0 && amount > threshold + 0.005;
}

// --- Document snapshots and display summaries ---

async function accountLabel(conn: Conn, id: any) {
  if (!id) return '-';
  const a = await conn('chart_of_accounts').where({ id: Number(id) }).first();
  return a ? `${a.code} ${a.name}` : `#${id}`;
}

async function projectLabel(conn: Conn, id: any) {
  if (!id) return '-';
  const p = await conn('projects').where({ id: String(id) }).first();
  return p ? p.name || String(id) : String(id);
}

async function loadEntity(conn: Conn, type: EntityType, id: string) {
  const row = type === 'invoice'
    ? await conn('invoices').where({ id }).first()
    : await conn(type === 'bill' ? 'bills' : type === 'payment' ? 'payments' : 'journal_entries').where({ id: Number(id) || -1 }).first();
  if (!row) throw new LedgerError(`${human(type)} not found`, 404);
  return row;
}

/** The editable fields of a document, used as the base for a proposed correction. */
async function editableFields(conn: Conn, type: EntityType, row: any) {
  switch (type) {
    case 'bill':
      return {
        supplier_id: row.supplier_id, account_id: row.account_id, quantity: Number(row.quantity || 1), unit_price: Number(row.unit_price ?? row.amount),
        date: day(row.date || row.created_at), due_date: row.due_date ? day(row.due_date) : undefined, category: row.category, project_id: row.project_id,
        reference: row.reference, description: row.description,
      };
    case 'invoice': {
      const breakdown = parseJson(row.tax_breakdown) || [];
      return {
        client: row.client, project_id: row.project_id, date: day(row.date || row.created_at), dueDate: row.dueDate ? day(row.dueDate) : undefined,
        items: parseJson(row.items) || [], apply_tax: breakdown.length > 0 || Number(row.tax_amount) > 0,
      };
    }
    case 'payment':
      return {
        date: day(row.date), amount: Number(row.amount), method: row.method, reference: row.reference, bank_account_id: row.bank_account_id,
        wht_rate: Number(row.wht_rate || 0), target_type: row.target_type, target_id: row.target_id,
      };
    case 'journal': {
      const lines = await conn('ledger_entries').where({ journal_id: row.id }).orderBy('id').select('account_id', 'debit', 'credit');
      return {
        date: day(row.date), description: row.description, project_id: row.project_id,
        lines: lines.map((l: any) => ({ account_id: l.account_id, debit: Number(l.debit), credit: Number(l.credit) })),
      };
    }
  }
}

/** Flat, human-readable view of a document for the side-by-side comparison. */
export async function summarize(conn: Conn, type: EntityType, id: string): Promise<SummaryField[]> {
  const row = await loadEntity(conn, type, id);
  const f = (label: string, value: any): SummaryField => ({ label, value: text(value) });
  switch (type) {
    case 'bill': {
      const supplier = await conn('suppliers').where({ id: row.supplier_id }).first();
      const settled = await paidOn(conn, 'Bill', row.id);
      return [
        f('Supplier', supplier?.name || row.supplier_id), f('Account', await accountLabel(conn, row.account_id)),
        f('Quantity', Number(row.quantity || 1)), f('Unit price', money(row.unit_price ?? row.amount)), f('Amount', money(row.amount)),
        f('Bill date', day(row.date || row.created_at)), f('Due date', day(row.due_date)), f('Category', row.category),
        f('Project', await projectLabel(conn, row.project_id)), f('Reference', row.reference), f('Description', row.description),
        f('Paid', money(settled.total)), f('Status', human(statusFor(Number(row.amount), settled.total, row.status))),
      ];
    }
    case 'invoice': {
      const items = parseJson(row.items) || [];
      const settled = await paidOn(conn, 'Invoice', row.id);
      return [
        f('Client', row.client), f('Project', await projectLabel(conn, row.project_id)), f('Invoice date', day(row.date || row.created_at)),
        f('Due date', day(row.dueDate)),
        f('Items', items.map((it: any) => `${it.description}: ${Number(it.quantity)} x ${money(it.unitPrice)}`).join('\n')),
        f('Tax', row.tax_name || 'No tax'), f('Subtotal', money(row.subtotal ?? row.amount)), f('Tax amount', money(row.tax_amount)),
        f('Total', money(row.amount)), f('Paid / credited', money(settled.total)),
        f('Status', human(statusFor(Number(row.amount), settled.total, row.status))),
      ];
    }
    case 'payment': {
      const isVoid = row.target_type === 'Void';
      const bank = row.bank_account_id ? await conn('bank_accounts').where({ id: row.bank_account_id }).first() : null;
      return [
        f('Payment no.', row.payment_id), f('Applied to', isVoid ? `Nothing (was ${row.original_target_type} ${row.target_id})` : `${row.target_type} ${row.target_id}`),
        f('Amount', money(row.amount)), f('Date', day(row.date)), f('Method', row.method),
        f('Bank account', bank ? `${bank.bank_name} - ${bank.account_name}` : '-'), f('Reference', row.reference),
        f('WHT rate', `${Number(row.wht_rate || 0)}%`), f('Status', isVoid ? 'Voided' : 'Active'),
      ];
    }
    case 'journal': {
      const lines = await conn('ledger_entries as le').join('chart_of_accounts as c', 'le.account_id', 'c.id')
        .where('le.journal_id', row.id).orderBy('le.id').select('c.code', 'c.name', 'le.debit', 'le.credit');
      const total = lines.reduce((s: number, l: any) => s + Number(l.debit), 0);
      return [
        f('Journal no.', `#${row.id}`), f('Date', day(row.date)), f('Description', row.description),
        f('Project', await projectLabel(conn, row.project_id)),
        f('Lines', lines.map((l: any) => `${l.code} ${l.name}: ${Number(l.debit) > 0 ? `Dr ${money(l.debit)}` : `Cr ${money(l.credit)}`}`).join('\n')),
        f('Total', money(total)), f('Status', row.status === 'reversed' ? 'Reversed' : 'Active'),
      ];
    }
  }
}

async function entityLabel(conn: Conn, type: EntityType, row: any) {
  switch (type) {
    case 'bill': {
      const supplier = await conn('suppliers').where({ id: row.supplier_id }).first();
      return `Bill #${row.id} - ${supplier?.name || row.supplier_id} (${money(row.amount)})`;
    }
    case 'invoice': return `Invoice ${row.id} - ${row.client} (${money(row.amount)})`;
    case 'payment': return `Payment ${row.payment_id} on ${row.target_type} ${row.target_id} (${money(row.amount)})`;
    case 'journal': return `Journal #${row.id} - ${String(row.description || '').slice(0, 60)}`;
  }
}

/** Merges the requested changes over the document's current values. */
function normalizeProposal(type: EntityType, action: string, current: any, raw: any) {
  if (action === 'void') return { date: raw?.date ? toIsoDate(raw.date) : undefined };
  if (action === 'credit_note') return { amount: round2(raw?.amount), date: raw?.date ? toIsoDate(raw.date) : undefined };
  switch (type) {
    case 'bill': {
      const changes = pick(raw, ['supplier_id', 'account_id', 'quantity', 'unit_price', 'amount', 'date', 'due_date', 'category', 'project_id', 'reference', 'description'] as const);
      const merged: any = { ...current, ...changes };
      if (changes.amount !== undefined && changes.unit_price === undefined) {
        merged.quantity = 1;
        merged.unit_price = Number(changes.amount);
      }
      delete merged.amount;
      return merged;
    }
    case 'invoice':
      return { ...current, ...pick(raw, ['client', 'project_id', 'date', 'dueDate', 'items', 'apply_tax'] as const) };
    case 'payment':
      return { ...current, ...pick(raw, ['date', 'amount', 'method', 'reference', 'bank_account_id', 'wht_rate', 'target_type', 'target_id'] as const) };
    case 'journal': {
      const merged: any = { ...current, ...pick(raw, ['date', 'description', 'project_id'] as const) };
      const rawLines = Array.isArray(raw?.lines) ? raw.lines : Array.isArray(raw?.items) ? raw.items : null;
      if (rawLines) {
        merged.lines = rawLines
          .filter((l: any) => l && l.account_id !== '' && l.account_id != null)
          .map((l: any) => ({ account_id: Number(l.account_id), debit: round2(l.debit), credit: round2(l.credit) })) as JournalLine[];
      }
      return merged;
    }
  }
}

// --- Applying a request ---

interface RequestLike { id?: number; entity_type: string; entity_id: string; action: string; reason: string; proposed: any }

/** Performs the change a request describes. Must run inside the caller's transaction. */
export async function applyRequest(trx: Knex.Transaction, request: RequestLike): Promise<any> {
  const ctx = { requestId: request.id ?? null };
  const p = parseJson(request.proposed) || {};
  const id = request.entity_id;
  switch (`${request.entity_type}:${request.action}`) {
    case 'bill:create': return approvePendingBill(trx, Number(id), ctx);
    case 'bill:correct': return correctBill(trx, Number(id), p, ctx);
    case 'bill:void': return voidBill(trx, Number(id), { date: p.date, reason: request.reason }, ctx);
    case 'invoice:correct': return correctInvoice(trx, id, p, ctx);
    case 'invoice:void': return voidInvoice(trx, id, { date: p.date, reason: request.reason }, ctx);
    case 'invoice:credit_note': return createCreditNote(trx, id, { date: p.date, amount: p.amount, reason: request.reason }, ctx);
    case 'payment:correct': return correctPayment(trx, Number(id), p, ctx);
    case 'payment:void': return voidPayment(trx, Number(id), request.reason, ctx);
    case 'journal:correct': return correctJournal(trx, Number(id), p, ctx);
    case 'journal:void': return voidJournal(trx, Number(id), request.reason, ctx);
    default: throw new LedgerError(`Unsupported request: ${request.action} ${request.entity_type}`);
  }
}

class PreviewDone extends Error {
  constructor(public payload: { original: SummaryField[]; proposed: SummaryField[] }) { super('preview'); }
}

/** Applies the change in a transaction that is always rolled back, to validate it and show its result. */
async function preview(request: RequestLike) {
  try {
    await db.transaction(async (trx) => {
      const type = request.entity_type as EntityType;
      const original = await summarize(trx, type, request.entity_id);
      const result = await applyRequest(trx, request);
      const afterId = type === 'journal' && request.action === 'correct' ? String(result.new_journal_id) : request.entity_id;
      throw new PreviewDone({ original, proposed: await summarize(trx, type, afterId) });
    });
  } catch (error) {
    if (error instanceof PreviewDone) return error.payload;
    throw error;
  }
  throw new Error('Preview did not complete');
}

// --- Requests ---

async function otherAdminExists(conn: Conn, userId: number) {
  const row = await conn('users').where({ role: 'admin' }).whereNot('id', userId)
    .where((q) => q.where('is_active', true).orWhereNull('is_active')).first('id');
  return !!row;
}

function notifyAdmins(row: any) {
  return notify(
    { roles: ['admin'] },
    `Approval needed: ${row.entity_label}`,
    `${ACTION_TEXT[row.action] || row.action} requested by ${row.requested_by_email || 'the system'}. Reason: ${row.reason}`,
    { type: 'warning', link: 'accounting-approvals', excludeUserId: row.requested_by || undefined },
  );
}

const isUniqueViolation = (error: any) => error?.code === '23505';

/** Accountant (or admin) asks for a correction, void or credit note. Nothing is posted until approved. */
export async function createRequest(req: AuthRequest, input: any) {
  const user = req.user as Actor;
  const type = String(input?.entity_type || '') as EntityType;
  const action = String(input?.action || '');
  const entityId = String(input?.entity_id ?? '').trim();
  const reason = String(input?.reason || '').trim();
  if (!ALLOWED_ACTIONS[type]?.includes(action)) throw new LedgerError('Unsupported request type');
  if (!entityId) throw new LedgerError('entity_id is required');
  if (reason.length < 3) throw new LedgerError('Please give a reason for the change');

  const existing = await db('approval_requests').where({ entity_type: type, entity_id: entityId, status: 'pending' }).first();
  if (existing) throw new LedgerError(`Request #${existing.id} for this ${type} is already waiting for approval`, 409);

  const row = await loadEntity(db, type, entityId);
  if (type === 'journal' && row.reference_type !== 'manual') {
    throw new LedgerError(`This entry was created by a ${human(String(row.reference_type || 'system'))} document; correct it from that document instead.`);
  }
  if (type === 'payment' && row.target_type === 'Void') throw new LedgerError('This payment has already been voided');
  const current = await editableFields(db, type, row);
  const proposed = normalizeProposal(type, action, current, input?.proposed || {});
  const request: RequestLike = { entity_type: type, entity_id: entityId, action, reason, proposed };
  const summaries = await preview(request);
  const journalShape = (j: any) => JSON.stringify({
    date: toIsoDate(j.date), description: String(j.description || '').trim(), project_id: j.project_id || null,
    lines: (j.lines || []).map((l: any) => [Number(l.account_id), round2(l.debit), round2(l.credit)]),
  });
  const unchanged = type === 'journal'
    ? journalShape(current) === journalShape(proposed)
    : JSON.stringify(summaries.original) === JSON.stringify(summaries.proposed);
  if (action === 'correct' && unchanged) {
    throw new LedgerError('Nothing was changed. Edit at least one field before submitting.');
  }

  const applyDirectly = user.role === 'admin' && !(await otherAdminExists(db, user.id));
  let saved: any;
  try {
    saved = await db.transaction(async (trx) => {
      const [inserted] = await trx('approval_requests').insert({
        entity_type: type,
        entity_id: entityId,
        entity_label: await entityLabel(trx, type, row),
        action,
        status: 'pending',
        reason,
        original: JSON.stringify(current),
        proposed: JSON.stringify(proposed),
        original_summary: JSON.stringify(summaries.original),
        proposed_summary: JSON.stringify(summaries.proposed),
        requested_by: user.id,
        requested_by_email: user.email,
      }).returning('*');
      await logAudit(req, `approval.request_${action}`, type, entityId, summaries.original, { request_id: inserted.id, reason, proposed: summaries.proposed }, trx);
      if (!applyDirectly) return inserted;

      const result = await applyRequest(trx, inserted);
      const comment = 'Applied directly: no other admin is available to approve';
      const [done] = await trx('approval_requests').where({ id: inserted.id }).update({
        status: 'approved', decided_by: user.id, decided_by_email: user.email, decided_at: trx.fn.now(), decision_comment: comment,
        result: JSON.stringify(result), updated_at: trx.fn.now(),
      }).returning('*');
      await logAudit(req, `approval.applied_directly`, type, entityId, summaries.original, { request_id: inserted.id, reason, comment, result }, trx);
      return done;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new LedgerError(`Another request for this ${type} is already waiting for approval`, 409);
    throw error;
  }

  if (saved.status === 'pending') await notifyAdmins(saved);
  return {
    request: saved,
    applied: saved.status === 'approved',
    message: saved.status === 'approved'
      ? 'Applied immediately because no other admin is available to approve it. The change is recorded in the audit log.'
      : `Sent for admin approval (request #${saved.id}). Nothing changes in the ledger until it is approved.`,
  };
}

/** Records the approval request for a new bill that was saved as pending. Call inside the bill's transaction. */
export async function recordBillCreateRequest(trx: Knex.Transaction, user: Actor | null, billId: number | string, reason: string, auditReq: AuthRequest | null = null) {
  const bill = await loadEntity(trx, 'bill', String(billId));
  const [row] = await trx('approval_requests').insert({
    entity_type: 'bill',
    entity_id: String(billId),
    entity_label: await entityLabel(trx, 'bill', bill),
    action: 'create',
    status: 'pending',
    reason,
    original: null,
    proposed: JSON.stringify(await editableFields(trx, 'bill', bill)),
    original_summary: null,
    proposed_summary: JSON.stringify(await summarize(trx, 'bill', String(billId))),
    requested_by: user?.id ?? null,
    requested_by_email: user?.email ?? 'system',
  }).returning('*');
  await logAudit(auditReq, 'approval.request_create', 'bill', billId, undefined, { request_id: row.id, reason }, trx);
  return row;
}

async function thresholdReason(conn: Conn, amount: number) {
  const threshold = await getBillApprovalThreshold(conn);
  return `Amount ${money(amount)} is above the approval limit of ${money(threshold)}`;
}

/**
 * Applies the approval limit to a bill that has just been inserted as pending or posted.
 * Returns the approval request when one was opened; the caller notifies admins after commit.
 */
export async function afterBillCreated(trx: Knex.Transaction, billId: number | string, amount: number, pending: boolean, user: Actor | null, auditReq: AuthRequest | null) {
  if (pending) return recordBillCreateRequest(trx, user, billId, await thresholdReason(trx, amount), auditReq);
  const threshold = await getBillApprovalThreshold(trx);
  if (threshold > 0 && amount > threshold + 0.005) {
    await logAudit(auditReq, 'bill.posted_over_approval_limit', 'bill', billId, undefined, { amount, threshold, note: 'Entered by an admin, so no second approval was required' }, trx);
  }
  return null;
}

/** createBill with the approval limit applied. Notify admins about `request` after the transaction commits. */
export async function createBillWithApprovalLimit(trx: Knex.Transaction, input: BillInput, req: AuthRequest | null) {
  const user = (req?.user as Actor | undefined) || null;
  const { columns } = await buildBill(trx, input);
  const pending = await billNeedsApproval(trx, columns.amount, user);
  const bill = await createBill(trx, input, { pending });
  const request = await afterBillCreated(trx, bill.id, bill.amount, pending, user, req);
  return { ...bill, request };
}

export { notifyAdmins as notifyAdminsOfRequest };

async function lockPending(trx: Knex.Transaction, id: number) {
  const row = await trx('approval_requests').where({ id }).forUpdate().first();
  if (!row) throw new LedgerError('Request not found', 404);
  if (row.status !== 'pending') throw new LedgerError(`This request has already been ${row.status}`, 409);
  return row;
}

function notifyRequester(row: any, title: string, body: string, type = 'info') {
  if (!row.requested_by) return Promise.resolve(0);
  return notify({ userId: row.requested_by }, title, body, { type, link: 'accounting-approvals' });
}

export async function approveRequest(req: AuthRequest, id: number, comment?: string) {
  const user = req.user as Actor;
  if (user.role !== 'admin') throw new LedgerError('Only an admin can approve requests', 403);
  const done = await db.transaction(async (trx) => {
    const row = await lockPending(trx, id);
    if (row.requested_by === user.id) throw new LedgerError('You cannot approve your own request. Another admin must approve it.', 403);
    const result = await applyRequest(trx, row);
    const [updated] = await trx('approval_requests').where({ id }).update({
      status: 'approved', decided_by: user.id, decided_by_email: user.email, decided_at: trx.fn.now(),
      decision_comment: String(comment || '').trim() || null, result: JSON.stringify(result), updated_at: trx.fn.now(),
    }).returning('*');
    await logAudit(req, `approval.approved_${row.action}`, row.entity_type, row.entity_id, parseJson(row.original_summary), {
      request_id: id, reason: row.reason, requested_by: row.requested_by_email, requested_at: row.requested_at,
      approved_by: user.email, comment: updated.decision_comment, proposed: parseJson(row.proposed_summary), result,
    }, trx);
    return updated;
  });
  await notifyRequester(done, `Approved: ${done.entity_label}`, `${ACTION_TEXT[done.action] || done.action} approved by ${user.email}${done.decision_comment ? `: ${done.decision_comment}` : ''}. It is now posted to the ledger.`, 'success');
  return done;
}

async function withdrawPendingBill(trx: Knex.Transaction, row: any, reason: string) {
  if (row.entity_type !== 'bill' || row.action !== 'create') return;
  const billId = Number(row.entity_id) || -1;
  await trx('bills').where({ id: billId, status: 'pending_approval' })
    .update({ status: 'void', voided_at: trx.fn.now(), void_reason: reason.slice(0, 250), updated_at: trx.fn.now() });
  await releasePurchaseOrder(trx, billId);
}

export async function rejectRequest(req: AuthRequest, id: number, comment?: string) {
  const user = req.user as Actor;
  if (user.role !== 'admin') throw new LedgerError('Only an admin can reject requests', 403);
  const note = String(comment || '').trim();
  if (!note) throw new LedgerError('Please say why the request is rejected');
  const done = await db.transaction(async (trx) => {
    const row = await lockPending(trx, id);
    if (row.requested_by === user.id) throw new LedgerError('This is your own request; cancel it instead.', 403);
    await withdrawPendingBill(trx, row, `Rejected by ${user.email}: ${note}`);
    const [updated] = await trx('approval_requests').where({ id }).update({
      status: 'rejected', decided_by: user.id, decided_by_email: user.email, decided_at: trx.fn.now(), decision_comment: note, updated_at: trx.fn.now(),
    }).returning('*');
    await logAudit(req, `approval.rejected_${row.action}`, row.entity_type, row.entity_id, undefined, {
      request_id: id, reason: row.reason, requested_by: row.requested_by_email, rejected_by: user.email, comment: note,
    }, trx);
    return updated;
  });
  const outcome = done.action === 'create' ? 'The bill was not posted.' : 'Nothing was changed.';
  await notifyRequester(done, `Rejected: ${done.entity_label}`, `${ACTION_TEXT[done.action] || done.action} rejected by ${user.email}: ${note}. ${outcome}`, 'error');
  return done;
}

export async function cancelRequest(req: AuthRequest, id: number) {
  const user = req.user as Actor;
  return db.transaction(async (trx) => {
    const row = await lockPending(trx, id);
    if (row.requested_by !== user.id) throw new LedgerError('Only the person who made the request can cancel it', 403);
    await withdrawPendingBill(trx, row, `Withdrawn by ${user.email}`);
    const [updated] = await trx('approval_requests').where({ id }).update({
      status: 'cancelled', decided_by: user.id, decided_by_email: user.email, decided_at: trx.fn.now(), updated_at: trx.fn.now(),
    }).returning('*');
    await logAudit(req, 'approval.cancelled', row.entity_type, row.entity_id, undefined, { request_id: id }, trx);
    return updated;
  });
}

export async function listRequests(user: Actor, status?: string) {
  const q = db('approval_requests').orderBy([{ column: 'requested_at', order: 'desc' }, { column: 'id', order: 'desc' }]).limit(500);
  if (status && status !== 'all') q.where({ status });
  if (user.role !== 'admin') q.where({ requested_by: user.id });
  const rows = await q;
  const isAdmin = user.role === 'admin';
  const otherAdmin = isAdmin ? await otherAdminExists(db, user.id) : true;
  return rows.map((r: any) => ({
    ...r,
    original_summary: parseJson(r.original_summary),
    proposed_summary: parseJson(r.proposed_summary),
    can_approve: isAdmin && r.status === 'pending' && r.requested_by !== user.id,
    can_cancel: r.status === 'pending' && r.requested_by === user.id,
    other_admin_available: otherAdmin,
  }));
}

/** Pending requests an admin can act on, or the user's own pending requests. */
export async function pendingCount(user: Actor) {
  const q = db('approval_requests').where({ status: 'pending' });
  if (user.role === 'admin') q.where((w) => w.whereNull('requested_by').orWhereNot('requested_by', user.id));
  else q.where({ requested_by: user.id });
  const [{ n }] = await q.count({ n: 'id' });
  return Number(n);
}

/** entity_id -> pending request, for badges on document lists. */
export async function pendingRequestMap(conn: Conn, type: EntityType) {
  const rows = await conn('approval_requests').where({ entity_type: type, status: 'pending' }).select('id', 'entity_id', 'action');
  return new Map<string, { id: number; action: string }>(rows.map((r: any) => [String(r.entity_id), { id: r.id, action: r.action }]));
}
