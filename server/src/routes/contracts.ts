import { Router } from 'express';
import db from '../db';
import { authenticateToken, authorizeRole } from '../middleware/auth';

const router = Router();

// Get all contracts
router.get('/', authenticateToken, async (req, res) => {
  try {
    const contracts = await db('contracts')
      .select('contracts.*', 'projects.name as project_name')
      .join('projects', 'contracts.project_id', 'projects.id');
    res.json(contracts);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching contracts' });
  }
});

// Create new contract
router.post('/', authenticateToken, authorizeRole(['pm', 'admin']), async (req, res) => {
  try {
    const data = req.body;
    await db('contracts').insert({
      ...data,
      retention_amount: (Number(data.value) * (Number(data.retention_pct || 10) / 100))
    });
    res.status(201).json({ message: 'Contract initialized' });
  } catch (error) {
    res.status(500).json({ message: 'Error creating contract' });
  }
});

// Update contract status/variations
router.patch('/:id', authenticateToken, authorizeRole(['pm', 'admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    await db('contracts').where({ id }).update({ ...updates, updated_at: db.fn.now() });
    res.json({ message: 'Contract updated' });
  } catch (error) {
    res.status(500).json({ message: 'Error updating contract' });
  }
});

export default router;
