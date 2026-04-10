import React, { useState, useEffect } from 'react';
import { 
  Plus, 
  Briefcase, 
  BarChart3, 
  FileText, 
  Layers,
  Search,
  MoreVertical,
  TrendingUp,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Calculator,
  ArrowRight,
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
  Tabs, 
  TabsContent, 
  TabsList, 
  TabsTrigger 
} from '../ui/tabs';
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
import { Progress } from '../ui/progress';
import { toast } from 'sonner';
import { projectsApi, contractsApi, settingsApi } from '../../lib/api';

interface ProjectsProps {
  activeSub?: string;
}

export default function Projects({ activeSub = 'projects-active' }: ProjectsProps) {
  const [projects, setProjects] = useState<any[]>([]);
  const [wipReport, setWipReport] = useState<any[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);
  const [costingData, setCostingData] = useState<any>(null);
  
  const [isLoading, setIsLoading] = useState(true);
  const [isAddProjectModalOpen, setIsAddProjectModalOpen] = useState(false);
  const [isEditProjectModalOpen, setIsEditProjectModalOpen] = useState(false);
  const [isRegisterContractOpen, setIsRegisterContractOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<any | null>(null);
  const [settings, setSettings] = useState<any[]>([]);

  useEffect(() => {
    fetchData();
  }, [activeSub]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const settingsRes = await settingsApi.getSettings();
      setSettings(settingsRes.data);

      if (activeSub === 'projects-active') {
        const res = await projectsApi.getProjects();
        setProjects(res.data);
      } else if (activeSub === 'projects-costing') {
        const res = await projectsApi.getProjects();
        setProjects(res.data);
      } else if (activeSub === 'projects-contracts') {
        const res = await contractsApi.getContracts();
        setContracts(res.data);
      } else if (activeSub === 'projects-wip') {
        const res = await projectsApi.getWIPReport();
        setWipReport(res.data);
      }
    } catch (error) {
      toast.error('Failed to load project data');
    } finally {
      setIsLoading(false);
    }
  };

  const getSetting = (key: string) => settings.find(s => s.key === key)?.value || '';
  const currSym = getSetting('currency') === 'USD' ? '$' : 'GH₵';

  const fetchJobCosting = async (id: string) => {
    try {
      const res = await projectsApi.getJobCosting(id);
      setCostingData(res.data);
    } catch (error) {
      toast.error('Failed to load costing analytics');
    }
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    const data = {
      id: `PRJ-${Math.floor(100 + Math.random() * 900)}`,
      name: formData.get('name'),
      client: formData.get('client'),
      budget: Number(formData.get('budget')),
      startDate: formData.get('startDate'),
      endDate: formData.get('endDate') || 'TBD',
      status: formData.get('status'),
      manager: 'Current User',
      profitability: 0
    };
    try {
      await projectsApi.createProject(data);
      toast.success('Project initialized');
      setIsAddProjectModalOpen(false);
      fetchData();
    } catch (error) {
      toast.error('Failed to initialize project');
    }
  };

  const handleEditProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject) return;
    const formData = new FormData(e.target as HTMLFormElement);
    const data = {
      name: formData.get('name'),
      client: formData.get('client'),
      budget: Number(formData.get('budget')),
      startDate: formData.get('startDate'),
      endDate: formData.get('endDate'),
      status: formData.get('status')
    };
    try {
      await projectsApi.updateProject(selectedProject.id, data);
      toast.success('Project constraints updated');
      setIsEditProjectModalOpen(false);
      fetchData();
    } catch (error) {
      toast.error('Failed to update project');
    }
  };

  const handleRegisterContract = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    const data = {
      id: `CONT-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`,
      project_id: formData.get('project_id'),
      name: formData.get('name'),
      value: Number(formData.get('value')),
      retention_pct: Number(formData.get('retention_pct') || 10),
      status: 'Active'
    };

    try {
      await contractsApi.createContract(data);
      toast.success('Service contract registered');
      setIsRegisterContractOpen(false);
      fetchData();
    } catch (error) {
      toast.error('Failed to register contract');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  const renderContent = () => {
    switch (activeSub) {
      case 'projects-active':
        return (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <Card key={project.id} className="border-none shadow-sm overflow-hidden group hover:shadow-xl hover:shadow-blue-500/10 transition-all rounded-3xl bg-white">
                <CardHeader className="pb-4">
                  <div className="flex justify-between items-start">
                    <Badge className={
                      project.status === 'In Progress' ? 'bg-blue-100 text-blue-600 border-none' : 
                      project.status === 'On Hold' ? 'bg-yellow-100 text-yellow-700 border-none' : 
                      'bg-green-100 text-green-700 border-none'
                    }>
                      {project.status.toUpperCase()}
                    </Badge>
                    <Button variant="ghost" size="icon" onClick={() => { setSelectedProject(project); setIsEditProjectModalOpen(true); }} className="h-8 w-8 hover:bg-[#F5F5F5] rounded-full">
                      <Pencil className="w-4 h-4" />
                    </Button>
                  </div>
                  <CardTitle className="mt-4 text-xl font-bold">{project.name}</CardTitle>
                  <CardDescription className="font-medium text-[#8E9299]">{project.client}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-3">
                    <div className="flex justify-between text-xs font-bold uppercase tracking-widest text-[#8E9299]">
                      <span>Budget Utilization</span>
                      <span>{Math.round((Number(project.spent || 0) / Number(project.budget || 1)) * 100)}%</span>
                    </div>
                    <Progress value={(Number(project.spent || 0) / Number(project.budget || 1)) * 100} className="h-2 bg-[#F5F5F5]" />
                  </div>
                  <div className="grid grid-cols-2 gap-4 py-4 border-t border-[#F5F5F5]">
                    <div>
                      <p className="text-[10px] text-[#8E9299] uppercase font-bold tracking-widest">Actual Spent</p>
                      <p className="text-lg font-black text-[#141414]">{currSym}{Number(project.spent || 0).toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-[#8E9299] uppercase font-bold tracking-widest">Profitability</p>
                      <p className="text-lg font-black text-green-600">+{project.profitability}%</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] font-bold text-[#8E9299] uppercase tracking-wider">
                    <Clock className="w-3.5 h-3.5" />
                    <span>Handoff: {project.endDate}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        );
      case 'projects-costing':
        return (
          <div className="grid gap-6 lg:grid-cols-4">
            <Card className="lg:col-span-1 border-none shadow-sm rounded-3xl bg-white overflow-hidden">
              <CardHeader className="bg-[#F5F5F5]/30"><CardTitle className="text-sm font-bold uppercase text-[#8E9299]">Target Job</CardTitle></CardHeader>
              <CardContent className="p-0">
                {projects.map(p => (
                  <button 
                    key={p.id} 
                    onClick={() => { setSelectedProject(p); fetchJobCosting(p.id); }}
                    className={`w-full text-left p-4 border-b border-[#F5F5F5] hover:bg-blue-50 transition-colors ${selectedProject?.id === p.id ? 'bg-blue-50 border-r-4 border-r-blue-600' : ''}`}
                  >
                    <p className="font-bold text-sm">{p.name}</p>
                    <p className="text-[10px] text-[#8E9299]">{p.client}</p>
                  </button>
                ))}
              </CardContent>
            </Card>
            <Card className="lg:col-span-3 border-none shadow-sm rounded-3xl bg-white overflow-hidden">
              {costingData ? (
                <>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                      <CardTitle>Job Cost Breakdown: {costingData.project_name}</CardTitle>
                      <CardDescription>Fiscal vs Budget variance by category.</CardDescription>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-bold text-[#8E9299] uppercase">Project Health</p>
                      <Badge className="bg-green-100 text-green-700 border-none font-bold">ON BUDGET</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader><TableRow><TableHead>Cost Category</TableHead><TableHead className="text-right">Actual to Date</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {costingData.actuals.map((c: any, i: number) => (
                            <TableRow key={i}>
                              <TableCell className="font-medium text-[#141414]">{c.category}</TableCell>
                              <TableCell className="text-right font-bold">{currSym}{c.amount.toLocaleString()}</TableCell>
                            </TableRow>
                          ))}
                          <TableRow className="bg-[#F5F5F5]/50 font-black">
                            <TableCell>Total Committed Cost</TableCell>
                            <TableCell className="text-right">{currSym}{costingData.actuals.reduce((s:any,c:any)=>s+c.amount,0).toLocaleString()}</TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center p-20 text-[#8E9299]">
                  <Calculator className="w-12 h-12 mb-4 opacity-20" />
                  <p className="font-medium">Select a project to analyze job costing</p>
                </div>
              )}
            </Card>
          </div>
        );
      case 'projects-contracts':
        return (
          <Card className="border-none shadow-sm rounded-3xl bg-white overflow-hidden">
            <CardHeader className="bg-[#F5F5F5]/30 flex flex-row items-center justify-between">
              <div><CardTitle>Master Service Agreements</CardTitle><CardDescription>Contractual values and retention tracking.</CardDescription></div>
              <Dialog open={isRegisterContractOpen} onOpenChange={setIsRegisterContractOpen}>
                <DialogTrigger asChild><Button className="bg-[#141414] text-white rounded-xl gap-2 font-bold px-6"><Plus className="w-4 h-4" /> Register contract</Button></DialogTrigger>
                <DialogContent>
                  <form onSubmit={handleRegisterContract}>
                    <DialogHeader><DialogTitle>New Service Contract</DialogTitle></DialogHeader>
                    <div className="p-4 space-y-4">
                      <div className="grid gap-2"><Label>Contract Heading</Label><Input name="name" required /></div>
                      <div className="grid gap-2">
                        <Label>Project Mapping</Label>
                        <Select name="project_id" required>
                          <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue placeholder="Map to project..." /></SelectTrigger>
                          <SelectContent>
                            {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2"><Label>Value ({currSym})</Label><Input name="value" type="number" required /></div>
                        <div className="grid gap-2"><Label>Retention %</Label><Input name="retention_pct" type="number" defaultValue="10" /></div>
                      </div>
                    </div>
                    <DialogFooter><Button type="submit" className="bg-blue-600 text-white w-full rounded-xl font-bold">INITIALIZE SERVICE AGREEMENT</Button></DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow className="bg-[#F5F5F5]/50"><TableHead>Contract Ref</TableHead><TableHead>Project</TableHead><TableHead>Value</TableHead><TableHead>Retention ({currSym})</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {contracts.map(c => (
                      <TableRow key={c.id}>
                        <TableCell className="font-bold text-blue-600">{c.id}</TableCell>
                        <TableCell className="font-medium">{c.project_name}</TableCell>
                        <TableCell className="font-bold text-[#141414]">{currSym}{Number(c.value).toLocaleString()}</TableCell>
                        <TableCell className="text-[#8E9299] underline decoration-dotted font-medium">{currSym}{Number(c.retention_amount).toLocaleString()}</TableCell>
                        <TableCell><Badge className="bg-blue-100 text-blue-700 font-bold">{c.status.toUpperCase()}</Badge></TableCell>
                      </TableRow>
                    ))}
                    {contracts.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-12 text-[#8E9299]">No executive contracts initialized.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        );
      case 'projects-wip':
        return (
          <Card className="border-none shadow-sm rounded-3xl bg-white overflow-hidden">
            <CardHeader className="bg-[#F5F5F5]/30"><CardTitle>Work-in-Progress (WIP) Position</CardTitle><CardDescription>Earned vs Billed revenue recognition.</CardDescription></CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-[#F5F5F5]/50">
                      <TableHead>Project</TableHead>
                      <TableHead>Completion %</TableHead>
                      <TableHead>Earned Revenue</TableHead>
                      <TableHead>Billed Revenue</TableHead>
                      <TableHead className="text-right">Net Position</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {wipReport.map((w, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-bold">{w.project_name}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress value={Number(w.poc)} className="w-20 h-1.5" />
                            <span className="text-xs font-bold">{w.poc}%</span>
                          </div>
                        </TableCell>
                        <TableCell className="font-medium text-[#141414]">{currSym}{Number(w.earned_revenue).toLocaleString()}</TableCell>
                        <TableCell className="font-medium text-[#141414]">{currSym}{Number(w.billed_revenue).toLocaleString()}</TableCell>
                        <TableCell className="text-right">
                          <Badge className={w.over_under_billing >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}>
                            {w.over_under_billing >= 0 ? 'Underbilled Asset' : 'Overbilled Liability'}
                          </Badge>
                          <p className="text-[10px] font-bold mt-1">{currSym}{Math.abs(w.over_under_billing).toLocaleString()}</p>
                        </TableCell>
                      </TableRow>
                    ))}
                    {wipReport.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-12 text-[#8E9299]">No active WIP data available for recording.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-black tracking-tighter text-[#141414]">Project Governance.</h1>
          <p className="text-[#8E9299] text-lg font-medium">Monitoring heavy infrastructure delivery and financial integrity.</p>
        </div>
        <div className="flex items-center gap-3">
          <Dialog open={isAddProjectModalOpen} onOpenChange={setIsAddProjectModalOpen}>
            <DialogTrigger asChild>
              <Button className="bg-blue-600 text-white gap-2 h-12 px-8 rounded-2xl shadow-xl shadow-blue-500/20 font-bold hover:bg-blue-700 transition-all">
                <Plus className="w-4 h-4" /> Initialize Job
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl bg-white border-none shadow-2xl rounded-3xl p-0 overflow-hidden">
              <form onSubmit={handleCreateProject}>
                <DialogHeader className="p-8 bg-blue-50">
                  <DialogTitle className="text-2xl font-bold text-blue-900 leading-none">New Project Charter</DialogTitle>
                  <DialogDescription className="text-blue-700 mt-2">Establish baseline constraints and fiscal budget.</DialogDescription>
                </DialogHeader>
                <div className="p-8 space-y-6">
                  <div className="space-y-2">
                    <Label className="font-bold text-xs uppercase tracking-widest text-[#8E9299]">Project Identification</Label>
                    <Input name="name" placeholder="e.g. Volta Dam Expansion Phase II" required className="h-12 bg-[#F5F5F5] border-none rounded-xl font-bold" />
                  </div>
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label className="font-bold text-xs uppercase tracking-widest text-[#8E9299]">Stakeholder / Client</Label>
                      <Input name="client" placeholder="City Water Dept" required className="h-12 bg-[#F5F5F5] border-none rounded-xl" />
                    </div>
                    <div className="space-y-2">
                      <Label className="font-bold text-xs uppercase tracking-widest text-[#8E9299]">Operational Status</Label>
                      <Select name="status" defaultValue="Planning">
                        <SelectTrigger className="h-12 bg-[#F5F5F5] border-none rounded-xl font-bold"><SelectValue /></SelectTrigger>
                        <SelectContent className="rounded-xl border-none shadow-2xl">
                          <SelectItem value="Planning">Pre-Construction</SelectItem>
                          <SelectItem value="In Progress">Executive Phase</SelectItem>
                          <SelectItem value="On Hold">Force Majeure / Hold</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label className="font-bold text-xs uppercase tracking-widest text-[#8E9299]">Total Fiscal Budget ({currSym})</Label>
                      <Input name="budget" type="number" placeholder="1000000" required className="h-12 bg-[#F5F5F5] border-none rounded-xl font-black text-blue-600" />
                    </div>
                    <div className="space-y-2">
                      <Label className="font-bold text-xs uppercase tracking-widest text-[#8E9299]">Commencement Date</Label>
                      <Input name="startDate" type="date" required className="h-12 bg-[#F5F5F5] border-none rounded-xl" />
                    </div>
                  </div>
                </div>
                <DialogFooter className="p-8 border-t border-[#F5F5F5] bg-[#F5F5F5]/30">
                  <Button type="button" variant="ghost" className="rounded-xl h-12 px-6" onClick={() => setIsAddProjectModalOpen(false)}>Cancel</Button>
                  <Button type="submit" className="bg-blue-600 text-white rounded-xl h-12 px-10 font-bold shadow-lg shadow-blue-500/20">AUTHORIZE PROJECT</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog open={isEditProjectModalOpen} onOpenChange={setIsEditProjectModalOpen}>
            <DialogContent className="max-w-2xl">
              {selectedProject && (
                <form onSubmit={handleEditProject}>
                  <DialogHeader><DialogTitle>Refine Project Charter</DialogTitle></DialogHeader>
                  <div className="p-8 space-y-6">
                    <div className="space-y-2"><Label>Title</Label><Input name="name" defaultValue={selectedProject.name} required /></div>
                    <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-2"><Label>Client</Label><Input name="client" defaultValue={selectedProject.client} required /></div>
                      <div className="space-y-2">
                        <Label>Status</Label>
                        <Select name="status" defaultValue={selectedProject.status}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Planning">Pre-Construction</SelectItem>
                            <SelectItem value="In Progress">Executive Phase</SelectItem>
                            <SelectItem value="On Hold">Force Majeure / Hold</SelectItem>
                            <SelectItem value="Completed">Decommissioned</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-6">
                      <div className="space-y-2"><Label>Budget</Label><Input name="budget" type="number" defaultValue={selectedProject.budget} required /></div>
                      <div className="space-y-2"><Label>Start</Label><Input name="startDate" type="date" defaultValue={selectedProject.startDate} required /></div>
                      <div className="space-y-2"><Label>End</Label><Input name="endDate" type="date" defaultValue={selectedProject.endDate} required /></div>
                    </div>
                  </div>
                  <DialogFooter><Button type="submit" className="bg-blue-600 text-white w-full h-12 rounded-xl font-bold">COMMIT REVISIONS</Button></DialogFooter>
                </form>
              )}
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="w-full">
        {renderContent()}
      </div>
    </div>
  );
}
