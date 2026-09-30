import { Router } from 'express';
import db from '../db';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();

router.get('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const [items, unread] = await Promise.all([
      db('notifications').where({ user_id: req.user!.id }).orderBy('created_at', 'desc').limit(limit),
      db('notifications').where({ user_id: req.user!.id }).whereNull('read_at').count('id as count').first(),
    ]);
    res.json({ items, unread: Number(unread?.count || 0) });
  } catch (error) {
    console.error('GET /notifications failed:', error);
    res.status(500).json({ message: 'Error fetching notifications' });
  }
});

router.patch('/:id/read', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const updated = await db('notifications')
      .where({ id: req.params.id, user_id: req.user!.id })
      .whereNull('read_at')
      .update({ read_at: db.fn.now() });
    res.json({ updated });
  } catch (error) {
    console.error('PATCH /notifications/:id/read failed:', error);
    res.status(500).json({ message: 'Error updating notification' });
  }
});

router.post('/read-all', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const updated = await db('notifications').where({ user_id: req.user!.id }).whereNull('read_at').update({ read_at: db.fn.now() });
    res.json({ updated });
  } catch (error) {
    console.error('POST /notifications/read-all failed:', error);
    res.status(500).json({ message: 'Error updating notifications' });
  }
});

export default router;
