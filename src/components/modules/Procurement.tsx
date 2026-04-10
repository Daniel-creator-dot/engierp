import React, { useState, useEffect } from 'react';
import { 
  Plus, 
  ShoppingCart, 
  Package, 
  Truck, 
  Search,
  MoreVertical,
  CheckCircle2,
  Clock,
  AlertCircle,
  ArrowRight,
  Loader2,
  Building2,
  Phone,
  Mail,
  Star,
  Pencil,
  Printer
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
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '../ui/select';
import { Badge } from '../ui/badge';
import { toast } from 'sonner';
import { procurementApi, projectsApi, settingsApi } from '../../lib/api';

interface ProcurementProps {
  activeSub?: string;
}

export default function Procurement({ activeSub = 'procurement-pos' }: ProcurementProps) {
  const [isAddPOModalOpen, setIsAddPOModalOpen] = useState(false);
  const [isAddSupplierModalOpen, setIsAddSupplierModalOpen] = useState(false);
  const [isEditSupplierModalOpen, setIsEditSupplierModalOpen] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<any | null>(null);
  const [isAddInventoryModalOpen, setIsAddInventoryModalOpen] = useState(false);
  
  const [inventory, setInventory] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [currency, setCurrency] = useState('GHS');
  const [isLoading, setIsLoading] = useState(true);
  const [companySettings, setCompanySettings] = useState<any[]>([]);

  useEffect(() => {
    fetchData();
  }, [activeSub]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const settingsRes = await settingsApi.getSettings();
      setCompanySettings(settingsRes.data);
      const curr = settingsRes.data.find((s: any) => s.key === 'currency')?.value || 'GHS';
      setCurrency(curr);

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
        const [poRes, supRes, projRes] = await Promise.all([
          procurementApi.getPurchaseOrders(),
          procurementApi.getSuppliers(),
          projectsApi.getProjects()
        ]);
        setPurchaseOrders(poRes.data);
        setSuppliers(supRes.data);
        setProjects(projRes.data);
      }
    } catch (error) {
      toast.error('Failed to load procurement data');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreatePO = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    const data = {
      supplier_id: formData.get('supplier_id'),
      project_id: formData.get('project_id'),
      order_date: new Date().toISOString().split('T')[0],
      total_amount: Number(formData.get('amount')),
      items: [
        { name: formData.get('item_name'), quantity: 1, price: Number(formData.get('amount')) }
      ]
    };
    try {
      await procurementApi.createPurchaseOrder(data);
      toast.success('Purchase Order created');
      setIsAddPOModalOpen(false);
      fetchData();
    } catch (error) {
      toast.error('Failed to create PO');
    }
  };

  const handleAddSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    const data = {
      id: `SUP-${Math.floor(1000 + Math.random() * 9000)}`,
      name: formData.get('name'),
      category: formData.get('category'),
      contact_person: formData.get('contact'),
      email: formData.get('email'),
      rating: 5
    };
    try {
      await procurementApi.addSupplier(data);
      toast.success('Supplier onboarded');
      setIsAddSupplierModalOpen(false);
      fetchData();
    } catch (error) {
      toast.error('Failed to onboard supplier');
    }
  };

  const handleEditSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSupplier) return;
    const formData = new FormData(e.target as HTMLFormElement);
    const data = {
      name: formData.get('name'),
      category: formData.get('category'),
      contact_person: formData.get('contact'),
      email: formData.get('email')
    };
    try {
      await procurementApi.updateSupplier(selectedSupplier.id, data);
      toast.success('Supplier profile updated');
      setIsEditSupplierModalOpen(false);
      fetchData();
    } catch (error) {
      toast.error('Failed to update supplier');
    }
  };

  const handleAddInventory = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    const data = {
      id: `INV-${Math.floor(1000 + Math.random() * 9000)}`,
      name: formData.get('name'),
      project_id: formData.get('project_id') || null,
      category: 'Materials',
      quantity: Number(formData.get('quantity')),
      unit: formData.get('unit'),
      reorder_level: Number(formData.get('reorder'))
    };
    try {
      await procurementApi.addInventory(data);
      toast.success('Inventory initialized');
      setIsAddInventoryModalOpen(false);
      fetchData();
    } catch (error) {
      toast.error('Failed to initialize stock');
    }
  };

  const handlePrintDocument = (title: string, content: string) => {
    const getSetting = (key: string) => companySettings.find((s: any) => s.key === key)?.value || '';
    const logo = getSetting('company_logo');
    const signature = getSetting('company_signature');
    const currSym = getSetting('currency') === 'USD' ? '$' : 'GH₵';
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    printWindow.document.write(`
      <html>
        <head>
          <title>${title}</title>
          <style>
            body { font-family: 'Inter', sans-serif; padding: 40px; color: #141414; line-height: 1.5; }
            .header { border-bottom: 2px solid #141414; padding-bottom: 20px; margin-bottom: 40px; display: flex; justify-content: space-between; align-items: center; }
            .logo { max-height: 60px; max-width: 200px; }
            .footer { margin-top: 60px; border-top: 1px solid #E4E3E0; padding-top: 20px; display: flex; justify-content: space-between; }
            .signature { max-height: 60px; }
            .branding-banner { display: flex; flex-direction: column; }
            .address-block { font-size: 0.8rem; color: #8E9299; margin-top: 4px; }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="branding-banner">
              ${logo ? `<img src="${logo}" class="logo" />` : `<h1>${getSetting('company_name') || 'ENGINEERING ERP'}</h1>`}
              <div class="address-block">${getSetting('company_address') || ''}</div>
            </div>
            <div style="text-align: right">
              <h2>${title}</h2>
              <p>Generated: ${new Date().toLocaleDateString()}</p>
            </div>
          </div>
          ${content}
          <div class="footer">
            <div>
              <p>Authorized Signature</p>
              ${signature ? `<img src="${signature}" class="signature" />` : '<div style="height: 60px; width: 200px; border-bottom: 1px solid #000;"></div>'}
            </div>
            <div style="text-align: right; color: #8E9299; font-size: 0.75rem;">
              <p>Digital ERP Hash: ${Math.random().toString(36).substring(7).toUpperCase()}</p>
            </div>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-[#141414]" />
      </div>
    );
  }

  const renderContent = () => {
    const currSym = currency === 'USD' ? '$' : 'GH₵';
    switch (activeSub) {
      case 'procurement-pos':
        return (
          <Card className="border-none shadow-sm rounded-2xl overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between border-b border-[#F5F5F5] bg-[#F5F5F5]/30">
              <div>
                <CardTitle>Purchase Orders</CardTitle>
                <CardDescription>Material procurement lifecycle.</CardDescription>
              </div>
              <Dialog open={isAddPOModalOpen} onOpenChange={setIsAddPOModalOpen}>
                <DialogTrigger asChild>
                  <Button className="bg-[#141414] text-white gap-2 font-bold px-6 rounded-xl h-11"><Plus className="w-4 h-4" />Create PO</Button>
                </DialogTrigger>
                <DialogContent className="rounded-3xl border-none shadow-2xl">
                  <form onSubmit={handleCreatePO}>
                    <DialogHeader><DialogTitle>Execute Purchase Order</DialogTitle></DialogHeader>
                    <div className="grid gap-6 py-6">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Supplier</Label>
                          <Select name="supplier_id" required>
                            <SelectTrigger className="bg-[#F5F5F5] border-none rounded-xl"><SelectValue placeholder="Select supplier..." /></SelectTrigger>
                            <SelectContent className="rounded-xl">
                              {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Project Allocation</Label>
                          <Select name="project_id" required>
                            <SelectTrigger className="bg-[#F5F5F5] border-none rounded-xl"><SelectValue placeholder="Select project..." /></SelectTrigger>
                            <SelectContent className="rounded-xl">
                              {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="space-y-2"><Label>Item Description</Label><Input name="item_name" required className="bg-[#F5F5F5] border-none h-11 rounded-xl" /></div>
                      <div className="space-y-2"><Label>Total Amount ({currSym})</Label><Input name="amount" type="number" required className="bg-[#F5F5F5] border-none h-11 rounded-xl font-bold" /></div>
                    </div>
                    <DialogFooter><Button type="submit" className="bg-blue-600 text-white w-full h-11 rounded-xl shadow-lg shadow-blue-500/20 font-bold">AUTHORIZE PROCUREMENT</Button></DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-[#F5F5F5]/50"><TableHead>PO ID</TableHead><TableHead>Vendor</TableHead><TableHead>Project</TableHead><TableHead className="text-right">Total ({currSym})</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {purchaseOrders.map((po) => (
                    <TableRow key={po.id} className="hover:bg-blue-50/20 transition-colors">
                      <TableCell className="font-black text-blue-600">{po.id}</TableCell>
                      <TableCell className="font-medium">{po.supplier_name}</TableCell>
                      <TableCell className="text-[#8E9299] text-xs font-bold">{po.project_name || 'General Inventory'}</TableCell>
                      <TableCell className="text-right font-black text-[#141414]">{currSym}{Number(po.total_amount).toLocaleString()}</TableCell>
                      <TableCell><Badge className="bg-yellow-50 text-yellow-700 border-none font-bold text-[10px]">{po.status.toUpperCase()}</Badge></TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" className="h-8 w-8 text-blue-600 p-0" onClick={() => handlePrintDocument(`PURCHASE ORDER - ${po.id}`, `<h3>Vendor: ${po.supplier_name}</h3><p>Project: ${po.project_name || 'General Inventory'}</p><p>Status: ${po.status.toUpperCase()}</p><h2 style="color: #141414;">Total Authorized: ${currSym}${Number(po.total_amount).toLocaleString()}</h2>`)}>
                          <Printer className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {purchaseOrders.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-12 text-[#8E9299]">No active purchase orders found.</TableCell></TableRow>}
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
              <div><CardTitle>Site Inventory</CardTitle><CardDescription>Current stock levels at active construction zones.</CardDescription></div>
              <Dialog open={isAddInventoryModalOpen} onOpenChange={setIsAddInventoryModalOpen}>
                <DialogTrigger asChild><Button className="bg-[#141414] text-white gap-2 font-bold px-6 rounded-xl"><Plus className="w-4 h-4" />Stock Receipt</Button></DialogTrigger>
                <DialogContent className="rounded-3xl">
                  <form onSubmit={handleAddInventory}>
                    <DialogHeader><DialogTitle>Initialize Site Stock</DialogTitle></DialogHeader>
                    <div className="grid gap-6 py-6">
                      <div className="space-y-2"><Label>Item Name</Label><Input name="name" required className="bg-[#F5F5F5] border-none rounded-xl h-11" /></div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2"><Label>Quantity</Label><Input name="quantity" type="number" required className="bg-[#F5F5F5] border-none rounded-xl h-11" /></div>
                        <div className="space-y-2"><Label>Unit (e.g. Bags, m3)</Label><Input name="unit" required className="bg-[#F5F5F5] border-none rounded-xl h-11" /></div>
                      </div>
                      <div className="space-y-2">
                        <Label>Site Allocation</Label>
                        <Select name="project_id">
                          <SelectTrigger className="bg-[#F5F5F5] border-none rounded-xl h-11"><SelectValue placeholder="General / Common Stock" /></SelectTrigger>
                          <SelectContent className="rounded-xl">{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2"><Label>Reorder Level</Label><Input name="reorder" type="number" defaultValue="10" className="bg-[#F5F5F5] border-none rounded-xl h-11" /></div>
                    </div>
                    <DialogFooter><Button type="submit" className="bg-blue-600 text-white w-full h-11 rounded-xl font-bold">RECORD INVENTORY</Button></DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-[#F5F5F5]/50"><TableHead>Material Item</TableHead><TableHead>Deployment Site</TableHead><TableHead>Quantity</TableHead><TableHead className="text-right">Integrity Status</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {inventory.map((inv) => (
                      <TableRow key={inv.id} className="hover:bg-blue-50/20">
                        <TableCell className="font-bold text-[#141414]">{inv.name}</TableCell>
                        <TableCell className="text-xs text-[#8E9299] font-medium">{inv.project_name || 'Common Storage'}</TableCell>
                        <TableCell className="font-black">{inv.quantity} {inv.unit}</TableCell>
                        <TableCell className="text-right"><Badge className={inv.quantity > inv.reorder_level ? 'bg-green-100 text-green-700 font-bold px-3 border-none' : 'bg-red-100 text-red-700 font-bold px-3 border-none'}>{inv.quantity > inv.reorder_level ? 'SUFFICIENT' : 'REORDER'}</Badge></TableCell>
                      </TableRow>
                    ))}
                    {inventory.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-12 text-[#8E9299]">Site stockpile is empty.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        );
      case 'procurement-suppliers':
        return (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-bold flex items-center gap-2"><Building2 className="w-5 h-5 text-blue-600" /> Authorized Vendors</h2>
              <Dialog open={isAddSupplierModalOpen} onOpenChange={setIsAddSupplierModalOpen}>
                <DialogTrigger asChild><Button className="bg-[#141414] text-white gap-2 font-bold px-6 rounded-xl transition-all hover:bg-black shadow-lg"><Plus className="w-4 h-4" />Onboard Supplier</Button></DialogTrigger>
                <DialogContent className="rounded-3xl">
                  <form onSubmit={handleAddSupplier}>
                    <DialogHeader><DialogTitle>Supplier Qualification</DialogTitle><DialogDescription>Register a new vetted vendor into the system.</DialogDescription></DialogHeader>
                    <div className="grid gap-6 py-6">
                      <div className="space-y-2"><Label>Enterprise Name</Label><Input name="name" required className="bg-[#F5F5F5] border-none rounded-xl h-11 font-bold" /></div>
                      <div className="space-y-2"><Label>Service Category</Label><Select name="category" required><SelectTrigger className="bg-[#F5F5F5] border-none rounded-xl h-11"><SelectValue placeholder="Specialty..." /></SelectTrigger><SelectContent className="rounded-xl"><SelectItem value="Heavy Materials">Heavy Materials (Stone/Sand)</SelectItem><SelectItem value="Finishing">Finishing & Fixtures</SelectItem><SelectItem value="Plant Hire">Plant & Equipment Hire</SelectItem><SelectItem value="Safety">Safety & PPE</SelectItem></SelectContent></Select></div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2"><Label>Primary Contact</Label><Input name="contact" required className="bg-[#F5F5F5] border-none rounded-xl h-11" /></div>
                        <div className="space-y-2"><Label>Email / Billing</Label><Input name="email" type="email" required className="bg-[#F5F5F5] border-none rounded-xl h-11" /></div>
                      </div>
                    </div>
                    <DialogFooter><Button type="submit" className="bg-blue-600 text-white w-full h-11 rounded-xl font-bold">VERIFY & REGISTER</Button></DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {suppliers.map((s) => (
                <Card key={s.id} className="border-none shadow-sm group hover:shadow-xl hover:shadow-blue-500/5 transition-all duration-300 rounded-2xl overflow-hidden bg-white">
                  <CardHeader className="p-6">
                    <div className="flex justify-between items-start">
                      <div className="p-2 bg-blue-50 rounded-xl"><Building2 className="w-5 h-5 text-blue-600" /></div>
                      <div className="flex gap-2">
                        <Button variant="ghost" size="icon" onClick={() => { setSelectedSupplier(s); setIsEditSupplierModalOpen(true); }} className="h-8 w-8 hover:bg-blue-50 rounded-full">
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Badge className="bg-[#F5F5F5] text-[#141414] border-none font-bold text-[10px] flex items-center gap-1"><Star className="w-3 h-3 fill-yellow-400 text-yellow-400" /> {s.rating}</Badge>
                      </div>
                    </div>
                    <CardTitle className="mt-4 text-lg font-bold">{s.name}</CardTitle>
                    <CardDescription className="text-blue-600 font-bold text-xs uppercase tracking-widest">{s.category}</CardDescription>
                  </CardHeader>
                  <CardContent className="px-6 pb-6 pt-0 space-y-4">
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center gap-2 text-[#8E9299] font-medium"><Phone className="w-3.5 h-3.5" /> <span>{s.contact_person}</span></div>
                      <div className="flex items-center gap-2 text-[#8E9299] font-medium"><Mail className="w-3.5 h-3.5" /> <span>{s.email}</span></div>
                    </div>
                    <Button variant="outline" className="w-full rounded-xl border-[#F5F5F5] font-bold text-xs h-10 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-100 transition-all">VIEW ACCOUNT HISTORY</Button>
                  </CardContent>
                </Card>
              ))}
              {suppliers.length === 0 && <div className="col-span-full py-20 text-center text-[#8E9299] font-medium">No authorized vendors registered.</div>}
            </div>

            <Dialog open={isEditSupplierModalOpen} onOpenChange={setIsEditSupplierModalOpen}>
              <DialogContent className="rounded-3xl">
                {selectedSupplier && (
                  <form onSubmit={handleEditSupplier}>
                    <DialogHeader><DialogTitle>Refine Vendor Credentials</DialogTitle></DialogHeader>
                    <div className="grid gap-6 py-6">
                      <div className="space-y-2"><Label>Enterprise Name</Label><Input name="name" defaultValue={selectedSupplier.name} required /></div>
                      <div className="space-y-2">
                        <Label>Category</Label>
                        <Select name="category" defaultValue={selectedSupplier.category}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                             <SelectItem value="Heavy Materials">Heavy Materials (Stone/Sand)</SelectItem>
                             <SelectItem value="Finishing">Finishing & Fixtures</SelectItem>
                             <SelectItem value="Plant Hire">Plant & Equipment Hire</SelectItem>
                             <SelectItem value="Safety">Safety & PPE</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2"><Label>Primary Contact</Label><Input name="contact" defaultValue={selectedSupplier.contact_person} required /></div>
                        <div className="space-y-2"><Label>Email / Billing</Label><Input name="email" type="email" defaultValue={selectedSupplier.email} required /></div>
                      </div>
                    </div>
                    <DialogFooter><Button type="submit" className="bg-blue-600 text-white w-full h-11 rounded-xl font-bold">COMMIT VENDOR UPDATES</Button></DialogFooter>
                  </form>
                )}
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
          <h1 className="text-4xl font-black tracking-tighter text-[#141414]">Procurement Hub.</h1>
          <p className="text-[#8E9299] text-lg font-medium">Global supply chain and material logistics.</p>
        </div>
      </div>
      {renderContent()}
    </div>
  );
}
