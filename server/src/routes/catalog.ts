import { Router } from 'express';
import db from '../db';
import { authenticateToken, authorizeRole } from '../middleware/auth';

const router = Router();

const MANAGERS = ['admin', 'accountant'];
export const CATEGORY_TYPES = ['expense', 'supplier', 'inventory', 'asset', 'service'] as const;

// Existing records store the category name as plain text, so renames and
// deletions have to look at these columns.
const NAME_USAGE: Record<string, { table: string; column: string }> = {
  supplier: { table: 'suppliers', column: 'category' },
  asset: { table: 'equipment', column: 'category' },
  inventory: { table: 'inventory_items', column: 'category' },
  expense: { table: 'bills', column: 'category' },
};

const isUniqueViolation = (error: any) => error?.code === '23505';

const toNumberOrNull = (value: any) => {
  if (value === undefined || value === null || value === '' || value === 'none') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const countCategoryUsage = async (category: { id: number; name: string; type: string }) => {
  if (category.type === 'service') {
    const row = await db('services').where({ category_id: category.id }).count('id as count').first();
    return Number(row?.count || 0);
  }
  const usage = NAME_USAGE[category.type];
  if (!usage) return 0;
  const row = await db(usage.table).where(usage.column, category.name).count('* as count').first();
  return Number(row?.count || 0);
};

// --- Categories ---

router.get('/categories', authenticateToken, async (req, res) => {
  try {
    const { type, active } = req.query;
    const query = db('categories')
      .leftJoin('chart_of_accounts', 'categories.account_id', 'chart_of_accounts.id')
      .select(
        'categories.*',
        'chart_of_accounts.code as account_code',
        'chart_of_accounts.name as account_name'
      )
      .orderBy([{ column: 'categories.type' }, { column: 'categories.name' }]);

    if (type) query.where('categories.type', String(type));
    if (active === 'true') query.where('categories.is_active', true);

    res.json(await query);
  } catch (error: any) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ message: 'Error fetching categories' });
  }
});

router.post('/categories', authenticateToken, authorizeRole(MANAGERS), async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const type = String(req.body.type || '').trim();

    if (!name) return res.status(400).json({ message: 'Category name is required' });
    if (!CATEGORY_TYPES.includes(type as any)) {
      return res.status(400).json({ message: `Category type must be one of: ${CATEGORY_TYPES.join(', ')}` });
    }

    const [inserted] = await db('categories').insert({
      name,
      type,
      description: req.body.description || null,
      account_id: type === 'expense' ? toNumberOrNull(req.body.account_id) : null,
      is_active: true,
    }).returning('*');

    res.status(201).json(inserted);
  } catch (error: any) {
    if (isUniqueViolation(error)) return res.status(409).json({ message: 'A category with this name already exists for this type' });
    console.error('Error creating category:', error);
    res.status(500).json({ message: 'Error creating category' });
  }
});

router.patch('/categories/:id', authenticateToken, authorizeRole(MANAGERS), async (req, res) => {
  const trx = await db.transaction();
  try {
    const existing = await trx('categories').where({ id: req.params.id }).first();
    if (!existing) {
      await trx.rollback();
      return res.status(404).json({ message: 'Category not found' });
    }

    const updates: Record<string, any> = { updated_at: trx.fn.now() };
    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) {
        await trx.rollback();
        return res.status(400).json({ message: 'Category name is required' });
      }
      updates.name = name;
    }
    if (req.body.description !== undefined) updates.description = req.body.description || null;
    if (req.body.is_active !== undefined) updates.is_active = Boolean(req.body.is_active);
    if (req.body.account_id !== undefined && existing.type === 'expense') {
      updates.account_id = toNumberOrNull(req.body.account_id);
    }

    const [updated] = await trx('categories').where({ id: existing.id }).update(updates).returning('*');

    const usage = NAME_USAGE[existing.type];
    if (usage && updates.name && updates.name !== existing.name) {
      await trx(usage.table).where(usage.column, existing.name).update({ [usage.column]: updates.name });
    }

    await trx.commit();
    res.json(updated);
  } catch (error: any) {
    await trx.rollback();
    if (isUniqueViolation(error)) return res.status(409).json({ message: 'A category with this name already exists for this type' });
    console.error('Error updating category:', error);
    res.status(500).json({ message: 'Error updating category' });
  }
});

router.delete('/categories/:id', authenticateToken, authorizeRole(MANAGERS), async (req, res) => {
  try {
    const existing = await db('categories').where({ id: req.params.id }).first();
    if (!existing) return res.status(404).json({ message: 'Category not found' });

    const usageCount = await countCategoryUsage(existing);
    if (usageCount > 0) {
      return res.status(409).json({
        message: `"${existing.name}" is used by ${usageCount} record(s). Archive it instead so existing records keep their category.`
      });
    }

    await db('categories').where({ id: existing.id }).del();
    res.json({ message: 'Category deleted' });
  } catch (error: any) {
    console.error('Error deleting category:', error);
    res.status(500).json({ message: 'Error deleting category' });
  }
});

// --- Services ---

router.get('/services', authenticateToken, async (req, res) => {
  try {
    const query = db('services')
      .leftJoin('categories', 'services.category_id', 'categories.id')
      .select('services.*', 'categories.name as category_name')
      .orderBy('services.name');

    if (req.query.active === 'true') query.where('services.is_active', true);

    res.json(await query);
  } catch (error: any) {
    console.error('Error fetching services:', error);
    res.status(500).json({ message: 'Error fetching services' });
  }
});

const readServiceBody = (body: any) => {
  const data: Record<string, any> = {};
  if (body.name !== undefined) data.name = String(body.name).trim();
  if (body.description !== undefined) data.description = body.description || null;
  if (body.category_id !== undefined) data.category_id = toNumberOrNull(body.category_id);
  if (body.unit !== undefined) data.unit = String(body.unit || '').trim() || 'job';
  if (body.default_price !== undefined) data.default_price = Number(body.default_price) || 0;
  if (body.is_active !== undefined) data.is_active = Boolean(body.is_active);
  return data;
};

router.post('/services', authenticateToken, authorizeRole(MANAGERS), async (req, res) => {
  try {
    const data = readServiceBody(req.body);
    if (!data.name) return res.status(400).json({ message: 'Service name is required' });
    if (data.default_price < 0) return res.status(400).json({ message: 'Default price cannot be negative' });

    const [inserted] = await db('services').insert({ ...data, is_active: true }).returning('*');
    res.status(201).json(inserted);
  } catch (error: any) {
    if (isUniqueViolation(error)) return res.status(409).json({ message: 'A service with this name already exists' });
    console.error('Error creating service:', error);
    res.status(500).json({ message: 'Error creating service' });
  }
});

router.patch('/services/:id', authenticateToken, authorizeRole(MANAGERS), async (req, res) => {
  try {
    const data = readServiceBody(req.body);
    if (data.name === '') return res.status(400).json({ message: 'Service name is required' });
    if (data.default_price < 0) return res.status(400).json({ message: 'Default price cannot be negative' });

    const [updated] = await db('services')
      .where({ id: req.params.id })
      .update({ ...data, updated_at: db.fn.now() })
      .returning('*');

    if (!updated) return res.status(404).json({ message: 'Service not found' });
    res.json(updated);
  } catch (error: any) {
    if (isUniqueViolation(error)) return res.status(409).json({ message: 'A service with this name already exists' });
    console.error('Error updating service:', error);
    res.status(500).json({ message: 'Error updating service' });
  }
});

router.delete('/services/:id', authenticateToken, authorizeRole(MANAGERS), async (req, res) => {
  try {
    const deleted = await db('services').where({ id: req.params.id }).del();
    if (!deleted) return res.status(404).json({ message: 'Service not found' });
    res.json({ message: 'Service deleted' });
  } catch (error: any) {
    console.error('Error deleting service:', error);
    res.status(500).json({ message: 'Error deleting service' });
  }
});

export default router;
