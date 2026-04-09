import { Router } from 'express';
import db from '../db';
import { authenticateToken, authorizeRole, AuthRequest } from '../middleware/auth';

const router = Router();

// Get all site reports (PM/Admin only)
router.get('/reports', authenticateToken, authorizeRole(['pm', 'admin']), async (req, res) => {
  try {
    const reports = await db('site_reports')
      .select('site_reports.*', 'projects.name as project_name', 'users.email as author_email')
      .join('projects', 'site_reports.project_id', 'projects.id')
      .join('users', 'site_reports.author_id', 'users.id')
      .orderBy('site_reports.created_at', 'desc');
    res.json(reports);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching site reports' });
  }
});

// Submit a daily site report
router.post('/reports', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { project_id, weather, content, issues, gps_lat, gps_lng, photos } = req.body;
    const author_id = req.user?.id;

    if (!author_id) return res.status(401).json({ message: 'User not authenticated' });

    const [id] = await db('site_reports').insert({
      project_id,
      author_id,
      weather,
      content,
      issues,
      gps_lat,
      gps_lng,
      photos: JSON.stringify(photos || []),
      status: 'Pending Review'
    }).returning('id');

    res.status(201).json({ id, message: 'Site report submitted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error submitting site report' });
  }
});

// Approve/Reject a daily site report
router.patch('/reports/:id', authenticateToken, authorizeRole(['pm', 'admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    await db('site_reports').where({ id }).update({ status, updated_at: db.fn.now() });
    res.json({ message: `Site report ${status.toLowerCase()}` });
  } catch (error) {
    res.status(500).json({ message: 'Error updating site report' });
  }
});

// Get site tasks
router.get('/tasks', authenticateToken, async (req, res) => {
  try {
    const tasks = await db('site_tasks')
      .select('site_tasks.*', 'projects.name as project_name')
      .join('projects', 'site_tasks.project_id', 'projects.id')
      .orderBy('site_tasks.created_at', 'desc');
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching site tasks' });
  }
});

// Update task status
router.patch('/tasks/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    await db('site_tasks').where({ id }).update({ status, updated_at: db.fn.now() });
    res.json({ message: 'Task status updated' });
  } catch (error) {
    res.status(500).json({ message: 'Error updating task' });
  }
});

export default router;
