import { Router } from 'express';
import db from '../db';
import { authenticateToken, authorizeRole, AuthRequest } from '../middleware/auth';
import { sendSMS } from '../utils/sms';

const router = Router();

// Get all employees (HR/Accountant/Admin)
router.get('/employees', authenticateToken, authorizeRole(['hr', 'accountant', 'admin']), async (req, res) => {
  try {
    const employees = await db('employees').select('*');
    res.json(employees);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching employees' });
  }
});

// Add employee
router.post('/employees', authenticateToken, authorizeRole(['hr', 'admin']), async (req, res) => {
  try {
    const employee = req.body;
    await db('employees').insert(employee);
    res.status(201).json(employee);
  } catch (error) {
    res.status(500).json({ message: 'Error adding employee' });
  }
});

// Update employee
router.patch('/employees/:id', authenticateToken, authorizeRole(['hr', 'admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    await db('employees').where({ id }).update({ ...updates, updated_at: db.fn.now() });
    res.json({ message: 'Employee file updated' });
  } catch (error) {
    res.status(500).json({ message: 'Error updating employee' });
  }
});
router.get('/leave-requests', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userRole = req.user?.role;
    const empId = req.user?.employee_id;

    let query = db('leave_requests').select('leave_requests.*', 'employees.name as employee_name')
      .join('employees', 'leave_requests.employee_id', 'employees.id');

    if (userRole !== 'hr' && userRole !== 'admin') {
      if (!empId) return res.json([]);
      query = query.where('employee_id', empId);
    }

    const requests = await query;
    res.json(requests);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching leave requests' });
  }
});

// Submit leave request
router.post('/leave-requests', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { type, startDate, endDate, reason } = req.body;
    const empId = req.user?.employee_id;

    if (!empId) return res.status(401).json({ message: 'User not associated with employee record' });

    // Calculate requested duration
    const start = new Date(startDate);
    const end = new Date(endDate);
    const requestedDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    // Get Leave Limit from Config
    const configRaw = await db('settings').where('key', 'payroll_config').first();
    const config = configRaw ? JSON.parse(configRaw.value) : { max_leave_days_per_month: 5 };
    const limit = Number(config.max_leave_days_per_month) || 30;

    // Check existing days for this month (Simplified: check if start month has room)
    const monthStart = new Date(start.getFullYear(), start.getMonth(), 1).toISOString();
    const monthEnd = new Date(start.getFullYear(), start.getMonth() + 1, 0).toISOString();

    const existingDays = await db('leave_requests')
      .where({ employee_id: empId })
      .whereIn('status', ['Pending', 'Approved'])
      .where('startDate', '>=', monthStart)
      .where('startDate', '<=', monthEnd)
      .select('startDate', 'endDate');

    const totalExisting = existingDays.reduce((sum, req) => {
      const s = new Date(req.startDate);
      const e = new Date(req.endDate);
      return sum + (Math.ceil((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1);
    }, 0);

    if (totalExisting + requestedDays > limit) {
      return res.status(400).json({ 
        message: `Leave limit exceeded: You have already used/requested ${totalExisting} days this month. Your monthly limit is ${limit} days.` 
      });
    }

    const [id] = await db('leave_requests').insert({
      employee_id: empId,
      type,
      startDate,
      endDate,
      reason,
      status: 'Pending'
    }).returning('id');

    res.status(201).json({ id, message: 'Leave request submitted' });
  } catch (error) {
    res.status(500).json({ message: 'Error submitting leave request' });
  }
});

// Approve/Reject leave request (Admin only)
router.patch('/leave-requests/:id', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    await db('leave_requests').where({ id }).update({ status, updated_at: db.fn.now() });
    res.json({ message: `Leave request ${status.toLowerCase()}` });
  } catch (error) {
    res.status(500).json({ message: 'Error updating leave request' });
  }
});

// Get payroll history (Own for all, all for HR/Accountant/Admin)
router.get('/payroll', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userRole = req.user?.role;
    const empId = req.user?.employee_id;

    let query = db('payroll').select('payroll.*', 'employees.name')
      .join('employees', 'payroll.employee_id', 'employees.id');
    
    if (userRole !== 'hr' && userRole !== 'accountant' && userRole !== 'admin') {
      if (!empId) return res.json([]);
      query = query.where('employee_id', empId);
    }

    const payroll = await query.orderBy('year', 'desc').orderBy('month', 'desc');
    res.json(payroll);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching payroll' });
  }
});

// POST to process payroll (Admin/HR/Accountant only)
router.post('/payroll', authenticateToken, authorizeRole(['hr', 'accountant', 'admin']), async (req: AuthRequest, res) => {
  try {
    const { employee_id, month, year, base_salary, allowances, deductions, detailed_deductions } = req.body;
    
    const net_pay = Number(base_salary) + Number(allowances || 0) - Number(deductions || 0);
    const isAdmin = req.user?.role === 'admin';
    
    const [id] = await db('payroll').insert({
      employee_id,
      month,
      year,
      base_salary,
      allowances,
      deductions,
      detailed_deductions: detailed_deductions ? JSON.stringify(detailed_deductions) : null,
      net_pay,
      status: isAdmin ? 'Paid' : 'Pending',
      paid_at: isAdmin ? db.fn.now() : null
    }).returning('id');

    res.status(201).json({ id, message: isAdmin ? 'Payroll processed and approved' : 'Payroll submitted for admin approval' });
  } catch (error) {
    res.status(500).json({ message: 'Error processing payroll' });
  }
});

// Bulk process payroll for all active employees
router.post('/payroll/batch', authenticateToken, authorizeRole(['hr', 'accountant', 'admin']), async (req: AuthRequest, res) => {
  try {
    const { month, year } = req.body;
    const isAdmin = req.user?.role === 'admin';
    
    // 1. Get Payroll Configuration (Ghana SSNIT/PAYE)
    const payrollConfigRaw = await db('settings').where('key', 'payroll_config').first();
    const config = payrollConfigRaw ? JSON.parse(payrollConfigRaw.value) : { ssnit_employee: 5.5 };
    const ssnitRate = Number(config.ssnit_employee) / 100;

    // 2. Get all active employees
    const employees = await db('employees').where('status', 'active');
    
    // 3. Filter out those who already have payroll for this period
    const existingPayroll = await db('payroll')
      .where({ month, year })
      .select('employee_id');
    
    const existingIds = new Set(existingPayroll.map(p => p.employee_id));
    const employeesToProcess = employees.filter(e => !existingIds.has(e.id));

    if (employeesToProcess.length === 0) {
      return res.status(400).json({ message: 'Payroll already processed for all active employees for this period.' });
    }

    // 4. Insert batch with compliant calculations
    const batchData = employeesToProcess.map(emp => {
      const gross = Number(emp.salary);
      const ssnit = gross * ssnitRate;
      const taxableIncome = gross - ssnit;
      const net_pay = taxableIncome * 0.85;

      return {
        employee_id: emp.id,
        month,
        year,
        base_salary: gross,
        allowances: 0,
        deductions: ssnit,
        net_pay,
        status: isAdmin ? 'Paid' : 'Pending',
        paid_at: isAdmin ? db.fn.now() : null
      };
    });

    await db('payroll').insert(batchData);

    res.status(201).json({ 
      message: isAdmin 
        ? `Successfully processed and approved payroll for ${employeesToProcess.length} employees.`
        : `Payroll submitted for ${employeesToProcess.length} employees. Awaiting admin approval.`,
      count: employeesToProcess.length 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error batch processing payroll' });
  }
});

// Approve/Reject payroll entries (Admin only)
router.patch('/payroll/:id', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // 'Paid' or 'Rejected'
    await db('payroll').where({ id }).update({ 
      status, 
      paid_at: status === 'Paid' ? db.fn.now() : null,
      updated_at: db.fn.now() 
    });

    // Send SMS notification if approved
    if (status === 'Paid') {
      try {
        const payrollEntry = await db('payroll')
          .select('payroll.*', 'employees.name', 'employees.phone')
          .join('employees', 'payroll.employee_id', 'employees.id')
          .where('payroll.id', id)
          .first();
        
        if (payrollEntry?.phone) {
          const msg = `Hi ${payrollEntry.name}, your ${payrollEntry.month} ${payrollEntry.year} payroll of GHS ${Number(payrollEntry.net_pay).toLocaleString()} has been approved. - ByTzForge ERP`;
          await sendSMS(payrollEntry.phone, msg);
          console.log(`[Payroll SMS] Sent to ${payrollEntry.name}`);
        }
      } catch (smsErr) {
        console.error('[Payroll SMS] Failed:', smsErr);
      }
    }

    res.json({ message: `Payroll entry ${status.toLowerCase()}` });
  } catch (error) {
    res.status(500).json({ message: 'Error updating payroll status' });
  }
});

// Approve all pending payroll for a period (Admin only)
router.patch('/payroll/batch/approve', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  try {
    const { month, year } = req.body;

    // Get all pending entries with employee details before updating
    const pendingEntries = await db('payroll')
      .select('payroll.*', 'employees.name', 'employees.phone')
      .join('employees', 'payroll.employee_id', 'employees.id')
      .where({ 'payroll.month': month, 'payroll.year': year, 'payroll.status': 'Pending' });

    const count = await db('payroll')
      .where({ month, year, status: 'Pending' })
      .update({ status: 'Paid', paid_at: db.fn.now(), updated_at: db.fn.now() });

    // Send SMS to all affected employees
    const smsPromises = pendingEntries
      .filter(e => e.phone)
      .map(e => {
        const msg = `Hi ${e.name}, your ${month} ${year} payroll of GHS ${Number(e.net_pay).toLocaleString()} has been approved. - ByTzForge ERP`;
        return sendSMS(e.phone, msg).catch(err => console.error(`[Payroll SMS] Failed for ${e.name}:`, err));
      });
    
    await Promise.allSettled(smsPromises);
    console.log(`[Payroll SMS] Batch notifications sent to ${smsPromises.length} employees`);

    res.json({ message: `Approved ${count} payroll entries for ${month} ${year}. SMS notifications sent.` });
  } catch (error) {
    res.status(500).json({ message: 'Error approving batch payroll' });
  }
});

// Appraisals & KPIs
router.get('/appraisals', authenticateToken, async (req, res) => {
  try {
    const data = await db('appraisals')
      .select('appraisals.*', 'employees.name')
      .join('employees', 'appraisals.employee_id', 'employees.id');
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching appraisals' });
  }
});

router.post('/appraisals', authenticateToken, authorizeRole(['hr', 'admin']), async (req, res) => {
  try {
    const data = req.body;
    await db('appraisals').insert(data);
    res.status(201).json({ message: 'Appraisal recorded' });
  } catch (error) {
    res.status(500).json({ message: 'Error recording appraisal' });
  }
});

export default router;
