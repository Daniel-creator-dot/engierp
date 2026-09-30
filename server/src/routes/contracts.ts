import { Router } from 'express';
import db from '../db';
import { authenticateToken, authorizeRole } from '../middleware/auth';
import { pick } from '../utils/pick';

const router = Router();

const CONTRACT_STATUSES = ['Draft', 'Active', 'Completed', 'Terminated'];
const CONTRACT_FIELDS = ['project_id', 'name', 'value', 'retention_pct', 'status'] as const;

/** Blank means "use the default"; an explicit 0 must stay 0. */
function retentionPct(value: unknown) {
  if (value === undefined || value === null || value === '') return 10;
  const pct = Number(value);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw Object.assign(new Error('Retention must be between 0 and 100%'), { status: 400 });
  return pct;
}

function contractValue(value: unknown) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw Object.assign(new Error('Contract value must be a positive number'), { status: 400 });
  return amount;
}

// Get all contracts
router.get('/', authenticateToken, async (req, res) => {
  try {
    const contracts = await db('contracts')
      .select('contracts.*', 'projects.name as project_name')
      .join('projects', 'contracts.project_id', 'projects.id')
      .orderBy('contracts.created_at', 'desc');
    res.json(contracts);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching contracts' });
  }
});

// Create new contract
router.post('/', authenticateToken, authorizeRole(['pm', 'admin', 'accountant']), async (req, res) => {
  try {
    const data: Record<string, any> = pick(req.body, CONTRACT_FIELDS);
    if (!data.project_id || !data.name) return res.status(400).json({ message: 'Project and contract name are required' });
    const value = contractValue(data.value);
    const pct = retentionPct(data.retention_pct);
    const status = CONTRACT_STATUSES.includes(data.status) ? data.status : 'Active';

    const year = new Date().getFullYear();
    const prefix = `CONT-${year}-`;
    const last = await db('contracts').where('id', 'like', `${prefix}%`).orderBy('id', 'desc').first();
    const next = (last ? parseInt(String(last.id).slice(prefix.length), 10) || 0 : 0) + 1;
    const id = `${prefix}${String(next).padStart(3, '0')}`;

    await db('contracts').insert({
      id,
      project_id: data.project_id,
      name: data.name,
      value,
      retention_pct: pct,
      retention_amount: value * (pct / 100),
      status,
    });
    res.status(201).json({ id, message: 'Contract created' });
  } catch (error: any) {
    if (error.status === 400) return res.status(400).json({ message: error.message });
    console.error('Error creating contract:', error);
    res.status(500).json({ message: 'Error creating contract' });
  }
});

// Update contract status/variations
router.patch('/:id', authenticateToken, authorizeRole(['pm', 'admin', 'accountant']), async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await db('contracts').where({ id }).first();
    if (!existing) return res.status(404).json({ message: 'Contract not found' });

    const updates: Record<string, any> = pick(req.body, CONTRACT_FIELDS);
    if (updates.status !== undefined && !CONTRACT_STATUSES.includes(updates.status)) {
      return res.status(400).json({ message: `Status must be one of: ${CONTRACT_STATUSES.join(', ')}` });
    }
    if (updates.value !== undefined) updates.value = contractValue(updates.value);
    if (updates.retention_pct !== undefined) updates.retention_pct = retentionPct(updates.retention_pct);
    if (updates.value !== undefined || updates.retention_pct !== undefined) {
      const value = updates.value ?? Number(existing.value);
      const pct = updates.retention_pct ?? Number(existing.retention_pct);
      updates.retention_amount = value * (pct / 100);
    }

    await db('contracts').where({ id }).update({ ...updates, updated_at: db.fn.now() });
    res.json({ message: 'Contract updated' });
  } catch (error: any) {
    if (error.status === 400) return res.status(400).json({ message: error.message });
    console.error('Error updating contract:', error);
    res.status(500).json({ message: 'Error updating contract' });
  }
});

export default router;
