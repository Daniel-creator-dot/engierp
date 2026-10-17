import { Router } from 'express';
import db from '../db';
import { authenticateToken, authorizeRole, AuthRequest } from '../middleware/auth';

const router = Router();

const READ_ROLES = ['admin', 'accountant', 'pm', 'procurement'];
const SITE_ROLES = ['admin', 'pm'];
const BUY_ROLES = ['admin', 'accountant', 'procurement', 'pm'];
const MONEY_ROLES = ['admin', 'accountant', 'pm'];

const VARIATION_STATUS = ['Draft', 'Submitted', 'Approved', 'Rejected'];
const REQUISITION_STATUS = ['Submitted', 'Approved', 'Ordered', 'Rejected'];
const WORK_ORDER_STATUS = ['Draft', 'Issued', 'In Progress', 'Completed', 'Cancelled'];
const TENDER_STATUS = ['Open', 'Closed', 'Awarded'];
const MILESTONE_STATUS = ['Planned', 'In Progress', 'Done', 'Delayed'];
const INCIDENT_KINDS = ['Near Miss', 'Injury', 'Property', 'Environmental'];
const INCIDENT_SEVERITY = ['Low', 'Medium', 'High'];
const INCIDENT_STATUS = ['Open', 'Closed'];

const round2 = (n: number) => Math.round(n * 100) / 100;

function fail(res: any, error: unknown, message: string) {
  console.error(message, error);
  res.status(500).json({ message });
}

async function nextCode(table: string, prefix: string) {
  const year = new Date().getFullYear();
  const stem = `${prefix}-${year}-`;
  const last = await db(table).where('id', 'like', `${stem}%`).orderBy('id', 'desc').first();
  const n = last ? parseInt(String(last.id).slice(stem.length), 10) || 0 : 0;
  return `${stem}${String(n + 1).padStart(4, '0')}`;
}

async function requireProject(id: unknown) {
  if (!id) return null;
  return db('projects').where({ id: String(id) }).first();
}

function money(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? round2(n) : null;
}

function linesOf(body: any) {
  const raw = Array.isArray(body?.lines) ? body.lines : [];
  const lines = raw
    .map((line: any) => ({
      description: String(line?.description || '').trim(),
      unit: String(line?.unit || '').trim() || 'nr',
      quantity: Number(line?.quantity),
    }))
    .filter((line: any) => line.description && Number.isFinite(line.quantity) && line.quantity > 0);
  return lines;
}

router.get('/summary', authenticateToken, authorizeRole(READ_ROLES), async (_req, res) => {
  try {
    const [boq, variations, requisitions, workOrders, tenders, incidents] = await Promise.all([
      db('boq_items').sum('amount as total').count('id as count').first(),
      db('variations').where('status', 'Submitted').count('id as count').first(),
      db('material_requisitions').where('status', 'Submitted').count('id as count').first(),
      db('work_orders').whereIn('status', ['Issued', 'In Progress']).sum('amount as total').count('id as count').first(),
      db('tenders').where('status', 'Open').count('id as count').first(),
      db('hse_incidents').where('status', 'Open').count('id as count').first(),
    ]);
    res.json({
      boqTotal: Number(boq?.total || 0),
      boqItems: Number(boq?.count || 0),
      variationsWaiting: Number(variations?.count || 0),
      requisitionsWaiting: Number(requisitions?.count || 0),
      openWorkOrders: Number(workOrders?.count || 0),
      openWorkOrderValue: Number(workOrders?.total || 0),
      openTenders: Number(tenders?.count || 0),
      openIncidents: Number(incidents?.count || 0),
    });
  } catch (error) {
    fail(res, error, 'Could not load the commercial summary');
  }
});

router.get('/boq', authenticateToken, authorizeRole(READ_ROLES), async (req, res) => {
  try {
    const q = db('boq_items')
      .join('projects', 'boq_items.project_id', 'projects.id')
      .select('boq_items.*', 'projects.name as project_name')
      .orderBy(['boq_items.project_id', 'boq_items.item_no']);
    if (req.query.project_id) q.where('boq_items.project_id', String(req.query.project_id));
    res.json(await q);
  } catch (error) {
    fail(res, error, 'Could not load the bill of quantities');
  }
});

router.post('/boq', authenticateToken, authorizeRole(MONEY_ROLES), async (req: AuthRequest, res) => {
  try {
    const project = await requireProject(req.body?.project_id);
    if (!project) return res.status(400).json({ message: 'Choose a project' });
    const itemNo = String(req.body?.item_no || '').trim();
    const description = String(req.body?.description || '').trim();
    const unit = String(req.body?.unit || '').trim();
    const quantity = Number(req.body?.quantity);
    const rate = money(req.body?.rate);
    if (!itemNo || !description || !unit) return res.status(400).json({ message: 'Item number, description and unit are required' });
    if (!(quantity > 0) || rate === null || rate < 0) return res.status(400).json({ message: 'Quantity and rate must be valid amounts' });
    const [row] = await db('boq_items').insert({
      project_id: project.id,
      item_no: itemNo,
      description,
      unit,
      quantity,
      rate,
      amount: round2(quantity * rate),
      cost_code: String(req.body?.cost_code || '').trim() || null,
    }).returning('*');
    res.status(201).json(row);
  } catch (error) {
    fail(res, error, 'Could not add the BOQ item');
  }
});

router.delete('/boq/:id', authenticateToken, authorizeRole(MONEY_ROLES), async (req, res) => {
  try {
    const count = await db('boq_items').where({ id: req.params.id }).del();
    if (!count) return res.status(404).json({ message: 'BOQ item not found' });
    res.json({ message: 'BOQ item removed' });
  } catch (error) {
    fail(res, error, 'Could not remove the BOQ item');
  }
});

router.get('/variations', authenticateToken, authorizeRole(READ_ROLES), async (_req, res) => {
  try {
    const rows = await db('variations')
      .join('projects', 'variations.project_id', 'projects.id')
      .leftJoin('boq_items', 'variations.boq_item_id', 'boq_items.id')
      .select('variations.*', 'projects.name as project_name', 'boq_items.item_no')
      .orderBy('variations.created_at', 'desc');
    res.json(rows);
  } catch (error) {
    fail(res, error, 'Could not load variations');
  }
});

router.post('/variations', authenticateToken, authorizeRole(MONEY_ROLES), async (req: AuthRequest, res) => {
  try {
    const project = await requireProject(req.body?.project_id);
    if (!project) return res.status(400).json({ message: 'Choose a project' });
    const title = String(req.body?.title || '').trim();
    const amount = money(req.body?.amount);
    if (!title || amount === null) return res.status(400).json({ message: 'Title and amount are required' });
    const id = await nextCode('variations', 'VAR');
    const [row] = await db('variations').insert({
      id,
      project_id: project.id,
      boq_item_id: req.body?.boq_item_id ? Number(req.body.boq_item_id) : null,
      title,
      reason: String(req.body?.reason || '').trim() || null,
      amount,
      status: 'Submitted',
      requested_by: req.user?.id || null,
    }).returning('*');
    res.status(201).json(row);
  } catch (error) {
    fail(res, error, 'Could not raise the variation');
  }
});

router.patch('/variations/:id', authenticateToken, authorizeRole(['admin', 'accountant']), async (req, res) => {
  try {
    const status = String(req.body?.status || '');
    if (!VARIATION_STATUS.includes(status)) return res.status(400).json({ message: 'Unknown variation status' });
    const count = await db('variations').where({ id: req.params.id }).update({ status, updated_at: db.fn.now() });
    if (!count) return res.status(404).json({ message: 'Variation not found' });
    res.json({ message: 'Variation updated' });
  } catch (error) {
    fail(res, error, 'Could not update the variation');
  }
});

router.get('/requisitions', authenticateToken, authorizeRole(READ_ROLES), async (_req, res) => {
  try {
    const rows = await db('material_requisitions')
      .join('projects', 'material_requisitions.project_id', 'projects.id')
      .leftJoin('users', 'material_requisitions.requested_by', 'users.id')
      .select('material_requisitions.*', 'projects.name as project_name', 'users.email as requested_by_email')
      .orderBy('material_requisitions.created_at', 'desc');
    res.json(rows.map((row) => ({
      ...row,
      lines: typeof row.lines === 'string' ? JSON.parse(row.lines) : row.lines,
    })));
  } catch (error) {
    fail(res, error, 'Could not load material requisitions');
  }
});

router.post('/requisitions', authenticateToken, authorizeRole(SITE_ROLES.concat('procurement')), async (req: AuthRequest, res) => {
  try {
    const project = await requireProject(req.body?.project_id);
    if (!project) return res.status(400).json({ message: 'Choose a project' });
    const lines = linesOf(req.body);
    if (!lines.length) return res.status(400).json({ message: 'Add at least one material line' });
    const id = await nextCode('material_requisitions', 'MR');
    const [row] = await db('material_requisitions').insert({
      id,
      project_id: project.id,
      needed_by: req.body?.needed_by || null,
      status: 'Submitted',
      notes: String(req.body?.notes || '').trim() || null,
      lines: JSON.stringify(lines),
      requested_by: req.user?.id || null,
    }).returning('*');
    res.status(201).json(row);
  } catch (error) {
    fail(res, error, 'Could not submit the requisition');
  }
});

router.patch('/requisitions/:id', authenticateToken, authorizeRole(['admin', 'procurement', 'accountant']), async (req, res) => {
  try {
    const status = String(req.body?.status || '');
    if (!REQUISITION_STATUS.includes(status)) return res.status(400).json({ message: 'Unknown requisition status' });
    const count = await db('material_requisitions').where({ id: req.params.id }).update({ status, updated_at: db.fn.now() });
    if (!count) return res.status(404).json({ message: 'Requisition not found' });
    res.json({ message: 'Requisition updated' });
  } catch (error) {
    fail(res, error, 'Could not update the requisition');
  }
});

router.get('/work-orders', authenticateToken, authorizeRole(READ_ROLES), async (_req, res) => {
  try {
    const rows = await db('work_orders')
      .join('projects', 'work_orders.project_id', 'projects.id')
      .leftJoin('suppliers', 'work_orders.supplier_id', 'suppliers.id')
      .select('work_orders.*', 'projects.name as project_name', 'suppliers.name as supplier_name')
      .orderBy('work_orders.created_at', 'desc');
    res.json(rows);
  } catch (error) {
    fail(res, error, 'Could not load work orders');
  }
});

router.post('/work-orders', authenticateToken, authorizeRole(BUY_ROLES), async (req: AuthRequest, res) => {
  try {
    const project = await requireProject(req.body?.project_id);
    if (!project) return res.status(400).json({ message: 'Choose a project' });
    const title = String(req.body?.title || '').trim();
    const amount = money(req.body?.amount);
    if (!title || amount === null || amount < 0) return res.status(400).json({ message: 'Title and contract amount are required' });
    if (req.body?.supplier_id) {
      const supplier = await db('suppliers').where({ id: req.body.supplier_id }).first();
      if (!supplier) return res.status(400).json({ message: 'Subcontractor not found' });
    }
    const id = await nextCode('work_orders', 'WO');
    const [row] = await db('work_orders').insert({
      id,
      project_id: project.id,
      supplier_id: req.body?.supplier_id || null,
      title,
      scope: String(req.body?.scope || '').trim() || null,
      amount,
      start_date: req.body?.start_date || null,
      end_date: req.body?.end_date || null,
      status: 'Issued',
      created_by: req.user?.id || null,
    }).returning('*');
    res.status(201).json(row);
  } catch (error) {
    fail(res, error, 'Could not issue the work order');
  }
});

router.patch('/work-orders/:id', authenticateToken, authorizeRole(BUY_ROLES), async (req, res) => {
  try {
    const status = String(req.body?.status || '');
    if (!WORK_ORDER_STATUS.includes(status)) return res.status(400).json({ message: 'Unknown work order status' });
    const count = await db('work_orders').where({ id: req.params.id }).update({ status, updated_at: db.fn.now() });
    if (!count) return res.status(404).json({ message: 'Work order not found' });
    res.json({ message: 'Work order updated' });
  } catch (error) {
    fail(res, error, 'Could not update the work order');
  }
});

router.get('/tenders', authenticateToken, authorizeRole(READ_ROLES), async (_req, res) => {
  try {
    const tenders = await db('tenders')
      .leftJoin('projects', 'tenders.project_id', 'projects.id')
      .leftJoin('suppliers as awarded', 'tenders.awarded_supplier_id', 'awarded.id')
      .select('tenders.*', 'projects.name as project_name', 'awarded.name as awarded_supplier_name')
      .orderBy('tenders.created_at', 'desc');
    const quotes = await db('tender_quotes')
      .join('suppliers', 'tender_quotes.supplier_id', 'suppliers.id')
      .select('tender_quotes.*', 'suppliers.name as supplier_name')
      .orderBy('tender_quotes.amount', 'asc');
    const byTender = new Map<string, any[]>();
    for (const quote of quotes) {
      const list = byTender.get(quote.tender_id) || [];
      list.push(quote);
      byTender.set(quote.tender_id, list);
    }
    res.json(tenders.map((tender) => ({ ...tender, quotes: byTender.get(tender.id) || [] })));
  } catch (error) {
    fail(res, error, 'Could not load tenders');
  }
});

router.post('/tenders', authenticateToken, authorizeRole(['admin', 'procurement', 'accountant']), async (req: AuthRequest, res) => {
  try {
    const title = String(req.body?.title || '').trim();
    if (!title) return res.status(400).json({ message: 'Tender title is required' });
    if (req.body?.project_id && !(await requireProject(req.body.project_id))) {
      return res.status(400).json({ message: 'Project not found' });
    }
    const id = await nextCode('tenders', 'TND');
    const [row] = await db('tenders').insert({
      id,
      project_id: req.body?.project_id || null,
      title,
      closes_on: req.body?.closes_on || null,
      status: 'Open',
      notes: String(req.body?.notes || '').trim() || null,
      created_by: req.user?.id || null,
    }).returning('*');
    res.status(201).json(row);
  } catch (error) {
    fail(res, error, 'Could not open the tender');
  }
});

router.post('/tenders/:id/quotes', authenticateToken, authorizeRole(['admin', 'procurement', 'accountant']), async (req, res) => {
  try {
    const tender = await db('tenders').where({ id: req.params.id }).first();
    if (!tender) return res.status(404).json({ message: 'Tender not found' });
    if (tender.status === 'Awarded') return res.status(400).json({ message: 'This tender is already awarded' });
    const supplier = await db('suppliers').where({ id: req.body?.supplier_id }).first();
    if (!supplier) return res.status(400).json({ message: 'Choose a supplier' });
    const amount = money(req.body?.amount);
    if (amount === null || amount < 0) return res.status(400).json({ message: 'Quote amount is required' });
    const existing = await db('tender_quotes').where({ tender_id: tender.id, supplier_id: supplier.id }).first();
    const payload = {
      amount,
      lead_days: req.body?.lead_days ? Number(req.body.lead_days) : null,
      notes: String(req.body?.notes || '').trim() || null,
    };
    if (existing) {
      await db('tender_quotes').where({ id: existing.id }).update(payload);
    } else {
      await db('tender_quotes').insert({ tender_id: tender.id, supplier_id: supplier.id, ...payload });
    }
    res.status(201).json({ message: 'Quote recorded' });
  } catch (error) {
    fail(res, error, 'Could not record the quote');
  }
});

router.post('/tenders/:id/award', authenticateToken, authorizeRole(['admin', 'procurement']), async (req, res) => {
  try {
    const tender = await db('tenders').where({ id: req.params.id }).first();
    if (!tender) return res.status(404).json({ message: 'Tender not found' });
    const quote = await db('tender_quotes').where({ tender_id: tender.id, supplier_id: req.body?.supplier_id }).first();
    if (!quote) return res.status(400).json({ message: 'Award a supplier who has quoted' });
    await db('tenders').where({ id: tender.id }).update({
      status: 'Awarded',
      awarded_supplier_id: quote.supplier_id,
      updated_at: db.fn.now(),
    });
    res.json({ message: 'Tender awarded' });
  } catch (error) {
    fail(res, error, 'Could not award the tender');
  }
});

router.patch('/tenders/:id', authenticateToken, authorizeRole(['admin', 'procurement']), async (req, res) => {
  try {
    const status = String(req.body?.status || '');
    if (!TENDER_STATUS.includes(status) || status === 'Awarded') {
      return res.status(400).json({ message: 'Use award to choose a supplier, or set Open or Closed' });
    }
    const count = await db('tenders').where({ id: req.params.id }).update({ status, updated_at: db.fn.now() });
    if (!count) return res.status(404).json({ message: 'Tender not found' });
    res.json({ message: 'Tender updated' });
  } catch (error) {
    fail(res, error, 'Could not update the tender');
  }
});

router.get('/milestones', authenticateToken, authorizeRole(READ_ROLES), async (_req, res) => {
  try {
    const rows = await db('project_milestones')
      .join('projects', 'project_milestones.project_id', 'projects.id')
      .select('project_milestones.*', 'projects.name as project_name')
      .orderBy('project_milestones.due_date', 'asc');
    res.json(rows);
  } catch (error) {
    fail(res, error, 'Could not load the programme');
  }
});

router.post('/milestones', authenticateToken, authorizeRole(SITE_ROLES), async (req, res) => {
  try {
    const project = await requireProject(req.body?.project_id);
    if (!project) return res.status(400).json({ message: 'Choose a project' });
    const name = String(req.body?.name || '').trim();
    if (!name || !req.body?.due_date) return res.status(400).json({ message: 'Name and due date are required' });
    const [row] = await db('project_milestones').insert({
      project_id: project.id,
      name,
      due_date: req.body.due_date,
      status: MILESTONE_STATUS.includes(req.body?.status) ? req.body.status : 'Planned',
      notes: String(req.body?.notes || '').trim() || null,
    }).returning('*');
    res.status(201).json(row);
  } catch (error) {
    fail(res, error, 'Could not add the milestone');
  }
});

router.patch('/milestones/:id', authenticateToken, authorizeRole(SITE_ROLES), async (req, res) => {
  try {
    const status = String(req.body?.status || '');
    if (!MILESTONE_STATUS.includes(status)) return res.status(400).json({ message: 'Unknown milestone status' });
    const count = await db('project_milestones').where({ id: req.params.id }).update({ status, updated_at: db.fn.now() });
    if (!count) return res.status(404).json({ message: 'Milestone not found' });
    res.json({ message: 'Milestone updated' });
  } catch (error) {
    fail(res, error, 'Could not update the milestone');
  }
});

router.get('/incidents', authenticateToken, authorizeRole(READ_ROLES), async (_req, res) => {
  try {
    const rows = await db('hse_incidents')
      .join('projects', 'hse_incidents.project_id', 'projects.id')
      .leftJoin('users', 'hse_incidents.reported_by', 'users.id')
      .select('hse_incidents.*', 'projects.name as project_name', 'users.email as reported_by_email')
      .orderBy('hse_incidents.occurred_on', 'desc');
    res.json(rows);
  } catch (error) {
    fail(res, error, 'Could not load safety records');
  }
});

router.post('/incidents', authenticateToken, authorizeRole(SITE_ROLES.concat(['accountant'])), async (req: AuthRequest, res) => {
  try {
    const project = await requireProject(req.body?.project_id);
    if (!project) return res.status(400).json({ message: 'Choose a project' });
    const description = String(req.body?.description || '').trim();
    const kind = String(req.body?.kind || '');
    const severity = String(req.body?.severity || 'Low');
    if (!description || !INCIDENT_KINDS.includes(kind)) return res.status(400).json({ message: 'Kind and description are required' });
    if (!INCIDENT_SEVERITY.includes(severity) || !req.body?.occurred_on) {
      return res.status(400).json({ message: 'Date and severity are required' });
    }
    const [row] = await db('hse_incidents').insert({
      project_id: project.id,
      occurred_on: req.body.occurred_on,
      kind,
      severity,
      description,
      action_taken: String(req.body?.action_taken || '').trim() || null,
      status: 'Open',
      reported_by: req.user?.id || null,
    }).returning('*');
    res.status(201).json(row);
  } catch (error) {
    fail(res, error, 'Could not record the incident');
  }
});

router.patch('/incidents/:id', authenticateToken, authorizeRole(SITE_ROLES), async (req, res) => {
  try {
    const status = String(req.body?.status || '');
    if (!INCIDENT_STATUS.includes(status)) return res.status(400).json({ message: 'Unknown incident status' });
    const updates: Record<string, unknown> = { status, updated_at: db.fn.now() };
    if (req.body?.action_taken !== undefined) updates.action_taken = String(req.body.action_taken || '').trim() || null;
    const count = await db('hse_incidents').where({ id: req.params.id }).update(updates);
    if (!count) return res.status(404).json({ message: 'Incident not found' });
    res.json({ message: 'Incident updated' });
  } catch (error) {
    fail(res, error, 'Could not update the incident');
  }
});

export default router;
