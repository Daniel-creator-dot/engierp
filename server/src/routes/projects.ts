import { Router } from 'express';
import type { Knex } from 'knex';
import db from '../db';
import { authenticateToken, authorizeRole, AuthRequest } from '../middleware/auth';
import { pick, orNull } from '../utils/pick';

const router = Router();

export const PROJECT_STATUSES = ['Planning', 'In Progress', 'On Hold', 'Completed'] as const;
/** Purchase orders that are committed spend but not yet posted to the ledger as a bill. */
export const COMMITTED_PO_STATUSES = ['Approved', 'Partially Received', 'Received'];
const VOID_INVOICE_STATUSES = ['void', 'voided', 'cancelled', 'draft'];

const PROJECT_FIELDS = [
  'name', 'client', 'budget', 'revised_budget', 'estimated_cost_at_completion',
  'status', 'startDate', 'endDate', 'manager', 'completion_rate',
] as const;

function cleanProject(body: unknown) {
  const data: Record<string, any> = pick(body, PROJECT_FIELDS);
  for (const key of ['budget', 'revised_budget', 'estimated_cost_at_completion', 'completion_rate'] as const) {
    if (data[key] === '' || data[key] === null) data[key] = key === 'budget' ? 0 : null;
    else if (data[key] !== undefined) data[key] = Number(data[key]);
  }
  if (data.endDate === '' || data.endDate === null) data.endDate = 'TBD';
  if (data.completion_rate != null) data.completion_rate = Math.min(Math.max(data.completion_rate, 0), 100);
  if (data.status !== undefined && !PROJECT_STATUSES.includes(data.status)) {
    throw Object.assign(new Error(`Status must be one of: ${PROJECT_STATUSES.join(', ')}`), { status: 400 });
  }
  return data;
}

type Totals = Map<string, number>;

async function sumByProject(query: Knex.QueryBuilder): Promise<Totals> {
  const rows: any[] = await query;
  return new Map(rows.map(r => [String(r.project_id), Number(r.total || 0)]));
}

/** Project-level financial figures computed in a handful of grouped queries. */
async function projectFinancials(projectIds?: string[]) {
  const scope = (q: Knex.QueryBuilder, column: string) => (projectIds ? q.whereIn(column, projectIds) : q.whereNotNull(column));

  const [actuals, committed, billed, paid] = await Promise.all([
    sumByProject(scope(
      db('ledger_entries as le')
        .join('journal_entries as je', 'le.journal_id', 'je.id')
        .join('chart_of_accounts as coa', 'le.account_id', 'coa.id')
        .where('coa.type', 'Expense')
        .select('je.project_id', db.raw('SUM(le.debit - le.credit) as total'))
        .groupBy('je.project_id'),
      'je.project_id',
    )),
    sumByProject(scope(
      db('purchase_orders')
        .whereIn('status', COMMITTED_PO_STATUSES)
        .select('project_id', db.raw('SUM(total_amount) as total'))
        .groupBy('project_id'),
      'project_id',
    )),
    // Revenue is recognised when billed; VAT is excluded where the invoice records a subtotal.
    sumByProject(scope(
      db('invoices')
        .whereRaw('LOWER(COALESCE(status, \'\')) NOT IN (' + VOID_INVOICE_STATUSES.map(() => '?').join(',') + ')', VOID_INVOICE_STATUSES)
        .select('project_id', db.raw('SUM(COALESCE(subtotal, amount)) as total'))
        .groupBy('project_id'),
      'project_id',
    )),
    sumByProject(scope(
      db('payments as p')
        .join('invoices as i', function () {
          this.on('p.target_id', '=', 'i.id').andOn('p.target_type', '=', db.raw('?', ['Invoice']));
        })
        .select('i.project_id', db.raw('SUM(p.amount) as total'))
        .groupBy('i.project_id'),
      'i.project_id',
    )),
  ]);

  return { actuals, committed, billed, paid };
}

// Get all projects
router.get('/', authenticateToken, async (req, res) => {
  try {
    const projects = await db('projects').select('*').orderBy('created_at', 'desc');
    // Financial figures are an enrichment: if they can't be computed, still return the project list.
    const empty = new Map<string, number>();
    const { actuals, committed, billed, paid } = await projectFinancials().catch((error) => {
      console.error('GET /projects: failed to compute project financials:', error);
      return { actuals: empty, committed: empty, billed: empty, paid: empty };
    });

    res.json(projects.map((p: any) => {
      const spent = actuals.get(p.id) || 0;
      const committedCosts = committed.get(p.id) || 0;
      const budget = Number(p.revised_budget || p.budget || 0);
      return {
        ...p,
        spent,
        committed: committedCosts,
        revenue: billed.get(p.id) || 0,
        revenue_paid: paid.get(p.id) || 0,
        budget_remaining: budget - (spent + committedCosts),
      };
    }));
  } catch (error) {
    console.error('Error fetching projects:', error);
    res.status(500).json({ message: 'Error fetching projects' });
  }
});

// Expense accounts a project budget can be split across
router.get('/cost-accounts', authenticateToken, authorizeRole(['pm', 'accountant', 'admin']), async (req, res) => {
  try {
    const accounts = await db('chart_of_accounts').where('type', 'Expense').select('id', 'code', 'name').orderBy('code');
    res.json(accounts);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching cost accounts' });
  }
});

// Create new project
router.post('/', authenticateToken, authorizeRole(['pm', 'accountant', 'admin']), async (req: AuthRequest, res) => {
  try {
    const id = String(req.body?.id || '').trim().toUpperCase();
    if (!id) return res.status(400).json({ message: 'Project code is required' });
    const data = cleanProject(req.body);
    if (!data.name || !data.client) return res.status(400).json({ message: 'Project name and client are required' });

    const existing = await db('projects').where({ id }).first();
    if (existing) return res.status(409).json({ message: `Project code ${id} is already in use` });

    const project = {
      id,
      ...data,
      status: data.status || 'Planning',
      budget: data.budget ?? 0,
      startDate: data.startDate || new Date().toISOString().slice(0, 10),
      endDate: data.endDate || 'TBD',
      manager: data.manager || req.user?.email || 'Unassigned',
    };
    await db('projects').insert(project);
    res.status(201).json(project);
  } catch (error: any) {
    if (error.status === 400) return res.status(400).json({ message: error.message });
    console.error('Error creating project:', error);
    res.status(500).json({ message: 'Error creating project' });
  }
});

// Update project
router.patch('/:id', authenticateToken, authorizeRole(['pm', 'accountant', 'admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const updates = cleanProject(req.body);
    if (Object.keys(updates).length === 0) return res.status(400).json({ message: 'Nothing to update' });
    const count = await db('projects').where({ id }).update({ ...updates, updated_at: db.fn.now() });
    if (!count) return res.status(404).json({ message: 'Project not found' });
    res.json({ message: 'Project updated' });
  } catch (error: any) {
    if (error.status === 400) return res.status(400).json({ message: error.message });
    console.error('Error updating project:', error);
    res.status(500).json({ message: 'Error updating project' });
  }
});

// Job cost report: budget vs actual per cost account
router.get('/:id/job-costing', authenticateToken, authorizeRole(['pm', 'accountant', 'admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const project = await db('projects').where({ id }).first();
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const [actualRows, budgetRows, poRows, fin] = await Promise.all([
      db('ledger_entries as le')
        .join('journal_entries as je', 'le.journal_id', 'je.id')
        .join('chart_of_accounts as coa', 'le.account_id', 'coa.id')
        .where('je.project_id', id)
        .where('coa.type', 'Expense')
        .select('coa.id as account_id', 'coa.code', 'coa.name')
        .select(db.raw('SUM(le.debit - le.credit) as amount'))
        .groupBy('coa.id', 'coa.code', 'coa.name'),
      db('project_budget_lines as b')
        .join('chart_of_accounts as coa', 'b.account_id', 'coa.id')
        .where('b.project_id', id)
        .select('b.account_id', 'coa.code', 'coa.name', 'b.amount', 'b.notes'),
      db('purchase_orders as po')
        .leftJoin('suppliers as s', 'po.supplier_id', 's.id')
        .where('po.project_id', id)
        .whereIn('po.status', COMMITTED_PO_STATUSES)
        .select('po.id', 'po.order_date', 'po.status', 'po.total_amount', 's.name as supplier_name')
        .orderBy('po.order_date', 'desc'),
      projectFinancials([id]),
    ]);

    const lines = new Map<number, any>();
    for (const b of budgetRows) {
      lines.set(b.account_id, { account_id: b.account_id, code: b.code, name: b.name, budget: Number(b.amount || 0), actual: 0, notes: b.notes || '' });
    }
    for (const a of actualRows) {
      const line = lines.get(a.account_id) || { account_id: a.account_id, code: a.code, name: a.name, budget: 0, actual: 0, notes: '' };
      line.actual = Number(a.amount || 0);
      lines.set(a.account_id, line);
    }
    const categories = [...lines.values()]
      .map(l => ({ ...l, variance: l.budget - l.actual }))
      .sort((a, b) => String(a.code).localeCompare(String(b.code)));

    const totalActuals = categories.reduce((s, c) => s + c.actual, 0);
    const totalBudgetLines = categories.reduce((s, c) => s + c.budget, 0);
    const totalCommitted = fin.committed.get(id) || 0;
    const revisedBudget = Number(project.revised_budget || project.budget || 0);

    res.json({
      project_id: project.id,
      project_name: project.name,
      client: project.client,
      status: project.status,
      manager: project.manager,
      completion_rate: Number(project.completion_rate || 0),
      total_budget: Number(project.budget || 0),
      revised_budget: revisedBudget,
      budget_lines_total: totalBudgetLines,
      unallocated_budget: revisedBudget - totalBudgetLines,
      total_committed: totalCommitted,
      total_actuals: totalActuals,
      budget_remaining: revisedBudget - (totalActuals + totalCommitted),
      revenue_billed: fin.billed.get(id) || 0,
      revenue_paid: fin.paid.get(id) || 0,
      categories,
      // Kept for older clients.
      actuals: categories.filter(c => c.actual !== 0).map(c => ({ category: c.name, amount: c.actual })),
      commitments: poRows.map((po: any) => ({ ...po, total_amount: Number(po.total_amount || 0) })),
    });
  } catch (error) {
    console.error('Error fetching job costing:', error);
    res.status(500).json({ message: 'Error fetching job costing data' });
  }
});

// Replace the per-account budget for a project
router.put('/:id/budget-lines', authenticateToken, authorizeRole(['pm', 'accountant', 'admin']), async (req, res) => {
  const { id } = req.params;
  const input = Array.isArray(req.body?.lines) ? req.body.lines : null;
  if (!input) return res.status(400).json({ message: 'lines must be an array' });

  const lines = new Map<number, { account_id: number; amount: number; notes: string | null }>();
  for (const raw of input) {
    const accountId = Number(raw?.account_id);
    const amount = Number(raw?.amount);
    if (!Number.isInteger(accountId) || !Number.isFinite(amount) || amount < 0) {
      return res.status(400).json({ message: 'Each line needs an account and a non-negative amount' });
    }
    if (amount > 0) lines.set(accountId, { account_id: accountId, amount, notes: orNull(raw?.notes) as string | null });
  }

  try {
    await db.transaction(async (trx) => {
      const project = await trx('projects').where({ id }).first();
      if (!project) throw Object.assign(new Error('Project not found'), { status: 404 });
      if (lines.size) {
        const accounts = await trx('chart_of_accounts').whereIn('id', [...lines.keys()]).select('id', 'type');
        if (accounts.length !== lines.size || accounts.some((a: any) => a.type !== 'Expense')) {
          throw Object.assign(new Error('Budget lines must use expense accounts'), { status: 400 });
        }
      }
      await trx('project_budget_lines').where({ project_id: id }).delete();
      if (lines.size) {
        await trx('project_budget_lines').insert([...lines.values()].map(l => ({ ...l, project_id: id })));
      }
    });
    res.json({ message: 'Budget saved' });
  } catch (error: any) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error('Error saving budget lines:', error);
    res.status(500).json({ message: 'Error saving budget lines' });
  }
});

// WIP Report (Percentage of Completion) for every project not yet completed
router.get('/reports/wip', authenticateToken, authorizeRole(['pm', 'accountant', 'admin']), async (req, res) => {
  try {
    const projects = await db('projects')
      .whereNot('status', 'Completed')
      .orderBy('name');
    const ids = projects.map((p: any) => p.id);
    if (!ids.length) return res.json([]);

    const [contractRows, fin] = await Promise.all([
      db('contracts')
        .whereIn('project_id', ids)
        .whereRaw('LOWER(COALESCE(status, \'\')) NOT IN (?, ?)', ['cancelled', 'terminated'])
        .select('project_id', db.raw('SUM(value) as total'))
        .groupBy('project_id'),
      projectFinancials(ids),
    ]);
    const contractValue = new Map(contractRows.map((r: any) => [String(r.project_id), Number(r.total || 0)]));

    res.json(projects.map((project: any) => {
      const actualCost = fin.actuals.get(project.id) || 0;
      const budgetedCost = Number(project.estimated_cost_at_completion || project.revised_budget || project.budget || 0);
      const completion = Number(project.completion_rate || 0);
      const poc = completion > 0
        ? Math.min(completion / 100, 1)
        : budgetedCost > 0 ? Math.min(actualCost / budgetedCost, 1) : 0;
      const value = contractValue.get(project.id) || Number(project.revised_budget || project.budget || 0);
      const earnedRevenue = value * poc;
      const billedRevenue = fin.billed.get(project.id) || 0;

      return {
        project_id: project.id,
        project_name: project.name,
        status: project.status,
        poc: (poc * 100).toFixed(1),
        poc_basis: completion > 0 ? 'reported' : 'cost',
        contract_value: value,
        has_contract: contractValue.has(project.id),
        earned_revenue: earnedRevenue,
        billed_revenue: billedRevenue,
        paid_revenue: fin.paid.get(project.id) || 0,
        over_under_billing: earnedRevenue - billedRevenue, // Positive = underbilled (asset), negative = overbilled (liability)
        actual_cost: actualCost,
        budgeted_cost: budgetedCost,
      };
    }));
  } catch (error) {
    console.error('Error generating WIP report:', error);
    res.status(500).json({ message: 'Error generating WIP report' });
  }
});

export default router;
