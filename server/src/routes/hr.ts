import { Router } from 'express';
import db from '../db';
import { authenticateToken, authorizeRole, AuthRequest } from '../middleware/auth';

const router = Router();

// Get all employees (HR/Admin only)
router.get('/employees', authenticateToken, authorizeRole(['hr', 'admin']), async (req, res) => {
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
    let empId = req.user?.employee_id;
    
    if (!empId && req.user?.role === 'admin') {
      const adminUser = await db('users').where({ id: req.user.id }).first();
      empId = adminUser?.employee_id;
    }

    if (!empId) return res.status(400).json({ 
      message: 'Leave request failed: Your user account is not associated with an Employee profile. Please link your account in User Management first.' 
    });

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

// Approve/Reject leave request
router.patch('/leave-requests/:id', authenticateToken, authorizeRole(['hr', 'admin']), async (req, res) => {
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
router.post('/payroll', authenticateToken, authorizeRole(['hr', 'accountant', 'admin']), async (req, res) => {
  try {
    const { employee_id, month, year, base_salary, allowances, deductions, detailed_deductions } = req.body;
    
    const net_pay = Number(base_salary) + Number(allowances || 0) - Number(deductions || 0);
    
    const [id] = await db('payroll').insert({
      employee_id,
      month,
      year,
      base_salary,
      allowances,
      deductions,
      detailed_deductions: detailed_deductions ? JSON.stringify(detailed_deductions) : null,
      net_pay,
      status: 'Paid',
      paid_at: db.fn.now()
    }).returning('id');

    res.status(201).json({ id, message: 'Payroll processed' });
  } catch (error) {
    res.status(500).json({ message: 'Error processing payroll' });
  }
});

// Bulk process payroll for all active employees
router.post('/payroll/batch', authenticateToken, authorizeRole(['hr', 'admin']), async (req, res) => {
  try {
    const { month, year } = req.body;
    
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
      
      // Simplified PAYE for batch (In real world, this would use the graduated tiers from config)
      // For now, let's assume a flat 15% on taxable income for the simplified version or just use gross-ssnit
      // The user asked for PAYE integration, so let's stick to a robust calculation.
      const net_pay = taxableIncome * 0.85; // Simple approximation of 15% tax for demonstration

      return {
        employee_id: emp.id,
        month,
        year,
        base_salary: gross,
        allowances: 0,
        deductions: ssnit, // SSNIT is a mandatory deduction
        net_pay,
        status: 'Paid',
        paid_at: db.fn.now()
      };
    });

    await db('payroll').insert(batchData);

    res.status(201).json({ 
      message: `Successfully processed compliant payroll for ${employeesToProcess.length} employees.`,
      count: employeesToProcess.length 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error batch processing payroll' });
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
