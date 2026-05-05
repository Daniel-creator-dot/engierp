import React, { useState, useEffect } from 'react';
import { 
  Truck, 
  Plus, 
  Calendar, 
  Wrench, 
  MapPin, 
  History, 
  AlertCircle,
  Loader2,
  MoreVertical,
  CheckCircle2,
  Pencil
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
import { assetsApi, projectsApi } from '../../lib/api';

export default function Assets() {
  const [equipment, setEquipment] = useState<any[]>([]);
  const [allocations, setAllocations] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedEquipment, setSelectedEquipment] = useState<any | null>(null);
  const [isAllocModalOpen, setIsAllocModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'inventory' | 'allocations'>('inventory');
  const [isDisposeModalOpen, setIsDisposeModalOpen] = useState(false);
  const [isDepreciateModalOpen, setIsDepreciateModalOpen] = useState(false);
  const [disposeAmount, setDisposeAmount] = useState<string>('');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [equipRes, allocRes, projectsRes] = await Promise.all([
        assetsApi.getEquipment(),
        assetsApi.getAllocations(),
        projectsApi.getProjects()
      ]);
      setEquipment(equipRes.data);
      setAllocations(allocRes.data);
      setProjects(projectsRes.data);
    } catch (error) {
      toast.error('Failed to load asset data');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddEquipment = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    const data = {
      id: `EQ-${Math.floor(1000 + Math.random() * 9000)}`,
      name: formData.get('name'),
      category: formData.get('category'),
      daily_cost: Number(formData.get('daily_cost')),
      status: 'Available',
      acquisition_cost: Number(formData.get('acquisition_cost') || 0),
      useful_life_months: Number(formData.get('useful_life_months') || 60),
      residual_value: Number(formData.get('residual_value') || 0),
      location: formData.get('location') || 'Warehouse'
    };

    try {
      await assetsApi.addEquipment(data);
      toast.success('Asset registered');
      setIsAddModalOpen(false);
      fetchData();
    } catch (error) {
      toast.error('Failed to register asset');
    }
  };

  const handleEditEquipment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEquipment) return;
    const formData = new FormData(e.target as HTMLFormElement);
    const data = {
      name: formData.get('name'),
      category: formData.get('category'),
      daily_cost: Number(formData.get('daily_cost')),
      status: formData.get('status')
    };

    try {
      await assetsApi.updateEquipment(selectedEquipment.id, data);
      toast.success('Equipment record updated');
      setIsEditModalOpen(false);
      fetchData();
    } catch (error) {
      toast.error('Failed to update asset');
    }
  };

  const handleAllocate = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    const data = {
      equipment_id: formData.get('equipment_id'),
      project_id: formData.get('project_id'),
      start_date: formData.get('start_date'),
    };

    try {
      await assetsApi.allocateEquipment(data);
      toast.success('Equipment deployed to site');
      setIsAllocModalOpen(false);
      fetchData();
    } catch (error) {
      toast.error('Failed to allocate equipment');
    }
  };

  const handleDepreciate = async () => {
    try {
      await assetsApi.depreciate();
      toast.success('Depreciation calculated and posted successfully');
      setIsDepreciateModalOpen(false);
      fetchData();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to run depreciation');
    }
  };

  const handleDispose = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEquipment) return;
    try {
      await assetsApi.dispose(selectedEquipment.id, { disposal_amount: Number(disposeAmount) });
      toast.success('Asset disposed successfully');
      setIsDisposeModalOpen(false);
      setDisposeAmount('');
      fetchData();
    } catch (error) {
      toast.error('Failed to dispose asset');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-[#141414]" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[#141414]">Engineering Assets</h1>
          <p className="text-[#8E9299]">Heavy machinery, equipment allocation, and fleet maintenance.</p>
        </div>
        <div className="flex items-center gap-3">
          <Dialog open={isDepreciateModalOpen} onOpenChange={setIsDepreciateModalOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2 border-orange-200 text-orange-700 bg-orange-50 hover:bg-orange-100 rounded-xl font-bold">
                <History className="w-4 h-4" /> Run Depreciation
              </Button>
            </DialogTrigger>
            <DialogContent className="rounded-2xl">
              <DialogHeader><DialogTitle>Run Depreciation</DialogTitle></DialogHeader>
              <p className="text-sm text-[#8E9299]">Calculate and post monthly depreciation for all active assets based on straight-line method.</p>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDepreciateModalOpen(false)}>Cancel</Button>
                <Button onClick={handleDepreciate} className="bg-orange-600 text-white font-bold">Confirm Run</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={isAllocModalOpen} onOpenChange={setIsAllocModalOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2 border-[#141414] text-[#141414] rounded-xl font-bold">
                <MapPin className="w-4 h-4" /> Deploy to Site
              </Button>
            </DialogTrigger>
            <DialogContent className="rounded-2xl">
              <form onSubmit={handleAllocate}>
                <DialogHeader><DialogTitle>Deploy Asset to Site</DialogTitle></DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label>Select Equipment</Label>
                    <Select name="equipment_id" required>
                      <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue placeholder="Choose asset..." /></SelectTrigger>
                      <SelectContent>
                        {equipment.filter(e => e.status === 'Available').map(e => (
                          <SelectItem key={e.id} value={e.id}>{e.name} ({e.id})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Project Site</Label>
                    <Select name="project_id" required>
                      <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue placeholder="Select site..." /></SelectTrigger>
                      <SelectContent>
                        {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2"><Label>Start Date</Label><Input type="date" name="start_date" defaultValue={new Date().toISOString().split('T')[0]} required className="bg-[#F5F5F5] border-none font-bold" /></div>
                </div>
                <DialogFooter><Button type="submit" className="bg-[#141414] text-white w-full rounded-xl font-bold h-11">Confirm Deployment</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
            <DialogTrigger asChild>
              <Button className="bg-[#141414] text-white gap-2 rounded-xl font-bold h-11 px-6 shadow-lg shadow-black/10">
                <Plus className="w-4 h-4" /> Add Equipment
              </Button>
            </DialogTrigger>
            <DialogContent className="rounded-2xl">
              <form onSubmit={handleAddEquipment}>
                <DialogHeader><DialogTitle>Register New Equipment</DialogTitle></DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2"><Label>Unit Name</Label><Input name="name" placeholder="e.g. Caterpillar 320 Excavator" required className="bg-[#F5F5F5] border-none font-bold h-11" /></div>
                  <div className="grid gap-2">
                    <Label>Category</Label>
                    <Select name="category" required>
                      <SelectTrigger className="bg-[#F5F5F5] border-none h-11"><SelectValue placeholder="Select category..." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Earthmoving">Earthmoving</SelectItem>
                        <SelectItem value="Lifting">Lifting & Cranes</SelectItem>
                        <SelectItem value="Vehicles">Heavy Vehicles</SelectItem>
                        <SelectItem value="Tools">Power Tools</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2"><Label>Daily Cost Rate (GH₵)</Label><Input name="daily_cost" type="number" placeholder="0.00" required className="bg-[#F5F5F5] border-none font-bold h-11" /></div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="grid gap-2"><Label>Acquisition Cost</Label><Input name="acquisition_cost" type="number" required className="bg-[#F5F5F5] border-none font-bold h-11" /></div>
                    <div className="grid gap-2"><Label>Residual Value</Label><Input name="residual_value" type="number" defaultValue="0" className="bg-[#F5F5F5] border-none font-bold h-11" /></div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="grid gap-2"><Label>Useful Life (Months)</Label><Input name="useful_life_months" type="number" defaultValue="60" required className="bg-[#F5F5F5] border-none font-bold h-11" /></div>
                    <div className="grid gap-2"><Label>Location</Label><Input name="location" defaultValue="Warehouse" className="bg-[#F5F5F5] border-none font-bold h-11" /></div>
                  </div>
                </div>
                <DialogFooter><Button type="submit" className="bg-[#141414] text-white w-full rounded-xl font-bold h-11">Register Asset</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid gap-6 grid-cols-2 md:grid-cols-4">
        <Card className="border-none shadow-sm rounded-2xl"><CardHeader className="pb-2"><CardDescription className="text-xs uppercase font-bold tracking-wider">Total Units</CardDescription><CardTitle className="text-3xl font-black">{equipment.length}</CardTitle></CardHeader></Card>
        <Card className="border-none shadow-sm rounded-2xl"><CardHeader className="pb-2"><CardDescription className="text-xs uppercase font-bold tracking-wider">On Site</CardDescription><CardTitle className="text-3xl font-black text-blue-600">{equipment.filter(e => e.status === 'On Site').length}</CardTitle></CardHeader></Card>
        <Card className="border-none shadow-sm rounded-2xl"><CardHeader className="pb-2"><CardDescription className="text-xs uppercase font-bold tracking-wider">Available</CardDescription><CardTitle className="text-3xl font-black text-green-600">{equipment.filter(e => e.status === 'Available').length}</CardTitle></CardHeader></Card>
        <Card className="border-none shadow-sm rounded-2xl"><CardHeader className="pb-2"><CardDescription className="text-xs uppercase font-bold tracking-wider">Maintenance</CardDescription><CardTitle className="text-3xl font-black text-red-600">{equipment.filter(e => e.status === 'Maintenance').length}</CardTitle></CardHeader></Card>
      </div>

      <Card className="border-none shadow-sm overflow-hidden rounded-2xl">
        <div className="border-b border-[#F5F5F5] px-6 py-4 flex items-center gap-8 bg-[#F5F5F5]/30">
          <button className={`text-sm font-bold transition-all ${activeTab === 'inventory' ? 'text-blue-600 border-b-2 border-blue-600 pb-4 -mb-4' : 'text-[#8E9299]'}`} onClick={() => setActiveTab('inventory')}>Asset Registry</button>
          <button className={`text-sm font-bold transition-all ${activeTab === 'allocations' ? 'text-blue-600 border-b-2 border-blue-600 pb-4 -mb-4' : 'text-[#8E9299]'}`} onClick={() => setActiveTab('allocations')}>Site Allocations</button>
        </div>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            {activeTab === 'inventory' ? (
              <Table>
                <TableHeader><TableRow className="bg-[#F5F5F5]/20"><TableHead>Asset ID</TableHead><TableHead>Unit Name</TableHead><TableHead>Cost</TableHead><TableHead>Acc. Depr.</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
                <TableBody>
                  {equipment.map((item) => (
                    <TableRow key={item.id} className="hover:bg-blue-50/20">
                      <TableCell className="font-mono text-xs font-bold text-blue-600">{item.id}</TableCell>
                      <TableCell className="font-bold text-[#141414]">{item.name}</TableCell>
                      <TableCell className="font-black text-[#141414]">GH₵{Number(item.acquisition_cost || 0).toLocaleString()}</TableCell>
                      <TableCell className="font-mono text-red-600">GH₵{Number(item.accumulated_depreciation || 0).toLocaleString()}</TableCell>
                      <TableCell><Badge className={item.status === 'Available' ? 'bg-green-100 text-green-700 font-bold border-none px-3' : item.status === 'On Site' ? 'bg-blue-100 text-blue-700 font-bold border-none px-3' : item.status === 'Disposed' ? 'bg-gray-100 text-gray-700 font-bold border-none px-3' : 'bg-red-100 text-red-700 font-bold border-none px-3'}>{item.status}</Badge></TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => { setSelectedEquipment(item); setIsEditModalOpen(true); }} className="h-8 w-8 hover:bg-white rounded-full">
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          {item.status !== 'Disposed' && (
                            <Button variant="ghost" size="icon" onClick={() => { setSelectedEquipment(item); setIsDisposeModalOpen(true); }} className="h-8 w-8 hover:bg-red-50 text-red-600 rounded-full">
                              <AlertCircle className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <Table>
                <TableHeader><TableRow className="bg-[#F5F5F5]/20"><TableHead>Asset</TableHead><TableHead>Project Site</TableHead><TableHead>Deployed Date</TableHead><TableHead className="text-right">Status</TableHead></TableRow></TableHeader>
                <TableBody>
                  {allocations.map((alloc) => (
                    <TableRow key={alloc.id} className="hover:bg-blue-50/20">
                      <TableCell className="font-bold">{alloc.equipment_name}</TableCell>
                      <TableCell className="font-medium text-[#141414]">{alloc.project_name}</TableCell>
                      <TableCell className="text-[#8E9299] text-xs font-bold">{new Date(alloc.start_date).toLocaleDateString()}</TableCell>
                      <TableCell className="text-right"><Badge className="bg-blue-50 text-blue-600 border-none font-bold">ACTIVE DEPLOYMENT</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent className="rounded-2xl">
          {selectedEquipment && (
            <form onSubmit={handleEditEquipment}>
              <DialogHeader><DialogTitle>Refine Asset Profile</DialogTitle></DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2"><Label>Unit Name</Label><Input name="name" defaultValue={selectedEquipment.name} required /></div>
                <div className="grid gap-2">
                  <Label>Category</Label>
                  <Select name="category" defaultValue={selectedEquipment.category}>
                    <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Earthmoving">Earthmoving</SelectItem>
                      <SelectItem value="Lifting">Lifting & Cranes</SelectItem>
                      <SelectItem value="Vehicles">Heavy Vehicles</SelectItem>
                      <SelectItem value="Tools">Power Tools</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2"><Label>Daily Cost Rate (GH₵)</Label><Input name="daily_cost" type="number" defaultValue={selectedEquipment.daily_cost} required /></div>
                <div className="grid gap-2">
                  <Label>Status</Label>
                  <Select name="status" defaultValue={selectedEquipment.status}>
                    <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Available">Available</SelectItem>
                      <SelectItem value="On Site">On Site</SelectItem>
                      <SelectItem value="Maintenance">Maintenance</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter><Button type="submit" className="bg-blue-600 text-white w-full rounded-xl font-bold h-11">COMMIT SYSTEM UPDATES</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={isDisposeModalOpen} onOpenChange={setIsDisposeModalOpen}>
        <DialogContent className="rounded-2xl">
          <form onSubmit={handleDispose}>
            <DialogHeader><DialogTitle>Dispose Asset</DialogTitle></DialogHeader>
            <div className="py-4 space-y-4">
              {selectedEquipment && (
                <div className="p-4 bg-[#F5F5F5] rounded-xl text-sm">
                  <p><strong>{selectedEquipment.name}</strong></p>
                  <p>Net Book Value: GH₵{(Number(selectedEquipment.acquisition_cost || 0) - Number(selectedEquipment.accumulated_depreciation || 0)).toLocaleString()}</p>
                </div>
              )}
              <div className="grid gap-2">
                <Label>Disposal Amount (Sale Value)</Label>
                <Input type="number" required value={disposeAmount} onChange={e => setDisposeAmount(e.target.value)} placeholder="0.00" className="bg-[#F5F5F5] border-none font-bold h-11" />
              </div>
            </div>
            <DialogFooter><Button type="submit" className="bg-red-600 text-white w-full rounded-xl font-bold h-11">Process Disposal</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
