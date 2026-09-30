import { Router } from 'express';
import db from '../db';
import { authenticateToken, authorizeRole, AuthRequest } from '../middleware/auth';
import { logAudit } from '../lib/audit';
import { getSmsStatus, normalizePhone, sendSMS } from '../utils/sms';

const router = Router();

router.get('/', authenticateToken, async (req, res) => {
  try {
    const settings = await db('settings').select('*');
    res.json(settings);
  } catch (error) {
    console.error('GET /settings failed:', error);
    res.status(500).json({ message: 'Error fetching settings' });
  }
});

router.post('/', authenticateToken, authorizeRole(['admin', 'hr', 'accountant']), async (req: AuthRequest, res) => {
  try {
    const { key, value } = req.body;
    
    // Security: HR can only update payroll settings; accountants also manage the company profile
    const accountantKey = req.user?.role === 'accountant' && /^company_[a-z_]+$/.test(String(key));
    if ((req.user?.role === 'hr' || req.user?.role === 'accountant') && key !== 'payroll_config' && !accountantKey) {
      return res.status(403).json({ message: 'You can only update payroll and company profile settings' });
    }

    const existing = await db('settings').where({ key }).first();
    if (existing) {
      await db('settings').where({ key }).update({ value });
    } else {
      await db('settings').insert({ key, value });
    }
    await logAudit(req, 'setting_updated', 'setting', key, existing ? { value: existing.value } : undefined, { value });
    res.json({ message: 'Setting updated' });
  } catch (error) {
    res.status(500).json({ message: 'Error updating setting' });
  }
});

// User management lives in routes/users.ts (mounted at /api/settings/users).

// SMS Configuration. Keys are write-only: the API never returns them.
router.get('/sms', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  try {
    const config = await db('sms_configurations').select('*').first();
    const { api_key, api_secret, ...rest } = config || {};
    res.json({
      ...rest,
      api_key: '',
      api_secret: '',
      api_key_set: !!api_key,
      api_secret_set: !!api_secret,
      env_key_set: !!process.env.SMS_API_KEY?.trim(),
      env_provider_set: !!process.env.SMS_PROVIDER?.trim(),
      env_sender_set: !!process.env.SMS_SENDER_ID?.trim(),
      env_url_set: !!process.env.SMS_API_URL?.trim(),
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching SMS config' });
  }
});

router.get('/sms/status', authenticateToken, authorizeRole(['admin']), async (_req, res) => {
  try {
    res.json(await getSmsStatus());
  } catch (error) {
    res.status(500).json({ message: 'Error checking SMS status' });
  }
});

router.post('/sms/test', authenticateToken, authorizeRole(['admin']), async (req: AuthRequest, res) => {
  try {
    const phone = normalizePhone(String(req.body?.phone || ''));
    if (!/^\d{9,15}$/.test(phone)) return res.status(400).json({ message: 'Enter a valid phone number' });
    const result = await sendSMS(phone, 'Test message from bytzforge ERP: SMS is working.');
    await logAudit(req, 'sms_test_sent', 'setting', 'sms_configurations', undefined, { to: phone, success: result.success, error: result.error });
    if (!result.success) return res.status(result.disabled ? 503 : 502).json({ message: `SMS failed: ${result.error || 'unknown error'}` });
    res.json({ message: `Test SMS sent to ${phone}` });
  } catch (error) {
    res.status(500).json({ message: 'Error sending test SMS' });
  }
});

router.post('/sms', authenticateToken, authorizeRole(['admin']), async (req: AuthRequest, res) => {
  try {
    const { provider, api_key, api_secret, sender_id, api_url, clear_api_key } = req.body;
    const existing = await db('sms_configurations').first();

    const updates: Record<string, any> = { provider: provider || 'Custom', sender_id, api_url };
    if (typeof api_key === 'string' && api_key.trim()) updates.api_key = api_key.trim();
    else if (clear_api_key) updates.api_key = '';
    if (typeof api_secret === 'string' && api_secret.trim()) updates.api_secret = api_secret.trim();

    if (existing) {
      await db('sms_configurations').where({ id: existing.id }).update({ ...updates, updated_at: db.fn.now() });
    } else {
      await db('sms_configurations').insert({ api_key: '', ...updates });
    }
    await logAudit(req, 'sms_config_updated', 'setting', 'sms_configurations',
      existing ? { provider: existing.provider, sender_id: existing.sender_id, api_url: existing.api_url } : undefined,
      { provider: updates.provider, sender_id, api_url, api_key_changed: 'api_key' in updates, api_secret_changed: 'api_secret' in updates });
    res.json({ message: 'SMS configuration updated' });
  } catch (error) {
    res.status(500).json({ message: 'Error updating SMS config' });
  }
});

export default router;
