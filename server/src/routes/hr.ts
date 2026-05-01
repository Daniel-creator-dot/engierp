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
      payment_date: req.body.payment_date || db.fn.now(),
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

/**
 * Calculates PAYE (Income Tax) based on tiered rates from settings
 */
function calculatePAYE(taxableIncome: number, tiers: any[]) {
  let tax = 0;
  let remainingIncome = taxableIncome;

  for (const tier of tiers) {
    const taxableInThisTier = Math.min(Math.max(remainingIncome, 0), Number(tier.threshold));
    tax += taxableInThisTier * (Number(tier.rate) / 100);
    remainingIncome -= taxableInThisTier;
    if (remainingIncome <= 0) break;
  }
  
  // If income exceeds last tier, apply last rate to the remainder (usually the top bracket)
  if (remainingIncome > 0 && tiers.length > 0) {
    const lastRate = Number(tiers[tiers.length - 1].rate);
    tax += remainingIncome * (lastRate / 100);
  }

  return tax;
}

// Bulk process payroll for all active employees
router.post('/payroll/batch', authenticateToken, authorizeRole(['hr', 'accountant', 'admin']), async (req: AuthRequest, res) => {
  try {
    const { month, year } = req.body;
    const isAdmin = req.user?.role === 'admin';
    
    // 1. Get Payroll Configuration
    const payrollConfigRaw = await db('settings').where('key', 'payroll_config').first();
    const config = payrollConfigRaw 
      ? JSON.parse(payrollConfigRaw.value) 
      : { 
          ssnit_employee: 5.5, 
          tax_tiers: [{ threshold: 402, rate: 0 }, { threshold: 512, rate: 5 }, { threshold: 642, rate: 10 }] 
        };
        
    const ssnitRate = Number(config.ssnit_employee || 5.5) / 100;
    const tiers = config.tax_tiers || [];

    // 2. Get all active employees
    const employees = await db('employees').where('status', 'active');
    
    // 3. Filter out those who already have payroll for this period
    const existingPayroll = await db('payroll')
      .where({ month, year })
      .select('employee_id');
    
    const existingIds = new Set(existingPayroll.map(p => p.employee_id));
    let employeesToProcess = employees.filter(e => !existingIds.has(e.id) && e.wage_type !== 'Hourly');
    
    if (req.body.employee_ids && Array.isArray(req.body.employee_ids)) {
      employeesToProcess = employeesToProcess.filter(e => req.body.employee_ids.includes(e.id));
    }

    const skippedHourlyCount = employees.filter(e => !existingIds.has(e.id) && e.wage_type === 'Hourly').length;

    if (employeesToProcess.length === 0) {
      return res.status(400).json({ message: 'No eligible employees found or payroll already processed.' });
    }

    // 4. Insert batch with compliant calculations
    const batchData = employeesToProcess.map(emp => {
      const gross = Number(emp.salary);
      const ssnit = gross * ssnitRate;
      const taxableIncome = gross - ssnit;
      const paye = calculatePAYE(taxableIncome, tiers);
      const net_pay = taxableIncome - paye;

      const detailed_deductions = [
        { type: 'SSNIT (5.5%)', amount: ssnit },
        { type: 'PAYE (Income Tax)', amount: paye }
      ];

      return {
        employee_id: emp.id,
        month,
        year,
        payment_date: req.body.payment_date || db.fn.now(),
        base_salary: gross,
        allowances: 0,
        deductions: ssnit + paye,
        detailed_deductions: JSON.stringify(detailed_deductions),
        net_pay,
        status: isAdmin ? 'Paid' : 'Pending',
        paid_at: isAdmin ? db.fn.now() : null,
        project_id: req.body.project_id === 'none' ? null : req.body.project_id
      };
    });

    await db('payroll').insert(batchData);

    const skippedMsg = skippedHourlyCount > 0 ? ` Skipped ${skippedHourlyCount} hourly employee(s) (process manually).` : '';

    res.status(201).json({ 
      message: isAdmin 
        ? `Processed and approved payroll for ${employeesToProcess.length} salaried employees.${skippedMsg}`
        : `Payroll submitted for ${employeesToProcess.length} salaried employees.${skippedMsg}`,
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

    // Send SMS notification and Post to Ledger if approved
    if (status === 'Paid') {
      const trx = await db.transaction();
      try {
        const payrollEntry = await db('payroll')
          .join('employees', 'payroll.employee_id', 'employees.id')
          .where('payroll.id', id)
          .select('employees.phone', 'employees.name', 'payroll.net_pay', 'payroll.base_salary', 'payroll.project_id', 'payroll.month', 'payroll.year')
          .first();

        if (payrollEntry) {
          // 1. Post to Ledger
          const [journal_id] = await trx('journal_entries').insert({
            date: new Date().toISOString().split('T')[0],
            description: `Payroll: ${payrollEntry.name} - ${payrollEntry.month}/${payrollEntry.year}`,
            project_id: payrollEntry.project_id,
            reference_type: 'payroll',
            reference_id: String(id)
          }).returning('id');

          // Account Mapping: 79 (Site Workers) if project_id exists, else 86 (Office Salaries)
          const expense_account_id = payrollEntry.project_id ? 79 : 86;
          const bank_account_id = 44;

          // Debit Expense
          await trx('ledger_entries').insert({
            journal_id,
            account_id: expense_account_id,
            debit: payrollEntry.base_salary,
            credit: 0
          });

          // Credit Bank
          await trx('ledger_entries').insert({
            journal_id,
            account_id: bank_account_id,
            debit: 0,
            credit: payrollEntry.base_salary
          });

          // Update Balances
          await trx('chart_of_accounts').where({ id: expense_account_id }).increment('balance', payrollEntry.base_salary);
          await trx('chart_of_accounts').where({ id: bank_account_id }).decrement('balance', payrollEntry.base_salary);

          await trx.commit();

          // 2. Send SMS
          if (payrollEntry.phone) {
            const message = `Hello ${payrollEntry.name}, your payroll of GHS ${Number(payrollEntry.net_pay).toLocaleString()} has been approved and paid. - BytzForge`;
            await sendSMS(payrollEntry.phone, message);
          }
        }
      } catch (ledgerError) {
        await trx.rollback();
        console.error('Failed to post payroll to ledger:', ledgerError);
      }
    }

    res.json({ message: `Payroll ${status}` });
  } catch (error) {
    res.status(500).json({ message: 'Error updating payroll status' });
  }
});

// Batch approve payroll entries (Admin only)
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
