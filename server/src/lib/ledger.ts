import type { Knex } from 'knex';
import type { Response } from 'express';

/**
 * Single entry point for every ledger posting.
 *
 * Convention: chart_of_accounts.balance always holds SUM(debit) - SUM(credit)
 * for every account type. Liability, Equity and Income accounts therefore carry
 * negative balances; use naturalBalance() to show them the way accountants read them.
 */

export type Conn = Knex | Knex.Transaction;

export interface JournalLine {
  account_id: number | string;
  debit?: number | string | null;
  credit?: number | string | null;
}

export interface LedgerLine extends JournalLine {
  journal_id: number;
}

export interface JournalInput {
  date?: string | Date | null;
  description: string;
  reference_type: string;
  reference_id?: string | number | null;
  project_id?: string | null;
  lines: JournalLine[];
}

export class LedgerError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export const PERIOD_LOCK_KEY = 'books_closed_through';
export const CREDIT_NORMAL_TYPES = ['Liability', 'Equity', 'Income'];

export const round2 = (value: unknown) => Math.round((Number(value) || 0) * 100) / 100;

/** Balance with the sign an accountant expects (credit-normal accounts shown positive). */
export const naturalBalance = (type: string, debitMinusCredit: unknown) =>
  CREDIT_NORMAL_TYPES.includes(type) ? -round2(debitMinusCredit) : round2(debitMinusCredit);

const pad = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' for strings, Date objects (pg DATE columns) or today when empty. */
export function toIsoDate(value?: string | Date | null): string {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export async function getBooksClosedThrough(conn: Conn): Promise<string | null> {
  const row = await conn('settings').where({ key: PERIOD_LOCK_KEY }).first();
  const value = String(row?.value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

/** Throws when the date falls on or before the books_closed_through setting. */
export async function assertPeriodOpen(conn: Conn, date?: string | Date | null) {
  const closedThrough = await getBooksClosedThrough(conn);
  if (!closedThrough) return;
  const iso = toIsoDate(date);
  if (iso <= closedThrough) {
    throw new LedgerError(`The books are closed through ${closedThrough}. Use a date after that, or ask an admin to reopen the period.`);
  }
}

function normaliseLines<T extends JournalLine>(lines: T[]) {
  return lines
    .map((line) => ({ ...line, account_id: Number(line.account_id), debit: round2(line.debit), credit: round2(line.credit) }))
    .filter((line) => line.debit !== 0 || line.credit !== 0);
}

/**
 * Inserts ledger lines and moves chart_of_accounts.balance by (debit - credit).
 * Does not check that the lines balance or that the period is open; postJournal does both.
 */
export async function applyLines(trx: Knex.Transaction, lines: LedgerLine[]) {
  const clean = normaliseLines(lines);
  if (clean.length === 0) return;

  for (const line of clean) {
    if (!Number.isInteger(line.account_id) || line.account_id <= 0) throw new LedgerError('Every line needs an account');
    if (line.debit < 0 || line.credit < 0) throw new LedgerError('Debits and credits cannot be negative');
  }

  const accountIds = [...new Set(clean.map((l) => l.account_id))];
  const found = await trx('chart_of_accounts').whereIn('id', accountIds).select('id');
  if (found.length !== accountIds.length) throw new LedgerError('One or more accounts do not exist in the chart of accounts');

  await trx('ledger_entries').insert(
    clean.map((l) => ({ journal_id: l.journal_id, account_id: l.account_id, debit: l.debit, credit: l.credit }))
  );

  const impact = new Map<number, number>();
  for (const l of clean) impact.set(l.account_id, round2((impact.get(l.account_id) || 0) + l.debit - l.credit));
  for (const [id, amount] of impact) {
    if (amount !== 0) await trx('chart_of_accounts').where({ id }).increment('balance', amount);
  }
}

/** Deletes a journal's ledger lines and takes their effect back out of the account balances. */
export async function removeJournalLines(trx: Knex.Transaction, journalId: number | string) {
  const entries = await trx('ledger_entries').where({ journal_id: journalId });
  const impact = new Map<number, number>();
  for (const e of entries) {
    impact.set(e.account_id, round2((impact.get(e.account_id) || 0) + Number(e.debit || 0) - Number(e.credit || 0)));
  }
  for (const [id, amount] of impact) {
    if (amount !== 0) await trx('chart_of_accounts').where({ id }).decrement('balance', amount);
  }
  await trx('ledger_entries').where({ journal_id: journalId }).del();
}

export function assertBalanced(lines: JournalLine[]) {
  const clean = normaliseLines(lines);
  if (clean.length < 2) throw new LedgerError('A journal needs at least two non-zero lines');
  const debits = round2(clean.reduce((s, l) => s + l.debit, 0));
  const credits = round2(clean.reduce((s, l) => s + l.credit, 0));
  if (Math.abs(debits - credits) > 0.005) {
    throw new LedgerError(`Journal is not balanced: debits ${debits.toFixed(2)} vs credits ${credits.toFixed(2)}`);
  }
  if (debits === 0) throw new LedgerError('Journal total cannot be zero');
  return debits;
}

/** Validates, checks the period lock, writes the header and its lines. Returns the journal id. */
export async function postJournal(trx: Knex.Transaction, input: JournalInput): Promise<number> {
  assertBalanced(input.lines);
  const date = toIsoDate(input.date);
  await assertPeriodOpen(trx, date);

  const [inserted] = await trx('journal_entries').insert({
    date,
    description: input.description,
    reference_type: input.reference_type,
    reference_id: input.reference_id != null ? String(input.reference_id) : null,
    project_id: input.project_id && input.project_id !== 'none' ? input.project_id : null,
  }).returning('id');
  const journalId = typeof inserted === 'object' ? inserted.id : inserted;

  await applyLines(trx, input.lines.map((l) => ({ ...l, journal_id: journalId })));
  return journalId;
}

/** Replaces a journal's header and lines in place (both old and new dates must be open). */
export async function updateJournal(
  trx: Knex.Transaction,
  journalId: number | string,
  input: Omit<JournalInput, 'reference_type' | 'reference_id'>
) {
  const header = await trx('journal_entries').where({ id: journalId }).first();
  if (!header) throw new LedgerError('Journal entry not found', 404);
  assertBalanced(input.lines);
  await assertPeriodOpen(trx, header.date);
  const date = toIsoDate(input.date);
  await assertPeriodOpen(trx, date);

  await removeJournalLines(trx, journalId);
  await trx('journal_entries').where({ id: journalId }).update({
    date,
    description: input.description,
    project_id: input.project_id && input.project_id !== 'none' ? input.project_id : null,
    updated_at: trx.fn.now(),
  });
  await applyLines(trx, input.lines.map((l) => ({ ...l, journal_id: Number(journalId) })));
}

export async function deleteJournal(trx: Knex.Transaction, journalId: number | string) {
  const header = await trx('journal_entries').where({ id: journalId }).first();
  if (!header) throw new LedgerError('Journal entry not found', 404);
  await assertPeriodOpen(trx, header.date);
  await removeJournalLines(trx, journalId);
  await trx('journal_entries').where({ id: journalId }).del();
}

/** Posts a mirror-image journal (debits and credits swapped) that cancels the original. */
export async function reverseJournal(
  trx: Knex.Transaction,
  journalId: number | string,
  opts: { date?: string | null; description: string; reference_type: string; reference_id?: string | number | null }
) {
  const header = await trx('journal_entries').where({ id: journalId }).first();
  if (!header) throw new LedgerError('Journal entry not found', 404);
  const entries = await trx('ledger_entries').where({ journal_id: journalId });
  return postJournal(trx, {
    date: opts.date,
    description: opts.description,
    reference_type: opts.reference_type,
    reference_id: opts.reference_id,
    project_id: header.project_id,
    lines: entries.map((e: any) => ({ account_id: e.account_id, debit: e.credit, credit: e.debit })),
  });
}

export async function findAccountByCode(conn: Conn, code: string) {
  return conn('chart_of_accounts').where({ code }).first();
}

/** Sends LedgerError messages with their status; anything else is a 500. */
export function sendError(res: Response, error: any, fallback: string) {
  if (error instanceof LedgerError) return res.status(error.status).json({ message: error.message });
  console.error(`${fallback}:`, error);
  return res.status(500).json({ message: error?.message || fallback });
}
