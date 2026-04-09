import { Router } from 'express';
import db from '../db';
import { authenticateToken, authorizeRole } from '../middleware/auth';

const router = Router();

// Get all equipment
router.get('/', authenticateToken, async (req, res) => {
  try {
    const equipment = await db('equipment').select('*');
    res.json(equipment);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching equipment' });
  }
});

// Add new equipment
router.post('/', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  try {
    const data = req.body;
    await db('equipment').insert(data);
    res.status(201).json({ message: 'Equipment registered' });
  } catch (error) {
    res.status(500).json({ message: 'Error registering equipment' });
  }
});

// Update equipment
router.patch('/:id', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    await db('equipment').where({ id }).update({ ...updates, updated_at: db.fn.now() });
    res.json({ message: 'Equipment registry updated' });
  } catch (error) {
    res.status(500).json({ message: 'Error updating equipment' });
  }
});

// Handle allocations
router.get('/allocations', authenticateToken, async (req, res) => {
  try {
    const allocations = await db('equipment_allocations')
      .select('equipment_allocations.*', 'equipment.name as equipment_name', 'projects.name as project_name')
      .join('equipment', 'equipment_allocations.equipment_id', 'equipment.id')
      .join('projects', 'equipment_allocations.project_id', 'projects.id');
    res.json(allocations);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching allocations' });
  }
});

router.post('/allocations', authenticateToken, authorizeRole(['pm', 'admin']), async (req, res) => {
  try {
    const data = req.body;
    await db('equipment_allocations').insert(data);
    // Update equipment status
    await db('equipment').where({ id: data.equipment_id }).update({ status: 'On Site' });
    res.status(201).json({ message: 'Equipment allocated to site' });
  } catch (error) {
    res.status(500).json({ message: 'Error allocating equipment' });
  }
});

export default router;
