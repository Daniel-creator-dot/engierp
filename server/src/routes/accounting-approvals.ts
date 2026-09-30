import { Router } from 'express';
import db from '../db';
import { AuthRequest } from '../middleware/auth';
import { LedgerError, round2, sendError } from '../lib/ledger';
import { saveSettingValue } from '../lib/accounting';
import { logAudit } from '../lib/audit';
import {
  BILL_APPROVAL_THRESHOLD_KEY,
  approveRequest,
  cancelRequest,
  createRequest,
  getBillApprovalThreshold,
  listRequests,
  pendingCount,
  rejectRequest,
} from '../lib/approvals';

// Mounted inside routes/accounting.ts, which already enforces admin/accountant access.
const router = Router();

router.get('/approvals', async (req: AuthRequest, res) => {
  try {
    res.json(await listRequests(req.user as any, req.query.status ? String(req.query.status) : undefined));
  } catch (error) {
    sendError(res, error, 'Error loading approval requests');
  }
});

router.get('/approvals/count', async (req: AuthRequest, res) => {
  try {
    res.json({ count: await pendingCount(req.user as any) });
  } catch (error) {
    sendError(res, error, 'Error counting approval requests');
  }
});

router.post('/approvals', async (req: AuthRequest, res) => {
  try {
    const out = await createRequest(req, req.body);
    res.status(out.applied ? 200 : 202).json(out);
  } catch (error) {
    sendError(res, error, 'Error submitting the request');
  }
});

router.post('/approvals/:id/approve', async (req: AuthRequest, res) => {
  try {
    const request = await approveRequest(req, Number(req.params.id), req.body?.comment);
    res.json({ message: 'Approved and posted to the ledger', request });
  } catch (error) {
    sendError(res, error, 'Error approving the request');
  }
});

router.post('/approvals/:id/reject', async (req: AuthRequest, res) => {
  try {
    const request = await rejectRequest(req, Number(req.params.id), req.body?.comment);
    res.json({ message: 'Request rejected; nothing was changed', request });
  } catch (error) {
    sendError(res, error, 'Error rejecting the request');
  }
});

router.post('/approvals/:id/cancel', async (req: AuthRequest, res) => {
  try {
    const request = await cancelRequest(req, Number(req.params.id));
    res.json({ message: 'Request cancelled', request });
  } catch (error) {
    sendError(res, error, 'Error cancelling the request');
  }
});

router.get('/settings/approvals', async (_req, res) => {
  try {
    res.json({ bill_approval_threshold: await getBillApprovalThreshold(db) });
  } catch (error) {
    sendError(res, error, 'Error loading approval settings');
  }
});

router.put('/settings/approvals', async (req: AuthRequest, res) => {
  try {
    if (req.user?.role !== 'admin') throw new LedgerError('Only an admin can change the approval limit', 403);
    const raw = req.body?.bill_approval_threshold;
    const value = raw === '' || raw === null || raw === undefined ? 0 : round2(raw);
    if (!Number.isFinite(value) || value < 0) throw new LedgerError('The approval limit must be zero or a positive amount');
    const before = await getBillApprovalThreshold(db);
    await saveSettingValue(db, BILL_APPROVAL_THRESHOLD_KEY, String(value));
    await logAudit(req, 'settings.bill_approval_threshold', 'setting', BILL_APPROVAL_THRESHOLD_KEY, { value: before }, { value });
    res.json({ bill_approval_threshold: value });
  } catch (error) {
    sendError(res, error, 'Error saving approval settings');
  }
});

export default router;
