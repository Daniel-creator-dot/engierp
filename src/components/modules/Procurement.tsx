import React, { useState, useEffect } from 'react';
import {
  Plus,
  Loader2,
  Building2,
  Phone,
  Mail,
  MapPin,
  Star,
  Pencil,
  Printer,
  FileText,
  CreditCard,
  Receipt,
  XCircle,
  CheckCircle2,
  Eye,
  Trash2,
  PackageCheck,
  History,
  ArrowDownToLine,
  ArrowUpFromLine,
  SlidersHorizontal,
  Ban,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription
} from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '../ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '../ui/dialog';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../ui/select';
import { Badge } from '../ui/badge';
import { toast } from 'sonner';
import { procurementApi, projectsApi, settingsApi, apiErrorMessage } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import CategorySelect from '../CategorySelect';
import { formatDate, todayIso } from '../../lib/dates';
import { formatWithSymbol } from '../../lib/currency';
import { escapeHtml } from '../../lib/html';
import { printDocument } from '../../lib/printDocument';

interface ProcurementProps {
  activeSub?: string;
}

interface PoLine {
  item_name: string;
  quantity: string;
  unit: string;
  unit_price: string;
}

interface PoForm {
  supplier_id: string;
  project_id: string;
  order_date: string;
  delivery_date: string;
  notes: string;
  lines: PoLine[];
}

interface ReceiveLine {
  quantity: string;
  add_to_stock: boolean;
  inventory_item_id: string;
}

const NONE = 'none';
const emptyLine = (): PoLine => ({ item_name: '', quantity: '1', unit: 'pcs', unit_price: '' });
const emptyPoForm = (): PoForm => ({ supplier_id: '', project_id: '', order_date: todayIso(), delivery_date: '', notes: '', lines: [emptyLine()] });

const PO_BADGE: Record<string, string> = {
  'Pending Approval': 'bg-yellow-100 text-yellow-700',
  Approved: 'bg-blue-100 text-blue-700',
  'Partially Received': 'bg-indigo-100 text-indigo-700',
  Received: 'bg-teal-100 text-teal-700',
  Billed: 'bg-green-100 text-green-700',
  Rejected: 'bg-red-100 text-red-700',
  Cancelled: 'bg-gray-100 text-gray-600',
};

const MOVEMENT_LABEL: Record<string, string> = { receipt: 'Receipt', issue: 'Issue', adjustment: 'Adjustment' };

export default function Procurement({ activeSub = 'procurement-pos' }: ProcurementProps) {
  const { user } = useAuth();
  const role = user?.role || '';
  const canBuy = ['procurement', 'admin', 'accountant'].includes(role);
  const canApprove = ['admin', 'accountant'].includes(role);
  const canReceive = ['procurement', 'admin', 'accountant', 'pm'].includes(role);
  const canBill = ['admin', 'accountant'].includes(role);

  const [isAddSupplierModalOpen, setIsAddSupplierModalOpen] = useState(false);
  const [isEditSupplierModalOpen, setIsEditSupplierModalOpen] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<any | null>(null);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [supplierHistory, setSupplierHistory] = useState<any>(null);
  const [isBillDetailsOpen, setIsBillDetailsOpen] = useState(false);
  const [selectedBill, setSelectedBill] = useState<any | null>(null);

  const [inventory, setInventory] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [currency, setCurrency] = useState('GHS');
  const [isLoading, setIsLoading] = useState(true);
  const [companySettings, setCompanySettings] = useState<any[]>([]);

  // Purchase orders
  const [isPoFormOpen, setIsPoFormOpen] = useState(false);
  const [poForm, setPoForm] = useState<PoForm>(emptyPoForm());
  const [editingPoId, setEditingPoId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [poDetail, setPoDetail] = useState<any | null>(null);
  /** The order being received, billed or rejected; kept apart from the detail view. */
  const [actionPo, setActionPo] = useState<any | null>(null);
  const [isReceiveOpen, setIsReceiveOpen] = useState(false);
  const [receiveLines, setReceiveLines] = useState<Record<number, ReceiveLine>>({});
  const [receiveMeta, setReceiveMeta] = useState({ receipt_date: todayIso(), delivery_note: '', notes: '' });
  const [isBillOpen, setIsBillOpen] = useState(false);
  const [billAccounts, setBillAccounts] = useState<any[]>([]);
  const [billForm, setBillForm] = useState({ account_id: '', bill_date: todayIso(), due_date: '' });
  const [isRejectOpen, setIsRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  // Inventory
  const [isAddInventoryModalOpen, setIsAddInventoryModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<any | null>(null);
  const [movementItem, setMovementItem] = useState<any | null>(null);
  const [movementForm, setMovementForm] = useState({ type: 'issue' as 'issue' | 'adjustment', quantity: '', project_id: '', notes: '' });
  const [historyItem, setHistoryItem] = useState<any | null>(null);
  const [movements, setMovements] = useState<any[]>([]);

  useEffect(() => {
    fetchData();
  }, [activeSub]);

  const fetchData = async () => {
    setIsLoading(true);
    settingsApi.getSettings()
      .then(res => {
        setCompanySettings(res.data);
        setCurrency(res.data.find((s: any) => s.key === 'currency')?.value || 'GHS');
      })
      .catch(() => setCompanySettings([]));
    try {
      if (activeSub === 'procurement-inventory') {
        const [invRes, projRes] = await Promise.all([
          procurementApi.getInventory(),
          projectsApi.getProjects()
        ]);
        setInventory(invRes.data);
        setProjects(projRes.data);
      } else if (activeSub === 'procurement-suppliers') {
        const res = await procurementApi.getSuppliers();
        setSuppliers(res.data);
      } else if (activeSub === 'procurement-pos') {
        const [poRes, supRes, projRes, invRes] = await Promise.all([
          procurementApi.getPurchaseOrders(),
          procurementApi.getSuppliers(),
          projectsApi.getProjects(),
          procurementApi.getInventory().catch(() => ({ data: [] })),
        ]);
        setPurchaseOrders(poRes.data);
        setSuppliers(supRes.data);
        setProjects(projRes.data);
        setInventory(invRes.data);
      }
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to load procurement data'));
    } finally {
      setIsLoading(false);
    }
  };

  const currSym = currency === 'USD' ? '$' : 'GH₵';
  const money = (value: unknown) => formatWithSymbol(value, currSym);
  const isPaidStatus = (status?: string) => (status || '').toLowerCase() === 'paid';
  const billBadgeClass = (status?: string) => {
    const s = (status || '').toLowerCase();
    if (s === 'paid') return 'bg-green-100 text-green-700 border-none';
    if (s === 'partially_paid') return 'bg-amber-100 text-amber-700 border-none';
    return 'bg-red-50 text-red-700 border-none';
  };
  const formatStatus = (status?: string) => (status || 'unknown').replace(/_/g, ' ').toUpperCase();

  // ------------------------------------------------------------ Purchase orders

  const poTotal = poForm.lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0);
  const updateLine = (index: number, patch: Partial<PoLine>) =>
    setPoForm(f => ({ ...f, lines: f.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)) }));

  const openNewPo = () => {
    setEditingPoId(null);
    setPoForm(emptyPoForm());
    setIsPoFormOpen(true);
  };

  const openEditPo = (po: any) => {
    setEditingPoId(po.id);
    setPoForm({
      supplier_id: po.supplier_id || '',
      project_id: po.project_id || '',
      order_date: String(po.order_date || '').slice(0, 10) || todayIso(),
      delivery_date: String(po.delivery_date || '').slice(0, 10),
      notes: po.notes || '',
      lines: (po.items || []).map((i: any) => ({ item_name: i.item_name, quantity: String(i.quantity), unit: i.unit || 'pcs', unit_price: String(i.unit_price) })),
    });
    setPoDetail(null);
    setIsPoFormOpen(true);
  };

  const handleSavePo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!poForm.supplier_id) {
      toast.error('Choose a supplier');
      return;
    }
    const lines = poForm.lines.filter(l => l.item_name.trim());
    if (!lines.length) {
      toast.error('Add at least one line item');
      return;
    }
    const payload = {
      supplier_id: poForm.supplier_id,
      project_id: poForm.project_id && poForm.project_id !== NONE ? poForm.project_id : null,
      order_date: poForm.order_date,
      delivery_date: poForm.delivery_date || null,
      notes: poForm.notes || null,
      items: lines.map(l => ({ item_name: l.item_name.trim(), quantity: Number(l.quantity), unit: l.unit || 'pcs', unit_price: Number(l.unit_price) })),
    };
    setIsSaving(true);
    try {
      if (editingPoId) {
        await procurementApi.editPurchaseOrder(editingPoId, payload);
        toast.success(`${editingPoId} updated and resubmitted for approval`);
      } else {
        const res = await procurementApi.createPurchaseOrder(payload);
        toast.success(`Purchase order ${res.data.id} created and sent for approval`);
      }
      setIsPoFormOpen(false);
      fetchData();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to save purchase order'));
    } finally {
      setIsSaving(false);
    }
  };

  const openPoDetail = async (id: string) => {
    try {
      const res = await procurementApi.getPurchaseOrder(id);
      setPoDetail(res.data);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to load purchase order'));
    }
  };

  const refreshAfterAction = async (id?: string) => {
    await fetchData();
    if (id && poDetail?.id === id) openPoDetail(id);
  };

  const handleApprove = async (po: any) => {
    try {
      await procurementApi.approvePO(po.id);
      toast.success(`${po.id} approved`);
      refreshAfterAction(po.id);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to approve purchase order'));
    }
  };

  const handleReject = async () => {
    if (!actionPo) return;
    try {
      await procurementApi.rejectPO(actionPo.id, rejectReason);
      toast.success(`${actionPo.id} rejected`);
      setIsRejectOpen(false);
      setRejectReason('');
      refreshAfterAction(actionPo.id);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to reject purchase order'));
    }
  };

  const handleCancel = async (po: any) => {
    if (!window.confirm(`Cancel purchase order ${po.id}?`)) return;
    try {
      await procurementApi.cancelPO(po.id);
      toast.success(`${po.id} cancelled`);
      refreshAfterAction(po.id);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to cancel purchase order'));
    }
  };

  const openReceive = (po: any) => {
    const lines: Record<number, ReceiveLine> = {};
    for (const item of po.items || []) {
      const outstanding = Math.max(Number(item.quantity) - Number(item.received_quantity || 0), 0);
      lines[item.id] = { quantity: outstanding ? String(outstanding) : '0', add_to_stock: false, inventory_item_id: item.inventory_item_id || '' };
    }
    setReceiveLines(lines);
    setReceiveMeta({ receipt_date: todayIso(), delivery_note: '', notes: '' });
    setActionPo(po);
    setIsReceiveOpen(true);
  };

  const handleReceive = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actionPo) return;
    const lines = Object.entries(receiveLines)
      .map(([id, l]: [string, ReceiveLine]) => ({
        po_item_id: Number(id),
        quantity: Number(l.quantity) || 0,
        inventory_item_id: l.inventory_item_id && l.inventory_item_id !== NONE ? l.inventory_item_id : undefined,
        add_to_stock: l.add_to_stock,
      }))
      .filter(l => l.quantity > 0);
    if (!lines.length) {
      toast.error('Enter the quantity received for at least one line');
      return;
    }
    setIsSaving(true);
    try {
      const res = await procurementApi.receiveGoods(actionPo.id, { ...receiveMeta, lines });
      toast.success(res.data.message || 'Goods received');
      setIsReceiveOpen(false);
      refreshAfterAction(actionPo.id);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to record goods received'));
    } finally {
      setIsSaving(false);
    }
  };

  const openBill = async (po: any) => {
    setActionPo(po);
    setBillForm({ account_id: '', bill_date: todayIso(), due_date: '' });
    setIsBillOpen(true);
    if (!billAccounts.length) {
      try {
        const res = await procurementApi.getBillAccounts();
        setBillAccounts(res.data);
      } catch (error) {
        toast.error(apiErrorMessage(error, 'Failed to load accounts'));
      }
    }
  };

  const handleConvertToBill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actionPo || !billForm.account_id) {
      toast.error('Choose the account to charge');
      return;
    }
    setIsSaving(true);
    try {
      const res = await procurementApi.convertToBill(actionPo.id, {
        account_id: Number(billForm.account_id),
        bill_date: billForm.bill_date,
        due_date: billForm.due_date || undefined,
      });
      toast.success(res.data.message || 'Bill created');
      setIsBillOpen(false);
      refreshAfterAction(actionPo.id);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to create bill'));
    } finally {
      setIsSaving(false);
    }
  };

  const billAmountFor = (po: any) => (Number(po?.received_value) > 0 ? Number(po.received_value) : Number(po?.total_amount || 0));

  const handlePrintLpo = async (poOrId: any) => {
    let po = poOrId;
    if (!po.items) {
      try {
        po = (await procurementApi.getPurchaseOrder(po.id)).data;
      } catch (error) {
        toast.error(apiErrorMessage(error, 'Failed to load purchase order'));
        return;
      }
    }
    const rows = (po.items || []).map((item: any, i: number) => `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(item.item_name)}</td>
        <td class="num">${escapeHtml(Number(item.quantity).toLocaleString())}</td>
        <td>${escapeHtml(item.unit || '')}</td>
        <td class="num">${escapeHtml(money(item.unit_price))}</td>
        <td class="num">${escapeHtml(money(item.total_price))}</td>
      </tr>`).join('');
    const approved = po.approved_at && po.status !== 'Rejected' && po.status !== 'Pending Approval';

    const opened = printDocument({
      title: 'LOCAL PURCHASE ORDER',
      docNumber: po.id,
      settings: companySettings,
      printedBy: user?.email,
      bodyHtml: `
        ${po.status === 'Pending Approval' || po.status === 'Rejected' || po.status === 'Cancelled'
          ? `<p style="color:#b91c1c;font-weight:700;margin:0 0 16px">${escapeHtml(po.status.toUpperCase())} — NOT VALID FOR SUPPLY</p>` : ''}
        <div class="grid">
          <div class="box">
            <h4>Supplier</h4>
            <div><strong>${escapeHtml(po.supplier_name || '')}</strong></div>
            ${po.supplier_address ? `<div>${escapeHtml(po.supplier_address)}</div>` : ''}
            ${po.supplier_contact ? `<div>Attn: ${escapeHtml(po.supplier_contact)}</div>` : ''}
            ${po.supplier_phone || po.supplier_email ? `<div>${escapeHtml([po.supplier_phone, po.supplier_email].filter(Boolean).join(' · '))}</div>` : ''}
            ${po.supplier_tin ? `<div>TIN: ${escapeHtml(po.supplier_tin)}</div>` : ''}
          </div>
          <div class="box">
            <h4>Order details</h4>
            <div>Order date: ${escapeHtml(formatDate(po.order_date))}</div>
            ${po.delivery_date ? `<div>Required by: ${escapeHtml(formatDate(po.delivery_date))}</div>` : ''}
            <div>Deliver to: ${escapeHtml(po.project_name || 'Head office / general stock')}</div>
            <div>Status: ${escapeHtml(po.status)}</div>
          </div>
        </div>
        <table>
          <thead><tr><th>#</th><th>Description</th><th class="num">Qty</th><th>Unit</th><th class="num">Unit price</th><th class="num">Amount</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr class="totals"><td colspan="5" class="num">Total (${escapeHtml(currency)})</td><td class="num">${escapeHtml(money(po.total_amount))}</td></tr></tfoot>
        </table>
        ${po.notes ? `<p style="margin-top:20px"><strong>Notes:</strong> ${escapeHtml(po.notes)}</p>` : ''}
        <div class="grid" style="margin-top:28px">
          <div class="box"><h4>Raised by</h4><div>${escapeHtml(po.created_by_email || '—')}</div></div>
          <div class="box"><h4>Approved by</h4><div>${approved ? `${escapeHtml(po.approved_by_email || '—')} on ${escapeHtml(formatDate(String(po.approved_at).slice(0, 10)))}` : 'Not yet approved'}</div></div>
        </div>
        <p class="muted" style="margin-top:20px">Please quote ${escapeHtml(po.id)} on your delivery note and invoice.</p>
      `,
    });
    if (!opened) toast.error('Allow pop-ups to print the purchase order');
  };

  // ------------------------------------------------------------ Suppliers

  const supplierPayload = (formData: FormData) => ({
    name: formData.get('name'),
    category: formData.get('category'),
    contact_person: formData.get('contact'),
    email: formData.get('email'),
    phone: formData.get('phone'),
    address: formData.get('address'),
    tin: formData.get('tin'),
    payment_terms_days: formData.get('payment_terms_days') || 30,
  });

  const handleAddSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await procurementApi.addSupplier(supplierPayload(new FormData(e.target as HTMLFormElement)));
      toast.success('Supplier registered');
      setIsAddSupplierModalOpen(false);
      fetchData();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to register supplier'));
    }
  };

  const handleEditSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSupplier) return;
    try {
      await procurementApi.updateSupplier(selectedSupplier.id, supplierPayload(new FormData(e.target as HTMLFormElement)));
      toast.success('Supplier updated');
      setIsEditSupplierModalOpen(false);
      fetchData();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to update supplier'));
    }
  };

  const handleViewHistory = async (supplier: any) => {
    setSelectedSupplier(supplier);
    try {
      const res = await procurementApi.getSupplierHistory(supplier.id);
      setSupplierHistory({
        purchaseOrders: res.data?.purchaseOrders || [],
        bills: res.data?.bills || [],
        payments: res.data?.payments || [],
        summary: res.data?.summary || { totalOrdered: 0, totalBilled: 0, totalPaid: 0, balanceDue: 0 },
      });
      setIsHistoryModalOpen(true);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to load supplier account history'));
    }
  };

  const supplierFields = (s?: any) => (
    <>
      <div className="space-y-2"><Label>Company name</Label><Input name="name" defaultValue={s?.name} required className="bg-[#F5F5F5] border-none rounded-xl h-11 font-bold" /></div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Category</Label>
          <CategorySelect type="supplier" name="category" defaultValue={s?.category} required triggerClassName="bg-[#F5F5F5] border-none rounded-xl h-11" contentClassName="rounded-xl" />
        </div>
        <div className="space-y-2">
          <Label>GRA TIN</Label>
          <Input name="tin" defaultValue={s?.tin || ''} placeholder="e.g. C0012345678" maxLength={20} className="bg-[#F5F5F5] border-none rounded-xl h-11 uppercase" />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2"><Label>Contact person</Label><Input name="contact" defaultValue={s?.contact_person || ''} className="bg-[#F5F5F5] border-none rounded-xl h-11" /></div>
        <div className="space-y-2"><Label>Phone</Label><Input name="phone" type="tel" defaultValue={s?.phone || ''} placeholder="e.g. 024 000 0000" className="bg-[#F5F5F5] border-none rounded-xl h-11" /></div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2"><Label>Email</Label><Input name="email" type="email" defaultValue={s?.email || ''} className="bg-[#F5F5F5] border-none rounded-xl h-11" /></div>
        <div className="space-y-2"><Label>Payment terms (days)</Label><Input name="payment_terms_days" type="number" min="0" max="365" defaultValue={s?.payment_terms_days ?? 30} className="bg-[#F5F5F5] border-none rounded-xl h-11" /></div>
      </div>
      <div className="space-y-2"><Label>Address</Label><Textarea name="address" defaultValue={s?.address || ''} className="bg-[#F5F5F5] border-none rounded-xl resize-none min-h-[70px]" /></div>
    </>
  );

  // ------------------------------------------------------------ Inventory

  const handleAddInventory = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    const projectId = String(formData.get('project_id') || '');
    try {
      await procurementApi.addInventory({
        name: formData.get('name'),
        project_id: projectId && projectId !== NONE ? projectId : null,
        category: formData.get('category') || 'Materials',
        quantity: Number(formData.get('quantity') || 0),
        unit: formData.get('unit'),
        reorder_level: Number(formData.get('reorder') || 0),
      });
      toast.success('Stock item created');
      setIsAddInventoryModalOpen(false);
      fetchData();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to create stock item'));
    }
  };

  const handleEditInventory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;
    const formData = new FormData(e.target as HTMLFormElement);
    const projectId = String(formData.get('project_id') || '');
    try {
      await procurementApi.updateInventory(editingItem.id, {
        name: formData.get('name'),
        category: formData.get('category'),
        unit: formData.get('unit'),
        reorder_level: Number(formData.get('reorder') || 0),
        project_id: projectId && projectId !== NONE ? projectId : null,
      });
      toast.success('Stock item updated');
      setEditingItem(null);
      fetchData();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to update stock item'));
    }
  };

  const openMovement = (item: any, type: 'issue' | 'adjustment') => {
    setMovementItem(item);
    setMovementForm({ type, quantity: '', project_id: item.project_id || '', notes: '' });
  };

  const handleMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!movementItem) return;
    try {
      await procurementApi.recordStockMovement(movementItem.id, {
        type: movementForm.type,
        quantity: Number(movementForm.quantity),
        project_id: movementForm.project_id && movementForm.project_id !== NONE ? movementForm.project_id : undefined,
        notes: movementForm.notes || undefined,
      });
      toast.success(movementForm.type === 'issue' ? 'Stock issued' : 'Stock adjusted');
      setMovementItem(null);
      fetchData();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to record stock movement'));
    }
  };

  const openStockHistory = async (item: any) => {
    setHistoryItem(item);
    setMovements([]);
    try {
      const res = await procurementApi.getStockMovements(item.id);
      setMovements(res.data);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to load stock history'));
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-[#141414]" />
      </div>
    );
  }

  const canDecide = (po: any) => canApprove && po.status === 'Pending Approval' && po.created_by !== user?.id;
  const canEditPo = (po: any) => canBuy && ['Pending Approval', 'Rejected'].includes(po.status) && (!po.created_by || po.created_by === user?.id || role === 'admin');
  const canCancelPo = (po: any) => canBuy && ['Pending Approval', 'Approved', 'Rejected'].includes(po.status) && !(po.items || []).some((i: any) => Number(i.received_quantity) > 0);
  const canReceivePo = (po: any) => canReceive && ['Approved', 'Partially Received'].includes(po.status);
  const canBillPo = (po: any) => canBill && ['Approved', 'Partially Received', 'Received', 'Billed'].includes(po.status) && !po.bill_id;

  const poActions = (po: any, compact: boolean) => (
    <>
      {canDecide(po) && (
        <>
          <Button variant={compact ? 'ghost' : 'default'} size={compact ? 'icon' : 'sm'} onClick={() => handleApprove(po)} className={compact ? 'h-8 w-8 text-green-600 hover:bg-green-50 rounded-full' : 'bg-green-600 text-white gap-1'} title="Approve">
            <CheckCircle2 className="w-4 h-4" />{!compact && 'Approve'}
          </Button>
          <Button variant={compact ? 'ghost' : 'outline'} size={compact ? 'icon' : 'sm'} onClick={() => { setActionPo(po); setRejectReason(''); setIsRejectOpen(true); }} className={compact ? 'h-8 w-8 text-red-600 hover:bg-red-50 rounded-full' : 'text-red-600 border-red-200 gap-1'} title="Reject">
            <XCircle className="w-4 h-4" />{!compact && 'Reject'}
          </Button>
        </>
      )}
      {canReceivePo(po) && (
        <Button variant={compact ? 'ghost' : 'default'} size={compact ? 'icon' : 'sm'} onClick={() => openReceive(po)} className={compact ? 'h-8 w-8 text-indigo-600 hover:bg-indigo-50 rounded-full' : 'bg-indigo-600 text-white gap-1'} title="Receive goods">
          <PackageCheck className="w-4 h-4" />{!compact && 'Receive Goods'}
        </Button>
      )}
      {canBillPo(po) && (
        <Button variant={compact ? 'ghost' : 'default'} size={compact ? 'icon' : 'sm'} onClick={() => openBill(po)} className={compact ? 'h-8 w-8 text-green-700 hover:bg-green-50 rounded-full' : 'bg-green-700 text-white gap-1'} title="Convert to bill">
          <Receipt className="w-4 h-4" />{!compact && 'Convert to Bill'}
        </Button>
      )}
    </>
  );

  const renderContent = () => {
    switch (activeSub) {
      case 'procurement-pos':
        return (
          <Card className="border-none shadow-sm rounded-2xl overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between border-b border-[#F5F5F5] bg-[#F5F5F5]/30">
              <div>
                <CardTitle>Purchase Orders</CardTitle>
                <CardDescription>Raise, approve, receive and bill purchase orders. Whoever raises an order cannot approve it.</CardDescription>
              </div>
              {canBuy && <Button onClick={openNewPo} className="bg-[#141414] text-white gap-2 font-bold px-6 rounded-xl h-11"><Plus className="w-4 h-4" />Create PO</Button>}
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-[#F5F5F5]/50">
                      <TableHead>PO No.</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead>Items</TableHead>
                      <TableHead className="text-right">Total ({currSym})</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {purchaseOrders.map((po) => (
                      <TableRow key={po.id} className="hover:bg-blue-50/20 transition-colors">
                        <TableCell className="font-black text-blue-600 whitespace-nowrap">{po.id}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{formatDate(po.order_date)}</TableCell>
                        <TableCell>
                          <p className="font-medium">{po.supplier_name}</p>
                          <p className="text-[10px] text-[#8E9299]">{po.project_name || 'General stock'}</p>
                        </TableCell>
                        <TableCell className="text-[#8E9299] text-xs font-bold">
                          {po.item_name || 'N/A'}{po.item_count > 1 ? ` + ${po.item_count - 1} more` : ''}
                        </TableCell>
                        <TableCell className="text-right font-black text-[#141414]">{money(po.total_amount)}</TableCell>
                        <TableCell>
                          <Badge className={`${PO_BADGE[po.status] || 'bg-gray-100 text-gray-700'} border-none font-bold text-[10px] whitespace-nowrap`}>
                            {String(po.status).toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {poActions(po, true)}
                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={() => openPoDetail(po.id)} title="View details"><Eye className="w-4 h-4" /></Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600 rounded-full" onClick={() => handlePrintLpo(po)} title="Print LPO"><Printer className="w-4 h-4" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {purchaseOrders.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-12 text-[#8E9299]">No purchase orders yet.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        );
      case 'procurement-inventory':
        return (
          <Card className="border-none shadow-sm rounded-2xl overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between border-b border-[#F5F5F5] bg-[#F5F5F5]/30">
              <div><CardTitle>Site Inventory</CardTitle><CardDescription>Stock levels and movements. Receipts come from goods received on purchase orders.</CardDescription></div>
              <Dialog open={isAddInventoryModalOpen} onOpenChange={setIsAddInventoryModalOpen}>
                <DialogTrigger asChild><Button className="bg-[#141414] text-white gap-2 font-bold px-6 rounded-xl"><Plus className="w-4 h-4" />New Stock Item</Button></DialogTrigger>
                <DialogContent className="rounded-3xl">
                  <form onSubmit={handleAddInventory}>
                    <DialogHeader><DialogTitle>New Stock Item</DialogTitle><DialogDescription>Opening stock is recorded as the first movement in the item's history.</DialogDescription></DialogHeader>
                    <div className="grid gap-5 py-6">
                      <div className="space-y-2"><Label>Item name</Label><Input name="name" required className="bg-[#F5F5F5] border-none rounded-xl h-11" /></div>
                      <div className="space-y-2">
                        <Label>Category</Label>
                        <CategorySelect type="inventory" name="category" defaultValue="Materials" triggerClassName="bg-[#F5F5F5] border-none rounded-xl h-11" contentClassName="rounded-xl" />
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2"><Label>Opening quantity</Label><Input name="quantity" type="number" min="0" step="any" defaultValue="0" className="bg-[#F5F5F5] border-none rounded-xl h-11" /></div>
                        <div className="space-y-2"><Label>Unit (e.g. bags, m³)</Label><Input name="unit" required className="bg-[#F5F5F5] border-none rounded-xl h-11" /></div>
                      </div>
                      <div className="space-y-2">
                        <Label>Location</Label>
                        <Select name="project_id" defaultValue={NONE}>
                          <SelectTrigger className="bg-[#F5F5F5] border-none rounded-xl h-11"><SelectValue /></SelectTrigger>
                          <SelectContent className="rounded-xl">
                            <SelectItem value={NONE}>General / common store</SelectItem>
                            {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2"><Label>Reorder level</Label><Input name="reorder" type="number" min="0" step="any" defaultValue="10" className="bg-[#F5F5F5] border-none rounded-xl h-11" /></div>
                    </div>
                    <DialogFooter><Button type="submit" className="bg-blue-600 text-white w-full h-11 rounded-xl font-bold">Create Item</Button></DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-[#F5F5F5]/50"><TableHead>Item</TableHead><TableHead>Location</TableHead><TableHead>Quantity</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {inventory.map((inv) => {
                      const low = Number(inv.quantity) <= Number(inv.reorder_level);
                      return (
                        <TableRow key={inv.id} className="hover:bg-blue-50/20">
                          <TableCell>
                            <p className="font-bold text-[#141414]">{inv.name}</p>
                            <p className="text-[10px] font-bold uppercase text-blue-600">{inv.id}{inv.category ? ` · ${inv.category}` : ''}</p>
                          </TableCell>
                          <TableCell className="text-xs text-[#8E9299] font-medium">{inv.project_name || 'Common store'}</TableCell>
                          <TableCell className="font-black">{Number(inv.quantity).toLocaleString()} {inv.unit}</TableCell>
                          <TableCell><Badge className={low ? 'bg-red-100 text-red-700 font-bold px-3 border-none' : 'bg-green-100 text-green-700 font-bold px-3 border-none'}>{low ? 'REORDER' : 'SUFFICIENT'}</Badge></TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" title="Issue to project" onClick={() => openMovement(inv, 'issue')}><ArrowUpFromLine className="w-4 h-4" /></Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" title="Adjust after count" onClick={() => openMovement(inv, 'adjustment')}><SlidersHorizontal className="w-4 h-4" /></Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" title="Stock history" onClick={() => openStockHistory(inv)}><History className="w-4 h-4" /></Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" title="Edit item" onClick={() => setEditingItem(inv)}><Pencil className="w-3.5 h-3.5" /></Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {inventory.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-12 text-[#8E9299]">No stock items yet.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </div>
            </CardContent>

            <Dialog open={!!editingItem} onOpenChange={(open) => !open && setEditingItem(null)}>
              <DialogContent className="rounded-3xl">
                {editingItem && (
                  <form onSubmit={handleEditInventory}>
                    <DialogHeader><DialogTitle>Edit {editingItem.name}</DialogTitle><DialogDescription>Quantities change only through issues, adjustments and goods received, so the history stays complete.</DialogDescription></DialogHeader>
                    <div className="grid gap-5 py-6">
                      <div className="space-y-2"><Label>Item name</Label><Input name="name" defaultValue={editingItem.name} required /></div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Category</Label>
                          <CategorySelect type="inventory" name="category" defaultValue={editingItem.category} />
                        </div>
                        <div className="space-y-2"><Label>Unit</Label><Input name="unit" defaultValue={editingItem.unit} required /></div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Location</Label>
                          <Select name="project_id" defaultValue={editingItem.project_id || NONE}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>General / common store</SelectItem>
                              {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2"><Label>Reorder level</Label><Input name="reorder" type="number" min="0" step="any" defaultValue={editingItem.reorder_level} /></div>
                      </div>
                    </div>
                    <DialogFooter><Button type="submit" className="bg-blue-600 text-white w-full h-11 rounded-xl font-bold">Save Changes</Button></DialogFooter>
                  </form>
                )}
              </DialogContent>
            </Dialog>

            <Dialog open={!!movementItem} onOpenChange={(open) => !open && setMovementItem(null)}>
              <DialogContent className="rounded-3xl">
                {movementItem && (
                  <form onSubmit={handleMovement}>
                    <DialogHeader>
                      <DialogTitle>{movementForm.type === 'issue' ? 'Issue Stock to Project' : 'Stock Adjustment'}</DialogTitle>
                      <DialogDescription>{movementItem.name}: {Number(movementItem.quantity).toLocaleString()} {movementItem.unit} in stock</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-5 py-6">
                      <div className="space-y-2">
                        <Label>{movementForm.type === 'issue' ? `Quantity issued (${movementItem.unit})` : `Change in quantity (${movementItem.unit}) — negative to reduce`}</Label>
                        <Input type="number" step="any" required value={movementForm.quantity} onChange={e => setMovementForm(f => ({ ...f, quantity: e.target.value }))} min={movementForm.type === 'issue' ? '0' : undefined} />
                      </div>
                      <div className="space-y-2">
                        <Label>Project{movementForm.type === 'issue' ? '' : ' (optional)'}</Label>
                        <Select value={movementForm.project_id || NONE} onValueChange={value => setMovementForm(f => ({ ...f, project_id: value }))}>
                          <SelectTrigger><SelectValue placeholder="Select project..." /></SelectTrigger>
                          <SelectContent>
                            {movementForm.type === 'adjustment' && <SelectItem value={NONE}>None</SelectItem>}
                            {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>{movementForm.type === 'adjustment' ? 'Reason (required)' : 'Notes'}</Label>
                        <Textarea value={movementForm.notes} onChange={e => setMovementForm(f => ({ ...f, notes: e.target.value }))} required={movementForm.type === 'adjustment'} className="resize-none" />
                      </div>
                    </div>
                    <DialogFooter><Button type="submit" className="bg-blue-600 text-white w-full h-11 rounded-xl font-bold">{movementForm.type === 'issue' ? 'Issue Stock' : 'Record Adjustment'}</Button></DialogFooter>
                  </form>
                )}
              </DialogContent>
            </Dialog>

            <Dialog open={!!historyItem} onOpenChange={(open) => !open && setHistoryItem(null)}>
              <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto rounded-3xl">
                <DialogHeader>
                  <DialogTitle>Stock History — {historyItem?.name}</DialogTitle>
                  <DialogDescription>Current balance: {Number(historyItem?.quantity || 0).toLocaleString()} {historyItem?.unit}</DialogDescription>
                </DialogHeader>
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Balance</TableHead><TableHead>Project / Reference</TableHead><TableHead>By</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {movements.map(m => (
                      <TableRow key={m.id}>
                        <TableCell className="text-xs whitespace-nowrap">{new Date(m.created_at).toLocaleString()}</TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-1 text-xs font-bold">
                            {Number(m.quantity) > 0 ? <ArrowDownToLine className="w-3 h-3 text-green-600" /> : <ArrowUpFromLine className="w-3 h-3 text-red-600" />}
                            {MOVEMENT_LABEL[m.movement_type] || m.movement_type}
                          </span>
                        </TableCell>
                        <TableCell className={`text-right font-bold ${Number(m.quantity) > 0 ? 'text-green-600' : 'text-red-600'}`}>{Number(m.quantity) > 0 ? '+' : ''}{Number(m.quantity).toLocaleString()}</TableCell>
                        <TableCell className="text-right">{Number(m.balance_after).toLocaleString()}</TableCell>
                        <TableCell className="text-xs">
                          {m.project_name || '—'}
                          {m.reference_id ? <span className="block text-[#8E9299]">{m.reference_id}</span> : null}
                          {m.notes ? <span className="block text-[#8E9299] italic">{m.notes}</span> : null}
                        </TableCell>
                        <TableCell className="text-xs">{m.created_by_email || '—'}</TableCell>
                      </TableRow>
                    ))}
                    {movements.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-8 text-[#8E9299]">No movements recorded.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </DialogContent>
            </Dialog>
          </Card>
        );
      case 'procurement-suppliers':
        return (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-bold flex items-center gap-2"><Building2 className="w-5 h-5 text-blue-600" /> Suppliers</h2>
              {canBuy && (
                <Dialog open={isAddSupplierModalOpen} onOpenChange={setIsAddSupplierModalOpen}>
                  <DialogTrigger asChild><Button className="bg-[#141414] text-white gap-2 font-bold px-6 rounded-xl transition-all hover:bg-black shadow-lg"><Plus className="w-4 h-4" />Add Supplier</Button></DialogTrigger>
                  <DialogContent className="rounded-3xl max-h-[90vh] overflow-y-auto">
                    <form onSubmit={handleAddSupplier}>
                      <DialogHeader><DialogTitle>New Supplier</DialogTitle><DialogDescription>Register a vendor. The GRA TIN appears on printed purchase orders.</DialogDescription></DialogHeader>
                      <div className="grid gap-5 py-6">{supplierFields()}</div>
                      <DialogFooter><Button type="submit" className="bg-blue-600 text-white w-full h-11 rounded-xl font-bold">Register Supplier</Button></DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              )}
            </div>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {suppliers.map((s) => (
                <Card key={s.id} className="border-none shadow-sm group hover:shadow-xl hover:shadow-blue-500/5 transition-all duration-300 rounded-2xl overflow-hidden bg-white">
                  <CardHeader className="p-6">
                    <div className="flex justify-between items-start">
                      <div className="p-2 bg-blue-50 rounded-xl"><Building2 className="w-5 h-5 text-blue-600" /></div>
                      <div className="flex gap-2">
                        {canBuy && (
                          <Button variant="ghost" size="icon" onClick={() => { setSelectedSupplier(s); setIsEditSupplierModalOpen(true); }} className="h-8 w-8 hover:bg-blue-50 rounded-full">
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        <Badge className="bg-[#F5F5F5] text-[#141414] border-none font-bold text-[10px] flex items-center gap-1"><Star className="w-3 h-3 fill-yellow-400 text-yellow-400" /> {s.rating}</Badge>
                      </div>
                    </div>
                    <CardTitle className="mt-4 text-lg font-bold">{s.name}</CardTitle>
                    <CardDescription className="text-blue-600 font-bold text-xs uppercase tracking-widest">{s.category}</CardDescription>
                  </CardHeader>
                  <CardContent className="px-6 pb-6 pt-0 space-y-4">
                    <div className="space-y-2 text-sm text-[#8E9299] font-medium">
                      {s.contact_person && <div className="flex items-center gap-2"><Building2 className="w-3.5 h-3.5" /> <span>{s.contact_person}</span></div>}
                      {s.phone && <div className="flex items-center gap-2"><Phone className="w-3.5 h-3.5" /> <span>{s.phone}</span></div>}
                      {s.email && <div className="flex items-center gap-2"><Mail className="w-3.5 h-3.5" /> <span className="truncate">{s.email}</span></div>}
                      {s.address && <div className="flex items-center gap-2"><MapPin className="w-3.5 h-3.5" /> <span className="line-clamp-1">{s.address}</span></div>}
                      <div className="text-xs">TIN: {s.tin || <span className="text-orange-600">not recorded</span>}</div>
                    </div>
                    <Button onClick={() => handleViewHistory(s)} variant="outline" className="w-full rounded-xl border-[#F5F5F5] font-bold text-xs h-10 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-100 transition-all">VIEW ACCOUNT HISTORY</Button>
                  </CardContent>
                </Card>
              ))}
              {suppliers.length === 0 && <div className="col-span-full py-20 text-center text-[#8E9299] font-medium">No suppliers registered.</div>}
            </div>

            <Dialog open={isEditSupplierModalOpen} onOpenChange={setIsEditSupplierModalOpen}>
              <DialogContent className="rounded-3xl max-h-[90vh] overflow-y-auto">
                {selectedSupplier && (
                  <form onSubmit={handleEditSupplier}>
                    <DialogHeader><DialogTitle>Edit Supplier</DialogTitle></DialogHeader>
                    <div className="grid gap-5 py-6">{supplierFields(selectedSupplier)}</div>
                    <DialogFooter><Button type="submit" className="bg-blue-600 text-white w-full h-11 rounded-xl font-bold">Save Changes</Button></DialogFooter>
                  </form>
                )}
              </DialogContent>
            </Dialog>

            <Dialog open={isHistoryModalOpen} onOpenChange={setIsHistoryModalOpen}>
              <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto rounded-3xl">
                <DialogHeader>
                  <DialogTitle className="text-2xl font-black">Account History</DialogTitle>
                  <DialogDescription>
                    {selectedSupplier?.name} - {selectedSupplier?.category}
                  </DialogDescription>
                </DialogHeader>

                {supplierHistory && (
                  supplierHistory.purchaseOrders.length === 0 && supplierHistory.bills.length === 0 && supplierHistory.payments.length === 0 ? (
                    <div className="py-12 flex flex-col items-center text-center gap-3">
                      <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center">
                        <FileText className="w-7 h-7 text-slate-400" />
                      </div>
                      <p className="font-bold text-[#141414]">No account activity yet</p>
                      <p className="text-sm text-slate-500 max-w-sm">Purchase orders, bills and payments for this supplier will appear here once they are recorded.</p>
                    </div>
                  ) : (
                  <div className="grid gap-8 py-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      {[
                        { label: 'Total Ordered', value: supplierHistory.summary.totalOrdered, className: 'text-[#141414]' },
                        { label: 'Total Billed', value: supplierHistory.summary.totalBilled, className: 'text-[#141414]' },
                        { label: 'Total Paid', value: supplierHistory.summary.totalPaid, className: 'text-green-600' },
                        { label: 'Balance Due', value: supplierHistory.summary.balanceDue, className: supplierHistory.summary.balanceDue > 0 ? 'text-red-600' : 'text-green-600' },
                      ].map((item) => (
                        <div key={item.label} className="p-4 rounded-2xl bg-slate-50">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{item.label}</p>
                          <p className={`text-lg font-black ${item.className}`}>{money(item.value)}</p>
                        </div>
                      ))}
                    </div>

                    <div className="space-y-4">
                      <h3 className="font-bold flex items-center gap-2"><FileText className="w-5 h-5 text-blue-600" /> Purchase Orders</h3>
                      {supplierHistory.purchaseOrders.length > 0 ? (
                        <div className="rounded-xl border overflow-hidden">
                          <Table>
                            <TableHeader className="bg-slate-50">
                              <TableRow>
                                <TableHead>PO No.</TableHead>
                                <TableHead>Date</TableHead>
                                <TableHead className="text-right">Amount</TableHead>
                                <TableHead>Status</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {supplierHistory.purchaseOrders.map((po: any) => (
                                <TableRow key={po.id}>
                                  <TableCell className="font-bold text-blue-600">{po.id}</TableCell>
                                  <TableCell>{formatDate(po.order_date)}</TableCell>
                                  <TableCell className="text-right font-black">{money(po.total_amount)}</TableCell>
                                  <TableCell>
                                    <Badge className={`${PO_BADGE[po.status] || 'bg-gray-100 text-gray-700'} border-none font-bold text-[10px]`}>{formatStatus(po.status)}</Badge>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ) : (
                        <div className="p-4 bg-slate-50 rounded-xl text-center text-sm text-slate-500 font-medium">No purchase orders found.</div>
                      )}
                    </div>

                    <div className="space-y-4">
                      <h3 className="font-bold flex items-center gap-2"><Receipt className="w-5 h-5 text-blue-600" /> Accounts Payable (Bills)</h3>
                      {supplierHistory.bills.length > 0 ? (
                        <div className="rounded-xl border overflow-hidden">
                          <Table>
                            <TableHeader className="bg-slate-50">
                              <TableRow>
                                <TableHead>Bill ID</TableHead>
                                <TableHead>Date</TableHead>
                                <TableHead>Due Date</TableHead>
                                <TableHead className="text-right">Total</TableHead>
                                <TableHead className="text-right">Balance</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Action</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {supplierHistory.bills.map((bill: any) => (
                                <TableRow key={bill.id}>
                                  <TableCell className="font-bold">{bill.id}{bill.po_id ? <span className="block text-[10px] text-blue-600">{bill.po_id}</span> : null}</TableCell>
                                  <TableCell>{formatDate(bill.date)}</TableCell>
                                  <TableCell className={bill.due_date && new Date(bill.due_date) < new Date() && !isPaidStatus(bill.status) ? 'text-red-500 font-bold' : ''}>
                                    {formatDate(bill.due_date)}
                                  </TableCell>
                                  <TableCell className="text-right font-black">{money(bill.total_amount)}</TableCell>
                                  <TableCell className="text-right font-bold">{money(bill.balance_due)}</TableCell>
                                  <TableCell>
                                    <Badge className={billBadgeClass(bill.status)}>
                                      {formatStatus(bill.status)}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <Button variant="ghost" size="sm" className="font-bold h-8 text-xs" onClick={() => { setSelectedBill(bill); setIsBillDetailsOpen(true); }}>
                                      <Eye className="w-4 h-4" />
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ) : (
                        <div className="p-4 bg-slate-50 rounded-xl text-center text-sm text-slate-500 font-medium">No bills found.</div>
                      )}
                    </div>

                    <div className="space-y-4">
                      <h3 className="font-bold flex items-center gap-2"><CreditCard className="w-5 h-5 text-blue-600" /> Payments Made</h3>
                      {supplierHistory.payments.length > 0 ? (
                        <div className="rounded-xl border overflow-hidden">
                          <Table>
                            <TableHeader className="bg-slate-50">
                              <TableRow>
                                <TableHead>Payment Ref</TableHead>
                                <TableHead>Date</TableHead>
                                <TableHead>Method</TableHead>
                                <TableHead className="text-right">Amount</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {supplierHistory.payments.map((pmt: any) => (
                                <TableRow key={pmt.payment_id}>
                                  <TableCell className="font-bold text-slate-500">{pmt.payment_id}</TableCell>
                                  <TableCell>{formatDate(pmt.date)}</TableCell>
                                  <TableCell><Badge variant="outline">{pmt.method}</Badge></TableCell>
                                  <TableCell className="text-right font-black text-green-600">{money(pmt.amount)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ) : (
                        <div className="p-4 bg-slate-50 rounded-xl text-center text-sm text-slate-500 font-medium">No payments recorded yet.</div>
                      )}
                    </div>
                  </div>
                  )
                )}
              </DialogContent>
            </Dialog>

            <Dialog open={isBillDetailsOpen} onOpenChange={setIsBillDetailsOpen}>
              <DialogContent className="rounded-2xl">
                <DialogHeader>
                  <DialogTitle>Bill Details</DialogTitle>
                  <DialogDescription>View bill information</DialogDescription>
                </DialogHeader>
                {selectedBill && (
                  <div className="grid gap-4 py-4">
                    <div className="space-y-2"><Label>Bill ID</Label><div className="font-bold">{selectedBill.id}</div></div>
                    {selectedBill.po_id && <div className="space-y-2"><Label>Purchase order</Label><div className="font-bold text-blue-600">{selectedBill.po_id}</div></div>}
                    <div className="space-y-2"><Label>Date</Label><div>{formatDate(selectedBill.date)}</div></div>
                    <div className="space-y-2"><Label>Due Date</Label><div>{formatDate(selectedBill.due_date)}</div></div>
                    <div className="space-y-2"><Label>Total Amount</Label><div className="font-black text-lg">{money(selectedBill.total_amount)}</div></div>
                    <div className="space-y-2"><Label>Amount Paid / Balance</Label><div className="font-bold">{money(selectedBill.paid_amount)} / {money(selectedBill.balance_due)}</div></div>
                    <div className="space-y-2">
                      <Label>Status</Label>
                      <Badge className={billBadgeClass(selectedBill.status)}>
                        {formatStatus(selectedBill.status)}
                      </Badge>
                    </div>
                  </div>
                )}
                <DialogFooter>
                  <Button onClick={() => setIsBillDetailsOpen(false)}>Close</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-10">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h1 className="text-4xl font-black tracking-tighter text-[#141414]">Procurement.</h1>
          <p className="text-[#8E9299] text-lg font-medium">Purchase orders, suppliers and site stock.</p>
        </div>
      </div>
      {renderContent()}

      {/* Create / edit purchase order */}
      <Dialog open={isPoFormOpen} onOpenChange={setIsPoFormOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto rounded-3xl border-none shadow-2xl">
          <form onSubmit={handleSavePo}>
            <DialogHeader>
              <DialogTitle>{editingPoId ? `Edit ${editingPoId}` : 'New Purchase Order'}</DialogTitle>
              <DialogDescription>The order goes to an admin or accountant for approval before it can be sent or received.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-5 py-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Supplier</Label>
                  <Select value={poForm.supplier_id} onValueChange={value => setPoForm(f => ({ ...f, supplier_id: value }))}>
                    <SelectTrigger className="bg-[#F5F5F5] border-none rounded-xl"><SelectValue placeholder="Select supplier..." /></SelectTrigger>
                    <SelectContent className="rounded-xl">
                      {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Project</Label>
                  <Select value={poForm.project_id || NONE} onValueChange={value => setPoForm(f => ({ ...f, project_id: value }))}>
                    <SelectTrigger className="bg-[#F5F5F5] border-none rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent className="rounded-xl">
                      <SelectItem value={NONE}>General stock / overheads</SelectItem>
                      {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Order date</Label><Input type="date" required value={poForm.order_date} onChange={e => setPoForm(f => ({ ...f, order_date: e.target.value }))} className="bg-[#F5F5F5] border-none rounded-xl" /></div>
                <div className="space-y-2"><Label>Required delivery date</Label><Input type="date" value={poForm.delivery_date} onChange={e => setPoForm(f => ({ ...f, delivery_date: e.target.value }))} className="bg-[#F5F5F5] border-none rounded-xl" /></div>
              </div>

              <div className="space-y-2">
                <Label>Line items</Label>
                <div className="rounded-xl border border-[#F5F5F5] overflow-hidden">
                  <div className="grid grid-cols-[1fr_90px_90px_120px_120px_36px] gap-2 bg-[#F5F5F5]/60 px-3 py-2 text-[10px] font-bold uppercase text-[#8E9299]">
                    <span>Description</span><span>Qty</span><span>Unit</span><span>Unit price</span><span className="text-right">Amount</span><span />
                  </div>
                  {poForm.lines.map((line, index) => (
                    <div key={index} className="grid grid-cols-[1fr_90px_90px_120px_120px_36px] gap-2 px-3 py-2 items-center border-t border-[#F5F5F5]">
                      <Input value={line.item_name} onChange={e => updateLine(index, { item_name: e.target.value })} placeholder="e.g. Cement 42.5R" list="po-stock-items" />
                      <Input type="number" min="0" step="any" value={line.quantity} onChange={e => updateLine(index, { quantity: e.target.value })} />
                      <Input value={line.unit} onChange={e => updateLine(index, { unit: e.target.value })} />
                      <Input type="number" min="0" step="0.01" value={line.unit_price} onChange={e => updateLine(index, { unit_price: e.target.value })} placeholder="0.00" />
                      <span className="text-right text-sm font-bold">{money((Number(line.quantity) || 0) * (Number(line.unit_price) || 0))}</span>
                      <Button type="button" variant="ghost" size="icon" disabled={poForm.lines.length === 1} onClick={() => setPoForm(f => ({ ...f, lines: f.lines.filter((_, i) => i !== index) }))} className="text-red-600" title="Remove line">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                  <datalist id="po-stock-items">
                    {inventory.map(i => <option key={i.id} value={i.name} />)}
                  </datalist>
                </div>
                <div className="flex items-center justify-between">
                  <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => setPoForm(f => ({ ...f, lines: [...f.lines, emptyLine()] }))}>
                    <Plus className="w-3.5 h-3.5" /> Add line
                  </Button>
                  <p className="text-lg font-black">Total: {money(poTotal)}</p>
                </div>
              </div>
              <div className="space-y-2"><Label>Notes for supplier (optional)</Label><Textarea value={poForm.notes} onChange={e => setPoForm(f => ({ ...f, notes: e.target.value }))} className="bg-[#F5F5F5] border-none rounded-xl resize-none" /></div>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setIsPoFormOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isSaving} className="bg-blue-600 text-white rounded-xl font-bold px-8">
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : editingPoId ? 'Save & Resubmit' : 'Submit for Approval'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Purchase order details */}
      <Dialog open={!!poDetail && !isReceiveOpen && !isBillOpen && !isRejectOpen} onOpenChange={(open) => !open && setPoDetail(null)}>
        <DialogContent className="max-w-4xl max-h-[88vh] overflow-y-auto rounded-3xl">
          {poDetail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-3">
                  {poDetail.id}
                  <Badge className={`${PO_BADGE[poDetail.status] || 'bg-gray-100 text-gray-700'} border-none text-[10px]`}>{String(poDetail.status).toUpperCase()}</Badge>
                </DialogTitle>
                <DialogDescription>
                  {poDetail.supplier_name} · {poDetail.project_name || 'General stock'} · ordered {formatDate(poDetail.order_date)}
                  {poDetail.delivery_date ? ` · required by ${formatDate(poDetail.delivery_date)}` : ''}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-5 py-2">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div className="p-3 rounded-xl bg-slate-50"><p className="text-[10px] uppercase font-bold text-slate-500">Raised by</p><p className="font-medium truncate">{poDetail.created_by_email || '—'}</p></div>
                  <div className="p-3 rounded-xl bg-slate-50"><p className="text-[10px] uppercase font-bold text-slate-500">{poDetail.status === 'Rejected' ? 'Rejected by' : 'Approved by'}</p><p className="font-medium truncate">{poDetail.approved_by_email || '—'}</p></div>
                  <div className="p-3 rounded-xl bg-slate-50"><p className="text-[10px] uppercase font-bold text-slate-500">Received value</p><p className="font-bold">{money(poDetail.received_value)}</p></div>
                  <div className="p-3 rounded-xl bg-slate-50"><p className="text-[10px] uppercase font-bold text-slate-500">Bill</p><p className="font-bold">{poDetail.bill_id ? `#${poDetail.bill_id}` : '—'}</p></div>
                </div>
                {poDetail.rejection_reason && <p className="text-sm text-red-700 bg-red-50 rounded-xl p-3">Rejected: {poDetail.rejection_reason}</p>}
                <Table>
                  <TableHeader><TableRow><TableHead>Description</TableHead><TableHead className="text-right">Ordered</TableHead><TableHead className="text-right">Received</TableHead><TableHead className="text-right">Unit price</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {(poDetail.items || []).map((item: any) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.item_name}{item.inventory_item_id ? <span className="block text-[10px] text-blue-600">Stock: {item.inventory_item_id}</span> : null}</TableCell>
                        <TableCell className="text-right">{item.quantity} {item.unit}</TableCell>
                        <TableCell className={`text-right ${item.received_quantity >= item.quantity ? 'text-green-600 font-bold' : ''}`}>{item.received_quantity} {item.unit}</TableCell>
                        <TableCell className="text-right">{money(item.unit_price)}</TableCell>
                        <TableCell className="text-right font-bold">{money(item.total_price)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow><TableCell colSpan={4} className="text-right font-bold">Total</TableCell><TableCell className="text-right font-black">{money(poDetail.total_amount)}</TableCell></TableRow>
                  </TableBody>
                </Table>
                {poDetail.notes && <p className="text-sm"><span className="font-bold">Notes:</span> {poDetail.notes}</p>}
                {(poDetail.receipts || []).length > 0 && (
                  <div>
                    <h4 className="font-bold mb-2 flex items-center gap-2"><PackageCheck className="w-4 h-4 text-indigo-600" /> Goods received</h4>
                    <div className="space-y-2">
                      {poDetail.receipts.map((r: any) => (
                        <div key={r.id} className="rounded-xl border border-[#F5F5F5] p-3 text-sm">
                          <p className="font-bold">GRN-{r.id} · {formatDate(r.receipt_date)} · {r.received_by_email || '—'}{r.delivery_note ? ` · Delivery note ${r.delivery_note}` : ''}</p>
                          <p className="text-[#8E9299]">{r.lines.map((l: any) => `${l.item_name}: ${l.quantity} ${l.unit || ''}`).join(' · ')}</p>
                          {r.notes && <p className="text-[#8E9299] italic">{r.notes}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <DialogFooter className="flex-wrap gap-2">
                {canEditPo(poDetail) && <Button variant="outline" className="gap-1" onClick={() => openEditPo(poDetail)}><Pencil className="w-4 h-4" /> Edit</Button>}
                {canCancelPo(poDetail) && <Button variant="outline" className="gap-1 text-gray-600" onClick={() => handleCancel(poDetail)}><Ban className="w-4 h-4" /> Cancel Order</Button>}
                <Button variant="outline" className="gap-1" onClick={() => handlePrintLpo(poDetail)}><Printer className="w-4 h-4" /> Print LPO</Button>
                {poActions(poDetail, false)}
                {canApprove && poDetail.status === 'Pending Approval' && poDetail.created_by === user?.id && (
                  <p className="text-xs text-[#8E9299] self-center">You raised this order, so another approver must approve it.</p>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Reject */}
      <Dialog open={isRejectOpen} onOpenChange={setIsRejectOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader><DialogTitle>Reject {actionPo?.id}</DialogTitle><DialogDescription>The person who raised the order can edit and resubmit it.</DialogDescription></DialogHeader>
          <div className="space-y-2 py-2"><Label>Reason</Label><Textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="e.g. Price too high, get another quote" className="resize-none" /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRejectOpen(false)}>Back</Button>
            <Button onClick={handleReject} className="bg-red-600 text-white">Reject Order</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Goods received */}
      <Dialog open={isReceiveOpen} onOpenChange={setIsReceiveOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto rounded-3xl">
          {actionPo && (
            <form onSubmit={handleReceive}>
              <DialogHeader><DialogTitle>Receive Goods — {actionPo.id}</DialogTitle><DialogDescription>Record what arrived from {actionPo.supplier_name}. Lines linked to a stock item are added to inventory.</DialogDescription></DialogHeader>
              <div className="grid gap-5 py-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>Date received</Label><Input type="date" required value={receiveMeta.receipt_date} onChange={e => setReceiveMeta(m => ({ ...m, receipt_date: e.target.value }))} /></div>
                  <div className="space-y-2"><Label>Supplier delivery note no.</Label><Input value={receiveMeta.delivery_note} onChange={e => setReceiveMeta(m => ({ ...m, delivery_note: e.target.value }))} /></div>
                </div>
                <Table>
                  <TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="text-right">Outstanding</TableHead><TableHead className="w-28">Received now</TableHead><TableHead>Put into stock</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {(actionPo.items || []).map((item: any) => {
                      const outstanding = Math.max(item.quantity - item.received_quantity, 0);
                      const line = receiveLines[item.id] || { quantity: '0', add_to_stock: false, inventory_item_id: '' };
                      const setLine = (patch: Partial<ReceiveLine>) => setReceiveLines(ls => ({ ...ls, [item.id]: { ...line, ...patch } }));
                      const stockChoice = item.inventory_item_id ? item.inventory_item_id : line.add_to_stock ? '__new' : (line.inventory_item_id || NONE);
                      return (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">{item.item_name}</TableCell>
                          <TableCell className="text-right">{outstanding} {item.unit}</TableCell>
                          <TableCell><Input type="number" min="0" max={outstanding} step="any" disabled={outstanding === 0} value={line.quantity} onChange={e => setLine({ quantity: e.target.value })} /></TableCell>
                          <TableCell>
                            {item.inventory_item_id ? (
                              <span className="text-xs text-blue-600 font-bold">{item.inventory_item_id}</span>
                            ) : (
                              <Select
                                value={stockChoice}
                                onValueChange={value => setLine(value === '__new' ? { add_to_stock: true, inventory_item_id: '' } : { add_to_stock: false, inventory_item_id: value === NONE ? '' : value })}
                              >
                                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={NONE}>Not stocked (use directly)</SelectItem>
                                  <SelectItem value="__new">New stock item "{item.item_name}"</SelectItem>
                                  {inventory.map(i => <SelectItem key={i.id} value={i.id}>{i.name} ({i.unit})</SelectItem>)}
                                </SelectContent>
                              </Select>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                <div className="space-y-2"><Label>Notes (condition, shortages, etc.)</Label><Textarea value={receiveMeta.notes} onChange={e => setReceiveMeta(m => ({ ...m, notes: e.target.value }))} className="resize-none" /></div>
              </div>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setIsReceiveOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={isSaving} className="bg-indigo-600 text-white font-bold">{isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Record Goods Received'}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Convert to bill */}
      <Dialog open={isBillOpen} onOpenChange={setIsBillOpen}>
        <DialogContent className="rounded-2xl">
          {actionPo && (
            <form onSubmit={handleConvertToBill}>
              <DialogHeader>
                <DialogTitle>Convert {actionPo.id} to a Bill</DialogTitle>
                <DialogDescription>
                  Creates an accounts payable bill for {money(billAmountFor(actionPo))}
                  {Number(actionPo.received_value) > 0 ? ' (the value of goods received)' : ' (the full order — nothing has been received yet)'} and posts it to the ledger.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="space-y-2">
                  <Label>Charge to account</Label>
                  <Select value={billForm.account_id} onValueChange={value => setBillForm(f => ({ ...f, account_id: value }))}>
                    <SelectTrigger><SelectValue placeholder="Select expense or asset account..." /></SelectTrigger>
                    <SelectContent>
                      {billAccounts.map(a => <SelectItem key={a.id} value={String(a.id)}>{a.code} · {a.name} ({a.type})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>Bill date</Label><Input type="date" required value={billForm.bill_date} onChange={e => setBillForm(f => ({ ...f, bill_date: e.target.value }))} /></div>
                  <div className="space-y-2"><Label>Due date</Label><Input type="date" value={billForm.due_date} onChange={e => setBillForm(f => ({ ...f, due_date: e.target.value }))} placeholder="From supplier terms" /></div>
                </div>
                <p className="text-xs text-[#8E9299]">Leave the due date blank to use the supplier's payment terms.</p>
              </div>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setIsBillOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={isSaving} className="bg-green-700 text-white font-bold">{isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create Bill'}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
