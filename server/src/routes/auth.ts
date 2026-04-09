import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../db';
import { sendSMS } from '../utils/sms';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await db('users').where({ email }).first();
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, employee_id: user.employee_id },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        phone: user.phone,
        employee_id: user.employee_id
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/me', async (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ message: 'Not logged in' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const user = await db('users').where({ id: decoded.id }).first();
    if (!user) return res.status(404).json({ message: 'User not found' });

    res.json({
      id: user.id,
      email: user.email,
      role: user.role,
      phone: user.phone,
      employee_id: user.employee_id
    });
  } catch (error) {
    res.status(401).json({ message: 'Invalid session' });
  }
});

router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  try {
    const user = await db('users').where({ email }).first();
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Generate 6 digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

    await db('users').where({ id: user.id }).update({
      reset_token: code,
      reset_token_expires: expires
    });

    const smsSent = await sendSMS(user.phone, `Your Engineering ERP reset code is: ${code}. It expires in 10 minutes.`);

    if (smsSent) {
      res.json({ message: 'Reset code sent via SMS' });
    } else {
      res.status(500).json({ message: 'Error sending SMS code' });
    }
  } catch (error) {
    res.status(500).json({ message: 'Error processing request' });
  }
});

router.post('/reset-password', async (req, res) => {
  const { email, code, newPassword } = req.body;
  try {
    const user = await db('users').where({ email, reset_token: code }).first();
    
    if (!user || new Date(user.reset_token_expires) < new Date()) {
      return res.status(400).json({ message: 'Invalid or expired code' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await db('users').where({ id: user.id }).update({
      password: hashedPassword,
      reset_token: null,
      reset_token_expires: null
    });

    res.json({ message: 'Password reset successful' });
  } catch (error) {
    res.status(500).json({ message: 'Error resetting password' });
  }
});

export default router;
