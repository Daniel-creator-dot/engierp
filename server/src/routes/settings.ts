import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db';
import { authenticateToken, authorizeRole } from '../middleware/auth';

const router = Router();

router.get('/', authenticateToken, async (req, res) => {
  try {
    const settings = await db('settings').select('*');
    res.json(settings);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching settings' });
  }
});

router.post('/', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  try {
    const { key, value } = req.body;
    const existing = await db('settings').where({ key }).first();
    if (existing) {
      await db('settings').where({ key }).update({ value });
    } else {
      await db('settings').insert({ key, value });
    }
    res.json({ message: 'Setting updated' });
  } catch (error) {
    res.status(500).json({ message: 'Error updating setting' });
  }
});

// User Management
router.get('/users', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  try {
    const users = await db('users').select('id', 'email', 'role', 'phone', 'employee_id');
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching users' });
  }
});

router.post('/users', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  try {
    const { email, role, phone } = req.body;
    const defaultPassword = 'zxcv123$$';
    const hashedPassword = await bcrypt.hash(defaultPassword, 10);

    const [id] = await db('users').insert({
      email,
      role,
      phone,
      password: hashedPassword
    }).returning('id');

    res.status(201).json({ id, email, role, phone, message: 'User created with default password' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error creating user' });
  }
});

// SMS Configuration
router.get('/sms', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  try {
    const config = await db('sms_configurations').select('*').first();
    res.json(config || {});
  } catch (error) {
    res.status(500).json({ message: 'Error fetching SMS config' });
  }
});

router.post('/sms', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  try {
    const { provider, api_key, api_secret, sender_id } = req.body;
    const existing = await db('sms_configurations').first();

    if (existing) {
      await db('sms_configurations').where({ id: existing.id }).update({
        provider,
        api_key,
        api_secret,
        sender_id,
        updated_at: db.fn.now()
      });
    } else {
      await db('sms_configurations').insert({
        provider,
        api_key,
        api_secret,
        sender_id
      });
    }
    res.json({ message: 'SMS configuration updated' });
  } catch (error) {
    res.status(500).json({ message: 'Error updating SMS config' });
  }
});

export default router;
