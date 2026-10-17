import { useEffect, useState, type ReactNode } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Textarea } from '../ui/textarea';
import { commercialApi, procurementApi, projectsApi, apiErrorMessage } from '../../lib/api';
import { formatDate, todayIso } from '../../lib/dates';
import { formatWithSymbol } from '../../lib/currency';
import { useAuth } from '../../contexts/AuthContext';
import type { Module } from '../../types';

const money = (value: unknown) => formatWithSymbol(value);

const statusClass = (status: string) => {
  const s = status.toLowerCase();
  if (['approved', 'done', 'awarded', 'completed', 'ordered', 'closed'].includes(s) && s !== 'closed') {
    return 'bg-green-100 text-green-700 border-none';
  }
  if (s === 'closed' || s === 'issued' || s === 'in progress') return 'bg-blue-100 text-blue-700 border-none';
  if (['rejected', 'cancelled', 'high'].includes(s)) return 'bg-red-100 text-red-700 border-none';
  if (['submitted', 'open', 'delayed', 'medium'].includes(s)) return 'bg-amber-100 text-amber-800 border-none';
  return 'bg-slate-100 text-slate-700 border-none';
};

function StatusBadge({ status }: { status: string }) {
  return <Badge className={statusClass(status)}>{status}</Badge>;
}

function useLookups() {
  const [projects, setProjects] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  useEffect(() => {
    projectsApi.getProjects().then(r => setProjects(r.data)).catch(() => setProjects([]));
    procurementApi.getSuppliers().then(r => setSuppliers(r.data)).catch(() => setSuppliers([]));
  }, []);
  return { projects, suppliers };
}

function Panel({ title, description, action, children }: { title: string; description: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-[#141414]">{title}</h2>
          <p className="text-sm text-[#8E9299]">{description}</p>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function Loading() {
  return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" /></div>;
}

function Empty({ text }: { text: string }) {
  return <p className="px-4 py-10 text-center text-sm text-[#8E9299]">{text}</p>;
}

function ProjectField({ value, onChange, projects }: { value: string; onChange: (v: string) => void; projects: any[] }) {
  return (
    <div className="space-y-2">
      <Label>Project</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="bg-[#F5F5F5] border-none rounded-xl h-11"><SelectValue placeholder="Choose a project" /></SelectTrigger>
        <SelectContent>
          {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

export default function Commercial({ activeSub }: { activeSub: Module }) {
  const { projects, suppliers } = useLookups();
  if (activeSub === 'commercial-tenders') return <Tenders projects={projects} suppliers={suppliers} />;
  if (activeSub === 'commercial-variations') return <Variations projects={projects} />;
  if (activeSub === 'commercial-requisitions') return <Requisitions projects={projects} />;
  if (activeSub === 'commercial-work-orders') return <WorkOrders projects={projects} suppliers={suppliers} />;
  if (activeSub === 'commercial-programme') return <Programme projects={projects} />;
  if (activeSub === 'commercial-safety') return <Safety projects={projects} />;
  return <Boq projects={projects} />;
}

function Boq({ projects }: { projects: any[] }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ project_id: '', item_no: '', description: '', unit: 'm3', quantity: '', rate: '', cost_code: '' });

  const load = () => {
    setLoading(true);
    commercialApi.getBoq().then(r => setRows(r.data)).catch(e => toast.error(apiErrorMessage(e, 'Could not load the bill of quantities'))).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
  const save = async () => {
    try {
      await commercialApi.addBoqItem({ ...form, quantity: Number(form.quantity), rate: Number(form.rate) });
      toast.success('BOQ item added');
      setOpen(false);
      load();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Could not add the item'));
    }
  };

  return (
    <Panel
      title="Bill of quantities"
      description="Measured work, rates and the contract sum for each project."
      action={<Button onClick={() => setOpen(true)} className="rounded-xl bg-[#141414] text-white"><Plus className="mr-2 h-4 w-4" />Add item</Button>}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="rounded-2xl border-none shadow-sm"><CardContent className="p-5"><p className="text-[11px] font-bold uppercase tracking-widest text-[#8E9299]">Contract sum</p><p className="mt-1 text-2xl font-black">{money(total)}</p></CardContent></Card>
        <Card className="rounded-2xl border-none shadow-sm"><CardContent className="p-5"><p className="text-[11px] font-bold uppercase tracking-widest text-[#8E9299]">Items</p><p className="mt-1 text-2xl font-black">{rows.length}</p></CardContent></Card>
        <Card className="rounded-2xl border-none shadow-sm"><CardContent className="p-5"><p className="text-[11px] font-bold uppercase tracking-widest text-[#8E9299]">Projects</p><p className="mt-1 text-2xl font-black">{new Set(rows.map(r => r.project_id)).size}</p></CardContent></Card>
      </div>
      <Card className="rounded-2xl border-none shadow-sm overflow-hidden">
        {loading ? <Loading /> : rows.length === 0 ? <Empty text="No measured items yet. Add the first line of the bill." /> : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead><TableHead>Description</TableHead><TableHead>Project</TableHead>
                  <TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Rate</TableHead><TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <TableRow key={row.id}>
                    <TableCell className="font-bold">{row.item_no}</TableCell>
                    <TableCell>{row.description}<div className="text-xs text-[#8E9299]">{row.unit}{row.cost_code ? ` · ${row.cost_code}` : ''}</div></TableCell>
                    <TableCell>{row.project_name}</TableCell>
                    <TableCell className="text-right">{Number(row.quantity).toLocaleString()}</TableCell>
                    <TableCell className="text-right">{money(row.rate)}</TableCell>
                    <TableCell className="text-right font-bold">{money(row.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-3xl">
          <DialogHeader><DialogTitle>Add a measured item</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <ProjectField value={form.project_id} onChange={v => setForm({ ...form, project_id: v })} projects={projects} />
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Item no.</Label><Input value={form.item_no} onChange={e => setForm({ ...form, item_no: e.target.value })} className="bg-[#F5F5F5] border-none rounded-xl h-11" /></div>
              <div className="space-y-2"><Label>Unit</Label><Input value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} className="bg-[#F5F5F5] border-none rounded-xl h-11" /></div>
            </div>
            <div className="space-y-2"><Label>Description</Label><Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="bg-[#F5F5F5] border-none rounded-xl h-11" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Quantity</Label><Input type="number" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} className="bg-[#F5F5F5] border-none rounded-xl h-11" /></div>
              <div className="space-y-2"><Label>Rate (GH₵)</Label><Input type="number" value={form.rate} onChange={e => setForm({ ...form, rate: e.target.value })} className="bg-[#F5F5F5] border-none rounded-xl h-11" /></div>
            </div>
          </div>
          <DialogFooter><Button onClick={save} className="rounded-xl bg-[#141414] text-white">Save item</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}

function Variations({ projects }: { projects: any[] }) {
  const { user } = useAuth();
  const canDecide = user?.role === 'admin' || user?.role === 'accountant';
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ project_id: '', title: '', reason: '', amount: '' });
  const load = () => {
    setLoading(true);
    commercialApi.getVariations().then(r => setRows(r.data)).catch(e => toast.error(apiErrorMessage(e, 'Could not load variations'))).finally(() => setLoading(false));
  };
  useEffect(load, []);
  const save = async () => {
    try {
      await commercialApi.addVariation({ ...form, amount: Number(form.amount) });
      toast.success('Variation submitted');
      setOpen(false);
      load();
    } catch (error) { toast.error(apiErrorMessage(error, 'Could not raise the variation')); }
  };
  const setStatus = async (id: string, status: string) => {
    try { await commercialApi.setVariationStatus(id, status); load(); } catch (error) { toast.error(apiErrorMessage(error, 'Could not update the variation')); }
  };
  return (
    <Panel title="Variations" description="Changes to the contract sum, raised on site and approved in the office." action={<Button onClick={() => setOpen(true)} className="rounded-xl bg-[#141414] text-white"><Plus className="mr-2 h-4 w-4" />Raise variation</Button>}>
      <Card className="rounded-2xl border-none shadow-sm overflow-hidden">
        {loading ? <Loading /> : rows.length === 0 ? <Empty text="No variations yet." /> : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Ref</TableHead><TableHead>Change</TableHead><TableHead>Project</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map(row => (
                  <TableRow key={row.id}>
                    <TableCell className="font-bold">{row.id}</TableCell>
                    <TableCell>{row.title}<div className="text-xs text-[#8E9299]">{row.reason}</div></TableCell>
                    <TableCell>{row.project_name}</TableCell>
                    <TableCell className="text-right font-bold">{money(row.amount)}</TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                      {canDecide && row.status === 'Submitted' && (
                        <div className="mt-2 flex gap-2">
                          <Button size="sm" className="h-7 rounded-lg" onClick={() => setStatus(row.id, 'Approved')}>Approve</Button>
                          <Button size="sm" variant="outline" className="h-7 rounded-lg" onClick={() => setStatus(row.id, 'Rejected')}>Reject</Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-3xl">
          <DialogHeader><DialogTitle>Raise a variation</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <ProjectField value={form.project_id} onChange={v => setForm({ ...form, project_id: v })} projects={projects} />
            <div className="space-y-2"><Label>Title</Label><Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className="bg-[#F5F5F5] border-none rounded-xl h-11" /></div>
            <div className="space-y-2"><Label>Reason</Label><Textarea value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} className="bg-[#F5F5F5] border-none rounded-xl" /></div>
            <div className="space-y-2"><Label>Amount (GH₵, negative for an omission)</Label><Input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} className="bg-[#F5F5F5] border-none rounded-xl h-11" /></div>
          </div>
          <DialogFooter><Button onClick={save} className="rounded-xl bg-[#141414] text-white">Submit</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}

function Requisitions({ projects }: { projects: any[] }) {
  const { user } = useAuth();
  const canDecide = ['admin', 'procurement', 'accountant'].includes(user?.role || '');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ project_id: '', needed_by: todayIso(), notes: '', description: '', unit: 'bag', quantity: '' });
  const load = () => {
    setLoading(true);
    commercialApi.getRequisitions().then(r => setRows(r.data)).catch(e => toast.error(apiErrorMessage(e, 'Could not load requisitions'))).finally(() => setLoading(false));
  };
  useEffect(load, []);
  const save = async () => {
    try {
      await commercialApi.addRequisition({
        project_id: form.project_id, needed_by: form.needed_by, notes: form.notes,
        lines: [{ description: form.description, unit: form.unit, quantity: Number(form.quantity) }],
      });
      toast.success('Requisition sent to procurement');
      setOpen(false);
      load();
    } catch (error) { toast.error(apiErrorMessage(error, 'Could not submit the requisition')); }
  };
  const setStatus = async (id: string, status: string) => {
    try { await commercialApi.setRequisitionStatus(id, status); load(); } catch (error) { toast.error(apiErrorMessage(error, 'Could not update the requisition')); }
  };
  return (
    <Panel title="Material requisitions" description="What the site needs, before a purchase order is raised." action={<Button onClick={() => setOpen(true)} className="rounded-xl bg-[#141414] text-white"><Plus className="mr-2 h-4 w-4" />Request materials</Button>}>
      <Card className="rounded-2xl border-none shadow-sm overflow-hidden">
        {loading ? <Loading /> : rows.length === 0 ? <Empty text="No material requests yet." /> : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Ref</TableHead><TableHead>Materials</TableHead><TableHead>Needed</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map(row => (
                  <TableRow key={row.id}>
                    <TableCell className="font-bold">{row.id}<div className="text-xs text-[#8E9299]">{row.project_name}</div></TableCell>
                    <TableCell>{(row.lines || []).map((l: any) => `${l.quantity} ${l.unit} ${l.description}`).join(', ')}</TableCell>
                    <TableCell>{formatDate(row.needed_by)}</TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                      {canDecide && row.status === 'Submitted' && (
                        <div className="mt-2 flex gap-2">
                          <Button size="sm" className="h-7 rounded-lg" onClick={() => setStatus(row.id, 'Approved')}>Approve</Button>
                          <Button size="sm" variant="outline" className="h-7 rounded-lg" onClick={() => setStatus(row.id, 'Ordered')}>Mark ordered</Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-3xl">
          <DialogHeader><DialogTitle>Request materials</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <ProjectField value={form.project_id} onChange={v => setForm({ ...form, project_id: v })} projects={projects} />
            <div className="space-y-2"><Label>Material</Label><Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="bg-[#F5F5F5] border-none rounded-xl h-11" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Quantity</Label><Input type="number" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} className="bg-[#F5F5F5] border-none rounded-xl h-11" /></div>
              <div className="space-y-2"><Label>Unit</Label><Input value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} className="bg-[#F5F5F5] border-none rounded-xl h-11" /></div>
            </div>
            <div className="space-y-2"><Label>Needed by</Label><Input type="date" value={form.needed_by} onChange={e => setForm({ ...form, needed_by: e.target.value })} className="bg-[#F5F5F5] border-none rounded-xl h-11" /></div>
          </div>
          <DialogFooter><Button onClick={save} className="rounded-xl bg-[#141414] text-white">Submit</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}

function WorkOrders({ projects, suppliers }: { projects: any[]; suppliers: any[] }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ project_id: '', supplier_id: '', title: '', scope: '', amount: '', start_date: todayIso(), end_date: '' });
  const load = () => {
    setLoading(true);
    commercialApi.getWorkOrders().then(r => setRows(r.data)).catch(e => toast.error(apiErrorMessage(e, 'Could not load work orders'))).finally(() => setLoading(false));
  };
  useEffect(load, []);
  const save = async () => {
    try {
      await commercialApi.addWorkOrder({ ...form, supplier_id: form.supplier_id || null, amount: Number(form.amount) });
      toast.success('Work order issued');
      setOpen(false);
      load();
    } catch (error) { toast.error(apiErrorMessage(error, 'Could not issue the work order')); }
  };
  const setStatus = async (id: string, status: string) => {
    try { await commercialApi.setWorkOrderStatus(id, status); load(); } catch (error) { toast.error(apiErrorMessage(error, 'Could not update the work order')); }
  };
  return (
    <Panel title="Work orders" description="Subcontract packages: scope, value and progress." action={<Button onClick={() => setOpen(true)} className="rounded-xl bg-[#141414] text-white"><Plus className="mr-2 h-4 w-4" />Issue work order</Button>}>
      <Card className="rounded-2xl border-none shadow-sm overflow-hidden">
        {loading ? <Loading /> : rows.length === 0 ? <Empty text="No subcontract work orders yet." /> : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Order</TableHead><TableHead>Subcontractor</TableHead><TableHead>Project</TableHead><TableHead className="text-right">Value</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map(row => (
                  <TableRow key={row.id}>
                    <TableCell className="font-bold">{row.id}<div className="font-normal">{row.title}</div></TableCell>
                    <TableCell>{row.supplier_name || 'Not assigned'}</TableCell>
                    <TableCell>{row.project_name}</TableCell>
                    <TableCell className="text-right font-bold">{money(row.amount)}</TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                      {row.status === 'Issued' && <Button size="sm" variant="outline" className="mt-2 h-7 rounded-lg" onClick={() => setStatus(row.id, 'In Progress')}>Start</Button>}
                      {row.status === 'In Progress' && <Button size="sm" className="mt-2 h-7 rounded-lg" onClick={() => setStatus(row.id, 'Completed')}>Complete</Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-3xl">
          <DialogHeader><DialogTitle>Issue a work order</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <ProjectField value={form.project_id} onChange={v => setForm({ ...form, project_id: v })} projects={projects} />
            <div className="space-y-2">
              <Label>Subcontractor</Label>
              <Select value={form.supplier_id} onValueChange={v => setForm({ ...form, supplier_id: v })}>
                <SelectTrigger className="bg-[#F5F5F5] border-none rounded-xl h-11"><SelectValue placeholder={suppliers.length ? 'Optional' : 'Add a supplier in Procurement first'} /></SelectTrigger>
                <SelectContent>{suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Title</Label><Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className="bg-[#F5F5F5] border-none rounded-xl h-11" /></div>
            <div className="space-y-2"><Label>Scope</Label><Textarea value={form.scope} onChange={e => setForm({ ...form, scope: e.target.value })} className="bg-[#F5F5F5] border-none rounded-xl" /></div>
            <div className="space-y-2"><Label>Contract amount (GH₵)</Label><Input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} className="bg-[#F5F5F5] border-none rounded-xl h-11" /></div>
          </div>
          <DialogFooter><Button onClick={save} className="rounded-xl bg-[#141414] text-white">Issue</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}

function Tenders({ projects, suppliers }: { projects: any[]; suppliers: any[] }) {
  const { user } = useAuth();
  const canAward = user?.role === 'admin' || user?.role === 'procurement';
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [quoteFor, setQuoteFor] = useState<string | null>(null);
  const [form, setForm] = useState({ project_id: '', title: '', closes_on: '', notes: '' });
  const [quote, setQuote] = useState({ supplier_id: '', amount: '', lead_days: '', notes: '' });
  const load = () => {
    setLoading(true);
    commercialApi.getTenders().then(r => setRows(r.data)).catch(e => toast.error(apiErrorMessage(e, 'Could not load tenders'))).finally(() => setLoading(false));
  };
  useEffect(load, []);
  const save = async () => {
    try {
      await commercialApi.addTender({ ...form, project_id: form.project_id || null });
      toast.success('Tender opened');
      setOpen(false);
      load();
    } catch (error) { toast.error(apiErrorMessage(error, 'Could not open the tender')); }
  };
  const saveQuote = async () => {
    if (!quoteFor) return;
    try {
      await commercialApi.addQuote(quoteFor, { ...quote, amount: Number(quote.amount), lead_days: quote.lead_days ? Number(quote.lead_days) : null });
      toast.success('Quote recorded');
      setQuoteFor(null);
      load();
    } catch (error) { toast.error(apiErrorMessage(error, 'Could not record the quote')); }
  };
  const award = async (id: string, supplier_id: string) => {
    try { await commercialApi.awardTender(id, supplier_id); toast.success('Tender awarded'); load(); }
    catch (error) { toast.error(apiErrorMessage(error, 'Could not award the tender')); }
  };
  return (
    <Panel title="Tenders and quotes" description="Invite prices, compare them, and award the package." action={<Button onClick={() => setOpen(true)} className="rounded-xl bg-[#141414] text-white"><Plus className="mr-2 h-4 w-4" />Open tender</Button>}>
      {loading ? <Loading /> : rows.length === 0 ? <Card className="rounded-2xl border-none shadow-sm"><Empty text="No tenders open." /></Card> : (
        <div className="grid gap-4">
          {rows.map(tender => (
            <Card key={tender.id} className="rounded-2xl border-none shadow-sm">
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-lg">{tender.title}</CardTitle>
                    <CardDescription>{tender.id} · {tender.project_name || 'Company-wide'} · closes {formatDate(tender.closes_on)}</CardDescription>
                  </div>
                  <StatusBadge status={tender.status} />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {tender.notes && <p className="text-sm text-[#8E9299]">{tender.notes}</p>}
                {(tender.quotes || []).length === 0 ? <p className="text-sm text-[#8E9299]">No quotes yet.</p> : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow><TableHead>Supplier</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Lead</TableHead><TableHead></TableHead></TableRow></TableHeader>
                      <TableBody>
                        {tender.quotes.map((q: any) => (
                          <TableRow key={q.id}>
                            <TableCell>{q.supplier_name}{tender.awarded_supplier_id === q.supplier_id ? ' · awarded' : ''}</TableCell>
                            <TableCell className="text-right font-bold">{money(q.amount)}</TableCell>
                            <TableCell>{q.lead_days ? `${q.lead_days} days` : '—'}</TableCell>
                            <TableCell className="text-right">
                              {canAward && tender.status !== 'Awarded' && <Button size="sm" className="h-7 rounded-lg" onClick={() => award(tender.id, q.supplier_id)}>Award</Button>}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                {tender.status !== 'Awarded' && <Button variant="outline" className="rounded-xl" onClick={() => { setQuoteFor(tender.id); setQuote({ supplier_id: '', amount: '', lead_days: '', notes: '' }); }}>Record a quote</Button>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-3xl">
          <DialogHeader><DialogTitle>Open a tender</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-2"><Label>Title</Label><Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className="bg-[#F5F5F5] border-none rounded-xl h-11" /></div>
            <ProjectField value={form.project_id} onChange={v => setForm({ ...form, project_id: v })} projects={projects} />
            <div className="space-y-2"><Label>Closes on</Label><Input type="date" value={form.closes_on} onChange={e => setForm({ ...form, closes_on: e.target.value })} className="bg-[#F5F5F5] border-none rounded-xl h-11" /></div>
            <div className="space-y-2"><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="bg-[#F5F5F5] border-none rounded-xl" /></div>
          </div>
          <DialogFooter><Button onClick={save} className="rounded-xl bg-[#141414] text-white">Open tender</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!quoteFor} onOpenChange={v => !v && setQuoteFor(null)}>
        <DialogContent className="rounded-3xl">
          <DialogHeader><DialogTitle>Record a supplier quote</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-2">
              <Label>Supplier</Label>
              <Select value={quote.supplier_id} onValueChange={v => setQuote({ ...quote, supplier_id: v })}>
                <SelectTrigger className="bg-[#F5F5F5] border-none rounded-xl h-11"><SelectValue placeholder={suppliers.length ? 'Choose a supplier' : 'Add a supplier in Procurement first'} /></SelectTrigger>
                <SelectContent>{suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Amount (GH₵)</Label><Input type="number" value={quote.amount} onChange={e => setQuote({ ...quote, amount: e.target.value })} className="bg-[#F5F5F5] border-none rounded-xl h-11" /></div>
              <div className="space-y-2"><Label>Lead time (days)</Label><Input type="number" value={quote.lead_days} onChange={e => setQuote({ ...quote, lead_days: e.target.value })} className="bg-[#F5F5F5] border-none rounded-xl h-11" /></div>
            </div>
          </div>
          <DialogFooter><Button onClick={saveQuote} className="rounded-xl bg-[#141414] text-white">Save quote</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}

function Programme({ projects }: { projects: any[] }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ project_id: '', name: '', due_date: todayIso(), notes: '' });
  const load = () => {
    setLoading(true);
    commercialApi.getMilestones().then(r => setRows(r.data)).catch(e => toast.error(apiErrorMessage(e, 'Could not load the programme'))).finally(() => setLoading(false));
  };
  useEffect(load, []);
  const save = async () => {
    try { await commercialApi.addMilestone(form); toast.success('Milestone added'); setOpen(false); load(); }
    catch (error) { toast.error(apiErrorMessage(error, 'Could not add the milestone')); }
  };
  const setStatus = async (id: number, status: string) => {
    try { await commercialApi.setMilestoneStatus(id, status); load(); } catch (error) { toast.error(apiErrorMessage(error, 'Could not update the milestone')); }
  };
  return (
    <Panel title="Programme" description="Milestones the site is working toward." action={<Button onClick={() => setOpen(true)} className="rounded-xl bg-[#141414] text-white"><Plus className="mr-2 h-4 w-4" />Add milestone</Button>}>
      <Card className="rounded-2xl border-none shadow-sm overflow-hidden">
        {loading ? <Loading /> : rows.length === 0 ? <Empty text="No milestones on the programme yet." /> : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Milestone</TableHead><TableHead>Project</TableHead><TableHead>Due</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map(row => (
                  <TableRow key={row.id}>
                    <TableCell className="font-bold">{row.name}</TableCell>
                    <TableCell>{row.project_name}</TableCell>
                    <TableCell>{formatDate(row.due_date)}</TableCell>
                    <TableCell>
                      <Select value={row.status} onValueChange={v => setStatus(row.id, v)}>
                        <SelectTrigger className="h-8 w-36 rounded-lg border-none bg-[#F5F5F5]"><SelectValue /></SelectTrigger>
                        <SelectContent>{['Planned', 'In Progress', 'Done', 'Delayed'].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-3xl">
          <DialogHeader><DialogTitle>Add a milestone</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <ProjectField value={form.project_id} onChange={v => setForm({ ...form, project_id: v })} projects={projects} />
            <div className="space-y-2"><Label>Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="bg-[#F5F5F5] border-none rounded-xl h-11" /></div>
            <div className="space-y-2"><Label>Due date</Label><Input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} className="bg-[#F5F5F5] border-none rounded-xl h-11" /></div>
          </div>
          <DialogFooter><Button onClick={save} className="rounded-xl bg-[#141414] text-white">Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}

function Safety({ projects }: { projects: any[] }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ project_id: '', occurred_on: todayIso(), kind: 'Near Miss', severity: 'Low', description: '', action_taken: '' });
  const load = () => {
    setLoading(true);
    commercialApi.getIncidents().then(r => setRows(r.data)).catch(e => toast.error(apiErrorMessage(e, 'Could not load safety records'))).finally(() => setLoading(false));
  };
  useEffect(load, []);
  const save = async () => {
    try { await commercialApi.addIncident(form); toast.success('Incident recorded'); setOpen(false); load(); }
    catch (error) { toast.error(apiErrorMessage(error, 'Could not record the incident')); }
  };
  const close = async (row: any) => {
    try { await commercialApi.setIncidentStatus(row.id, row.status === 'Open' ? 'Closed' : 'Open', row.action_taken); load(); }
    catch (error) { toast.error(apiErrorMessage(error, 'Could not update the incident')); }
  };
  return (
    <Panel title="Safety and compliance" description="Near misses, injuries and the action taken on site." action={<Button onClick={() => setOpen(true)} className="rounded-xl bg-[#141414] text-white"><Plus className="mr-2 h-4 w-4" />Record incident</Button>}>
      <Card className="rounded-2xl border-none shadow-sm overflow-hidden">
        {loading ? <Loading /> : rows.length === 0 ? <Empty text="No incidents recorded." /> : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>When</TableHead><TableHead>What happened</TableHead><TableHead>Severity</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map(row => (
                  <TableRow key={row.id}>
                    <TableCell>{formatDate(row.occurred_on)}<div className="text-xs text-[#8E9299]">{row.project_name}</div></TableCell>
                    <TableCell><span className="font-bold">{row.kind}.</span> {row.description}<div className="text-xs text-[#8E9299]">{row.action_taken}</div></TableCell>
                    <TableCell><StatusBadge status={row.severity} /></TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                      <Button size="sm" variant="outline" className="mt-2 h-7 rounded-lg" onClick={() => close(row)}>{row.status === 'Open' ? 'Close' : 'Reopen'}</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-3xl">
          <DialogHeader><DialogTitle>Record a site incident</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <ProjectField value={form.project_id} onChange={v => setForm({ ...form, project_id: v })} projects={projects} />
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Date</Label><Input type="date" value={form.occurred_on} onChange={e => setForm({ ...form, occurred_on: e.target.value })} className="bg-[#F5F5F5] border-none rounded-xl h-11" /></div>
              <div className="space-y-2">
                <Label>Kind</Label>
                <Select value={form.kind} onValueChange={v => setForm({ ...form, kind: v })}>
                  <SelectTrigger className="bg-[#F5F5F5] border-none rounded-xl h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>{['Near Miss', 'Injury', 'Property', 'Environmental'].map(k => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Severity</Label>
              <Select value={form.severity} onValueChange={v => setForm({ ...form, severity: v })}>
                <SelectTrigger className="bg-[#F5F5F5] border-none rounded-xl h-11"><SelectValue /></SelectTrigger>
                <SelectContent>{['Low', 'Medium', 'High'].map(k => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>What happened</Label><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="bg-[#F5F5F5] border-none rounded-xl" /></div>
            <div className="space-y-2"><Label>Action taken</Label><Textarea value={form.action_taken} onChange={e => setForm({ ...form, action_taken: e.target.value })} className="bg-[#F5F5F5] border-none rounded-xl" /></div>
          </div>
          <DialogFooter><Button onClick={save} className="rounded-xl bg-[#141414] text-white">Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
