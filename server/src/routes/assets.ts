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
router.post('/', authenticateToken, authorizeRole(['admin', 'accountant']), async (req, res) => {
  try {
    const data = req.body;
    await db('equipment').insert(data);
    res.status(201).json({ message: 'Equipment registered' });
  } catch (error) {
    res.status(500).json({ message: 'Error registering equipment' });
  }
});

// Update equipment
router.patch('/:id', authenticateToken, authorizeRole(['admin', 'accountant']), async (req, res) => {
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

router.post('/allocations', authenticateToken, authorizeRole(['pm', 'admin', 'accountant']), async (req, res) => {
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

// Depreciation
router.post('/depreciate', authenticateToken, authorizeRole(['admin', 'accountant']), async (req, res) => {
  const trx = await db.transaction();
  try {
    const { periodEndDate } = req.body;
    
    // Fetch all active assets (not disposed)
    const assets = await trx('equipment').whereNull('disposal_date');
    
    let totalDepreciation = 0;
    
    for (const asset of assets) {
      if (!asset.initial_cost || !asset.useful_life) continue;
      
      // Straight Line Depreciation: (Cost - Residual) / Life (years) / 12 (months)
      const monthlyDepreciation = (Number(asset.initial_cost) - Number(asset.residual_value || 0)) / Number(asset.useful_life) / 12;
      
      if (monthlyDepreciation <= 0) continue;

      await trx('equipment')
        .where({ id: asset.id })
        .increment('accumulated_depreciation', monthlyDepreciation);
        
      totalDepreciation += monthlyDepreciation;
    }

    if (totalDepreciation > 0) {
      // Record Journal Entry
      const [journal_id] = await trx('journal_entries').insert({
        date: periodEndDate || new Date().toISOString().split('T')[0],
        description: `Monthly Depreciation Run - ${periodEndDate || 'Current'}`,
        reference_type: 'depreciation'
      }).returning('id');

      // Double Entry: Debit Depreciation Expense (Code: 5104), Credit Accumulated Depreciation (Code: 1101)
      const depExpAcc = await trx('chart_of_accounts').where('code', '5104').first();
      const accDepAcc = await trx('chart_of_accounts').where('code', '1101').first();

      if (!depExpAcc || !accDepAcc) throw new Error('Depreciation accounts not found in COA');

      await trx('ledger_entries').insert([
        { journal_id, account_id: depExpAcc.id, debit: totalDepreciation, credit: 0 },
        { journal_id, account_id: accDepAcc.id, debit: 0, credit: totalDepreciation }
      ]);

      // Update COA Balances
      await trx('chart_of_accounts').where({ id: depExpAcc.id }).increment('balance', totalDepreciation);
      await trx('chart_of_accounts').where({ id: accDepAcc.id }).decrement('balance', totalDepreciation);
    }

    await trx.commit();
    res.json({ message: 'Depreciation processed', total: totalDepreciation });
  } catch (error) {
    await trx.rollback();
    console.error(error);
    res.status(500).json({ message: 'Error processing depreciation' });
  }
});

// Disposal
router.post('/dispose/:id', authenticateToken, authorizeRole(['admin', 'accountant']), async (req, res) => {
  const trx = await db.transaction();
  try {
    const { id } = req.params;
    const { disposal_date, disposal_value } = req.body;
    
    const asset = await trx('equipment').where({ id }).first();
    if (!asset) return res.status(404).json({ message: 'Asset not found' });

    const bookValue = Number(asset.initial_cost) - Number(asset.accumulated_depreciation);
    const gainLoss = Number(disposal_value) - bookValue;

    await trx('equipment').where({ id }).update({
      disposal_date,
      disposal_value,
      status: 'Disposed'
    });

    // Record Journal Entry for Disposal
    const [journal_id] = await trx('journal_entries').insert({
      date: disposal_date,
      description: `Asset Disposal: ${asset.name} (ID: ${asset.id})`,
      reference_type: 'disposal',
      reference_id: asset.id
    }).returning('id');

    // Double Entry: 
    // 1. Debit Cash/Bank (Disposal Value)
    // 2. Debit Accumulated Depreciation
    // 3. Credit Asset (Original Cost)
    // 4. Debit/Credit Gain/Loss on Disposal
    
    // Simplified for now: Just adjust Asset and Cash
    // TODO: More complex disposal logic if needed
    
    await trx.commit();
    res.json({ message: 'Asset disposed successfully', gainLoss });
  } catch (error) {
    await trx.rollback();
    res.status(500).json({ message: 'Error disposing asset' });
  }
});

export default router;
