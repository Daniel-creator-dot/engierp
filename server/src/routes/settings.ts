import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db';
import { authenticateToken, authorizeRole, AuthRequest } from '../middleware/auth';

const router = Router();

router.get('/', authenticateToken, async (req, res) => {
  try {
    const settings = await db('settings').select('*');
    res.json(settings);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching settings' });
  }
});

router.post('/', authenticateToken, authorizeRole(['admin', 'hr', 'accountant']), async (req: AuthRequest, res) => {
  try {
    const { key, value } = req.body;
    
    // Security: HR and Accountant can only update payroll settings
    if ((req.user?.role === 'hr' || req.user?.role === 'accountant') && key !== 'payroll_config') {
      return res.status(403).json({ message: 'HR and Accountants can only update payroll settings' });
    }

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
router.get('/users', authenticateToken, authorizeRole(['admin', 'hr']), async (req, res) => {
  try {
    const users = await db('users').select('id', 'email', 'role', 'phone', 'employee_id');
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching users' });
  }
});

router.post('/users', authenticateToken, authorizeRole(['admin', 'hr']), async (req, res) => {
  try {
    const { email, role, phone, name, department } = req.body;
    const defaultPassword = 'zxcv123$$';
    const hashedPassword = await bcrypt.hash(defaultPassword, 10);

    // 1. Create Employee first
    const staffId = `EMP-${Math.floor(1000 + Math.random() * 9000)}`;
    await db('employees').insert({
      id: staffId,
      name: name || email.split('@')[0], // Fallback if name not provided
      role: role.toUpperCase(),
      department: department || 'General',
      salary: 0, // Default to 0, update later in HR
      joinDate: new Date().toISOString().split('T')[0],
      status: 'active',
      phone: phone
    });

    // 2. Create User and link to Employee
    const [id] = await db('users').insert({
      email,
      role,
      phone,
      password: hashedPassword,
      employee_id: staffId
    }).returning('id');

    res.status(201).json({ 
      id, 
      email, 
      role, 
      phone, 
      employee_id: staffId,
      message: 'User created and linked to Employee Directory with default password' 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error creating user and employee profile' });
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
    const { provider, api_key, api_secret, sender_id, api_url } = req.body;
    const existing = await db('sms_configurations').first();

    if (existing) {
      await db('sms_configurations').where({ id: existing.id }).update({
        provider,
        api_key,
        api_secret,
        sender_id,
        api_url,
        updated_at: db.fn.now()
      });
    } else {
      await db('sms_configurations').insert({
        provider,
        api_key,
        api_secret,
        sender_id,
        api_url
      });
    }
    res.json({ message: 'SMS configuration updated' });
  } catch (error) {
    res.status(500).json({ message: 'Error updating SMS config' });
  }
});

export default router;
