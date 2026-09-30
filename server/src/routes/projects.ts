import { Router } from 'express';
import db from '../db';
import { authenticateToken, authorizeRole } from '../middleware/auth';

const router = Router();

// Get all projects
router.get('/', authenticateToken, async (req, res) => {
  try {
    const projects = await db('projects').select('*');

    // Financial figures are an enrichment: if they can't be computed, still return the project list.
    const totalsByProject = (rows: any[]) => new Map(rows.map(r => [String(r.project_id), Number(r.total || 0)]));
    let actuals = new Map<string, number>();
    let committed = new Map<string, number>();
    let revenue = new Map<string, number>();
    try {
      const [actualRows, committedRows, revenueRows] = await Promise.all([
        db('ledger_entries')
          .join('journal_entries', 'ledger_entries.journal_id', 'journal_entries.id')
          .join('chart_of_accounts', 'ledger_entries.account_id', 'chart_of_accounts.id')
          .whereNotNull('journal_entries.project_id')
          .where('chart_of_accounts.type', 'Expense')
          .groupBy('journal_entries.project_id')
          .select('journal_entries.project_id', db.raw('SUM(debit - credit) as total')),
        db('purchase_orders')
          .whereNotNull('project_id')
          .whereIn('status', ['Approved', 'Paid', 'Partially Received'])
          .groupBy('project_id')
          .select('project_id', db.raw('SUM(total_amount) as total')),
        db('invoices')
          .whereNotNull('project_id')
          .whereIn('status', ['paid', 'Paid'])
          .groupBy('project_id')
          .select('project_id', db.raw('SUM(amount) as total')),
      ]);
      actuals = totalsByProject(actualRows);
      committed = totalsByProject(committedRows);
      revenue = totalsByProject(revenueRows);
    } catch (error) {
      console.error('GET /projects: failed to compute project financials:', error);
    }

    res.json(projects.map(p => {
      const spent = actuals.get(String(p.id)) || 0;
      const committedCosts = committed.get(String(p.id)) || 0;
      return {
        ...p,
        spent,
        committed: committedCosts,
        revenue: revenue.get(String(p.id)) || 0,
        budget_remaining: Number(p.revised_budget || p.budget || 0) - (spent + committedCosts)
      };
    }));
  } catch (error) {
    console.error('GET /projects failed:', error);
    res.status(500).json({ message: 'Error fetching projects' });
  }
});

// Create new project
router.post('/', authenticateToken, authorizeRole(['pm', 'accountant', 'admin']), async (req, res) => {
  try {
    const project = req.body;
    await db('projects').insert(project);
    res.status(201).json(project);
  } catch (error) {
    res.status(500).json({ message: 'Error creating project' });
  }
});

// Update project
router.patch('/:id', authenticateToken, authorizeRole(['pm', 'accountant', 'admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    await db('projects').where({ id }).update({ ...updates, updated_at: db.fn.now() });
    res.json({ message: 'Project constraints updated' });
  } catch (error) {
    res.status(500).json({ message: 'Error updating project' });
  }
});
router.get('/:id/job-costing', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Get project details (budget)
    const project = await db('projects').where({ id }).first();
    if (!project) return res.status(404).json({ message: 'Project not found' });

    // 2. Sum ledger entries by category
    const actualCosts = await db('ledger_entries')
      .join('journal_entries', 'ledger_entries.journal_id', 'journal_entries.id')
      .join('chart_of_accounts', 'ledger_entries.account_id', 'chart_of_accounts.id')
      .where('journal_entries.project_id', id)
      .where('chart_of_accounts.type', 'Expense')
      .select('chart_of_accounts.name as category')
      .select(db.raw('SUM(debit - credit) as amount'))
      .groupBy('chart_of_accounts.name');

    // 3. Sum Purchase Orders (Committed)
    const committedRes = await db('purchase_orders')
      .where('project_id', id)
      .whereIn('status', ['Approved', 'Paid', 'Partially Received'])
      .sum('total_amount as total')
      .first() as any;
    
    const totalCommitted = Number(committedRes?.total || 0);

    const totalActuals = actualCosts.reduce((s, c) => s + Number(c.amount || 0), 0);
    const revisedBudget = Number(project.revised_budget || project.budget || 0);
    const totalCommittedAndActual = totalActuals + totalCommitted;
    const budgetRemaining = revisedBudget - totalCommittedAndActual;

    // 4. Return combined budget vs actual
    res.json({
      project_name: project.name,
      total_budget: Number(project.budget || 0),
      revised_budget: revisedBudget,
      total_committed: totalCommitted,
      total_actuals: totalActuals,
      budget_remaining: budgetRemaining,
      actuals: actualCosts.map(c => ({
        category: c.category,
        amount: Number(c.amount || 0)
      }))
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error fetching job costing data' });
  }
});

// WIP Report (Percentage of Completion)
router.get('/reports/wip', authenticateToken, authorizeRole(['pm', 'accountant', 'admin']), async (req, res) => {
  try {
    // 1. Get all active projects with their contracts
    const projects = await db('projects')
      .select('projects.*', 'contracts.value as contract_value')
      .leftJoin('contracts', 'projects.id', 'contracts.project_id')
      .where('projects.status', 'In Progress');

    const wipReport = [];

    for (const project of projects) {
      // 2. Get actual costs for this project
      const costRes = await db('ledger_entries')
        .join('journal_entries', 'ledger_entries.journal_id', 'journal_entries.id')
        .join('chart_of_accounts', 'ledger_entries.account_id', 'chart_of_accounts.id')
        .where('journal_entries.project_id', project.id)
        .where('chart_of_accounts.type', 'Expense')
        .select(db.raw('SUM(debit - credit) as total'))
        .first() as any;

      const actualCost = Number(costRes?.total || 0);
      // 3. Calculate POC (Percentage of Completion)
      const budgetedCost = Number(project.estimated_cost_at_completion || project.budget);
      let poc = 0;
      if (project.completion_rate > 0) {
        poc = Number(project.completion_rate) / 100;
      } else {
        poc = budgetedCost > 0 ? Math.min(actualCost / budgetedCost, 1) : 0;
      }
      
      // 4. Calculate Earned Revenue
      const contractValue = Number(project.contract_value || project.budget);
      const earnedRevenue = contractValue * poc;

      // 5. Get Billed Revenue (Invoices)
      const billedRes = await db('invoices')
        .where('project_id', project.id)
        .sum('amount as total')
        .first() as any;
      
      const billedRevenue = Number(billedRes?.total || 0);

      wipReport.push({
        project_id: project.id,
        project_name: project.name,
        poc: (poc * 100).toFixed(1),
        contract_value: contractValue,
        earned_revenue: earnedRevenue,
        billed_revenue: billedRevenue,
        over_under_billing: earnedRevenue - billedRevenue, // Positive = Asset, Negative = Liability
        actual_cost: actualCost,
        budgeted_cost: budgetedCost
      });
    }

    res.json(wipReport);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error generating WIP report' });
  }
});

export default router;
