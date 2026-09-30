import { Router } from 'express';
import db from '../db';
import { authenticateToken, authorizeRole } from '../middleware/auth';

const router = Router();

router.get('/', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const { entity, action, user_id, from, to, q } = req.query as Record<string, string | undefined>;

    const base = db('audit_log');
    if (entity) base.where('entity', entity);
    if (action) base.where('action', action);
    if (user_id) base.where('user_id', Number(user_id));
    if (from) base.where('created_at', '>=', from);
    if (to) base.where('created_at', '<', db.raw("?::date + interval '1 day'", [to]));
    if (q) {
      const like = `%${q}%`;
      base.where(w => w.whereILike('user_email', like).orWhereILike('entity_id', like).orWhereILike('action', like));
    }

    const [items, total, facets] = await Promise.all([
      base.clone().orderBy('created_at', 'desc').limit(limit).offset(offset),
      base.clone().count('id as count').first(),
      db('audit_log').distinct('entity').orderBy('entity'),
    ]);
    res.json({ items, total: Number(total?.count || 0), entities: facets.map((f: any) => f.entity) });
  } catch (error) {
    console.error('GET /audit failed:', error);
    res.status(500).json({ message: 'Error fetching audit log' });
  }
});

export default router;
