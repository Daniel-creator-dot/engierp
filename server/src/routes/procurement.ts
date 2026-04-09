import { Router } from 'express';
import db from '../db';
import { authenticateToken, authorizeRole } from '../middleware/auth';

const router = Router();

// GET all suppliers
router.get('/suppliers', authenticateToken, async (req, res) => {
  try {
    const suppliers = await db('suppliers').select('*').orderBy('name', 'asc');
    res.json(suppliers);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching suppliers' });
  }
});

// POST new supplier
router.post('/suppliers', authenticateToken, authorizeRole(['procurement', 'admin']), async (req, res) => {
  try {
    const data = req.body;
    await db('suppliers').insert(data);
    res.status(201).json({ message: 'Supplier registered' });
  } catch (error) {
    res.status(500).json({ message: 'Error registering supplier' });
  }
});

// Update supplier
router.patch('/suppliers/:id', authenticateToken, authorizeRole(['procurement', 'admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    await db('suppliers').where({ id }).update({ ...updates, updated_at: db.fn.now() });
    res.json({ message: 'Supplier profile updated' });
  } catch (error) {
    res.status(500).json({ message: 'Error updating supplier' });
  }
});

// GET site inventory
router.get('/inventory', authenticateToken, async (req, res) => {
  try {
    const inventory = await db('inventory_items')
      .select('inventory_items.*', 'projects.name as project_name')
      .leftJoin('projects', 'inventory_items.project_id', 'projects.id');
    res.json(inventory);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching inventory' });
  }
});

// POST new inventory item
router.post('/inventory', authenticateToken, authorizeRole(['procurement', 'admin']), async (req, res) => {
  try {
    const data = req.body;
    await db('inventory_items').insert(data);
    res.status(201).json({ message: 'Inventory item initialized' });
  } catch (error) {
    res.status(500).json({ message: 'Error initializing inventory' });
  }
});

// GET all purchase orders
router.get('/purchase-orders', authenticateToken, async (req, res) => {
  try {
    const pos = await db('purchase_orders')
      .select('purchase_orders.*', 'suppliers.name as supplier_name', 'projects.name as project_name')
      .join('suppliers', 'purchase_orders.supplier_id', 'suppliers.id')
      .leftJoin('projects', 'purchase_orders.project_id', 'projects.id')
      .orderBy('order_date', 'desc');
    res.json(pos);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching purchase orders' });
  }
});

// POST new purchase order
router.post('/purchase-orders', authenticateToken, authorizeRole(['procurement', 'admin']), async (req, res) => {
  const trx = await db.transaction();
  try {
    const { supplier_id, project_id, items, order_date, total_amount } = req.body;
    
    const newPoId = `PO-${Date.now()}`;
    await trx('purchase_orders').insert({
      id: newPoId,
      supplier_id,
      project_id: project_id || null, // ensure empty strings become null
      total_amount,
      order_date,
      status: 'Pending Approval'
    });

    if (items && items.length > 0) {
      const poItems = items.map((item: any) => ({
        po_id: newPoId,
        item_name: item.name,
        quantity: item.quantity,
        unit_price: item.price,
        total_price: item.quantity * item.price
      }));
      await trx('po_items').insert(poItems);
    }

    await trx.commit();
    res.status(201).json({ id: newPoId, message: 'Purchase order created' });
  } catch (error) {
    await trx.rollback();
    res.status(500).json({ message: 'Error creating purchase order' });
  }
});

// PATCH to update PO shipping/logistics status
router.patch('/purchase-orders/:id', authenticateToken, authorizeRole(['procurement', 'admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { carrier, tracking_number, shipping_status, estimated_delivery } = req.body;
    
    await db('purchase_orders')
      .where({ id })
      .update({
        carrier,
        tracking_number,
        shipping_status,
        estimated_delivery,
        updated_at: db.fn.now()
      });

    res.json({ message: 'Logistics status updated' });
  } catch (error) {
    res.status(500).json({ message: 'Error updating logistics status' });
  }
});

export default router;
