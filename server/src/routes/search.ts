import { Router } from 'express';
import db from '../db';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();

interface SearchResult {
  type: string;
  id: string;
  title: string;
  subtitle?: string;
  link: string;
}

type Searcher = (like: string, limit: number) => Promise<SearchResult[]>;

const SEARCHERS: Array<{ type: string; roles: string[]; run: Searcher }> = [
  {
    type: 'employee',
    roles: ['admin', 'hr', 'accountant'],
    run: async (like, limit) => (await db('employees')
      .where(w => w.whereILike('name', like).orWhereILike('id', like).orWhereILike('phone', like).orWhereILike('department', like))
      .orderBy('name').limit(limit).select('id', 'name', 'role', 'department', 'status'))
      .map(e => ({ type: 'employee', id: e.id, title: e.name, subtitle: [e.id, e.role, e.department, e.status].filter(Boolean).join(' · '), link: 'hr-directory' })),
  },
  {
    type: 'invoice',
    roles: ['admin', 'accountant'],
    run: async (like, limit) => (await db('invoices')
      .where(w => w.whereILike('id', like).orWhereILike('client', like))
      .orderBy('created_at', 'desc').limit(limit).select('id', 'client', 'amount', 'status'))
      .map(i => ({ type: 'invoice', id: i.id, title: `${i.id} · ${i.client}`, subtitle: `${Number(i.amount).toLocaleString('en-GH', { minimumFractionDigits: 2 })} · ${i.status}`, link: 'accounting-ar' })),
  },
  {
    type: 'bill',
    roles: ['admin', 'accountant'],
    run: async (like, limit) => (await db('bills')
      .leftJoin('suppliers', 'bills.supplier_id', 'suppliers.id')
      .where(w => w.whereRaw('bills.id::text ilike ?', [like]).orWhereILike('suppliers.name', like).orWhereILike('bills.category', like))
      .orderBy('bills.created_at', 'desc').limit(limit)
      .select('bills.id', 'bills.amount', 'bills.status', 'bills.category', 'suppliers.name as supplier'))
      .map(b => ({ type: 'bill', id: String(b.id), title: `Bill #${b.id} · ${b.supplier || 'Unknown supplier'}`, subtitle: `${Number(b.amount).toLocaleString('en-GH', { minimumFractionDigits: 2 })} · ${b.status}${b.category ? ` · ${b.category}` : ''}`, link: 'accounting-ap' })),
  },
  {
    type: 'supplier',
    roles: ['admin', 'accountant', 'procurement'],
    run: async (like, limit) => (await db('suppliers')
      .where(w => w.whereILike('name', like).orWhereILike('id', like).orWhereILike('contact_person', like).orWhereILike('email', like).orWhereILike('phone', like))
      .orderBy('name').limit(limit).select('id', 'name', 'category', 'contact_person'))
      .map(s => ({ type: 'supplier', id: s.id, title: s.name, subtitle: [s.category, s.contact_person].filter(Boolean).join(' · '), link: 'procurement-suppliers' })),
  },
  {
    type: 'purchase_order',
    roles: ['admin', 'accountant', 'procurement'],
    run: async (like, limit) => (await db('purchase_orders')
      .leftJoin('suppliers', 'purchase_orders.supplier_id', 'suppliers.id')
      .where(w => w.whereILike('purchase_orders.id', like).orWhereILike('suppliers.name', like))
      .orderBy('purchase_orders.created_at', 'desc').limit(limit)
      .select('purchase_orders.id', 'purchase_orders.status', 'purchase_orders.total_amount', 'suppliers.name as supplier'))
      .map(p => ({ type: 'purchase_order', id: p.id, title: `${p.id} · ${p.supplier || 'Unknown supplier'}`, subtitle: `${Number(p.total_amount || 0).toLocaleString('en-GH', { minimumFractionDigits: 2 })} · ${p.status}`, link: 'procurement-pos' })),
  },
  {
    type: 'project',
    roles: ['admin', 'accountant', 'pm', 'hr'],
    run: async (like, limit) => (await db('projects')
      .where(w => w.whereILike('name', like).orWhereILike('id', like).orWhereILike('client', like).orWhereILike('manager', like))
      .orderBy('name').limit(limit).select('id', 'name', 'client', 'status'))
      .map(p => ({ type: 'project', id: p.id, title: p.name, subtitle: [p.id, p.client, p.status].filter(Boolean).join(' · '), link: 'projects-active' })),
  },
  {
    type: 'journal',
    roles: ['admin', 'accountant'],
    run: async (like, limit) => (await db('journal_entries')
      .where(w => w.whereILike('description', like).orWhereRaw('id::text ilike ?', [like]).orWhereILike('reference_id', like))
      .orderBy('date', 'desc').limit(limit).select('id', 'date', 'description', 'reference_type'))
      .map(j => ({ type: 'journal', id: String(j.id), title: `JE-${j.id} · ${j.description || 'Journal entry'}`, subtitle: [j.date ? new Date(j.date).toISOString().slice(0, 10) : null, j.reference_type].filter(Boolean).join(' · '), link: 'accounting-transactions' })),
  },
];

router.get('/', authenticateToken, async (req: AuthRequest, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ query: q, results: [] });

  const like = `%${q.slice(0, 100).replace(/[\\%_]/g, ch => `\\${ch}`)}%`;
  const limit = Math.min(Number(req.query.limit) || 5, 20);
  const allowed = SEARCHERS.filter(s => req.user && s.roles.includes(req.user.role));

  const settled = await Promise.allSettled(allowed.map(s => s.run(like, limit)));
  const results = settled.flatMap((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    console.error(`GET /search: ${allowed[i].type} search failed:`, r.reason?.message || r.reason);
    return [];
  });
  res.json({ query: q, results });
});

export default router;
