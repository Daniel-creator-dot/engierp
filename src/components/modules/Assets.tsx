import React, { useState, useEffect, useMemo } from 'react';
import {
  Plus,
  MapPin,
  History,
  AlertCircle,
  Loader2,
  Pencil,
  Settings2,
  Undo2,
  CornerDownLeft,
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
import { assetsApi, projectsApi, apiErrorMessage } from '../../lib/api';
import { categoryOptions, useCategories } from '../../lib/catalog';
import { useAuth } from '../../contexts/AuthContext';
import { formatDate, todayIso } from '../../lib/dates';

const DEFAULT = 'default';
const money = (value: unknown) => `GH₵${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS_BADGE: Record<string, string> = {
  Available: 'bg-green-100 text-green-700',
  'On Site': 'bg-blue-100 text-blue-700',
  Maintenance: 'bg-amber-100 text-amber-700',
  Disposed: 'bg-gray-100 text-gray-600',
};

const emptyAsset = {
  name: '', category: '', daily_cost: '', purchase_date: todayIso(), initial_cost: '', residual_value: '0',
  useful_life: '5', location: 'Warehouse', status: 'Available', last_maintenance: '', next_maintenance: '',
};

const mappingFields: [string, string, string[]][] = [
  ['depreciation_expense_id', 'Depreciation expense', ['Expense']],
  ['disposal_gain_loss_id', 'Gain / loss on disposal', ['Expense', 'Income']],
  ['disposal_proceeds_id', 'Disposal proceeds received into', ['Asset']],
  ['default_cost_id', 'Default asset cost account', ['Asset']],
  ['default_accumulated_id', 'Default accumulated depreciation', ['Asset']],
];

export default function Assets() {
  const { user } = useAuth();
  const role = user?.role || '';
  const canFinance = ['admin', 'accountant'].includes(role);
  const canAllocate = ['pm', 'admin', 'accountant'].includes(role);

  const assetCategories = useCategories('asset');
  const [equipment, setEquipment] = useState<any[]>([]);
  const [allocations, setAllocations] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'inventory' | 'allocations' | 'depreciation'>('inventory');

  const [assetForm, setAssetForm] = useState<any>(emptyAsset);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAssetModalOpen, setIsAssetModalOpen] = useState(false);

  const [isAllocModalOpen, setIsAllocModalOpen] = useState(false);
  const [allocForm, setAllocForm] = useState({ equipment_id: '', project_id: '', start_date: todayIso() });
  const [returning, setReturning] = useState<any | null>(null);
  const [returnDate, setReturnDate] = useState(todayIso());

  const [isDepreciateModalOpen, setIsDepreciateModalOpen] = useState(false);
  const [period, setPeriod] = useState(todayIso().slice(0, 7));

  const [disposing, setDisposing] = useState<any | null>(null);
  const [disposeForm, setDisposeForm] = useState({ disposal_date: todayIso(), disposal_value: '', proceeds_account_id: DEFAULT });

  const [isMappingOpen, setIsMappingOpen] = useState(false);
  const [mappingData, setMappingData] = useState<{ mapping: any; accounts: any[]; categories: string[] } | null>(null);
  const [mappingDraft, setMappingDraft] = useState<any>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    const loaders: [string, () => Promise<any>, (data: any) => void][] = [
      ['equipment', assetsApi.getEquipment, setEquipment],
      ['allocations', assetsApi.getAllocations, setAllocations],
      ['projects', projectsApi.getProjects, setProjects],
    ];
    if (canFinance) loaders.push(['depreciation runs', assetsApi.getDepreciationRuns, setRuns]);
    const results = await Promise.allSettled(loaders.map(([, load]) => load()));
    const failures: string[] = [];
    results.forEach((result, i) => {
      const [label, , apply] = loaders[i];
      if (result.status === 'fulfilled') apply(result.value.data);
      else failures.push(`${label}: ${apiErrorMessage(result.reason, 'request failed')}`);
    });
    if (failures.length) toast.error(`Some asset data could not be loaded (${failures.join('; ')})`);
    setIsLoading(false);
  };

  const loadMappings = async () => {
    if (mappingData) return mappingData;
    try {
      const res = await assetsApi.getAccountMappings();
      setMappingData(res.data);
      return res.data;
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Could not load account mappings'));
      return null;
    }
  };

  const accountLabel = (id: unknown) => {
    const a = mappingData?.accounts.find(x => x.id === Number(id));
    return a ? `${a.code} ${a.name}` : 'Not set';
  };

  // ---------------------------------------------------------------- Register

  const openAddAsset = () => {
    setEditingId(null);
    setAssetForm({ ...emptyAsset, purchase_date: todayIso() });
    setIsAssetModalOpen(true);
  };

  const openEditAsset = (item: any) => {
    setEditingId(item.id);
    setAssetForm({
      name: item.name || '',
      category: item.category || '',
      daily_cost: String(item.daily_cost ?? ''),
      purchase_date: item.purchase_date ? String(item.purchase_date).slice(0, 10) : '',
      initial_cost: String(item.initial_cost ?? ''),
      residual_value: String(item.residual_value ?? 0),
      useful_life: String(item.useful_life ?? 5),
      location: item.location || '',
      status: item.status || 'Available',
      last_maintenance: item.last_maintenance ? String(item.last_maintenance).slice(0, 10) : '',
      next_maintenance: item.next_maintenance ? String(item.next_maintenance).slice(0, 10) : '',
    });
    setIsAssetModalOpen(true);
  };

  const editingAsset = editingId ? equipment.find(e => e.id === editingId) : null;
  const editingDisposed = editingAsset?.status === 'Disposed';

  const handleSaveAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assetForm.category) {
      toast.error('Choose a category');
      return;
    }
    const payload: any = {
      name: assetForm.name,
      category: assetForm.category,
      daily_cost: Number(assetForm.daily_cost || 0),
      location: assetForm.location,
      last_maintenance: assetForm.last_maintenance,
      next_maintenance: assetForm.next_maintenance,
    };
    if (!editingDisposed) {
      Object.assign(payload, {
        purchase_date: assetForm.purchase_date,
        initial_cost: Number(assetForm.initial_cost || 0),
        residual_value: Number(assetForm.residual_value || 0),
        useful_life: Number(assetForm.useful_life || 0),
      });
      if (editingId) payload.status = assetForm.status;
    }
    setIsSaving(true);
    try {
      if (editingId) {
        await assetsApi.updateEquipment(editingId, payload);
        toast.success('Equipment record updated');
      } else {
        const res = await assetsApi.addEquipment(payload);
        toast.success(`Asset ${res.data?.id || ''} registered`);
      }
      setIsAssetModalOpen(false);
      fetchData();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to save asset'));
    } finally {
      setIsSaving(false);
    }
  };

  // ---------------------------------------------------------------- Allocations

  const openAllocate = (equipmentId = '') => {
    setAllocForm({ equipment_id: equipmentId, project_id: '', start_date: todayIso() });
    setIsAllocModalOpen(true);
  };

  const handleAllocate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allocForm.equipment_id || !allocForm.project_id) {
      toast.error('Choose the equipment and the project site');
      return;
    }
    setIsSaving(true);
    try {
      await assetsApi.allocateEquipment(allocForm);
      toast.success('Equipment deployed to site');
      setIsAllocModalOpen(false);
      fetchData();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to allocate equipment'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!returning) return;
    setIsSaving(true);
    try {
      await assetsApi.returnAllocation(returning.id, returnDate);
      toast.success(`${returning.equipment_name} returned from site`);
      setReturning(null);
      fetchData();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to return equipment'));
    } finally {
      setIsSaving(false);
    }
  };

  // ---------------------------------------------------------------- Depreciation

  const openDepreciate = () => {
    const last = runs[0]?.period as string | undefined;
    let next = todayIso().slice(0, 7);
    if (last) {
      const [y, m] = last.split('-').map(Number);
      const candidate = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
      if (candidate < next) next = candidate;
    }
    setPeriod(next);
    setIsDepreciateModalOpen(true);
  };

  const depreciationPreview = useMemo(() => {
    if (!/^\d{4}-\d{2}$/.test(period)) return { total: 0, count: 0 };
    const [y, m] = period.split('-').map(Number);
    const end = `${period}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
    const eligible = equipment.filter(a =>
      a.status !== 'Disposed' && !a.fully_depreciated && Number(a.monthly_depreciation) > 0 &&
      (!a.purchase_date || String(a.purchase_date).slice(0, 10) <= end));
    return {
      total: eligible.reduce((s, a) => s + Math.min(Number(a.monthly_depreciation), Number(a.initial_cost) - Number(a.residual_value) - Number(a.accumulated_depreciation)), 0),
      count: eligible.length,
    };
  }, [equipment, period]);

  const alreadyRun = runs.some(r => r.period === period);

  const handleDepreciate = async () => {
    setIsSaving(true);
    try {
      const res = await assetsApi.runDepreciation(period);
      toast.success(res.data?.message || 'Depreciation posted');
      setIsDepreciateModalOpen(false);
      fetchData();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to run depreciation'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleUndoRun = async (run: any) => {
    if (!window.confirm(`Reverse the ${run.period} depreciation of ${money(run.total)}? The journal will be deleted.`)) return;
    try {
      const res = await assetsApi.undoDepreciationRun(run.id);
      toast.success(res.data?.message || 'Depreciation reversed');
      fetchData();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to undo depreciation'));
    }
  };

  // ---------------------------------------------------------------- Disposal

  const openDispose = (item: any) => {
    setDisposing(item);
    setDisposeForm({ disposal_date: todayIso(), disposal_value: '', proceeds_account_id: DEFAULT });
    loadMappings();
  };

  const disposalGainLoss = disposing ? Number(disposeForm.disposal_value || 0) - Number(disposing.net_book_value || 0) : 0;

  const handleDispose = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!disposing) return;
    setIsSaving(true);
    try {
      const res = await assetsApi.dispose(disposing.id, {
        disposal_date: disposeForm.disposal_date,
        disposal_value: Number(disposeForm.disposal_value || 0),
        proceeds_account_id: disposeForm.proceeds_account_id === DEFAULT ? null : Number(disposeForm.proceeds_account_id),
      });
      toast.success(res.data?.message || 'Asset disposed');
      setDisposing(null);
      fetchData();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to dispose asset'));
    } finally {
      setIsSaving(false);
    }
  };

  // ---------------------------------------------------------------- Account mappings

  const openMappings = async () => {
    const data = await loadMappings();
    if (!data) return;
    setMappingDraft(JSON.parse(JSON.stringify(data.mapping)));
    setIsMappingOpen(true);
  };

  const handleSaveMappings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const res = await assetsApi.saveAccountMappings(mappingDraft);
      toast.success('Asset account mappings saved');
      setMappingData(prev => (prev ? { ...prev, mapping: res.data.mapping } : prev));
      setIsMappingOpen(false);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to save mappings'));
    } finally {
      setIsSaving(false);
    }
  };

  const accountOptions = (types: string[]) => (mappingData?.accounts || []).filter(a => types.includes(a.type));

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-[#141414]" />
      </div>
    );
  }

  const activeAssets = equipment.filter(e => e.status !== 'Disposed');
  const totalNbv = activeAssets.reduce((s, e) => s + Number(e.net_book_value || 0), 0);
  const deployable = equipment.filter(e => e.status === 'Available' || e.status === 'On Site');

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[#141414]">Engineering Assets</h1>
          <p className="text-[#8E9299]">Heavy machinery, equipment allocation, and fleet maintenance.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canFinance && (
            <>
              <Button variant="outline" onClick={openMappings} className="gap-2 rounded-xl font-bold">
                <Settings2 className="w-4 h-4" /> Account Mappings
              </Button>
              <Button variant="outline" onClick={openDepreciate} className="gap-2 border-orange-200 text-orange-700 bg-orange-50 hover:bg-orange-100 rounded-xl font-bold">
                <History className="w-4 h-4" /> Run Depreciation
              </Button>
            </>
          )}
          {canAllocate && (
            <Button variant="outline" onClick={() => openAllocate()} className="gap-2 border-[#141414] text-[#141414] rounded-xl font-bold">
              <MapPin className="w-4 h-4" /> Deploy to Site
            </Button>
          )}
          {canFinance && (
            <Button onClick={openAddAsset} className="bg-[#141414] text-white gap-2 rounded-xl font-bold h-11 px-6 shadow-lg shadow-black/10">
              <Plus className="w-4 h-4" /> Add Equipment
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 grid-cols-2 md:grid-cols-4">
        <Card className="border-none shadow-sm rounded-2xl"><CardHeader className="pb-2"><CardDescription className="text-xs uppercase font-bold tracking-wider">Active Units</CardDescription><CardTitle className="text-3xl font-black">{activeAssets.length}</CardTitle></CardHeader></Card>
        <Card className="border-none shadow-sm rounded-2xl"><CardHeader className="pb-2"><CardDescription className="text-xs uppercase font-bold tracking-wider">On Site</CardDescription><CardTitle className="text-3xl font-black text-blue-600">{equipment.filter(e => e.status === 'On Site').length}</CardTitle></CardHeader></Card>
        <Card className="border-none shadow-sm rounded-2xl"><CardHeader className="pb-2"><CardDescription className="text-xs uppercase font-bold tracking-wider">Available / Maintenance</CardDescription><CardTitle className="text-3xl font-black text-green-600">{equipment.filter(e => e.status === 'Available').length}<span className="text-amber-600"> / {equipment.filter(e => e.status === 'Maintenance').length}</span></CardTitle></CardHeader></Card>
        <Card className="border-none shadow-sm rounded-2xl"><CardHeader className="pb-2"><CardDescription className="text-xs uppercase font-bold tracking-wider">Net Book Value</CardDescription><CardTitle className="text-2xl font-black">{money(totalNbv)}</CardTitle></CardHeader></Card>
      </div>

      <Card className="border-none shadow-sm overflow-hidden rounded-2xl">
        <div className="border-b border-[#F5F5F5] px-6 py-4 flex items-center gap-8 bg-[#F5F5F5]/30">
          <button className={`text-sm font-bold transition-all ${activeTab === 'inventory' ? 'text-blue-600 border-b-2 border-blue-600 pb-4 -mb-4' : 'text-[#8E9299]'}`} onClick={() => setActiveTab('inventory')}>Asset Registry</button>
          <button className={`text-sm font-bold transition-all ${activeTab === 'allocations' ? 'text-blue-600 border-b-2 border-blue-600 pb-4 -mb-4' : 'text-[#8E9299]'}`} onClick={() => setActiveTab('allocations')}>Site Allocations</button>
          {canFinance && (
            <button className={`text-sm font-bold transition-all ${activeTab === 'depreciation' ? 'text-blue-600 border-b-2 border-blue-600 pb-4 -mb-4' : 'text-[#8E9299]'}`} onClick={() => setActiveTab('depreciation')}>Depreciation</button>
          )}
        </div>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            {activeTab === 'inventory' && (
              <Table>
                <TableHeader>
                  <TableRow className="bg-[#F5F5F5]/20">
                    <TableHead>Asset ID</TableHead><TableHead>Unit</TableHead><TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Acc. Depr.</TableHead><TableHead className="text-right">Book Value</TableHead>
                    <TableHead>Location</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {equipment.length === 0 && (
                    <TableRow><TableCell colSpan={8} className="text-center text-[#8E9299] py-10">No equipment registered yet.</TableCell></TableRow>
                  )}
                  {equipment.map((item) => (
                    <TableRow key={item.id} className="hover:bg-blue-50/20">
                      <TableCell className="font-mono text-xs font-bold text-blue-600">{item.id}</TableCell>
                      <TableCell>
                        <p className="font-bold text-[#141414]">{item.name}</p>
                        <p className="text-xs text-[#8E9299]">{item.category}{item.purchase_date ? ` · bought ${formatDate(item.purchase_date)}` : ''}</p>
                      </TableCell>
                      <TableCell className="text-right font-bold">{money(item.initial_cost)}</TableCell>
                      <TableCell className="text-right font-mono text-red-600">{money(item.accumulated_depreciation)}</TableCell>
                      <TableCell className="text-right font-black">
                        {money(item.net_book_value)}
                        {item.fully_depreciated && item.status !== 'Disposed' && <p className="text-[10px] font-bold text-[#8E9299] uppercase">Fully depreciated</p>}
                      </TableCell>
                      <TableCell className="text-sm">
                        {item.status === 'Disposed'
                          ? <span className="text-xs text-[#8E9299]">Disposed {formatDate(item.disposal_date)} for {money(item.disposal_value)}</span>
                          : item.current_project_name || item.location || '—'}
                      </TableCell>
                      <TableCell><Badge className={`${STATUS_BADGE[item.status] || 'bg-red-100 text-red-700'} font-bold border-none px-3`}>{item.status}</Badge></TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {canAllocate && ['Available', 'On Site'].includes(item.status) && (
                            <Button variant="ghost" size="icon" onClick={() => openAllocate(item.id)} className="h-8 w-8 hover:bg-white rounded-full" title="Deploy to site">
                              <MapPin className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {canFinance && (
                            <Button variant="ghost" size="icon" onClick={() => openEditAsset(item)} className="h-8 w-8 hover:bg-white rounded-full" title="Edit">
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {canFinance && item.status !== 'Disposed' && (
                            <Button variant="ghost" size="icon" onClick={() => openDispose(item)} className="h-8 w-8 hover:bg-red-50 text-red-600 rounded-full" title="Dispose">
                              <AlertCircle className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {activeTab === 'allocations' && (
              <Table>
                <TableHeader><TableRow className="bg-[#F5F5F5]/20"><TableHead>Asset</TableHead><TableHead>Project Site</TableHead><TableHead>Deployed</TableHead><TableHead>Returned</TableHead><TableHead className="text-right">Status</TableHead></TableRow></TableHeader>
                <TableBody>
                  {allocations.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-[#8E9299] py-10">No equipment has been deployed yet.</TableCell></TableRow>
                  )}
                  {allocations.map((alloc) => (
                    <TableRow key={alloc.id} className="hover:bg-blue-50/20">
                      <TableCell className="font-bold">{alloc.equipment_name || alloc.equipment_id}</TableCell>
                      <TableCell className="font-medium text-[#141414]">{alloc.project_name || alloc.project_id}</TableCell>
                      <TableCell className="text-[#8E9299] text-xs font-bold">{formatDate(alloc.start_date)}</TableCell>
                      <TableCell className="text-[#8E9299] text-xs font-bold">{formatDate(alloc.end_date)}</TableCell>
                      <TableCell className="text-right">
                        {alloc.end_date ? (
                          <Badge className="bg-gray-100 text-gray-600 border-none font-bold">RETURNED</Badge>
                        ) : (
                          <div className="flex justify-end items-center gap-2">
                            <Badge className="bg-blue-50 text-blue-600 border-none font-bold">ON SITE</Badge>
                            {canAllocate && (
                              <Button variant="outline" size="sm" className="gap-1 h-7" onClick={() => { setReturning(alloc); setReturnDate(todayIso()); }}>
                                <CornerDownLeft className="w-3.5 h-3.5" /> Return
                              </Button>
                            )}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {activeTab === 'depreciation' && canFinance && (
              <Table>
                <TableHeader><TableRow className="bg-[#F5F5F5]/20"><TableHead>Month</TableHead><TableHead>Posted</TableHead><TableHead className="text-right">Assets</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Journal</TableHead><TableHead>By</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
                <TableBody>
                  {runs.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-center text-[#8E9299] py-10">No depreciation has been posted yet.</TableCell></TableRow>
                  )}
                  {runs.map((run, index) => (
                    <TableRow key={run.id}>
                      <TableCell className="font-bold">{run.period}</TableCell>
                      <TableCell className="text-xs text-[#8E9299]">{formatDate(String(run.created_at).slice(0, 10))}</TableCell>
                      <TableCell className="text-right">{run.asset_count}</TableCell>
                      <TableCell className="text-right font-bold">{money(run.total)}</TableCell>
                      <TableCell className="font-mono text-xs">{run.journal_id ? `JE-${run.journal_id}` : '—'}</TableCell>
                      <TableCell className="text-xs">{run.created_by_email || '—'}</TableCell>
                      <TableCell className="text-right">
                        {index === 0 && (
                          <Button variant="ghost" size="sm" className="gap-1 text-red-600" onClick={() => handleUndoRun(run)}>
                            <Undo2 className="w-3.5 h-3.5" /> Undo
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Add / edit asset */}
      <Dialog open={isAssetModalOpen} onOpenChange={setIsAssetModalOpen}>
        <DialogContent className="rounded-2xl max-w-lg max-h-[90vh] overflow-y-auto">
          <form onSubmit={handleSaveAsset}>
            <DialogHeader>
              <DialogTitle>{editingId ? `Edit ${editingId}` : 'Register New Equipment'}</DialogTitle>
              <DialogDescription>Straight-line depreciation: (cost − residual value) ÷ useful life, charged monthly.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2"><Label>Unit Name</Label><Input value={assetForm.name} onChange={e => setAssetForm({ ...assetForm, name: e.target.value })} placeholder="e.g. Caterpillar 320 Excavator" required className="bg-[#F5F5F5] border-none font-bold h-11" /></div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Category</Label>
                  <Select value={assetForm.category} onValueChange={v => setAssetForm({ ...assetForm, category: v })}>
                    <SelectTrigger className="bg-[#F5F5F5] border-none h-11"><SelectValue placeholder="Select category..." /></SelectTrigger>
                    <SelectContent>
                      {categoryOptions(assetCategories, assetForm.category).map(name => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2"><Label>Daily Hire Rate (GH₵)</Label><Input type="number" min="0" step="0.01" value={assetForm.daily_cost} onChange={e => setAssetForm({ ...assetForm, daily_cost: e.target.value })} placeholder="0.00" className="bg-[#F5F5F5] border-none font-bold h-11" /></div>
              </div>
              {editingDisposed ? (
                <p className="text-sm text-[#8E9299] bg-[#F5F5F5] rounded-xl p-3">This asset has been disposed, so its cost, depreciation settings and status are locked.</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2"><Label>Purchase Date</Label><Input type="date" value={assetForm.purchase_date} onChange={e => setAssetForm({ ...assetForm, purchase_date: e.target.value })} required className="bg-[#F5F5F5] border-none font-bold h-11" /></div>
                    <div className="grid gap-2"><Label>Cost (GH₵)</Label><Input type="number" min="0" step="0.01" value={assetForm.initial_cost} onChange={e => setAssetForm({ ...assetForm, initial_cost: e.target.value })} required className="bg-[#F5F5F5] border-none font-bold h-11" /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2"><Label>Residual Value (GH₵)</Label><Input type="number" min="0" step="0.01" value={assetForm.residual_value} onChange={e => setAssetForm({ ...assetForm, residual_value: e.target.value })} className="bg-[#F5F5F5] border-none font-bold h-11" /></div>
                    <div className="grid gap-2"><Label>Useful Life (years)</Label><Input type="number" min="0.1" step="0.1" value={assetForm.useful_life} onChange={e => setAssetForm({ ...assetForm, useful_life: e.target.value })} required className="bg-[#F5F5F5] border-none font-bold h-11" /></div>
                  </div>
                  {editingId && (
                    <div className="grid gap-2">
                      <Label>Status</Label>
                      <Select value={assetForm.status} onValueChange={v => setAssetForm({ ...assetForm, status: v })}>
                        <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Available">Available</SelectItem>
                          <SelectItem value="On Site">On Site</SelectItem>
                          <SelectItem value="Maintenance">Maintenance</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </>
              )}
              <div className="grid gap-2"><Label>Location</Label><Input value={assetForm.location} onChange={e => setAssetForm({ ...assetForm, location: e.target.value })} placeholder="Warehouse" className="bg-[#F5F5F5] border-none font-bold h-11" /></div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2"><Label>Last Maintenance</Label><Input type="date" value={assetForm.last_maintenance} onChange={e => setAssetForm({ ...assetForm, last_maintenance: e.target.value })} className="bg-[#F5F5F5] border-none h-11" /></div>
                <div className="grid gap-2"><Label>Next Maintenance</Label><Input type="date" value={assetForm.next_maintenance} onChange={e => setAssetForm({ ...assetForm, next_maintenance: e.target.value })} className="bg-[#F5F5F5] border-none h-11" /></div>
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={isSaving} className="bg-[#141414] text-white w-full rounded-xl font-bold h-11">
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : editingId ? 'Save Changes' : 'Register Asset'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Deploy */}
      <Dialog open={isAllocModalOpen} onOpenChange={setIsAllocModalOpen}>
        <DialogContent className="rounded-2xl">
          <form onSubmit={handleAllocate}>
            <DialogHeader>
              <DialogTitle>Deploy Asset to Site</DialogTitle>
              <DialogDescription>Equipment already on another site is moved; its current deployment ends on the start date.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>Equipment</Label>
                <Select value={allocForm.equipment_id} onValueChange={v => setAllocForm({ ...allocForm, equipment_id: v })}>
                  <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue placeholder="Choose asset..." /></SelectTrigger>
                  <SelectContent>
                    {deployable.map(e => (
                      <SelectItem key={e.id} value={e.id}>{e.name} ({e.id}){e.current_project_name ? ` — at ${e.current_project_name}` : ''}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Project Site</Label>
                <Select value={allocForm.project_id} onValueChange={v => setAllocForm({ ...allocForm, project_id: v })}>
                  <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue placeholder="Select site..." /></SelectTrigger>
                  <SelectContent>
                    {projects.filter(p => p.status !== 'Completed').map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2"><Label>Start Date</Label><Input type="date" value={allocForm.start_date} onChange={e => setAllocForm({ ...allocForm, start_date: e.target.value })} required className="bg-[#F5F5F5] border-none font-bold" /></div>
            </div>
            <DialogFooter><Button type="submit" disabled={isSaving} className="bg-[#141414] text-white w-full rounded-xl font-bold h-11">Confirm Deployment</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Return from site */}
      <Dialog open={!!returning} onOpenChange={open => !open && setReturning(null)}>
        <DialogContent className="rounded-2xl">
          <form onSubmit={handleReturn}>
            <DialogHeader>
              <DialogTitle>Return {returning?.equipment_name}</DialogTitle>
              <DialogDescription>From {returning?.project_name}, deployed {formatDate(returning?.start_date)}.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2 py-4"><Label>Return Date</Label><Input type="date" value={returnDate} onChange={e => setReturnDate(e.target.value)} required className="bg-[#F5F5F5] border-none font-bold" /></div>
            <DialogFooter><Button type="submit" disabled={isSaving} className="bg-[#141414] text-white w-full rounded-xl font-bold h-11">Mark Returned</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Depreciation run */}
      <Dialog open={isDepreciateModalOpen} onOpenChange={setIsDepreciateModalOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>Run Depreciation</DialogTitle>
            <DialogDescription>Posts one month of straight-line depreciation for every active asset. Each month can only be posted once.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2"><Label>Month</Label><Input type="month" value={period} max={todayIso().slice(0, 7)} onChange={e => setPeriod(e.target.value)} className="bg-[#F5F5F5] border-none font-bold" /></div>
            {alreadyRun ? (
              <p className="text-sm text-red-700 bg-red-50 rounded-xl p-3">Depreciation for {period} has already been posted.</p>
            ) : (
              <p className="text-sm bg-[#F5F5F5] rounded-xl p-3">
                About <strong>{money(depreciationPreview.total)}</strong> across {depreciationPreview.count} asset(s), dated the last day of the month.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDepreciateModalOpen(false)}>Cancel</Button>
            <Button onClick={handleDepreciate} disabled={isSaving || alreadyRun || !period} className="bg-orange-600 text-white font-bold">
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Post Depreciation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Disposal */}
      <Dialog open={!!disposing} onOpenChange={open => !open && setDisposing(null)}>
        <DialogContent className="rounded-2xl">
          <form onSubmit={handleDispose}>
            <DialogHeader>
              <DialogTitle>Dispose {disposing?.name}</DialogTitle>
              <DialogDescription>Removes the asset from the register and posts the disposal journal, including any gain or loss.</DialogDescription>
            </DialogHeader>
            {disposing && (
              <div className="py-4 space-y-4">
                <div className="p-4 bg-[#F5F5F5] rounded-xl text-sm grid grid-cols-3 gap-2">
                  <div><p className="text-[10px] uppercase font-bold text-[#8E9299]">Cost</p><p className="font-bold">{money(disposing.initial_cost)}</p></div>
                  <div><p className="text-[10px] uppercase font-bold text-[#8E9299]">Acc. Depr.</p><p className="font-bold">{money(disposing.accumulated_depreciation)}</p></div>
                  <div><p className="text-[10px] uppercase font-bold text-[#8E9299]">Book Value</p><p className="font-bold">{money(disposing.net_book_value)}</p></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2"><Label>Disposal Date</Label><Input type="date" value={disposeForm.disposal_date} onChange={e => setDisposeForm({ ...disposeForm, disposal_date: e.target.value })} required className="bg-[#F5F5F5] border-none font-bold h-11" /></div>
                  <div className="grid gap-2"><Label>Sale Proceeds (GH₵)</Label><Input type="number" min="0" step="0.01" value={disposeForm.disposal_value} onChange={e => setDisposeForm({ ...disposeForm, disposal_value: e.target.value })} placeholder="0.00 if scrapped" className="bg-[#F5F5F5] border-none font-bold h-11" /></div>
                </div>
                {Number(disposeForm.disposal_value) > 0 && (
                  <div className="grid gap-2">
                    <Label>Proceeds received into</Label>
                    <Select value={disposeForm.proceeds_account_id} onValueChange={v => setDisposeForm({ ...disposeForm, proceeds_account_id: v })}>
                      <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={DEFAULT}>Default ({accountLabel(mappingData?.mapping?.disposal_proceeds_id)})</SelectItem>
                        {accountOptions(['Asset']).map(a => <SelectItem key={a.id} value={String(a.id)}>{a.code} {a.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <p className={`text-sm font-bold ${disposalGainLoss >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                  {disposalGainLoss === 0 ? 'Disposed at book value (no gain or loss).' : disposalGainLoss > 0 ? `Gain on disposal: ${money(disposalGainLoss)}` : `Loss on disposal: ${money(-disposalGainLoss)}`}
                </p>
              </div>
            )}
            <DialogFooter><Button type="submit" disabled={isSaving} className="bg-red-600 text-white w-full rounded-xl font-bold h-11">Process Disposal</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Account mappings */}
      <Dialog open={isMappingOpen} onOpenChange={setIsMappingOpen}>
        <DialogContent className="rounded-2xl max-w-2xl max-h-[90vh] overflow-y-auto">
          {mappingDraft && mappingData && (
            <form onSubmit={handleSaveMappings}>
              <DialogHeader>
                <DialogTitle>Asset Account Mappings</DialogTitle>
                <DialogDescription>The ledger accounts depreciation and disposal journals post to. Categories without their own accounts use the defaults.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                {mappingFields.map(([key, label, types]) => (
                  <div key={key} className="grid gap-2">
                    <Label>{label}</Label>
                    <Select value={mappingDraft[key] ? String(mappingDraft[key]) : ''} onValueChange={v => setMappingDraft({ ...mappingDraft, [key]: Number(v) })}>
                      <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue placeholder="Choose account..." /></SelectTrigger>
                      <SelectContent>
                        {accountOptions(types).map(a => <SelectItem key={a.id} value={String(a.id)}>{a.code} {a.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
                {mappingData.categories.length > 0 && (
                  <div className="space-y-2 pt-2">
                    <p className="text-sm font-bold">Per category</p>
                    <Table>
                      <TableHeader><TableRow><TableHead>Category</TableHead><TableHead>Asset cost</TableHead><TableHead>Accumulated depreciation</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {mappingData.categories.map(name => {
                          const cat = mappingDraft.categories?.[name] || {};
                          const setCat = (field: 'cost_id' | 'accumulated_id', v: string) => setMappingDraft({
                            ...mappingDraft,
                            categories: { ...mappingDraft.categories, [name]: { ...cat, [field]: v === DEFAULT ? null : Number(v) } },
                          });
                          return (
                            <TableRow key={name}>
                              <TableCell className="font-medium">{name}</TableCell>
                              {(['cost_id', 'accumulated_id'] as const).map(field => (
                                <TableCell key={field}>
                                  <Select value={cat[field] ? String(cat[field]) : DEFAULT} onValueChange={v => setCat(field, v)}>
                                    <SelectTrigger className="bg-[#F5F5F5] border-none h-9 text-xs"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value={DEFAULT}>Use default</SelectItem>
                                      {accountOptions(['Asset']).map(a => <SelectItem key={a.id} value={String(a.id)}>{a.code} {a.name}</SelectItem>)}
                                    </SelectContent>
                                  </Select>
                                </TableCell>
                              ))}
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsMappingOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={isSaving} className="bg-[#141414] text-white font-bold">Save Mappings</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
