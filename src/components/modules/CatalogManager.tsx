import React, { useEffect, useMemo, useState } from 'react';
import { Archive, ArchiveRestore, Loader2, Pencil, Plus, Tags, Trash2, Wrench } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { toast } from 'sonner';
import { accountingApi, catalogApi, CategoryType } from '../../lib/api';
import { canManageCategories, Category, CATEGORY_TYPE_LABELS, editableCategoryTypes, notifyCategoriesChanged, Service } from '../../lib/catalog';
import { formatCurrency } from '../../lib/currency';
import { useAuth } from '../../contexts/AuthContext';

const CATEGORY_TYPE_HINTS: Record<CategoryType, string> = {
  expense: 'Used when recording supplier bills (e.g. Food, Fuel, Transport).',
  supplier: 'Used to classify suppliers in Procurement.',
  inventory: 'Used when recording site stock.',
  asset: 'Used when registering equipment.',
  service: 'Used to group the services you sell.',
};

const errorMessage = (error: any, fallback: string) => error?.response?.data?.message || fallback;

interface CatalogManagerProps {
  currency: string;
}

export default function CatalogManager({ currency }: CatalogManagerProps) {
  const { user } = useAuth();
  // Admins/accountants manage everything; other roles (e.g. procurement) can
  // only add and rename the category types they use, and never touch services.
  const fullAccess = canManageCategories(user?.role);
  const categoryTypes = useMemo(() => editableCategoryTypes(user?.role), [user?.role]);

  const [categories, setCategories] = useState<Category[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [expenseAccounts, setExpenseAccounts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [typeFilter, setTypeFilter] = useState<CategoryType | 'all'>('all');

  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [categoryForm, setCategoryForm] = useState({ name: '', type: 'expense' as CategoryType, description: '', account_id: 'none' });

  const [serviceDialogOpen, setServiceDialogOpen] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [serviceForm, setServiceForm] = useState({ name: '', category_id: 'none', unit: 'job', default_price: '', description: '' });

  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    setIsLoading(true);
    try {
      const [catRes, svcRes, coaRes] = await Promise.all([
        catalogApi.getCategories(),
        fullAccess ? catalogApi.getServices() : Promise.resolve({ data: [] as Service[] }),
        fullAccess ? accountingApi.getCOA() : Promise.resolve({ data: [] as any[] }),
      ]);
      setCategories((catRes.data as Category[]).filter(c => categoryTypes.includes(c.type)));
      setServices(svcRes.data);
      setExpenseAccounts(coaRes.data.filter((a: any) => a.type === 'Expense'));
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to load categories and services'));
    } finally {
      setIsLoading(false);
    }
  };

  const visibleCategories = useMemo(
    () => typeFilter === 'all' ? categories : categories.filter(c => c.type === typeFilter),
    [categories, typeFilter]
  );
  const serviceCategories = categories.filter(c => c.type === 'service' && c.is_active);

  const openNewCategory = () => {
    setEditingCategory(null);
    setCategoryForm({ name: '', type: typeFilter === 'all' ? categoryTypes[0] : typeFilter, description: '', account_id: 'none' });
    setCategoryDialogOpen(true);
  };

  const openEditCategory = (category: Category) => {
    setEditingCategory(category);
    setCategoryForm({
      name: category.name,
      type: category.type,
      description: category.description || '',
      account_id: category.account_id ? String(category.account_id) : 'none',
    });
    setCategoryDialogOpen(true);
  };

  const saveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    const payload = {
      name: categoryForm.name,
      type: categoryForm.type,
      description: categoryForm.description,
      account_id: categoryForm.account_id,
    };
    try {
      if (editingCategory) {
        await catalogApi.updateCategory(editingCategory.id, payload);
        toast.success('Category updated');
      } else {
        await catalogApi.createCategory(payload);
        toast.success('Category added');
      }
      notifyCategoriesChanged(categoryForm.type);
      setCategoryDialogOpen(false);
      loadAll();
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to save category'));
    } finally {
      setIsSaving(false);
    }
  };

  const toggleCategoryActive = async (category: Category) => {
    try {
      await catalogApi.updateCategory(category.id, { is_active: !category.is_active });
      toast.success(category.is_active ? 'Category archived' : 'Category restored');
      loadAll();
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to update category'));
    }
  };

  const deleteCategory = async (category: Category) => {
    if (!window.confirm(`Delete the category "${category.name}"? This cannot be undone.`)) return;
    try {
      await catalogApi.deleteCategory(category.id);
      toast.success('Category deleted');
      loadAll();
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to delete category'));
    }
  };

  const openNewService = () => {
    setEditingService(null);
    setServiceForm({ name: '', category_id: 'none', unit: 'job', default_price: '', description: '' });
    setServiceDialogOpen(true);
  };

  const openEditService = (service: Service) => {
    setEditingService(service);
    setServiceForm({
      name: service.name,
      category_id: service.category_id ? String(service.category_id) : 'none',
      unit: service.unit || 'job',
      default_price: String(service.default_price ?? ''),
      description: service.description || '',
    });
    setServiceDialogOpen(true);
  };

  const saveService = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    const payload = { ...serviceForm, default_price: Number(serviceForm.default_price || 0) };
    try {
      if (editingService) {
        await catalogApi.updateService(editingService.id, payload);
        toast.success('Service updated');
      } else {
        await catalogApi.createService(payload);
        toast.success('Service added');
      }
      setServiceDialogOpen(false);
      loadAll();
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to save service'));
    } finally {
      setIsSaving(false);
    }
  };

  const toggleServiceActive = async (service: Service) => {
    try {
      await catalogApi.updateService(service.id, { is_active: !service.is_active });
      toast.success(service.is_active ? 'Service archived' : 'Service restored');
      loadAll();
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to update service'));
    }
  };

  const deleteService = async (service: Service) => {
    if (!window.confirm(`Delete the service "${service.name}"? This cannot be undone.`)) return;
    try {
      await catalogApi.deleteService(service.id);
      toast.success('Service deleted');
      loadAll();
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to delete service'));
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
      </div>
    );
  }

  const statusBadge = (active: boolean) => (
    <Badge className={active ? 'bg-green-100 text-green-700 border-none font-bold' : 'bg-[#F5F5F5] text-[#8E9299] border-none font-bold'}>
      {active ? 'ACTIVE' : 'ARCHIVED'}
    </Badge>
  );

  return (
    <div className="space-y-6">
      <Card className="border-none shadow-sm overflow-hidden">
        <CardHeader className="bg-[#F5F5F5]/30 border-b border-[#F5F5F5] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2"><Tags className="w-5 h-5 text-blue-600" /> Categories</CardTitle>
            <CardDescription>Lists used in dropdowns across the system. Archived categories stay on existing records but can't be picked for new ones.</CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <Select value={typeFilter} onValueChange={(v: any) => setTypeFilter(v)}>
              <SelectTrigger className="w-44 bg-white border-none shadow-sm rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {categoryTypes.map(t => <SelectItem key={t} value={t}>{CATEGORY_TYPE_LABELS[t]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button onClick={openNewCategory} className="bg-[#141414] text-white gap-2 rounded-xl px-6"><Plus className="w-4 h-4" /> Add Category</Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-[#F5F5F5]/50">
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Ledger Account</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleCategories.map(c => (
                  <TableRow key={c.id} className={c.is_active ? '' : 'opacity-60'}>
                    <TableCell>
                      <p className="font-bold text-[#141414]">{c.name}</p>
                      {c.description && <p className="text-xs text-[#8E9299]">{c.description}</p>}
                    </TableCell>
                    <TableCell><Badge variant="outline" className="rounded-lg font-bold uppercase text-[10px]">{CATEGORY_TYPE_LABELS[c.type] || c.type}</Badge></TableCell>
                    <TableCell className="text-xs text-[#8E9299]">{c.account_code ? `${c.account_code} - ${c.account_name}` : '—'}</TableCell>
                    <TableCell>{statusBadge(c.is_active)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button variant="ghost" size="icon" title="Edit" onClick={() => openEditCategory(c)} className="h-8 w-8 rounded-full"><Pencil className="w-3.5 h-3.5" /></Button>
                      {fullAccess && (
                        <>
                          <Button variant="ghost" size="icon" title={c.is_active ? 'Archive' : 'Restore'} onClick={() => toggleCategoryActive(c)} className="h-8 w-8 rounded-full">
                            {c.is_active ? <Archive className="w-3.5 h-3.5" /> : <ArchiveRestore className="w-3.5 h-3.5" />}
                          </Button>
                          <Button variant="ghost" size="icon" title="Delete" onClick={() => deleteCategory(c)} className="h-8 w-8 rounded-full text-red-500 hover:bg-red-50"><Trash2 className="w-3.5 h-3.5" /></Button>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {visibleCategories.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center py-10 text-[#8E9299]">No categories yet.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {fullAccess && (
      <Card className="border-none shadow-sm overflow-hidden">
        <CardHeader className="bg-[#F5F5F5]/30 border-b border-[#F5F5F5] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2"><Wrench className="w-5 h-5 text-blue-600" /> Services</CardTitle>
            <CardDescription>Services you sell. Pick them on sales invoices to fill in the description and price automatically.</CardDescription>
          </div>
          <Button onClick={openNewService} className="bg-[#141414] text-white gap-2 rounded-xl px-6"><Plus className="w-4 h-4" /> Add Service</Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-[#F5F5F5]/50">
                  <TableHead>Service</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Default Price</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {services.map(s => (
                  <TableRow key={s.id} className={s.is_active ? '' : 'opacity-60'}>
                    <TableCell>
                      <p className="font-bold text-[#141414]">{s.name}</p>
                      {s.description && <p className="text-xs text-[#8E9299]">{s.description}</p>}
                    </TableCell>
                    <TableCell className="text-xs text-[#8E9299]">{s.category_name || '—'}</TableCell>
                    <TableCell className="text-xs">{s.unit}</TableCell>
                    <TableCell className="text-right font-bold">{formatCurrency(Number(s.default_price), currency)}</TableCell>
                    <TableCell>{statusBadge(s.is_active)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button variant="ghost" size="icon" title="Edit" onClick={() => openEditService(s)} className="h-8 w-8 rounded-full"><Pencil className="w-3.5 h-3.5" /></Button>
                      <Button variant="ghost" size="icon" title={s.is_active ? 'Archive' : 'Restore'} onClick={() => toggleServiceActive(s)} className="h-8 w-8 rounded-full">
                        {s.is_active ? <Archive className="w-3.5 h-3.5" /> : <ArchiveRestore className="w-3.5 h-3.5" />}
                      </Button>
                      <Button variant="ghost" size="icon" title="Delete" onClick={() => deleteService(s)} className="h-8 w-8 rounded-full text-red-500 hover:bg-red-50"><Trash2 className="w-3.5 h-3.5" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
                {services.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center py-10 text-[#8E9299]">No services yet. Add the services you sell to speed up invoicing.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      )}

      <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
        <DialogContent className="rounded-2xl">
          <form onSubmit={saveCategory}>
            <DialogHeader>
              <DialogTitle>{editingCategory ? 'Edit Category' : 'New Category'}</DialogTitle>
              <DialogDescription>{CATEGORY_TYPE_HINTS[categoryForm.type]}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={categoryForm.name} onChange={e => setCategoryForm({ ...categoryForm, name: e.target.value })} placeholder="e.g. Food & Refreshments" required className="bg-[#F5F5F5] border-none rounded-xl h-11" />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={categoryForm.type} onValueChange={(v: any) => setCategoryForm({ ...categoryForm, type: v })} disabled={!!editingCategory}>
                  <SelectTrigger className="bg-[#F5F5F5] border-none rounded-xl h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {categoryTypes.map(t => <SelectItem key={t} value={t}>{CATEGORY_TYPE_LABELS[t]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {categoryForm.type === 'expense' && (
                <div className="space-y-2">
                  <Label>Default Ledger Account (optional)</Label>
                  <Select value={categoryForm.account_id} onValueChange={v => setCategoryForm({ ...categoryForm, account_id: v })}>
                    <SelectTrigger className="bg-[#F5F5F5] border-none rounded-xl h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No default account</SelectItem>
                      {expenseAccounts.map(a => <SelectItem key={a.id} value={String(a.id)}>{a.code} - {a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-[#8E9299]">Picking this category on a supplier bill will pre-select this account.</p>
                </div>
              )}
              <div className="space-y-2">
                <Label>Description (optional)</Label>
                <Input value={categoryForm.description} onChange={e => setCategoryForm({ ...categoryForm, description: e.target.value })} className="bg-[#F5F5F5] border-none rounded-xl h-11" />
              </div>
              {editingCategory && editingCategory.type !== 'service' && editingCategory.name !== categoryForm.name && (
                <p className="text-xs text-blue-700 bg-blue-50 p-3 rounded-xl">Existing records using "{editingCategory.name}" will be renamed too.</p>
              )}
            </div>
            <DialogFooter>
              <Button type="submit" className="bg-[#141414] text-white w-full rounded-xl" disabled={isSaving}>{editingCategory ? 'Save Changes' : 'Add Category'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={serviceDialogOpen} onOpenChange={setServiceDialogOpen}>
        <DialogContent className="rounded-2xl">
          <form onSubmit={saveService}>
            <DialogHeader>
              <DialogTitle>{editingService ? 'Edit Service' : 'New Service'}</DialogTitle>
              <DialogDescription>The default price can still be changed on each invoice.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label>Service Name</Label>
                <Input value={serviceForm.name} onChange={e => setServiceForm({ ...serviceForm, name: e.target.value })} placeholder="e.g. Site Supervision" required className="bg-[#F5F5F5] border-none rounded-xl h-11" />
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={serviceForm.category_id} onValueChange={v => setServiceForm({ ...serviceForm, category_id: v })}>
                  <SelectTrigger className="bg-[#F5F5F5] border-none rounded-xl h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Uncategorised</SelectItem>
                    {serviceCategories.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Unit</Label>
                  <Input value={serviceForm.unit} onChange={e => setServiceForm({ ...serviceForm, unit: e.target.value })} placeholder="e.g. hour, day, job" className="bg-[#F5F5F5] border-none rounded-xl h-11" />
                </div>
                <div className="space-y-2">
                  <Label>Default Price</Label>
                  <Input type="number" min="0" step="0.01" value={serviceForm.default_price} onChange={e => setServiceForm({ ...serviceForm, default_price: e.target.value })} required className="bg-[#F5F5F5] border-none rounded-xl h-11" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Description (optional)</Label>
                <Input value={serviceForm.description} onChange={e => setServiceForm({ ...serviceForm, description: e.target.value })} className="bg-[#F5F5F5] border-none rounded-xl h-11" />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" className="bg-[#141414] text-white w-full rounded-xl" disabled={isSaving}>{editingService ? 'Save Changes' : 'Add Service'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
