import express, { Router } from 'express';
import db from '../db';
import { AuthRequest } from '../middleware/auth';
import { LedgerError, assertBalanced, postJournal, round2, sendError, toIsoDate } from '../lib/ledger';
import { pick } from '../lib/accounting';
import { createBill } from '../lib/accountingDocs';

// Mounted inside routes/accounting.ts, which already enforces admin/accountant access.
const router = Router();

// --- Recurring templates ---

const FREQUENCIES = ['weekly', 'monthly', 'quarterly', 'yearly'];
const KINDS = ['journal', 'bill'];

export function advanceDate(iso: string, frequency: string) {
  const [y, m, d] = iso.split('-').map(Number);
  if (frequency === 'weekly') {
    const dt = new Date(Date.UTC(y, m - 1, d + 7));
    return dt.toISOString().slice(0, 10);
  }
  const months = frequency === 'monthly' ? 1 : frequency === 'quarterly' ? 3 : 12;
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

function parsePayload(v: any) {
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return {}; }
  }
  return v || {};
}

async function validateTemplate(data: any) {
  if (!String(data.name || '').trim()) throw new LedgerError('Template name is required');
  if (!KINDS.includes(data.kind)) throw new LedgerError('kind must be journal or bill');
  if (!FREQUENCIES.includes(data.frequency)) throw new LedgerError(`frequency must be one of ${FREQUENCIES.join(', ')}`);
  if (!data.next_run_date) throw new LedgerError('Choose the first date to generate');
  const payload = parsePayload(data.payload);
  if (data.kind === 'journal') {
    const lines = (payload.lines || []).map((l: any) => ({ account_id: Number(l.account_id), debit: round2(l.debit), credit: round2(l.credit) })).filter((l: any) => l.account_id);
    assertBalanced(lines);
    if (!String(payload.description || '').trim()) throw new LedgerError('Journal description is required');
    return { description: String(payload.description).trim(), project_id: payload.project_id || null, lines };
  }
  if (!payload.supplier_id || !payload.account_id || !(Number(payload.amount) > 0)) throw new LedgerError('Recurring bills need a supplier, account and amount');
  return {
    supplier_id: payload.supplier_id,
    account_id: Number(payload.account_id),
    amount: round2(payload.amount),
    category: payload.category || null,
    project_id: payload.project_id || null,
    due_days: Math.max(0, Number(payload.due_days) || 0),
    description: payload.description || null,
  };
}

router.get('/recurring', async (req, res) => {
  try {
    const rows = await db('recurring_templates').orderBy('next_run_date');
    const today = toIsoDate();
    res.json(rows.map((r: any) => ({ ...r, next_run_date: toIsoDate(r.next_run_date), end_date: r.end_date ? toIsoDate(r.end_date) : null, payload: parsePayload(r.payload), due: r.is_active && toIsoDate(r.next_run_date) <= today })));
  } catch (error) {
    sendError(res, error, 'Error loading recurring templates');
  }
});

router.post('/recurring', async (req, res) => {
  try {
    const data: any = pick(req.body, ['name', 'kind', 'frequency', 'next_run_date', 'end_date', 'is_active', 'payload'] as const);
    const payload = await validateTemplate(data);
    const [row] = await db('recurring_templates').insert({
      name: String(data.name).trim(),
      kind: data.kind,
      frequency: data.frequency,
      next_run_date: toIsoDate(data.next_run_date),
      end_date: data.end_date ? toIsoDate(data.end_date) : null,
      is_active: data.is_active !== false,
      payload: JSON.stringify(payload),
    }).returning('*');
    res.status(201).json(row);
  } catch (error) {
    sendError(res, error, 'Error saving recurring template');
  }
});

router.put('/recurring/:id', async (req, res) => {
  try {
    const existing = await db('recurring_templates').where({ id: req.params.id }).first();
    if (!existing) throw new LedgerError('Template not found', 404);
    const data: any = { ...existing, payload: parsePayload(existing.payload), ...pick(req.body, ['name', 'kind', 'frequency', 'next_run_date', 'end_date', 'is_active', 'payload'] as const) };
    data.next_run_date = toIsoDate(data.next_run_date);
    const payload = await validateTemplate(data);
    await db('recurring_templates').where({ id: req.params.id }).update({
      name: String(data.name).trim(),
      kind: data.kind,
      frequency: data.frequency,
      next_run_date: data.next_run_date,
      end_date: data.end_date ? toIsoDate(data.end_date) : null,
      is_active: data.is_active !== false,
      payload: JSON.stringify(payload),
      updated_at: db.fn.now(),
    });
    res.json({ message: 'Template updated' });
  } catch (error) {
    sendError(res, error, 'Error updating recurring template');
  }
});

router.delete('/recurring/:id', async (req, res) => {
  try {
    await db('recurring_templates').where({ id: req.params.id }).del();
    res.json({ message: 'Template deleted' });
  } catch (error) {
    sendError(res, error, 'Error deleting recurring template');
  }
});

// Creates every journal/bill that has fallen due up to today, catching up missed periods.
router.post('/recurring/generate', async (req, res) => {
  try {
    const today = toIsoDate();
    const templates = await db('recurring_templates').where({ is_active: true }).where('next_run_date', '<=', today);
    const created: any[] = [];
    const failed: any[] = [];
    for (const t of templates) {
      const payload = parsePayload(t.payload);
      let next = toIsoDate(t.next_run_date);
      const end = t.end_date ? toIsoDate(t.end_date) : null;
      try {
        await db.transaction(async (trx) => {
          let guard = 0;
          while (next <= today && (!end || next <= end) && guard++ < 60) {
            if (t.kind === 'journal') {
              const id = await postJournal(trx, { date: next, description: `${payload.description} (${t.name})`, reference_type: 'manual', project_id: payload.project_id, lines: payload.lines });
              created.push({ template: t.name, kind: 'journal', id, date: next });
            } else {
              const due = new Date(Date.parse(next) + (Number(payload.due_days) || 0) * 86400000).toISOString().slice(0, 10);
              const bill = await createBill(trx, { supplier_id: payload.supplier_id, account_id: payload.account_id, amount: payload.amount, quantity: 1, unit_price: payload.amount, category: payload.category, project_id: payload.project_id, date: next, due_date: due, description: payload.description, reference: `${t.name} ${next}` });
              created.push({ template: t.name, kind: 'bill', id: bill.id, date: next });
            }
            next = advanceDate(next, t.frequency);
          }
          await trx('recurring_templates').where({ id: t.id }).update({
            next_run_date: next,
            is_active: !end || next <= end,
            last_run_at: trx.fn.now(),
            updated_at: trx.fn.now(),
          });
        });
      } catch (e: any) {
        failed.push({ template: t.name, message: e.message });
      }
    }
    res.json({ message: `Generated ${created.length} item(s)${failed.length ? `, ${failed.length} template(s) failed` : ''}`, created, failed });
  } catch (error) {
    sendError(res, error, 'Error generating recurring items');
  }
});

// --- Attachments (stored in Postgres because the host filesystem is ephemeral) ---

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const ENTITY_TYPES = ['invoice', 'bill', 'journal'];

router.get('/attachments', async (req, res) => {
  try {
    const { entity_type, entity_id } = req.query;
    if (!ENTITY_TYPES.includes(String(entity_type)) || !entity_id) throw new LedgerError('entity_type and entity_id are required');
    res.json(await db('attachments').where({ entity_type: String(entity_type), entity_id: String(entity_id) })
      .select('id', 'entity_type', 'entity_id', 'file_name', 'mime_type', 'size_bytes', 'uploaded_by', 'created_at').orderBy('created_at'));
  } catch (error) {
    sendError(res, error, 'Error loading attachments');
  }
});

// Raw file body; metadata travels in the query string.
router.post('/attachments', express.raw({ type: () => true, limit: MAX_ATTACHMENT_BYTES + 1024 }), async (req: AuthRequest, res) => {
  try {
    const entityType = String(req.query.entity_type || '');
    const entityId = String(req.query.entity_id || '');
    const fileName = String(req.query.file_name || 'attachment').slice(0, 200);
    if (!ENTITY_TYPES.includes(entityType) || !entityId) throw new LedgerError('entity_type and entity_id are required');
    const data = req.body as Buffer;
    if (!Buffer.isBuffer(data) || data.length === 0) throw new LedgerError('The file is empty');
    if (data.length > MAX_ATTACHMENT_BYTES) throw new LedgerError('Files must be 5 MB or smaller');
    const [row] = await db('attachments').insert({
      entity_type: entityType,
      entity_id: entityId,
      file_name: fileName,
      mime_type: String(req.headers['content-type'] || 'application/octet-stream').slice(0, 120),
      size_bytes: data.length,
      data,
      uploaded_by: req.user?.email || null,
    }).returning(['id', 'file_name', 'size_bytes', 'created_at']);
    res.status(201).json(row);
  } catch (error: any) {
    if (error?.type === 'entity.too.large') return res.status(413).json({ message: 'Files must be 5 MB or smaller' });
    sendError(res, error, 'Error uploading attachment');
  }
});

router.get('/attachments/:id/download', async (req, res) => {
  try {
    const row = await db('attachments').where({ id: req.params.id }).first();
    if (!row) throw new LedgerError('Attachment not found', 404);
    res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(row.file_name)}"`);
    res.send(row.data);
  } catch (error) {
    sendError(res, error, 'Error downloading attachment');
  }
});

router.delete('/attachments/:id', async (req, res) => {
  try {
    await db('attachments').where({ id: req.params.id }).del();
    res.json({ message: 'Attachment deleted' });
  } catch (error) {
    sendError(res, error, 'Error deleting attachment');
  }
});

export default router;
