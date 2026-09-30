import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { Textarea } from '../../ui/textarea';
import { Card, CardContent } from '../../ui/card';
import { accountingApi } from '../../../lib/api';
import { errorText } from './print';

type SummaryField = { label: string; value: string };
type ApprovalRequest = {
  id: number;
  entity_type: 'bill' | 'invoice' | 'payment' | 'journal';
  entity_id: string;
  entity_label: string;
  action: 'create' | 'correct' | 'void' | 'credit_note';
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reason: string;
  original_summary: SummaryField[] | null;
  proposed_summary: SummaryField[] | null;
  requested_by: number | null;
  requested_by_email: string | null;
  requested_at: string;
  decided_by_email: string | null;
  decided_at: string | null;
  decision_comment: string | null;
  can_approve: boolean;
  can_cancel: boolean;
  other_admin_available: boolean;
};

const ACTION_LABEL: Record<string, string> = { create: 'New bill', correct: 'Correction', void: 'Void', credit_note: 'Credit note' };
const ACTION_STYLE: Record<string, string> = {
  create: 'bg-blue-100 text-blue-700',
  correct: 'bg-amber-100 text-amber-700',
  void: 'bg-red-100 text-red-700',
  credit_note: 'bg-purple-100 text-purple-700',
};
const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-600',
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');

function Comparison({ request }: { request: ApprovalRequest }) {
  const original = request.original_summary || [];
  const proposed = request.proposed_summary || [];
  const labels = [...new Set([...original.map(f => f.label), ...proposed.map(f => f.label)])];
  const valueOf = (fields: SummaryField[], label: string) => fields.find(f => f.label === label)?.value ?? '-';

  if (request.action === 'create') {
    return (
      <table className="w-full text-sm">
        <tbody>
          {proposed.map(f => (
            <tr key={f.label} className="border-b border-[#F5F5F5] last:border-none">
              <td className="py-1.5 pr-4 text-[#8E9299] font-medium w-40 align-top">{f.label}</td>
              <td className="py-1.5 font-semibold whitespace-pre-line">{f.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-[10px] font-black uppercase text-[#8E9299]">
          <th className="text-left py-1 w-40"></th>
          <th className="text-left py-1">Current</th>
          <th className="text-left py-1">After approval</th>
        </tr>
      </thead>
      <tbody>
        {labels.map(label => {
          const before = valueOf(original, label);
          const after = valueOf(proposed, label);
          const changed = before !== after;
          return (
            <tr key={label} className={`border-b border-[#F5F5F5] last:border-none ${changed ? 'bg-amber-50' : ''}`}>
              <td className="py-1.5 px-2 text-[#8E9299] font-medium align-top">{label}</td>
              <td className={`py-1.5 px-2 align-top whitespace-pre-line ${changed ? 'line-through text-red-600/80' : ''}`}>{before}</td>
              <td className={`py-1.5 px-2 align-top whitespace-pre-line ${changed ? 'font-bold text-green-700' : ''}`}>{after}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function RequestCard({ request, onChanged }: { request: ApprovalRequest; onChanged: () => void }) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<'' | 'approve' | 'reject' | 'cancel'>('');

  const act = async (kind: 'approve' | 'reject' | 'cancel') => {
    if (kind === 'reject' && !comment.trim()) {
      toast.error('Add a comment explaining why the request is rejected');
      return;
    }
    if (kind === 'cancel' && !window.confirm('Withdraw this request?')) return;
    setBusy(kind);
    try {
      const res = kind === 'approve'
        ? await accountingApi.approveRequest(request.id, comment.trim() || undefined)
        : kind === 'reject'
          ? await accountingApi.rejectRequest(request.id, comment.trim())
          : await accountingApi.cancelRequest(request.id);
      toast.success(res.data.message);
      onChanged();
    } catch (error: any) {
      toast.error(errorText(error, `Failed to ${kind} the request`));
    } finally {
      setBusy('');
    }
  };

  return (
    <Card className="border-none shadow-sm rounded-2xl overflow-hidden">
      <CardContent className="p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className={`${ACTION_STYLE[request.action]} border-none font-bold`}>{ACTION_LABEL[request.action] || request.action}</Badge>
              <Badge className={`${STATUS_STYLE[request.status]} border-none font-bold uppercase`}>{request.status}</Badge>
              <span className="text-xs text-[#8E9299] font-mono">Request #{request.id}</span>
            </div>
            <h3 className="mt-2 text-lg font-black text-[#141414]">{request.entity_label}</h3>
            <p className="text-xs text-[#8E9299]">Requested by <span className="font-bold text-[#141414]">{request.requested_by_email || 'system'}</span> on {when(request.requested_at)}</p>
          </div>
        </div>

        <div className="rounded-xl bg-[#F5F5F5] p-4">
          <p className="text-[10px] font-black uppercase text-[#8E9299]">Reason</p>
          <p className="text-sm font-medium text-[#141414] whitespace-pre-line">{request.reason}</p>
        </div>

        <div className="overflow-x-auto"><Comparison request={request} /></div>

        {request.status !== 'pending' && (
          <div className="rounded-xl border border-[#F5F5F5] p-4 text-sm">
            <span className="font-bold capitalize">{request.status}</span>
            {request.decided_by_email && <> by <span className="font-bold">{request.decided_by_email}</span></>}
            {request.decided_at && <> on {when(request.decided_at)}</>}
            {request.decision_comment && <p className="mt-1 text-[#8E9299]">"{request.decision_comment}"</p>}
          </div>
        )}

        {request.status === 'pending' && request.can_approve && (
          <div className="space-y-3">
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comment (required to reject, optional to approve)" className="bg-[#F5F5F5] border-none" />
            <div className="flex gap-2">
              <Button className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold h-11 gap-2" disabled={!!busy} onClick={() => act('approve')}>
                {busy === 'approve' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} APPROVE & POST
              </Button>
              <Button variant="outline" className="flex-1 border-red-200 text-red-600 hover:bg-red-50 font-bold h-11 gap-2" disabled={!!busy} onClick={() => act('reject')}>
                {busy === 'reject' ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />} REJECT
              </Button>
            </div>
          </div>
        )}

        {request.status === 'pending' && request.can_cancel && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-yellow-50 p-4">
            <p className="text-sm text-yellow-800 font-medium flex items-center gap-2">
              <Clock className="w-4 h-4" />
              {request.other_admin_available ? 'Waiting for an admin to approve. Nothing has changed in the ledger yet.' : 'No other admin is available to approve this request.'}
            </p>
            <Button variant="outline" size="sm" className="font-bold" disabled={!!busy} onClick={() => act('cancel')}>
              {busy === 'cancel' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Withdraw request'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function ApprovalsPanel({ isAdmin, onChanged }: { isAdmin: boolean; onChanged?: () => void }) {
  const [view, setView] = useState<'pending' | 'all'>('pending');
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await accountingApi.getApprovals(view === 'pending' ? 'pending' : 'all');
      setRequests(res.data);
    } catch (error: any) {
      toast.error(errorText(error, 'Failed to load approval requests'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [view]);

  const refresh = () => { load(); onChanged?.(); };
  const actionable = requests.filter(r => r.can_approve).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-blue-600" /> Approvals</h2>
          <p className="text-sm text-[#8E9299]">
            {isAdmin
              ? 'Corrections, voids, credit notes and large bills wait here until an admin approves them. Nothing reaches the ledger before that.'
              : 'Your correction and void requests. An admin must approve them before the ledger changes.'}
          </p>
        </div>
        <div className="flex gap-1 rounded-xl bg-[#F5F5F5] p-1">
          <Button size="sm" variant={view === 'pending' ? 'default' : 'ghost'} className="font-bold" onClick={() => setView('pending')}>
            Waiting{view === 'pending' && isAdmin && actionable > 0 ? ` (${actionable})` : ''}
          </Button>
          <Button size="sm" variant={view === 'all' ? 'default' : 'ghost'} className="font-bold" onClick={() => setView('all')}>History</Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>
      ) : requests.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#E5E5E5] py-16 text-center text-sm text-[#8E9299]">
          {view === 'pending' ? 'Nothing is waiting for approval.' : 'No requests yet.'}
        </div>
      ) : (
        <div className="space-y-4">
          {requests.map(r => <div key={r.id}><RequestCard request={r} onChanged={refresh} /></div>)}
        </div>
      )}
    </div>
  );
}
