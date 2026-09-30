import express, { Router } from 'express';
import db from '../db';
import { authenticateToken, authorizeRole, AuthRequest } from '../middleware/auth';
import { pick, orNull } from '../utils/pick';

const router = Router();

const FIELD_ROLES = ['pm', 'admin'];
const REPORT_STATUSES = ['Pending Review', 'Approved', 'Rejected'];
const TASK_STATUSES = ['Open', 'In Progress', 'Completed', 'Delayed'];
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_PHOTOS_PER_REPORT = 10;
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'];

/** Coordinates arrive as numbers; anything outside the valid range is dropped rather than stored. */
function coordinate(value: unknown, limit: number) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= limit ? n.toFixed(6) : null;
}

// Get all site reports
router.get('/reports', authenticateToken, authorizeRole(FIELD_ROLES), async (req, res) => {
  try {
    const reports = await db('site_reports')
      .select(
        'site_reports.*',
        'projects.name as project_name',
        'users.email as author_email',
        db.raw('(SELECT COUNT(*)::int FROM site_report_photos p WHERE p.report_id = site_reports.id) as photo_count'),
      )
      .join('projects', 'site_reports.project_id', 'projects.id')
      .leftJoin('users', 'site_reports.author_id', 'users.id')
      .orderBy('site_reports.created_at', 'desc');
    res.json(reports);
  } catch (error) {
    console.error('Error fetching site reports:', error);
    res.status(500).json({ message: 'Error fetching site reports' });
  }
});

// Submit a daily site report
router.post('/reports', authenticateToken, authorizeRole(FIELD_ROLES), async (req: AuthRequest, res) => {
  try {
    const { project_id, weather, content, issues } = req.body || {};
    const author_id = req.user?.id;
    if (!author_id) return res.status(401).json({ message: 'User not authenticated' });
    if (!project_id || !weather || !String(content || '').trim()) {
      return res.status(400).json({ message: 'Project, weather and progress details are required' });
    }
    const project = await db('projects').where({ id: project_id }).first();
    if (!project) return res.status(400).json({ message: 'Project not found' });

    const accuracy = Number(req.body?.gps_accuracy);
    const [inserted] = await db('site_reports').insert({
      project_id,
      author_id,
      weather: String(weather).slice(0, 100),
      content: String(content),
      issues: orNull(issues),
      gps_lat: coordinate(req.body?.gps_lat, 90),
      gps_lng: coordinate(req.body?.gps_lng, 180),
      gps_accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null,
      photos: JSON.stringify([]),
      status: 'Pending Review',
    }).returning('id');
    const id = typeof inserted === 'object' ? inserted.id : inserted;

    res.status(201).json({ id, message: 'Site report submitted' });
  } catch (error) {
    console.error('Error submitting site report:', error);
    res.status(500).json({ message: 'Error submitting site report' });
  }
});

// Approve/Reject a daily site report
router.patch('/reports/:id', authenticateToken, authorizeRole(FIELD_ROLES), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};
    if (!REPORT_STATUSES.includes(status)) {
      return res.status(400).json({ message: `Status must be one of: ${REPORT_STATUSES.join(', ')}` });
    }
    const report = await db('site_reports').where({ id }).first();
    if (!report) return res.status(404).json({ message: 'Site report not found' });
    if (report.author_id === req.user?.id && req.user?.role !== 'admin') {
      return res.status(403).json({ message: 'You cannot review your own site report' });
    }
    await db('site_reports').where({ id }).update({ status, reviewed_by: req.user?.id, updated_at: db.fn.now() });
    res.json({ message: `Site report ${String(status).toLowerCase()}` });
  } catch (error) {
    console.error('Error updating site report:', error);
    res.status(500).json({ message: 'Error updating site report' });
  }
});

// Upload one photo; the body is the raw image bytes with an image/* Content-Type
router.post(
  '/reports/:id/photos',
  authenticateToken,
  authorizeRole(FIELD_ROLES),
  express.raw({ type: 'image/*', limit: MAX_PHOTO_BYTES }),
  async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const mimeType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!PHOTO_TYPES.includes(mimeType)) return res.status(415).json({ message: 'Photos must be JPEG, PNG, WebP, GIF or HEIC images' });
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ message: 'No image data received' });

      const report = await db('site_reports').where({ id }).first();
      if (!report) return res.status(404).json({ message: 'Site report not found' });
      if (report.author_id !== req.user?.id && req.user?.role !== 'admin') {
        return res.status(403).json({ message: 'Only the report author can add photos' });
      }
      const countRow: any = await db('site_report_photos').where({ report_id: id }).count('id as count').first();
      if (Number(countRow?.count || 0) >= MAX_PHOTOS_PER_REPORT) {
        return res.status(400).json({ message: `A report can have at most ${MAX_PHOTOS_PER_REPORT} photos` });
      }

      const fileName = String(req.headers['x-file-name'] || '').slice(0, 200) || null;
      const [inserted] = await db('site_report_photos').insert({
        report_id: id,
        file_name: fileName ? decodeURIComponent(fileName) : null,
        mime_type: mimeType,
        size_bytes: req.body.length,
        data: req.body,
        uploaded_by: req.user?.id,
      }).returning('id');
      res.status(201).json({ id: typeof inserted === 'object' ? inserted.id : inserted });
    } catch (error) {
      console.error('Error uploading site photo:', error);
      res.status(500).json({ message: 'Error uploading photo' });
    }
  },
);

router.get('/reports/:id/photos', authenticateToken, authorizeRole(FIELD_ROLES), async (req, res) => {
  try {
    const photos = await db('site_report_photos')
      .where({ report_id: req.params.id })
      .select('id', 'file_name', 'mime_type', 'size_bytes', 'created_at')
      .orderBy('id');
    res.json(photos);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching photos' });
  }
});

router.get('/photos/:photoId', authenticateToken, authorizeRole(FIELD_ROLES), async (req, res) => {
  try {
    const photo = await db('site_report_photos').where({ id: req.params.photoId }).first();
    if (!photo) return res.status(404).json({ message: 'Photo not found' });
    res.setHeader('Content-Type', photo.mime_type);
    res.setHeader('Content-Length', String(photo.size_bytes));
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(photo.data);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching photo' });
  }
});

router.delete('/photos/:photoId', authenticateToken, authorizeRole(FIELD_ROLES), async (req: AuthRequest, res) => {
  try {
    const photo = await db('site_report_photos as p')
      .join('site_reports as r', 'p.report_id', 'r.id')
      .where('p.id', req.params.photoId)
      .select('p.id', 'r.author_id', 'r.status')
      .first();
    if (!photo) return res.status(404).json({ message: 'Photo not found' });
    if (photo.author_id !== req.user?.id && req.user?.role !== 'admin') {
      return res.status(403).json({ message: 'Only the report author can remove photos' });
    }
    if (photo.status === 'Approved' && req.user?.role !== 'admin') {
      return res.status(400).json({ message: 'Photos on an approved report cannot be removed' });
    }
    await db('site_report_photos').where({ id: photo.id }).del();
    res.json({ message: 'Photo removed' });
  } catch (error) {
    res.status(500).json({ message: 'Error removing photo' });
  }
});

// Get site tasks
router.get('/tasks', authenticateToken, authorizeRole(FIELD_ROLES), async (req, res) => {
  try {
    const tasks = await db('site_tasks')
      .select('site_tasks.*', 'projects.name as project_name')
      .join('projects', 'site_tasks.project_id', 'projects.id')
      .orderByRaw("CASE site_tasks.status WHEN 'Completed' THEN 1 ELSE 0 END")
      .orderByRaw('site_tasks.due_date ASC NULLS LAST')
      .orderBy('site_tasks.created_at', 'desc');
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching site tasks' });
  }
});

const TASK_FIELDS = ['project_id', 'name', 'description', 'status', 'assigned_to', 'due_date'] as const;

function cleanTask(body: unknown) {
  const data: Record<string, any> = pick(body, TASK_FIELDS);
  if (data.status !== undefined && !TASK_STATUSES.includes(data.status)) {
    throw Object.assign(new Error(`Status must be one of: ${TASK_STATUSES.join(', ')}`), { status: 400 });
  }
  if (data.name !== undefined) data.name = String(data.name).trim();
  for (const key of ['description', 'assigned_to', 'due_date'] as const) {
    if (key in data) data[key] = orNull(data[key]);
  }
  return data;
}

// Create a site task
router.post('/tasks', authenticateToken, authorizeRole(FIELD_ROLES), async (req: AuthRequest, res) => {
  try {
    const data = cleanTask(req.body);
    if (!data.project_id || !data.name) return res.status(400).json({ message: 'Project and task name are required' });
    const project = await db('projects').where({ id: data.project_id }).first();
    if (!project) return res.status(400).json({ message: 'Project not found' });
    const [inserted] = await db('site_tasks').insert({
      ...data,
      status: data.status || 'Open',
      created_by: req.user?.id,
    }).returning('id');
    res.status(201).json({ id: typeof inserted === 'object' ? inserted.id : inserted, message: 'Task created' });
  } catch (error: any) {
    if (error.status === 400) return res.status(400).json({ message: error.message });
    console.error('Error creating site task:', error);
    res.status(500).json({ message: 'Error creating task' });
  }
});

// Update task status or details
router.patch('/tasks/:id', authenticateToken, authorizeRole(FIELD_ROLES), async (req, res) => {
  try {
    const { id } = req.params;
    const updates = cleanTask(req.body);
    if (Object.keys(updates).length === 0) return res.status(400).json({ message: 'Nothing to update' });
    if (updates.status) updates.completed_at = updates.status === 'Completed' ? db.fn.now() : null;
    const count = await db('site_tasks').where({ id }).update({ ...updates, updated_at: db.fn.now() });
    if (!count) return res.status(404).json({ message: 'Task not found' });
    res.json({ message: 'Task updated' });
  } catch (error: any) {
    if (error.status === 400) return res.status(400).json({ message: error.message });
    res.status(500).json({ message: 'Error updating task' });
  }
});

router.delete('/tasks/:id', authenticateToken, authorizeRole(FIELD_ROLES), async (req, res) => {
  try {
    const count = await db('site_tasks').where({ id: req.params.id }).del();
    if (!count) return res.status(404).json({ message: 'Task not found' });
    res.json({ message: 'Task deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting task' });
  }
});

export default router;
