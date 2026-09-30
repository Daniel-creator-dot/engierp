import { Router } from 'express';
import type { Knex } from 'knex';
import db from '../db';
import { authenticateToken, authorizeRole, AuthRequest } from '../middleware/auth';
import { pick, orNull } from '../utils/pick';
import { LedgerError, deleteJournal, postJournal, round2, sendError, toIsoDate } from '../lib/ledger';
import { logAudit } from '../lib/audit';

const router = Router();

type Conn = Knex | Knex.Transaction;

const FINANCE_ROLES = ['admin', 'accountant'];
const ALLOCATION_ROLES = ['pm', 'admin', 'accountant'];
const EDITABLE_STATUSES = ['Available', 'On Site', 'Maintenance'];
const MAPPING_KEY = 'asset_accounts';

const httpError = (message: string, status = 400) => new LedgerError(message, status);

async function nextEquipmentId(conn: Conn) {
  const rows = await conn('equipment').where('id', 'like', 'EQ-%').select('id');
  const max = rows.reduce((m: number, r: any) => Math.max(m, parseInt(String(r.id).slice(3), 10) || 0), 0);
  return `EQ-${String(max + 1).padStart(4, '0')}`;
}

// ---------------------------------------------------------------- Account mappings

interface CategoryMapping { cost_id?: number | null; accumulated_id?: number | null }
interface AssetAccounts {
  depreciation_expense_id: number | null;
  disposal_gain_loss_id: number | null;
  disposal_proceeds_id: number | null;
  default_cost_id: number | null;
  default_accumulated_id: number | null;
  categories: Record<string, CategoryMapping>;
}

const idOrNull = (value: unknown) => {
  const n = Number(value);
  return value !== null && value !== '' && value !== undefined && Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Saved mappings merged over defaults matched to the chart of accounts, so depreciation and
 * disposal work before anyone opens the settings screen.
 */
async function loadAccountMappings(conn: Conn): Promise<AssetAccounts> {
  const [row, accounts, categories] = await Promise.all([
    conn('settings').where({ key: MAPPING_KEY }).first(),
    conn('chart_of_accounts').select('id', 'code', 'name', 'type'),
    conn('categories').where({ type: 'asset' }).select('name', 'account_id'),
  ]);
  let saved: Partial<AssetAccounts> = {};
  try { saved = row?.value ? JSON.parse(row.value) : {}; } catch { saved = {}; }

  const byCode = (code: string) => accounts.find((a: any) => a.code === code)?.id ?? null;
  const byName = (pattern: RegExp, types: string[]) =>
    accounts.find((a: any) => types.includes(a.type) && pattern.test(a.name))?.id ?? null;

  const defaults: AssetAccounts = {
    depreciation_expense_id: byName(/depreciation expense/i, ['Expense']),
    disposal_gain_loss_id: byName(/disposal/i, ['Expense', 'Income']),
    disposal_proceeds_id: byCode('1101'),
    default_cost_id: byCode('1203'),
    default_accumulated_id: byCode('1301'),
    categories: {},
  };
  for (const cat of categories) {
    const vehicle = /vehic|truck|car/i.test(cat.name);
    defaults.categories[cat.name] = {
      cost_id: cat.account_id || (vehicle ? byCode('1204') : null),
      accumulated_id: vehicle ? byCode('1302') : null,
    };
  }

  const pickId = (key: keyof Omit<AssetAccounts, 'categories'>) => idOrNull(saved[key]) ?? defaults[key];
  const merged: AssetAccounts = {
    depreciation_expense_id: pickId('depreciation_expense_id'),
    disposal_gain_loss_id: pickId('disposal_gain_loss_id'),
    disposal_proceeds_id: pickId('disposal_proceeds_id'),
    default_cost_id: pickId('default_cost_id'),
    default_accumulated_id: pickId('default_accumulated_id'),
    categories: {},
  };
  const names = new Set([...Object.keys(defaults.categories), ...Object.keys(saved.categories || {})]);
  for (const name of names) {
    const s = saved.categories?.[name] || {};
    const d = defaults.categories[name] || {};
    merged.categories[name] = {
      cost_id: idOrNull(s.cost_id) ?? d.cost_id ?? null,
      accumulated_id: idOrNull(s.accumulated_id) ?? d.accumulated_id ?? null,
    };
  }
  return merged;
}

function accountsForAsset(map: AssetAccounts, category: string) {
  const cat = map.categories[category] || {};
  return {
    costId: cat.cost_id || map.default_cost_id,
    accumulatedId: cat.accumulated_id || map.default_accumulated_id,
  };
}

router.get('/account-mappings', authenticateToken, authorizeRole(FINANCE_ROLES), async (req, res) => {
  try {
    const [mapping, accounts, categories] = await Promise.all([
      loadAccountMappings(db),
      db('chart_of_accounts').whereIn('type', ['Asset', 'Expense', 'Income']).select('id', 'code', 'name', 'type').orderBy('code'),
      db('categories').where({ type: 'asset' }).orderBy('name').pluck('name'),
    ]);
    res.json({ mapping, accounts, categories });
  } catch (error) {
    sendError(res, error, 'Error loading asset account mappings');
  }
});

router.put('/account-mappings', authenticateToken, authorizeRole(FINANCE_ROLES), async (req: AuthRequest, res) => {
  try {
    const body = req.body || {};
    const accounts = await db('chart_of_accounts').select('id', 'name', 'type');
    const typeOf = new Map(accounts.map((a: any) => [a.id, a.type]));
    const check = (label: string, value: unknown, types: string[], required = true) => {
      const id = idOrNull(value);
      if (!id) {
        if (required) throw httpError(`Choose the ${label} account`);
        return null;
      }
      if (!types.includes(typeOf.get(id))) throw httpError(`The ${label} account must be of type ${types.join(' or ')}`);
      return id;
    };

    const next: AssetAccounts = {
      depreciation_expense_id: check('depreciation expense', body.depreciation_expense_id, ['Expense']),
      disposal_gain_loss_id: check('gain/loss on disposal', body.disposal_gain_loss_id, ['Expense', 'Income']),
      disposal_proceeds_id: check('disposal proceeds', body.disposal_proceeds_id, ['Asset']),
      default_cost_id: check('default asset cost', body.default_cost_id, ['Asset']),
      default_accumulated_id: check('default accumulated depreciation', body.default_accumulated_id, ['Asset']),
      categories: {},
    };
    for (const [name, value] of Object.entries(body.categories || {})) {
      const v = (value || {}) as CategoryMapping;
      next.categories[String(name).slice(0, 100)] = {
        cost_id: check(`${name} cost`, v.cost_id, ['Asset'], false),
        accumulated_id: check(`${name} accumulated depreciation`, v.accumulated_id, ['Asset'], false),
      };
    }

    const before = await loadAccountMappings(db);
    const value = JSON.stringify(next);
    const existing = await db('settings').where({ key: MAPPING_KEY }).first();
    if (existing) await db('settings').where({ key: MAPPING_KEY }).update({ value, updated_at: db.fn.now() });
    else await db('settings').insert({ key: MAPPING_KEY, value });
    await logAudit(req, 'update', 'asset_account_mappings', MAPPING_KEY, before, next);
    res.json({ message: 'Asset account mappings saved', mapping: next });
  } catch (error) {
    sendError(res, error, 'Error saving asset account mappings');
  }
});

// ---------------------------------------------------------------- Equipment register

const EQUIPMENT_FIELDS = [
  'name', 'category', 'status', 'daily_cost', 'purchase_date', 'initial_cost', 'useful_life',
  'residual_value', 'location', 'depreciation_method', 'last_maintenance', 'next_maintenance',
] as const;
const FINANCIAL_FIELDS = ['purchase_date', 'initial_cost', 'useful_life', 'residual_value'];

function cleanEquipment(body: any) {
  const input = { ...(body || {}) };
  // Older clients sent these names; the table has initial_cost and useful_life (years).
  if (input.initial_cost === undefined && input.acquisition_cost !== undefined) input.initial_cost = input.acquisition_cost;
  if (input.useful_life === undefined && input.useful_life_months !== undefined) input.useful_life = Number(input.useful_life_months) / 12;

  const data: Record<string, any> = pick(input, EQUIPMENT_FIELDS);
  for (const key of ['name', 'category', 'location'] as const) {
    if (typeof data[key] === 'string') data[key] = data[key].trim();
  }
  for (const key of ['daily_cost', 'initial_cost', 'residual_value'] as const) {
    if (data[key] === undefined) continue;
    const n = Number(data[key] || 0);
    if (!Number.isFinite(n) || n < 0) throw httpError(`${key.replace('_', ' ')} cannot be negative`);
    data[key] = round2(n);
  }
  if (data.useful_life !== undefined) {
    const years = Number(data.useful_life);
    if (!Number.isFinite(years) || years <= 0 || years > 100) throw httpError('Useful life must be between 0 and 100 years');
    data.useful_life = Math.round(years * 100) / 100;
  }
  for (const key of ['purchase_date', 'last_maintenance', 'next_maintenance'] as const) {
    if (key in data) data[key] = orNull(data[key]) ? toIsoDate(data[key]) : null;
  }
  if (data.status !== undefined && !EDITABLE_STATUSES.includes(data.status)) {
    throw httpError(`Status must be one of ${EDITABLE_STATUSES.join(', ')}. Use Dispose to retire an asset.`);
  }
  if ('location' in data) data.location = orNull(data.location);
  return data;
}

function withBookValue(asset: any) {
  const cost = Number(asset.initial_cost || 0);
  const accumulated = Number(asset.accumulated_depreciation || 0);
  const residual = Number(asset.residual_value || 0);
  const life = Number(asset.useful_life || 0);
  return {
    ...asset,
    initial_cost: cost,
    accumulated_depreciation: accumulated,
    residual_value: residual,
    net_book_value: round2(cost - accumulated),
    monthly_depreciation: life > 0 && !asset.disposal_date ? round2(Math.max(cost - residual, 0) / life / 12) : 0,
    fully_depreciated: cost > 0 && accumulated >= cost - residual - 0.005,
  };
}

router.get('/', authenticateToken, async (req, res) => {
  try {
    const equipment = await db('equipment as e')
      .leftJoin('equipment_allocations as a', function () {
        this.on('a.equipment_id', 'e.id').andOnNull('a.end_date');
      })
      .leftJoin('projects as p', 'a.project_id', 'p.id')
      .select('e.*', 'a.project_id as current_project_id', 'p.name as current_project_name')
      .orderBy('e.id');
    res.json(equipment.map(withBookValue));
  } catch (error) {
    console.error('GET /assets failed:', error);
    res.status(500).json({ message: 'Error fetching equipment' });
  }
});

router.post('/', authenticateToken, authorizeRole(FINANCE_ROLES), async (req: AuthRequest, res) => {
  try {
    const data = cleanEquipment(req.body);
    if (!data.name || !data.category) return res.status(400).json({ message: 'Asset name and category are required' });
    if (Number(data.residual_value || 0) > Number(data.initial_cost || 0)) {
      return res.status(400).json({ message: 'Residual value cannot be more than the cost' });
    }
    const id = await db.transaction(async (trx) => {
      const newId = await nextEquipmentId(trx);
      await trx('equipment').insert({ status: 'Available', ...data, id: newId, accumulated_depreciation: 0 });
      return newId;
    });
    await logAudit(req, 'create', 'equipment', id, undefined, data);
    res.status(201).json({ id, message: 'Equipment registered' });
  } catch (error) {
    sendError(res, error, 'Error registering equipment');
  }
});

router.patch('/:id', authenticateToken, authorizeRole(FINANCE_ROLES), async (req: AuthRequest, res) => {
  try {
    const updates = cleanEquipment(req.body);
    if (Object.keys(updates).length === 0) return res.status(400).json({ message: 'Nothing to update' });
    if (updates.name === '' || updates.category === '') return res.status(400).json({ message: 'Name and category cannot be blank' });

    const before = await db.transaction(async (trx) => {
      const asset = await trx('equipment').where({ id: req.params.id }).forUpdate().first();
      if (!asset) throw httpError('Asset not found', 404);
      if (asset.status === 'Disposed' || asset.disposal_date) {
        if (updates.status || FINANCIAL_FIELDS.some(f => f in updates)) {
          throw httpError('This asset has been disposed; only its name, category and location can change');
        }
      }
      const cost = updates.initial_cost ?? Number(asset.initial_cost || 0);
      const residual = updates.residual_value ?? Number(asset.residual_value || 0);
      if (residual > cost) throw httpError('Residual value cannot be more than the cost');
      if (cost < Number(asset.accumulated_depreciation || 0)) {
        throw httpError('Cost cannot be less than the depreciation already charged');
      }
      await trx('equipment').where({ id: asset.id }).update({ ...updates, updated_at: trx.fn.now() });
      return asset;
    });
    await logAudit(req, 'update', 'equipment', req.params.id, before, updates);
    res.json({ message: 'Equipment registry updated' });
  } catch (error) {
    sendError(res, error, 'Error updating equipment');
  }
});

// ---------------------------------------------------------------- Allocations

router.get('/allocations', authenticateToken, async (req, res) => {
  try {
    const allocations = await db('equipment_allocations')
      .select('equipment_allocations.*', 'equipment.name as equipment_name', 'projects.name as project_name')
      .leftJoin('equipment', 'equipment_allocations.equipment_id', 'equipment.id')
      .leftJoin('projects', 'equipment_allocations.project_id', 'projects.id')
      .orderByRaw('equipment_allocations.end_date IS NOT NULL, equipment_allocations.start_date DESC');
    res.json(allocations);
  } catch (error) {
    console.error('GET /assets/allocations failed:', error);
    res.status(500).json({ message: 'Error fetching allocations' });
  }
});

router.post('/allocations', authenticateToken, authorizeRole(ALLOCATION_ROLES), async (req: AuthRequest, res) => {
  try {
    const equipmentId = String(req.body?.equipment_id || '');
    const projectId = String(req.body?.project_id || '');
    if (!equipmentId || !projectId) return res.status(400).json({ message: 'Choose the equipment and the project site' });
    const startDate = toIsoDate(req.body?.start_date);
    const endDate = orNull(req.body?.end_date) ? toIsoDate(req.body.end_date) : null;
    if (endDate && endDate < startDate) return res.status(400).json({ message: 'End date cannot be before the start date' });

    await db.transaction(async (trx) => {
      const asset = await trx('equipment').where({ id: equipmentId }).forUpdate().first();
      if (!asset) throw httpError('Equipment not found', 404);
      if (asset.status === 'Disposed') throw httpError('Disposed equipment cannot be deployed');
      if (asset.status === 'Maintenance') throw httpError(`${asset.name} is under maintenance`);
      if (!(await trx('projects').where({ id: projectId }).first())) throw httpError('Project not found', 404);

      // Moving between sites closes the current deployment.
      await trx('equipment_allocations').where({ equipment_id: equipmentId }).whereNull('end_date')
        .update({ end_date: startDate, updated_at: trx.fn.now() });
      await trx('equipment_allocations').insert({ equipment_id: equipmentId, project_id: projectId, start_date: startDate, end_date: endDate });
      await trx('equipment').where({ id: equipmentId }).update({ status: endDate ? asset.status : 'On Site', updated_at: trx.fn.now() });
    });
    await logAudit(req, 'allocate', 'equipment', equipmentId, undefined, { project_id: projectId, start_date: startDate, end_date: endDate });
    res.status(201).json({ message: 'Equipment allocated to site' });
  } catch (error) {
    sendError(res, error, 'Error allocating equipment');
  }
});

// Bring equipment back from site
router.post('/allocations/:id/return', authenticateToken, authorizeRole(ALLOCATION_ROLES), async (req: AuthRequest, res) => {
  try {
    const endDate = toIsoDate(req.body?.end_date);
    await db.transaction(async (trx) => {
      const alloc = await trx('equipment_allocations').where({ id: req.params.id }).forUpdate().first();
      if (!alloc) throw httpError('Allocation not found', 404);
      if (alloc.end_date) throw httpError('This equipment has already been returned');
      if (endDate < toIsoDate(alloc.start_date)) throw httpError('Return date cannot be before the deployment date');
      await trx('equipment_allocations').where({ id: alloc.id }).update({ end_date: endDate, updated_at: trx.fn.now() });
      await trx('equipment').where({ id: alloc.equipment_id }).where('status', 'On Site')
        .update({ status: 'Available', updated_at: trx.fn.now() });
    });
    await logAudit(req, 'return', 'equipment_allocation', req.params.id, undefined, { end_date: endDate });
    res.json({ message: 'Equipment returned from site' });
  } catch (error) {
    sendError(res, error, 'Error returning equipment');
  }
});

// ---------------------------------------------------------------- Depreciation

const lastDayOfMonth = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return toIsoDate(new Date(y, m, 0));
};

router.get('/depreciation-runs', authenticateToken, authorizeRole(FINANCE_ROLES), async (req, res) => {
  try {
    const runs = await db('depreciation_runs as r')
      .leftJoin('users as u', 'r.created_by', 'u.id')
      .select('r.*', 'u.email as created_by_email')
      .orderBy('r.period', 'desc');
    res.json(runs.map((r: any) => ({ ...r, total: Number(r.total) })));
  } catch (error) {
    sendError(res, error, 'Error fetching depreciation runs');
  }
});

async function runDepreciation(req: AuthRequest, period: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw httpError('Choose the month to depreciate (YYYY-MM)');
  const periodEnd = lastDayOfMonth(period);
  const thisMonth = toIsoDate(new Date()).slice(0, 7);
  if (period > thisMonth) throw httpError('Depreciation cannot be run for a future month');

  return db.transaction(async (trx) => {
    const existing = await trx('depreciation_runs').where({ period }).first();
    if (existing) throw httpError(`Depreciation for ${period} was already posted (journal ${existing.journal_id ?? '-'})`, 409);

    const map = await loadAccountMappings(trx);
    if (!map.depreciation_expense_id) throw httpError('Set the depreciation expense account under Assets > Account Mappings first');

    const assets = await trx('equipment')
      .whereNull('disposal_date')
      .whereNot('status', 'Disposed')
      .where(q => q.whereNull('purchase_date').orWhere('purchase_date', '<=', periodEnd))
      .forUpdate();

    const lines: Array<{ equipment_id: string; amount: number; accumulatedId: number }> = [];
    for (const asset of assets) {
      const cost = Number(asset.initial_cost || 0);
      const residual = Number(asset.residual_value || 0);
      const life = Number(asset.useful_life || 0);
      if (cost <= 0 || life <= 0) continue;
      const remaining = round2(cost - residual - Number(asset.accumulated_depreciation || 0));
      const amount = Math.min(round2((cost - residual) / life / 12), remaining);
      if (amount <= 0) continue;
      const { accumulatedId } = accountsForAsset(map, asset.category);
      if (!accumulatedId) throw httpError(`No accumulated depreciation account is mapped for ${asset.category}`);
      lines.push({ equipment_id: asset.id, amount, accumulatedId });
    }
    if (!lines.length) throw httpError(`No assets need depreciation for ${period}`);

    const total = round2(lines.reduce((s, l) => s + l.amount, 0));
    const [inserted] = await trx('depreciation_runs').insert({
      period, period_end: periodEnd, total, asset_count: lines.length, created_by: req.user?.id,
    }).returning('id');
    const runId = typeof inserted === 'object' ? inserted.id : inserted;

    const credits = new Map<number, number>();
    for (const l of lines) credits.set(l.accumulatedId, round2((credits.get(l.accumulatedId) || 0) + l.amount));
    const journalId = await postJournal(trx, {
      date: periodEnd,
      description: `Depreciation for ${period} (${lines.length} asset${lines.length === 1 ? '' : 's'})`,
      reference_type: 'depreciation',
      reference_id: runId,
      lines: [
        { account_id: map.depreciation_expense_id, debit: total, credit: 0 },
        ...[...credits].map(([account_id, amount]) => ({ account_id, debit: 0, credit: amount })),
      ],
    });

    for (const l of lines) {
      await trx('equipment').where({ id: l.equipment_id }).increment('accumulated_depreciation', l.amount);
    }
    await trx('depreciation_run_lines').insert(lines.map(l => ({
      run_id: runId,
      equipment_id: l.equipment_id,
      amount: l.amount,
      expense_account_id: map.depreciation_expense_id,
      accumulated_account_id: l.accumulatedId,
    })));
    await trx('depreciation_runs').where({ id: runId }).update({ journal_id: journalId });
    await logAudit(req, 'depreciate', 'depreciation_run', runId, undefined, { period, total, assets: lines.length }, trx);
    return { runId, journalId, total, assetCount: lines.length };
  });
}

router.post('/depreciation-runs', authenticateToken, authorizeRole(FINANCE_ROLES), async (req: AuthRequest, res) => {
  try {
    const result = await runDepreciation(req, String(req.body?.period || ''));
    res.status(201).json({ message: `Depreciation of ${result.total.toFixed(2)} posted for ${result.assetCount} asset(s)`, ...result });
  } catch (error) {
    sendError(res, error, 'Error processing depreciation');
  }
});

// Older clients post a period end date here
router.post('/depreciate', authenticateToken, authorizeRole(FINANCE_ROLES), async (req: AuthRequest, res) => {
  try {
    const period = String(req.body?.period || toIsoDate(req.body?.periodEndDate).slice(0, 7));
    const result = await runDepreciation(req, period);
    res.json({ message: 'Depreciation processed', total: result.total, ...result });
  } catch (error) {
    sendError(res, error, 'Error processing depreciation');
  }
});

// Undo the most recent run, e.g. after correcting an asset's cost
router.delete('/depreciation-runs/:id', authenticateToken, authorizeRole(FINANCE_ROLES), async (req: AuthRequest, res) => {
  try {
    const run = await db.transaction(async (trx) => {
      const row = await trx('depreciation_runs').where({ id: req.params.id }).forUpdate().first();
      if (!row) throw httpError('Depreciation run not found', 404);
      const latest = await trx('depreciation_runs').orderBy('period', 'desc').first();
      if (latest.id !== row.id) throw httpError(`Only the latest run (${latest.period}) can be undone`);

      const lines = await trx('depreciation_run_lines').where({ run_id: row.id });
      const disposed = await trx('equipment').whereIn('id', lines.map((l: any) => l.equipment_id)).whereNotNull('disposal_date').first();
      if (disposed) throw httpError(`${disposed.name} has since been disposed, so this run cannot be undone`);

      if (row.journal_id) await deleteJournal(trx, row.journal_id);
      for (const l of lines) {
        await trx('equipment').where({ id: l.equipment_id }).decrement('accumulated_depreciation', Number(l.amount));
      }
      await trx('depreciation_runs').where({ id: row.id }).del();
      return row;
    });
    await logAudit(req, 'delete', 'depreciation_run', run.id, run);
    res.json({ message: `Depreciation for ${run.period} reversed` });
  } catch (error) {
    sendError(res, error, 'Error undoing depreciation run');
  }
});

// ---------------------------------------------------------------- Disposal

router.post('/dispose/:id', authenticateToken, authorizeRole(FINANCE_ROLES), async (req: AuthRequest, res) => {
  try {
    const value = round2(req.body?.disposal_value ?? req.body?.disposal_amount ?? 0);
    if (value < 0) return res.status(400).json({ message: 'Sale proceeds cannot be negative' });
    const disposalDate = toIsoDate(req.body?.disposal_date);

    const result = await db.transaction(async (trx) => {
      const asset = await trx('equipment').where({ id: req.params.id }).forUpdate().first();
      if (!asset) throw httpError('Asset not found', 404);
      if (asset.status === 'Disposed' || asset.disposal_date) throw httpError('This asset has already been disposed');
      if (asset.purchase_date && disposalDate < toIsoDate(asset.purchase_date)) {
        throw httpError('Disposal date cannot be before the purchase date');
      }

      const map = await loadAccountMappings(trx);
      const { costId, accumulatedId } = accountsForAsset(map, asset.category);
      const proceedsId = idOrNull(req.body?.proceeds_account_id) ?? map.disposal_proceeds_id;
      if (idOrNull(req.body?.proceeds_account_id)) {
        const acct = await trx('chart_of_accounts').where({ id: proceedsId }).first();
        if (!acct || acct.type !== 'Asset') throw httpError('Proceeds must go to a cash, bank or receivable (asset) account');
      }

      const cost = round2(asset.initial_cost);
      const accumulated = round2(asset.accumulated_depreciation);
      const bookValue = round2(cost - accumulated);
      const gainLoss = round2(value - bookValue);

      // Dr proceeds, Dr accumulated depreciation, Cr asset cost; the difference is the gain (credit) or loss (debit).
      const lines = [
        { account_id: proceedsId, debit: value, credit: 0 },
        { account_id: accumulatedId, debit: accumulated, credit: 0 },
        { account_id: costId, debit: 0, credit: cost },
        { account_id: map.disposal_gain_loss_id, debit: gainLoss < 0 ? -gainLoss : 0, credit: gainLoss > 0 ? gainLoss : 0 },
      ].filter(l => l.debit !== 0 || l.credit !== 0);

      const missing = lines.find(l => !l.account_id);
      if (missing) {
        throw httpError('Set the asset cost, accumulated depreciation, proceeds and gain/loss accounts under Assets > Account Mappings first');
      }

      let journalId: number | null = null;
      if (lines.length >= 2) {
        journalId = await postJournal(trx, {
          date: disposalDate,
          description: `Asset disposal: ${asset.name} (${asset.id})`,
          reference_type: 'asset_disposal',
          reference_id: asset.id,
          lines: lines as Array<{ account_id: number; debit: number; credit: number }>,
        });
      }

      await trx('equipment').where({ id: asset.id }).update({
        status: 'Disposed',
        disposal_date: disposalDate,
        disposal_value: value,
        disposal_journal_id: journalId,
        updated_at: trx.fn.now(),
      });
      await trx('equipment_allocations').where({ equipment_id: asset.id }).whereNull('end_date')
        .update({ end_date: disposalDate, updated_at: trx.fn.now() });
      await logAudit(req, 'dispose', 'equipment', asset.id, asset, { disposal_date: disposalDate, disposal_value: value, gain_loss: gainLoss, journal_id: journalId }, trx);
      return { gainLoss, bookValue, journalId };
    });

    const outcome = result.gainLoss === 0 ? 'at book value' : result.gainLoss > 0 ? `with a gain of ${result.gainLoss.toFixed(2)}` : `with a loss of ${(-result.gainLoss).toFixed(2)}`;
    res.json({ message: `Asset disposed ${outcome}`, ...result });
  } catch (error) {
    sendError(res, error, 'Error disposing asset');
  }
});

export default router;
