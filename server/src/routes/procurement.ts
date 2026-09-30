import { Router } from 'express';
import type { Knex } from 'knex';
import db from '../db';
import { authenticateToken, authorizeRole, AuthRequest } from '../middleware/auth';
import { pick, orNull } from '../utils/pick';
import { LedgerError, findAccountByCode, postJournal, round2, sendError, toIsoDate } from '../lib/ledger';

const router = Router();

const BUYER_ROLES = ['procurement', 'admin', 'accountant'];
const APPROVER_ROLES = ['admin', 'accountant'];
const RECEIVER_ROLES = ['procurement', 'admin', 'accountant', 'pm'];
const BILLING_ROLES = ['admin', 'accountant'];
const STOCK_ROLES = ['procurement', 'admin', 'accountant', 'pm'];

export const PO_STATUS = {
  pending: 'Pending Approval',
  approved: 'Approved',
  rejected: 'Rejected',
  partial: 'Partially Received',
  received: 'Received',
  billed: 'Billed',
  cancelled: 'Cancelled',
} as const;

const httpError = (message: string, status = 400) => new LedgerError(message, status);

/** Next sequential code such as PO-2026-0007; relies on the zero-padded suffix sorting as text. */
async function nextCode(conn: Knex | Knex.Transaction, table: string, prefix: string, width = 4) {
  const last = await conn(table).where('id', 'like', `${prefix}%`).orderBy('id', 'desc').first();
  const n = last ? parseInt(String(last.id).slice(prefix.length), 10) || 0 : 0;
  return `${prefix}${String(n + 1).padStart(width, '0')}`;
}

// ---------------------------------------------------------------- Suppliers

const SUPPLIER_FIELDS = ['name', 'category', 'contact_person', 'email', 'phone', 'address', 'tin', 'payment_terms_days', 'rating'] as const;

function cleanSupplier(body: unknown) {
  const data: Record<string, any> = pick(body, SUPPLIER_FIELDS);
  for (const key of ['name', 'category', 'contact_person', 'email', 'phone', 'address'] as const) {
    if (typeof data[key] === 'string') data[key] = data[key].trim();
  }
  if (data.tin !== undefined) {
    const tin = String(data.tin || '').trim().toUpperCase().replace(/\s+/g, '');
    if (tin && !/^[A-Z0-9-]{9,20}$/.test(tin)) throw httpError('GRA TIN should be 9-20 letters/digits (e.g. C0012345678 or GHA-123456789-0)');
    data.tin = tin || null;
  }
  if (data.payment_terms_days !== undefined) {
    const days = Number(data.payment_terms_days);
    if (!Number.isInteger(days) || days < 0 || days > 365) throw httpError('Payment terms must be 0-365 days');
    data.payment_terms_days = days;
  }
  if (data.rating !== undefined) data.rating = Math.min(Math.max(Number(data.rating) || 0, 0), 5);
  for (const key of ['email', 'phone', 'address', 'contact_person'] as const) {
    if (key in data) data[key] = orNull(data[key]);
  }
  return data;
}

router.get('/suppliers', authenticateToken, async (req, res) => {
  try {
    const suppliers = await db('suppliers').select('*').orderBy('name', 'asc');
    res.json(suppliers);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching suppliers' });
  }
});

router.post('/suppliers', authenticateToken, authorizeRole(BUYER_ROLES), async (req, res) => {
  try {
    const data = cleanSupplier(req.body);
    if (!data.name || !data.category) return res.status(400).json({ message: 'Supplier name and category are required' });
    const id = await nextCode(db, 'suppliers', 'SUP-');
    await db('suppliers').insert({ id, rating: 0, ...data });
    res.status(201).json({ id, message: 'Supplier registered' });
  } catch (error) {
    sendError(res, error, 'Error registering supplier');
  }
});

router.patch('/suppliers/:id', authenticateToken, authorizeRole(BUYER_ROLES), async (req, res) => {
  try {
    const updates = cleanSupplier(req.body);
    if (Object.keys(updates).length === 0) return res.status(400).json({ message: 'Nothing to update' });
    if (updates.name === '' || updates.category === '') return res.status(400).json({ message: 'Supplier name and category cannot be blank' });
    const count = await db('suppliers').where({ id: req.params.id }).update({ ...updates, updated_at: db.fn.now() });
    if (!count) return res.status(404).json({ message: 'Supplier not found' });
    res.json({ message: 'Supplier updated' });
  } catch (error) {
    sendError(res, error, 'Error updating supplier');
  }
});

// Supplier history (bills, POs, payments)
router.get('/suppliers/:id/history', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const purchaseOrders = await db('purchase_orders')
      .where({ supplier_id: id })
      .orderBy('order_date', 'desc');

    const rawBills = await db('bills')
      .where({ supplier_id: id })
      .orderBy('created_at', 'desc');

    // payments.target_id is varchar while bills.id is integer
    const billIds = rawBills.map((b: any) => String(b.id));
    let payments: any[] = [];

    if (billIds.length > 0) {
      payments = await db('payments')
        .where('target_type', 'Bill')
        .whereIn('target_id', billIds)
        .orderBy('date', 'desc');
    }

    const paidByBill = new Map<string, number>();
    for (const p of payments) {
      paidByBill.set(String(p.target_id), (paidByBill.get(String(p.target_id)) || 0) + Number(p.amount || 0));
    }

    const bills = rawBills.map((bill: any) => {
      const amount = Number(bill.amount || 0);
      const paidAmount = paidByBill.get(String(bill.id)) || 0;
      let status = 'unpaid';
      if (paidAmount >= amount && amount > 0) status = 'paid';
      else if (paidAmount > 0) status = 'partially_paid';
      return {
        ...bill,
        date: bill.created_at,
        total_amount: amount,
        paid_amount: paidAmount,
        balance_due: Math.max(0, amount - paidAmount),
        status,
      };
    });

    const totalBilled = bills.reduce((sum: number, b: any) => sum + b.total_amount, 0);
    const totalPaid = bills.reduce((sum: number, b: any) => sum + b.paid_amount, 0);
    const totalOrdered = purchaseOrders
      .filter((po: any) => ![PO_STATUS.rejected, PO_STATUS.cancelled].includes(po.status))
      .reduce((sum: number, po: any) => sum + Number(po.total_amount || 0), 0);

    res.json({
      purchaseOrders,
      bills,
      payments,
      summary: {
        totalOrdered,
        totalBilled,
        totalPaid,
        balanceDue: Math.max(0, totalBilled - totalPaid),
      },
    });
  } catch (error: any) {
    console.error('Error fetching supplier history:', error);
    res.status(500).json({ message: error.message || 'Error fetching supplier history' });
  }
});

// ---------------------------------------------------------------- Inventory

const MOVEMENT_TYPES = ['receipt', 'issue', 'adjustment'] as const;
type MovementType = typeof MOVEMENT_TYPES[number];

/**
 * Changes an item's quantity and records the movement in one step, so the stock
 * figure and its history can never disagree. `quantity` is signed.
 */
async function moveStock(trx: Knex.Transaction, input: {
  itemId: string;
  type: MovementType;
  quantity: number;
  projectId?: string | null;
  referenceType?: string | null;
  referenceId?: string | number | null;
  notes?: string | null;
  userId?: number;
}) {
  const item = await trx('inventory_items').where({ id: input.itemId }).forUpdate().first();
  if (!item) throw httpError(`Inventory item ${input.itemId} not found`, 404);
  const quantity = Math.round(input.quantity * 1000) / 1000;
  if (!Number.isFinite(quantity) || quantity === 0) throw httpError('Quantity must be a non-zero number');
  const balance = Math.round((Number(item.quantity || 0) + quantity) * 1000) / 1000;
  if (balance < 0) throw httpError(`Not enough ${item.name} in stock: ${item.quantity} ${item.unit} available`);

  await trx('inventory_items').where({ id: item.id }).update({ quantity: balance, updated_at: trx.fn.now() });
  await trx('inventory_movements').insert({
    item_id: item.id,
    movement_type: input.type,
    quantity,
    balance_after: balance,
    project_id: input.projectId || null,
    reference_type: input.referenceType || null,
    reference_id: input.referenceId != null ? String(input.referenceId) : null,
    notes: input.notes || null,
    created_by: input.userId || null,
  });
  return balance;
}

const INVENTORY_FIELDS = ['name', 'category', 'unit', 'reorder_level', 'project_id'] as const;

function cleanInventory(body: unknown) {
  const data: Record<string, any> = pick(body, INVENTORY_FIELDS);
  for (const key of ['name', 'category', 'unit'] as const) {
    if (typeof data[key] === 'string') data[key] = data[key].trim();
  }
  if (data.reorder_level !== undefined) {
    const level = Number(data.reorder_level);
    if (!Number.isFinite(level) || level < 0) throw httpError('Reorder level must be zero or more');
    data.reorder_level = level;
  }
  if ('project_id' in data) data.project_id = orNull(data.project_id);
  return data;
}

router.get('/inventory', authenticateToken, async (req, res) => {
  try {
    const inventory = await db('inventory_items')
      .select('inventory_items.*', 'projects.name as project_name')
      .leftJoin('projects', 'inventory_items.project_id', 'projects.id')
      .orderBy('inventory_items.name');
    res.json(inventory);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching inventory' });
  }
});

router.post('/inventory', authenticateToken, authorizeRole(STOCK_ROLES), async (req: AuthRequest, res) => {
  try {
    const data = cleanInventory(req.body);
    if (!data.name || !data.unit) return res.status(400).json({ message: 'Item name and unit are required' });
    const opening = Number(req.body?.quantity || 0);
    if (!Number.isFinite(opening) || opening < 0) return res.status(400).json({ message: 'Opening quantity must be zero or more' });

    const id = await db.transaction(async (trx) => {
      const newId = await nextCode(trx, 'inventory_items', 'STK-');
      await trx('inventory_items').insert({ id: newId, category: 'Materials', reorder_level: 10, ...data, quantity: 0 });
      if (opening > 0) {
        await moveStock(trx, {
          itemId: newId, type: 'adjustment', quantity: opening, projectId: data.project_id,
          referenceType: 'opening', notes: 'Opening stock', userId: req.user?.id,
        });
      }
      return newId;
    });
    res.status(201).json({ id, message: 'Inventory item created' });
  } catch (error) {
    sendError(res, error, 'Error creating inventory item');
  }
});

router.patch('/inventory/:id', authenticateToken, authorizeRole(STOCK_ROLES), async (req, res) => {
  try {
    const updates = cleanInventory(req.body);
    if (Object.keys(updates).length === 0) return res.status(400).json({ message: 'Nothing to update. Change quantities with a stock movement.' });
    if (updates.name === '' || updates.unit === '') return res.status(400).json({ message: 'Item name and unit cannot be blank' });
    const count = await db('inventory_items').where({ id: req.params.id }).update({ ...updates, updated_at: db.fn.now() });
    if (!count) return res.status(404).json({ message: 'Inventory item not found' });
    res.json({ message: 'Inventory item updated' });
  } catch (error) {
    sendError(res, error, 'Error updating inventory item');
  }
});

router.get('/inventory/:id/movements', authenticateToken, async (req, res) => {
  try {
    const movements = await db('inventory_movements as m')
      .leftJoin('projects as p', 'm.project_id', 'p.id')
      .leftJoin('users as u', 'm.created_by', 'u.id')
      .where('m.item_id', req.params.id)
      .select('m.*', 'p.name as project_name', 'u.email as created_by_email')
      .orderBy('m.created_at', 'desc')
      .orderBy('m.id', 'desc');
    res.json(movements);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching stock movements' });
  }
});

// Issue stock to a project, or adjust after a count. Receipts come from goods-received notes.
router.post('/inventory/:id/movements', authenticateToken, authorizeRole(STOCK_ROLES), async (req: AuthRequest, res) => {
  try {
    const type = req.body?.type as MovementType;
    const quantity = Number(req.body?.quantity);
    const notes = String(req.body?.notes || '').trim() || null;
    const projectId = orNull(req.body?.project_id) as string | null;

    if (type !== 'issue' && type !== 'adjustment') return res.status(400).json({ message: 'Type must be issue or adjustment' });
    if (!Number.isFinite(quantity) || quantity === 0) return res.status(400).json({ message: 'Quantity must be a non-zero number' });
    if (type === 'issue' && quantity < 0) return res.status(400).json({ message: 'Issue quantity must be positive' });
    if (type === 'issue' && !projectId) return res.status(400).json({ message: 'Choose the project the stock is issued to' });
    if (type === 'adjustment' && !notes) return res.status(400).json({ message: 'Give a reason for the adjustment' });

    const balance = await db.transaction((trx) => moveStock(trx, {
      itemId: req.params.id,
      type,
      quantity: type === 'issue' ? -quantity : quantity,
      projectId,
      notes,
      userId: req.user?.id,
    }));
    res.status(201).json({ message: type === 'issue' ? 'Stock issued' : 'Stock adjusted', balance });
  } catch (error) {
    sendError(res, error, 'Error recording stock movement');
  }
});

// ---------------------------------------------------------------- Purchase orders

async function loadItemsByPo(conn: Knex | Knex.Transaction, poIds: string[]) {
  const map = new Map<string, any[]>();
  if (!poIds.length) return map;
  const items = await conn('po_items').whereIn('po_id', poIds).orderBy('id');
  for (const item of items) {
    const list = map.get(item.po_id) || [];
    list.push({
      ...item,
      quantity: Number(item.quantity),
      unit_price: Number(item.unit_price),
      total_price: Number(item.total_price),
      received_quantity: Number(item.received_quantity || 0),
    });
    map.set(item.po_id, list);
  }
  return map;
}

const poBaseQuery = (conn: Knex | Knex.Transaction) => conn('purchase_orders')
  .select(
    'purchase_orders.*',
    'suppliers.name as supplier_name',
    'suppliers.tin as supplier_tin',
    'suppliers.address as supplier_address',
    'suppliers.phone as supplier_phone',
    'suppliers.email as supplier_email',
    'suppliers.contact_person as supplier_contact',
    'projects.name as project_name',
    'creator.email as created_by_email',
    'approver.email as approved_by_email',
  )
  .leftJoin('suppliers', 'purchase_orders.supplier_id', 'suppliers.id')
  .leftJoin('projects', 'purchase_orders.project_id', 'projects.id')
  .leftJoin('users as creator', 'purchase_orders.created_by', 'creator.id')
  .leftJoin('users as approver', 'purchase_orders.approved_by', 'approver.id');

function withItems(po: any, items: any[]) {
  const receivedValue = items.reduce((s, i) => s + i.received_quantity * i.unit_price, 0);
  return {
    ...po,
    total_amount: Number(po.total_amount),
    items,
    item_count: items.length,
    // Kept for older clients that show the first line only.
    item_name: items[0]?.item_name || null,
    quantity: items[0]?.quantity ?? null,
    unit: items[0]?.unit || null,
    received_value: round2(receivedValue),
    fully_received: items.length > 0 && items.every(i => i.received_quantity >= i.quantity),
  };
}

router.get('/purchase-orders', authenticateToken, async (req, res) => {
  try {
    const pos = await poBaseQuery(db).orderBy('order_date', 'desc').orderBy('purchase_orders.created_at', 'desc');
    const items = await loadItemsByPo(db, pos.map((p: any) => p.id));
    res.json(pos.map((po: any) => withItems(po, items.get(po.id) || [])));
  } catch (error) {
    console.error('Error fetching purchase orders:', error);
    res.status(500).json({ message: 'Error fetching purchase orders' });
  }
});

router.get('/purchase-orders/:id', authenticateToken, async (req, res) => {
  try {
    const po = await poBaseQuery(db).where('purchase_orders.id', req.params.id).first();
    if (!po) return res.status(404).json({ message: 'Purchase order not found' });
    const [items, receipts, receiptLines, bill] = await Promise.all([
      loadItemsByPo(db, [po.id]),
      db('goods_receipts as g').leftJoin('users as u', 'g.received_by', 'u.id')
        .where('g.po_id', po.id).select('g.*', 'u.email as received_by_email').orderBy('g.id'),
      db('goods_receipt_items as gi').join('goods_receipts as g', 'gi.receipt_id', 'g.id')
        .join('po_items as pi', 'gi.po_item_id', 'pi.id')
        .where('g.po_id', po.id).select('gi.*', 'pi.item_name', 'pi.unit'),
      po.bill_id ? db('bills').where({ id: po.bill_id }).first() : null,
    ]);
    res.json({
      ...withItems(po, items.get(po.id) || []),
      receipts: receipts.map((r: any) => ({ ...r, lines: receiptLines.filter((l: any) => l.receipt_id === r.id) })),
      bill: bill || null,
    });
  } catch (error) {
    console.error('Error fetching purchase order:', error);
    res.status(500).json({ message: 'Error fetching purchase order' });
  }
});

function cleanPoItems(raw: unknown) {
  if (!Array.isArray(raw) || raw.length === 0) throw httpError('Add at least one line item');
  return raw.map((item: any, index: number) => {
    const name = String(item?.item_name ?? item?.name ?? '').trim();
    const quantity = Number(item?.quantity);
    const unitPrice = Number(item?.unit_price ?? item?.price);
    if (!name) throw httpError(`Line ${index + 1}: description is required`);
    if (!Number.isFinite(quantity) || quantity <= 0) throw httpError(`Line ${index + 1}: quantity must be more than zero`);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw httpError(`Line ${index + 1}: unit price cannot be negative`);
    return {
      item_name: name.slice(0, 255),
      quantity,
      unit: String(item?.unit || 'pcs').trim().slice(0, 50) || 'pcs',
      unit_price: round2(unitPrice),
      total_price: round2(quantity * unitPrice),
      inventory_item_id: orNull(item?.inventory_item_id) as string | null,
    };
  });
}

router.post('/purchase-orders', authenticateToken, authorizeRole(BUYER_ROLES), async (req: AuthRequest, res) => {
  try {
    const { supplier_id } = req.body || {};
    if (!supplier_id) return res.status(400).json({ message: 'Choose a supplier' });
    const items = cleanPoItems(req.body?.items);
    const total = round2(items.reduce((s, i) => s + i.total_price, 0));
    if (total <= 0) return res.status(400).json({ message: 'The order total must be more than zero' });

    const id = await db.transaction(async (trx) => {
      const supplier = await trx('suppliers').where({ id: supplier_id }).first();
      if (!supplier) throw httpError('Supplier not found');
      const projectId = orNull(req.body?.project_id) as string | null;
      if (projectId && !(await trx('projects').where({ id: projectId }).first())) throw httpError('Project not found');

      const orderDate = toIsoDate(req.body?.order_date);
      const newId = await nextCode(trx, 'purchase_orders', `PO-${orderDate.slice(0, 4)}-`);
      await trx('purchase_orders').insert({
        id: newId,
        supplier_id,
        project_id: projectId,
        total_amount: total,
        order_date: orderDate,
        delivery_date: orNull(req.body?.delivery_date),
        notes: orNull(req.body?.notes),
        status: PO_STATUS.pending,
        created_by: req.user?.id,
      });
      await trx('po_items').insert(items.map(i => ({ ...i, po_id: newId })));
      return newId;
    });
    res.status(201).json({ id, message: 'Purchase order created' });
  } catch (error) {
    sendError(res, error, 'Error creating purchase order');
  }
});

// Edit a PO while it is still awaiting approval
router.put('/purchase-orders/:id', authenticateToken, authorizeRole(BUYER_ROLES), async (req: AuthRequest, res) => {
  try {
    const items = cleanPoItems(req.body?.items);
    const total = round2(items.reduce((s, i) => s + i.total_price, 0));
    await db.transaction(async (trx) => {
      const po = await trx('purchase_orders').where({ id: req.params.id }).forUpdate().first();
      if (!po) throw httpError('Purchase order not found', 404);
      if (po.status !== PO_STATUS.pending && po.status !== PO_STATUS.rejected) {
        throw httpError('Only orders awaiting approval or rejected can be edited');
      }
      if (po.created_by && po.created_by !== req.user?.id && req.user?.role !== 'admin') {
        throw httpError('Only the person who raised this order can edit it', 403);
      }
      const supplierId = req.body?.supplier_id || po.supplier_id;
      if (!(await trx('suppliers').where({ id: supplierId }).first())) throw httpError('Supplier not found');
      await trx('purchase_orders').where({ id: po.id }).update({
        supplier_id: supplierId,
        project_id: orNull(req.body?.project_id),
        order_date: toIsoDate(req.body?.order_date || po.order_date),
        delivery_date: orNull(req.body?.delivery_date),
        notes: orNull(req.body?.notes),
        total_amount: total,
        status: PO_STATUS.pending,
        rejection_reason: null,
        approved_by: null,
        approved_at: null,
        updated_at: trx.fn.now(),
      });
      await trx('po_items').where({ po_id: po.id }).del();
      await trx('po_items').insert(items.map(i => ({ ...i, po_id: po.id })));
    });
    res.json({ message: 'Purchase order updated and resubmitted for approval' });
  } catch (error) {
    sendError(res, error, 'Error updating purchase order');
  }
});

async function decide(req: AuthRequest, decision: 'approve' | 'reject', reason?: string) {
  return db.transaction(async (trx) => {
    const po = await trx('purchase_orders').where({ id: req.params.id }).forUpdate().first();
    if (!po) throw httpError('Purchase order not found', 404);
    if (po.status !== PO_STATUS.pending) throw httpError(`This order is ${po.status}, not awaiting approval`);
    if (po.created_by && po.created_by === req.user?.id) {
      throw httpError('You raised this purchase order, so someone else must approve or reject it', 403);
    }
    await trx('purchase_orders').where({ id: po.id }).update({
      status: decision === 'approve' ? PO_STATUS.approved : PO_STATUS.rejected,
      approved_by: req.user?.id,
      approved_at: trx.fn.now(),
      rejection_reason: decision === 'reject' ? reason || null : null,
      updated_at: trx.fn.now(),
    });
  });
}

router.post('/purchase-orders/:id/approve', authenticateToken, authorizeRole(APPROVER_ROLES), async (req: AuthRequest, res) => {
  try {
    await decide(req, 'approve');
    res.json({ message: 'Purchase order approved' });
  } catch (error) {
    sendError(res, error, 'Error approving purchase order');
  }
});

router.post('/purchase-orders/:id/reject', authenticateToken, authorizeRole(APPROVER_ROLES), async (req: AuthRequest, res) => {
  try {
    await decide(req, 'reject', String(req.body?.reason || '').trim());
    res.json({ message: 'Purchase order rejected' });
  } catch (error) {
    sendError(res, error, 'Error rejecting purchase order');
  }
});

router.post('/purchase-orders/:id/cancel', authenticateToken, authorizeRole(BUYER_ROLES), async (req: AuthRequest, res) => {
  try {
    await db.transaction(async (trx) => {
      const po = await trx('purchase_orders').where({ id: req.params.id }).forUpdate().first();
      if (!po) throw httpError('Purchase order not found', 404);
      if (![PO_STATUS.pending, PO_STATUS.approved, PO_STATUS.rejected].includes(po.status)) {
        throw httpError(`An order that is ${po.status} cannot be cancelled`);
      }
      const received = await trx('po_items').where({ po_id: po.id }).where('received_quantity', '>', 0).first();
      if (received) throw httpError('Goods have been received against this order, so it cannot be cancelled');
      await trx('purchase_orders').where({ id: po.id }).update({ status: PO_STATUS.cancelled, updated_at: trx.fn.now() });
    });
    res.json({ message: 'Purchase order cancelled' });
  } catch (error) {
    sendError(res, error, 'Error cancelling purchase order');
  }
});

// Shipping details. Status changes go through approve/reject/receive/convert-to-bill.
router.patch('/purchase-orders/:id', authenticateToken, authorizeRole(BUYER_ROLES), async (req: AuthRequest, res) => {
  try {
    const { status } = req.body || {};
    if (status === PO_STATUS.approved) {
      if (!APPROVER_ROLES.includes(req.user?.role || '')) return res.status(403).json({ message: 'Only admins and accountants can approve orders' });
      await decide(req, 'approve');
      return res.json({ message: 'Purchase order approved' });
    }
    if (status === PO_STATUS.rejected) {
      if (!APPROVER_ROLES.includes(req.user?.role || '')) return res.status(403).json({ message: 'Only admins and accountants can reject orders' });
      await decide(req, 'reject', String(req.body?.reason || '').trim());
      return res.json({ message: 'Purchase order rejected' });
    }
    if (status !== undefined) return res.status(400).json({ message: 'Use the approve, reject, receive or bill actions to change status' });

    const updates: Record<string, any> = pick(req.body, ['carrier', 'tracking_number', 'shipping_status', 'estimated_delivery'] as const);
    for (const key of Object.keys(updates)) updates[key] = orNull(updates[key]);
    if (Object.keys(updates).length === 0) return res.status(400).json({ message: 'Nothing to update' });
    const count = await db('purchase_orders').where({ id: req.params.id }).update({ ...updates, updated_at: db.fn.now() });
    if (!count) return res.status(404).json({ message: 'Purchase order not found' });
    res.json({ message: 'Purchase order updated' });
  } catch (error) {
    sendError(res, error, 'Error updating purchase order');
  }
});

// Goods received note: records what arrived and puts stock-tracked lines into inventory
router.post('/purchase-orders/:id/receive', authenticateToken, authorizeRole(RECEIVER_ROLES), async (req: AuthRequest, res) => {
  try {
    const rawLines = Array.isArray(req.body?.lines) ? req.body.lines : [];
    const lines = rawLines
      .map((l: any) => ({
        po_item_id: Number(l?.po_item_id),
        quantity: Number(l?.quantity),
        inventory_item_id: orNull(l?.inventory_item_id) as string | null,
        add_to_stock: Boolean(l?.add_to_stock),
      }))
      .filter((l: any) => l.quantity !== 0);
    if (!lines.length) return res.status(400).json({ message: 'Enter the quantity received for at least one line' });

    const result = await db.transaction(async (trx) => {
      const po = await trx('purchase_orders').where({ id: req.params.id }).forUpdate().first();
      if (!po) throw httpError('Purchase order not found', 404);
      if (po.status !== PO_STATUS.approved && po.status !== PO_STATUS.partial) {
        throw httpError(po.status === PO_STATUS.pending ? 'This order must be approved before goods can be received' : `Goods cannot be received on an order that is ${po.status}`);
      }
      const poItems = await trx('po_items').where({ po_id: po.id });
      const byId = new Map(poItems.map((i: any) => [i.id, i]));

      const receiptDate = toIsoDate(req.body?.receipt_date);
      const [inserted] = await trx('goods_receipts').insert({
        po_id: po.id,
        receipt_date: receiptDate,
        delivery_note: orNull(req.body?.delivery_note),
        notes: orNull(req.body?.notes),
        received_by: req.user?.id,
      }).returning('id');
      const receiptId = typeof inserted === 'object' ? inserted.id : inserted;

      for (const line of lines) {
        const item: any = byId.get(line.po_item_id);
        if (!item) throw httpError('A received line does not belong to this order');
        if (!Number.isFinite(line.quantity) || line.quantity < 0) throw httpError(`${item.item_name}: quantity received must be positive`);
        const outstanding = Number(item.quantity) - Number(item.received_quantity || 0);
        if (line.quantity > outstanding + 1e-9) {
          throw httpError(`${item.item_name}: only ${outstanding} ${item.unit || ''} still to receive`);
        }

        let stockItemId: string | null = line.inventory_item_id || item.inventory_item_id || null;
        if (!stockItemId && line.add_to_stock) {
          stockItemId = await nextCode(trx, 'inventory_items', 'STK-');
          await trx('inventory_items').insert({
            id: stockItemId,
            name: item.item_name,
            category: 'Materials',
            unit: item.unit || 'pcs',
            quantity: 0,
            reorder_level: 0,
            project_id: po.project_id || null,
          });
        }

        await trx('po_items').where({ id: item.id }).update({
          received_quantity: Number(item.received_quantity || 0) + line.quantity,
          ...(stockItemId && !item.inventory_item_id ? { inventory_item_id: stockItemId } : {}),
        });
        await trx('goods_receipt_items').insert({ receipt_id: receiptId, po_item_id: item.id, quantity: line.quantity, inventory_item_id: stockItemId });

        if (stockItemId) {
          await moveStock(trx, {
            itemId: stockItemId,
            type: 'receipt',
            quantity: line.quantity,
            projectId: po.project_id,
            referenceType: 'goods_receipt',
            referenceId: `${po.id}/GRN-${receiptId}`,
            notes: `Received on ${po.id}`,
            userId: req.user?.id,
          });
        }
      }

      const updated = await trx('po_items').where({ po_id: po.id });
      const complete = updated.every((i: any) => Number(i.received_quantity || 0) >= Number(i.quantity) - 1e-9);
      const status = complete ? PO_STATUS.received : PO_STATUS.partial;
      await trx('purchase_orders').where({ id: po.id }).update({
        status,
        shipping_status: complete ? 'Delivered' : po.shipping_status,
        delivery_date: complete ? receiptDate : po.delivery_date,
        updated_at: trx.fn.now(),
      });
      return { receiptId, status };
    });
    res.status(201).json({ message: `Goods received (GRN-${result.receiptId})`, ...result });
  } catch (error) {
    sendError(res, error, 'Error recording goods received');
  }
});

// Raise the supplier bill for an order and post it to the ledger (Dr cost account, Cr Accounts Payable)
router.post('/purchase-orders/:id/convert-to-bill', authenticateToken, authorizeRole(BILLING_ROLES), async (req: AuthRequest, res) => {
  try {
    const accountId = Number(req.body?.account_id);
    if (!Number.isInteger(accountId)) return res.status(400).json({ message: 'Choose the account to charge this bill to' });

    const result = await db.transaction(async (trx) => {
      const po = await trx('purchase_orders').where({ id: req.params.id }).forUpdate().first();
      if (!po) throw httpError('Purchase order not found', 404);
      if (po.bill_id) throw httpError(`This order has already been billed (bill ${po.bill_id})`);
      // A Billed order whose bill was deleted in Accounting (bill_id set null) can be billed again.
      if (![PO_STATUS.approved, PO_STATUS.partial, PO_STATUS.received, PO_STATUS.billed].includes(po.status)) {
        throw httpError(`An order that is ${po.status} cannot be billed`);
      }

      const account = await trx('chart_of_accounts').where({ id: accountId }).first();
      if (!account || !['Expense', 'Asset'].includes(account.type)) throw httpError('Bills must be charged to an expense or asset account');
      const ap = await findAccountByCode(trx, '2001');
      if (!ap) throw httpError('Accounts Payable (2001) is missing from the chart of accounts');
      if (ap.id === account.id) throw httpError('Choose a cost account, not Accounts Payable');

      const supplier = await trx('suppliers').where({ id: po.supplier_id }).first();
      const items = await trx('po_items').where({ po_id: po.id });
      const receivedValue = round2(items.reduce((s: number, i: any) => s + Number(i.received_quantity || 0) * Number(i.unit_price), 0));
      // Bill what arrived; an order with nothing received yet (e.g. services) bills in full.
      const amount = receivedValue > 0 ? receivedValue : round2(Number(po.total_amount));
      if (amount <= 0) throw httpError('Nothing to bill on this order');

      const billDate = toIsoDate(req.body?.bill_date);
      const terms = Number(supplier?.payment_terms_days ?? 30);
      const defaultDue = new Date(`${billDate}T00:00:00`);
      defaultDue.setDate(defaultDue.getDate() + (Number.isFinite(terms) ? terms : 30));
      const dueDate = toIsoDate(req.body?.due_date || defaultDue);
      if (dueDate < billDate) throw httpError('Due date cannot be before the bill date');

      const [insertedBill] = await trx('bills').insert({
        supplier_id: po.supplier_id,
        quantity: 1,
        unit_price: amount,
        amount,
        due_date: dueDate,
        category: supplier?.category || 'Purchase Order',
        project_id: po.project_id || null,
        account_id: account.id,
        po_id: po.id,
        status: 'Unpaid',
      }).returning('id');
      const billId = typeof insertedBill === 'object' ? insertedBill.id : insertedBill;

      await postJournal(trx, {
        date: billDate,
        description: `Vendor Bill: ${supplier?.name || po.supplier_id} for ${po.id} (Bill ID: ${billId})`,
        reference_type: 'bill',
        reference_id: billId,
        project_id: po.project_id,
        lines: [
          { account_id: account.id, debit: amount, credit: 0 },
          { account_id: ap.id, debit: 0, credit: amount },
        ],
      });

      await trx('purchase_orders').where({ id: po.id }).update({ status: PO_STATUS.billed, bill_id: billId, updated_at: trx.fn.now() });
      return { billId, amount };
    });
    res.status(201).json({ message: `Bill ${result.billId} created and posted to Accounts Payable`, bill_id: result.billId, amount: result.amount });
  } catch (error) {
    sendError(res, error, 'Error converting purchase order to bill');
  }
});

// Accounts a PO can be billed to, for users who cannot read the full chart of accounts
router.get('/bill-accounts', authenticateToken, authorizeRole(BILLING_ROLES), async (req, res) => {
  try {
    const accounts = await db('chart_of_accounts').whereIn('type', ['Expense', 'Asset']).select('id', 'code', 'name', 'type').orderBy('code');
    res.json(accounts);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching accounts' });
  }
});

export default router;
