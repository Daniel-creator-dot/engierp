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
  Pencil,
  ChevronLeft,
  ChevronRight,
  Printer,
  Trash2
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
import { projectsApi, contractsApi, settingsApi, apiErrorMessage } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { escapeHtml } from '../../lib/html';
import { printDocument } from '../../lib/printDocument';
import { formatDate, todayIso } from '../../lib/dates';
import { formatWithSymbol } from '../../lib/currency';

interface ProjectsProps {
  activeSub?: string;
}

const PROJECT_STATUSES = ['Planning', 'In Progress', 'On Hold', 'Completed'] as const;

const statusBadgeClass = (status: string) =>
  status === 'In Progress' ? 'bg-blue-100 text-blue-600 border-none' :
  status === 'On Hold' ? 'bg-yellow-100 text-yellow-700 border-none' :
  status === 'Completed' ? 'bg-green-100 text-green-700 border-none' :
  'bg-slate-100 text-slate-700 border-none';

interface BudgetDraftLine {
  account_id: string;
  amount: string;
  notes: string;
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
  const { user } = useAuth();
  const [costAccounts, setCostAccounts] = useState<any[]>([]);
  const [isBudgetModalOpen, setIsBudgetModalOpen] = useState(false);
  const [budgetDraft, setBudgetDraft] = useState<BudgetDraftLine[]>([]);
  const [isSavingBudget, setIsSavingBudget] = useState(false);
  
  // Search & Pagination State
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    fetchData();
    setCurrentPage(1); // Reset page on tab change
  }, [activeSub]);

  // Reset page when search query changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  const fetchData = async () => {
    setIsLoading(true);
    settingsApi.getSettings()
      .then(res => setSettings(res.data))
      .catch(error => toast.error(apiErrorMessage(error, 'Failed to load company settings')));
    try {
      if (activeSub === 'projects-active') {
        const res = await projectsApi.getProjects();
        setProjects(res.data);
      } else if (activeSub === 'projects-costing') {
        const [res, accountsRes] = await Promise.all([
          projectsApi.getProjects(),
          projectsApi.getCostAccounts().catch(() => ({ data: [] })),
        ]);
        setProjects(res.data);
        setCostAccounts(accountsRes.data);
      } else if (activeSub === 'projects-contracts') {
        const [res, projRes] = await Promise.all([contractsApi.getContracts(), projectsApi.getProjects()]);
        setContracts(res.data);
        setProjects(projRes.data);
      } else if (activeSub === 'projects-wip') {
        const res = await projectsApi.getWIPReport();
        setWipReport(res.data);
      }
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to load project data'));
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
      toast.error(apiErrorMessage(error, 'Failed to load job cost report'));
    }
  };

  const openBudgetEditor = () => {
    if (!costingData) return;
    const lines = (costingData.categories || [])
      .filter((c: any) => Number(c.budget) > 0)
      .map((c: any) => ({ account_id: String(c.account_id), amount: String(c.budget), notes: c.notes || '' }));
    setBudgetDraft(lines.length ? lines : [{ account_id: '', amount: '', notes: '' }]);
    setIsBudgetModalOpen(true);
  };

  const handleSaveBudget = async () => {
    if (!costingData) return;
    const lines = budgetDraft
      .filter(l => l.account_id && Number(l.amount) > 0)
      .map(l => ({ account_id: Number(l.account_id), amount: Number(l.amount), notes: l.notes || undefined }));
    const ids = lines.map(l => l.account_id);
    if (new Set(ids).size !== ids.length) {
      toast.error('Each cost account can only appear once');
      return;
    }
    setIsSavingBudget(true);
    try {
      await projectsApi.saveBudgetLines(costingData.project_id, lines);
      toast.success('Budget saved');
      setIsBudgetModalOpen(false);
      fetchJobCosting(costingData.project_id);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to save budget'));
    } finally {
      setIsSavingBudget(false);
    }
  };

  const money = (value: unknown) => formatWithSymbol(value, currSym);

  const handlePrintJobCost = () => {
    if (!costingData) return;
    const d = costingData;
    const rows = (d.categories || []).map((c: any) => `
      <tr>
        <td>${escapeHtml(c.code)}</td>
        <td>${escapeHtml(c.name)}</td>
        <td class="num">${escapeHtml(money(c.budget))}</td>
        <td class="num">${escapeHtml(money(c.actual))}</td>
        <td class="num ${c.variance < 0 ? 'neg' : ''}">${escapeHtml(money(c.variance))}</td>
        <td class="num">${c.budget > 0 ? escapeHtml(((c.actual / c.budget) * 100).toFixed(1)) + '%' : '—'}</td>
      </tr>`).join('');
    const commitments = (d.commitments || []).map((po: any) => `
      <tr>
        <td>${escapeHtml(po.id)}</td>
        <td>${escapeHtml(po.supplier_name || '')}</td>
        <td>${escapeHtml(formatDate(po.order_date))}</td>
        <td>${escapeHtml(po.status)}</td>
        <td class="num">${escapeHtml(money(po.total_amount))}</td>
      </tr>`).join('');
    const totalBudget = (d.categories || []).reduce((s: number, c: any) => s + Number(c.budget || 0), 0);

    printDocument({
      title: 'JOB COST REPORT',
      docNumber: `${d.project_id} · ${todayIso()}`,
      settings,
      printedBy: user?.email,
      signature: false,
      bodyHtml: `
        <div class="grid">
          <div class="box">
            <h4>Project</h4>
            <div><strong>${escapeHtml(d.project_name)}</strong> (${escapeHtml(d.project_id)})</div>
            <div>Client: ${escapeHtml(d.client || '—')}</div>
            <div>Manager: ${escapeHtml(d.manager || '—')}</div>
            <div>Status: ${escapeHtml(d.status || '—')} · ${escapeHtml(Number(d.completion_rate || 0).toFixed(1))}% complete</div>
          </div>
          <div class="box">
            <h4>Summary</h4>
            <table>
              <tr><td>Project budget</td><td class="num">${escapeHtml(money(d.revised_budget))}</td></tr>
              <tr><td>Actual cost to date</td><td class="num">${escapeHtml(money(d.total_actuals))}</td></tr>
              <tr><td>Open commitments (POs)</td><td class="num">${escapeHtml(money(d.total_committed))}</td></tr>
              <tr><td><strong>Budget remaining</strong></td><td class="num ${d.budget_remaining < 0 ? 'neg' : ''}"><strong>${escapeHtml(money(d.budget_remaining))}</strong></td></tr>
              <tr><td>Revenue billed / received</td><td class="num">${escapeHtml(money(d.revenue_billed))} / ${escapeHtml(money(d.revenue_paid))}</td></tr>
            </table>
          </div>
        </div>
        <h4>Budget vs actual by cost account</h4>
        <table>
          <thead><tr><th>Code</th><th>Cost account</th><th class="num">Budget</th><th class="num">Actual</th><th class="num">Variance</th><th class="num">Used</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="6">No budget lines or costs recorded yet.</td></tr>'}</tbody>
          <tfoot>
            <tr class="totals"><td></td><td>Total</td><td class="num">${escapeHtml(money(totalBudget))}</td><td class="num">${escapeHtml(money(d.total_actuals))}</td><td class="num">${escapeHtml(money(totalBudget - d.total_actuals))}</td><td></td></tr>
          </tfoot>
        </table>
        ${Number(d.unallocated_budget) !== 0 ? `<p class="muted">Budget not yet split across cost accounts: ${escapeHtml(money(d.unallocated_budget))}</p>` : ''}
        ${commitments ? `
          <h4 style="margin-top:24px">Open purchase order commitments</h4>
          <table>
            <thead><tr><th>PO</th><th>Supplier</th><th>Date</th><th>Status</th><th class="num">Amount</th></tr></thead>
            <tbody>${commitments}</tbody>
          </table>` : ''}
      `,
    });
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    const data = {
      id: String(formData.get('project_id') || '').trim().toUpperCase(),
      name: formData.get('name'),
      client: formData.get('client'),
      budget: Number(formData.get('budget')),
      startDate: formData.get('startDate'),
      endDate: formData.get('endDate') || 'TBD',
      status: formData.get('status'),
      manager: formData.get('manager') || user?.email,
    };
    try {
      await projectsApi.createProject(data);
      toast.success('Project created');
      setIsAddProjectModalOpen(false);
      fetchData();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to create project'));
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
      status: formData.get('status'),
      manager: formData.get('manager'),
      completion_rate: Number(formData.get('completion_rate'))
    };
    try {
      await projectsApi.updateProject(selectedProject.id, data);
      toast.success('Project updated');
      setIsEditProjectModalOpen(false);
      fetchData();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to update project'));
    }
  };

  const handleRegisterContract = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    const data = {
      project_id: formData.get('project_id'),
      name: formData.get('name'),
      value: Number(formData.get('value')),
      // Sent as typed so an explicit 0% is kept; the server applies 10% only when blank.
      retention_pct: formData.get('retention_pct'),
      status: 'Active'
    };

    try {
      await contractsApi.createContract(data);
      toast.success('Contract registered');
      setIsRegisterContractOpen(false);
      fetchData();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to register contract'));
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
    const q = searchQuery.toLowerCase();

    // Mapping items per page
    const itemsPerPage = activeSub === 'projects-active' ? 6 : 10;

    switch (activeSub) {
      case 'projects-active': {
        const filtered = projects.filter(p => 
          p.name?.toLowerCase().includes(q) || 
          p.client?.toLowerCase().includes(q) ||
          p.id?.toLowerCase().includes(q)
        );
        const totalPages = Math.ceil(filtered.length / itemsPerPage);
        const paginated = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

        return (
          <div className="space-y-8">
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {paginated.map((project) => (
                <Card key={project.id} className="border-none shadow-sm overflow-hidden group hover:shadow-xl hover:shadow-blue-500/10 transition-all rounded-3xl bg-white">
                  <CardHeader className="pb-4">
                    <div className="flex justify-between items-start">
                      <Badge className={statusBadgeClass(project.status)}>
                        {String(project.status || '').toUpperCase()}
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
                        <span>Budget Burn</span>
                        <span>{Math.round(((Number(project.spent || 0) + Number(project.committed || 0)) / Number(project.revised_budget || project.budget || 1)) * 100)}%</span>
                      </div>
                      <Progress value={((Number(project.spent || 0) + Number(project.committed || 0)) / Number(project.revised_budget || project.budget || 1)) * 100} className="h-2 bg-[#F5F5F5]" />
                    </div>
                    <div className="grid grid-cols-2 gap-4 py-4 border-t border-[#F5F5F5]">
                      <div>
                        <p className="text-[10px] text-[#8E9299] uppercase font-bold tracking-widest mb-1">Spent + Committed</p>
                        <p className="text-lg font-black text-[#141414]">{money((Number(project.spent || 0) + Number(project.committed || 0)))}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-[#8E9299] uppercase font-bold tracking-widest mb-1">Remaining Budget</p>
                        <p className={`text-lg font-black ${Number(project.budget_remaining || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {money(Number(project.budget_remaining || 0))}
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4 pt-4 border-t border-[#F5F5F5]">
                      <div>
                        <p className="text-[10px] text-[#8E9299] uppercase font-bold tracking-widest mb-1">Revenue Billed</p>
                        <p className="text-sm font-black text-[#141414]">{money(Number(project.revenue || 0))}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-[#8E9299] uppercase font-bold tracking-widest mb-1">Received</p>
                        <p className="text-sm font-black text-green-600">{money(Number(project.revenue_paid || 0))}</p>
                      </div>
                    </div>
                    <div className="pt-4 border-t border-[#F5F5F5] flex justify-between items-center">
                      <span className="text-xs font-bold uppercase text-[#8E9299]">Gross Margin (billed − cost)</span>
                      <span className={`text-xl font-black ${Number(project.revenue || 0) - Number(project.spent || 0) >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                        {money((Number(project.revenue || 0) - Number(project.spent || 0)))}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] font-bold text-[#8E9299] uppercase tracking-wider">
                      <Clock className="w-3.5 h-3.5" />
                      <span>Handover: {project.endDate && project.endDate !== 'TBD' ? formatDate(project.endDate) : 'TBD'}</span>
                      {project.manager && <span className="ml-auto normal-case">PM: {project.manager}</span>}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            {totalPages > 1 && <PaginationControls total={totalPages} current={currentPage} setPage={setCurrentPage} />}
          </div>
        );
      }
      case 'projects-costing': {
        const filtered = projects.filter(p => 
          p.name?.toLowerCase().includes(q) || 
          p.client?.toLowerCase().includes(q)
        );
        return (
          <div className="flex flex-col gap-6">
            {/* Project Selector - Horizontal on Mobile, Sidebar on Desktop */}
            <div className="lg:grid lg:grid-cols-4 gap-6">
              <Card className="lg:col-span-1 border-none shadow-sm rounded-3xl bg-white overflow-hidden h-fit">
                <div className="p-4 bg-[#F5F5F5]/30 border-b border-[#F5F5F5] lg:hidden">
                  <p className="text-[10px] font-black text-[#8E9299] uppercase tracking-widest">Select Project</p>
                </div>
                <CardContent className="p-0 flex lg:flex-col overflow-x-auto lg:overflow-y-auto lg:max-h-[600px] no-scrollbar">
                  {filtered.map(p => (
                    <button 
                      key={p.id} 
                      onClick={() => { setSelectedProject(p); fetchJobCosting(p.id); }}
                      className={`flex-none lg:w-full text-left p-4 border-b border-[#F5F5F5] hover:bg-blue-50 transition-all ${selectedProject?.id === p.id ? 'bg-blue-50 border-r-0 lg:border-r-4 border-r-blue-600 font-bold' : 'text-[#8E9299]'}`}
                    >
                      <p className="font-bold text-sm truncate max-w-[150px] lg:max-w-full text-[#141414]">{p.name}</p>
                      <p className="text-[10px] opacity-70">{p.client}</p>
                    </button>
                  ))}
                </CardContent>
              </Card>
              <Card className="lg:col-span-3 border-none shadow-sm rounded-3xl bg-white overflow-hidden">
                {costingData ? (
                  <>
                    <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-2">
                      <div>
                        <CardTitle className="text-xl lg:text-2xl font-black">Project Governance: {costingData.project_name}</CardTitle>
                        <CardDescription>Real-time fiscal position against authorized budget.</CardDescription>
                      </div>
                      <div className="flex items-center gap-3 sm:text-right">
                        <div>
                          <p className="text-[10px] font-bold text-[#8E9299] uppercase tracking-widest">Project Health</p>
                          <Badge className={costingData.budget_remaining >= 0 ? "bg-green-100 text-green-700 border-none font-bold" : "bg-red-100 text-red-700 border-none font-bold"}>
                            {costingData.budget_remaining >= 0 ? "ON BUDGET" : "OVER BUDGET"}
                          </Badge>
                        </div>
                        <Button variant="outline" size="sm" className="rounded-xl gap-1" onClick={openBudgetEditor}>
                          <Pencil className="w-3.5 h-3.5" /> Budget
                        </Button>
                        <Button variant="outline" size="sm" className="rounded-xl gap-1" onClick={handlePrintJobCost}>
                          <Printer className="w-3.5 h-3.5" /> Print
                        </Button>
                      </div>
                    </CardHeader>
                  <CardContent className="space-y-6">
                    {/* Governance Summary Cards */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 px-4 lg:px-6 py-2">
                      <div className="bg-[#F5F5F5]/50 p-4 rounded-2xl border border-white">
                        <p className="text-[9px] lg:text-[10px] font-black text-[#8E9299] uppercase mb-1">Total Budget</p>
                        <p className="text-base lg:text-xl font-black text-[#141414]">{money(Number(costingData.revised_budget))}</p>
                      </div>
                      <div className="bg-[#F5F5F5]/50 p-4 rounded-2xl border border-white">
                        <p className="text-[9px] lg:text-[10px] font-black text-[#8E9299] uppercase mb-1">Spent to Date</p>
                        <p className="text-base lg:text-xl font-black text-orange-600">{money(Number(costingData.total_actuals))}</p>
                      </div>
                      <div className="bg-[#F5F5F5]/50 p-4 rounded-2xl border border-white">
                        <p className="text-[9px] lg:text-[10px] font-black text-[#8E9299] uppercase mb-1">Open Commitments</p>
                        <p className="text-base lg:text-xl font-black text-blue-600">{money(Number(costingData.total_committed))}</p>
                      </div>
                      <div className="bg-[#141414] p-4 rounded-2xl shadow-xl shadow-slate-200">
                        <p className="text-[9px] lg:text-[10px] font-black text-white/50 uppercase mb-1">Budget Remaining</p>
                        <p className={`text-base lg:text-xl font-black ${costingData.budget_remaining >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {money(Number(costingData.budget_remaining))}
                        </p>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-[#F5F5F5]/50 border-none">
                            <TableHead className="font-bold text-xs uppercase">Cost Account</TableHead>
                            <TableHead className="text-right font-bold text-xs uppercase">Budget</TableHead>
                            <TableHead className="text-right font-bold text-xs uppercase">Actual to Date</TableHead>
                            <TableHead className="text-right font-bold text-xs uppercase">Variance</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(costingData.categories || []).map((c: any) => (
                            <TableRow key={c.account_id} className="hover:bg-slate-50 transition-colors">
                              <TableCell className="font-medium text-[#141414]">
                                <span className="text-xs text-[#8E9299] mr-2">{c.code}</span>{c.name}
                              </TableCell>
                              <TableCell className="text-right">{c.budget ? money(c.budget) : '—'}</TableCell>
                              <TableCell className="text-right font-bold">{money(c.actual)}</TableCell>
                              <TableCell className={`text-right font-bold ${c.variance < 0 ? 'text-red-600' : 'text-green-600'}`}>{money(c.variance)}</TableCell>
                            </TableRow>
                          ))}
                          {(costingData.categories || []).length === 0 && (
                            <TableRow><TableCell colSpan={4} className="text-center py-8 text-[#8E9299]">No costs posted to this project yet. Use "Budget" to split the budget across cost accounts.</TableCell></TableRow>
                          )}
                          {Number(costingData.unallocated_budget) !== 0 && (
                            <TableRow>
                              <TableCell className="text-[#8E9299] italic">Budget not yet split across cost accounts</TableCell>
                              <TableCell className="text-right text-[#8E9299]">{money(costingData.unallocated_budget)}</TableCell>
                              <TableCell colSpan={2} />
                            </TableRow>
                          )}
                          <TableRow className="bg-blue-50/30">
                            <TableCell className="font-bold text-blue-700">Open Purchase Order Commitments</TableCell>
                            <TableCell />
                            <TableCell className="text-right font-black text-blue-700">{money(costingData.total_committed)}</TableCell>
                            <TableCell />
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center p-12 lg:p-20 text-[#8E9299]">
                  <Calculator className="w-10 h-10 lg:w-12 lg:h-12 mb-4 opacity-20" />
                  <p className="font-medium text-sm lg:text-base">Select a project to analyze job costing</p>
                </div>
              )}
            </Card>
          </div>
        </div>
        );
      }
      case 'projects-contracts': {
        const filtered = contracts.filter(c => 
          c.id?.toLowerCase().includes(q) || 
          c.name?.toLowerCase().includes(q) ||
          c.project_name?.toLowerCase().includes(q)
        );
        const totalPages = Math.ceil(filtered.length / itemsPerPage);
        const paginated = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

        return (
          <div className="space-y-6">
            <Card className="border-none shadow-sm rounded-3xl bg-white overflow-hidden">
              <CardHeader className="bg-[#F5F5F5]/30 flex flex-row items-center justify-between">
                <div><CardTitle>Master Service Agreements</CardTitle><CardDescription>Contractual values and retention tracking.</CardDescription></div>
                <Dialog open={isRegisterContractOpen} onOpenChange={setIsRegisterContractOpen}>
                  <DialogTrigger asChild><Button className="bg-[#141414] text-white rounded-xl gap-2 font-bold px-6"><Plus className="w-4 h-4" /> Register contract</Button></DialogTrigger>
                  <DialogContent className="rounded-3xl border-none shadow-2xl overflow-hidden p-0">
                    <form onSubmit={handleRegisterContract}>
                      <DialogHeader className="p-8 pr-14 bg-blue-50"><DialogTitle>New Service Contract</DialogTitle></DialogHeader>
                      <div className="p-8 space-y-4">
                        <div className="grid gap-2"><Label className="font-bold text-xs uppercase text-[#8E9299]">Contract Heading</Label><Input name="name" required className="h-12 bg-[#F5F5F5] border-none rounded-xl" /></div>
                        <div className="grid gap-2">
                          <Label className="font-bold text-xs uppercase text-[#8E9299]">Project Mapping</Label>
                          <Select name="project_id" required>
                            <SelectTrigger className="h-12 bg-[#F5F5F5] border-none rounded-xl font-bold"><SelectValue placeholder="Map to project..." /></SelectTrigger>
                            <SelectContent className="rounded-xl border-none shadow-2xl">
                              {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="grid gap-2"><Label className="font-bold text-xs uppercase text-[#8E9299]">Value ({currSym})</Label><Input name="value" type="number" required className="h-12 bg-[#F5F5F5] border-none rounded-xl font-black text-blue-600" /></div>
                          <div className="grid gap-2"><Label className="font-bold text-xs uppercase text-[#8E9299]">Retention %</Label><Input name="retention_pct" type="number" defaultValue="10" className="h-12 bg-[#F5F5F5] border-none rounded-xl" /></div>
                        </div>
                      </div>
                      <DialogFooter className="p-8 bg-[#F5F5F5]/30 border-t border-[#F5F5F5]"><Button type="submit" className="bg-blue-600 text-white w-full h-12 rounded-xl font-bold shadow-lg shadow-blue-500/20">INITIALIZE SERVICE AGREEMENT</Button></DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow className="bg-[#F5F5F5]/50 hover:bg-[#F5F5F5]/50 border-none"><TableHead className="font-bold">Contract Ref</TableHead><TableHead className="font-bold">Project</TableHead><TableHead className="font-bold text-right">Value</TableHead><TableHead className="font-bold text-right">Retention ({currSym})</TableHead><TableHead className="font-bold">Status</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {paginated.map(c => (
                        <TableRow key={c.id} className="border-b border-[#F5F5F5] hover:bg-[#F5F5F5]/30">
                          <TableCell className="font-bold text-blue-600">{c.id}</TableCell>
                          <TableCell className="font-medium">{c.project_name}</TableCell>
                          <TableCell className="font-bold text-[#141414] text-right">{money(Number(c.value))}</TableCell>
                          <TableCell className="text-[#8E9299] underline decoration-dotted font-medium text-right">{money(Number(c.retention_amount))}</TableCell>
                          <TableCell><Badge className="bg-blue-100 text-blue-700 font-bold">{c.status.toUpperCase()}</Badge></TableCell>
                        </TableRow>
                      ))}
                      {paginated.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-12 text-[#8E9299]">No executive contracts found matching query.</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
            {totalPages > 1 && <PaginationControls total={totalPages} current={currentPage} setPage={setCurrentPage} />}
          </div>
        );
      }
      case 'projects-wip': {
        const filtered = wipReport.filter(w => 
          w.project_name?.toLowerCase().includes(q)
        );
        const totalPages = Math.ceil(filtered.length / itemsPerPage);
        const paginated = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

        return (
          <div className="space-y-6">
            <Card className="border-none shadow-sm rounded-3xl bg-white overflow-hidden">
              <CardHeader className="bg-[#F5F5F5]/30"><CardTitle>Work-in-Progress (WIP) Position</CardTitle><CardDescription>Earned vs billed revenue for every project not yet completed. Earned revenue uses the reported completion %, or cost incurred against budget when none is reported.</CardDescription></CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-[#F5F5F5]/50 hover:bg-[#F5F5F5]/50 border-none">
                        <TableHead className="font-bold">Project</TableHead>
                        <TableHead className="font-bold">Completion %</TableHead>
                        <TableHead className="font-bold text-right">Cost to Date</TableHead>
                        <TableHead className="font-bold text-right">Earned Revenue</TableHead>
                        <TableHead className="font-bold text-right">Billed Revenue</TableHead>
                        <TableHead className="font-bold text-right">Received</TableHead>
                        <TableHead className="text-right font-bold">Net Position</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginated.map((w, i) => (
                        <TableRow key={i} className="border-b border-[#F5F5F5] hover:bg-[#F5F5F5]/30">
                          <TableCell>
                            <p className="font-bold">{w.project_name}</p>
                            <Badge className={`${statusBadgeClass(w.status)} text-[10px] mt-1`}>{w.status}</Badge>
                            {!w.has_contract && <p className="text-[10px] text-[#8E9299] mt-1">No contract — using budget as value</p>}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Progress value={Number(w.poc)} className="w-20 h-1.5" />
                              <span className="text-xs font-bold">{w.poc}%</span>
                            </div>
                            <p className="text-[10px] text-[#8E9299] mt-1">{w.poc_basis === 'reported' ? 'Reported' : 'Cost-based'}</p>
                          </TableCell>
                          <TableCell className="font-medium text-[#141414] text-right">{money(Number(w.actual_cost))}</TableCell>
                          <TableCell className="font-medium text-[#141414] text-right">{money(Number(w.earned_revenue))}</TableCell>
                          <TableCell className="font-medium text-[#141414] text-right">{money(Number(w.billed_revenue))}</TableCell>
                          <TableCell className="font-medium text-green-600 text-right">{money(Number(w.paid_revenue || 0))}</TableCell>
                          <TableCell className="text-right">
                            <Badge className={w.over_under_billing >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}>
                              {w.over_under_billing >= 0 ? 'Underbilled Asset' : 'Overbilled Liability'}
                            </Badge>
                            <p className="text-[10px] font-bold mt-1">{money(Math.abs(w.over_under_billing))}</p>
                          </TableCell>
                        </TableRow>
                      ))}
                      {paginated.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-12 text-[#8E9299]">No open projects found.</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
            {totalPages > 1 && <PaginationControls total={totalPages} current={currentPage} setPage={setCurrentPage} />}
          </div>
        );
      }
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
                <DialogHeader className="p-8 pr-14 bg-blue-50">
                  <DialogTitle className="text-2xl font-bold text-blue-900 leading-none">New Project Charter</DialogTitle>
                  <DialogDescription className="text-blue-700 mt-2">Establish baseline constraints and fiscal budget.</DialogDescription>
                </DialogHeader>
                <div className="p-8 space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label className="font-bold text-xs uppercase tracking-widest text-[#8E9299]">Project Code (e.g. PRJ001)</Label>
                      <Input name="project_id" placeholder="PRJ001" required className="h-12 bg-[#F5F5F5] border-none rounded-xl font-black uppercase" />
                    </div>
                    <div className="space-y-2">
                      <Label className="font-bold text-xs uppercase tracking-widest text-[#8E9299]">Project Title</Label>
                      <Input name="name" placeholder="e.g. Volta Dam Expansion" required className="h-12 bg-[#F5F5F5] border-none rounded-xl font-bold" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label className="font-bold text-xs uppercase tracking-widest text-[#8E9299]">Stakeholder / Client</Label>
                      <Input name="client" placeholder="City Water Dept" required className="h-12 bg-[#F5F5F5] border-none rounded-xl" />
                    </div>
                    <div className="space-y-2">
                      <Label className="font-bold text-xs uppercase tracking-widest text-[#8E9299]">Operational Status</Label>
                      <Select name="status" defaultValue="Planning">
                        <SelectTrigger className="h-12 bg-[#F5F5F5] border-none rounded-xl font-bold"><SelectValue /></SelectTrigger>
                        <SelectContent className="rounded-xl border-none shadow-2xl">
                          {PROJECT_STATUSES.filter(s => s !== 'Completed').map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold text-xs uppercase tracking-widest text-[#8E9299]">Project Manager</Label>
                    <Input name="manager" defaultValue={user?.email || ''} placeholder="Name of the responsible PM" className="h-12 bg-[#F5F5F5] border-none rounded-xl" />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2"><Label>Project Code</Label><Input name="project_id" defaultValue={selectedProject.id} readOnly className="bg-[#F5F5F5] border-none font-black" /></div>
                      <div className="space-y-2"><Label>Title</Label><Input name="name" defaultValue={selectedProject.name} required /></div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2"><Label>Client</Label><Input name="client" defaultValue={selectedProject.client} required /></div>
                      <div className="space-y-2">
                        <Label>Status</Label>
                        <Select name="status" defaultValue={selectedProject.status}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {PROJECT_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-2"><Label>Project Manager</Label><Input name="manager" defaultValue={selectedProject.manager} /></div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2"><Label>Budget</Label><Input name="budget" type="number" defaultValue={selectedProject.budget} required /></div>
                      <div className="space-y-2"><Label>Completion %</Label><Input name="completion_rate" type="number" step="0.1" min="0" max="100" defaultValue={selectedProject.completion_rate || 0} required className="bg-green-50 border-green-100 font-bold text-green-700" /></div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2"><Label>Start Date</Label><Input name="startDate" type="date" defaultValue={selectedProject.startDate} required /></div>
                      <div className="space-y-2"><Label>End Date</Label><Input name="endDate" type="date" defaultValue={selectedProject.endDate === 'TBD' ? '' : selectedProject.endDate} /></div>
                    </div>
                  </div>
                  <DialogFooter><Button type="submit" className="bg-blue-600 text-white w-full h-12 rounded-xl font-bold">Save Changes</Button></DialogFooter>
                </form>
              )}
            </DialogContent>
          </Dialog>

          <Dialog open={isBudgetModalOpen} onOpenChange={setIsBudgetModalOpen}>
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl">
              <DialogHeader>
                <DialogTitle>Project Budget by Cost Account</DialogTitle>
                <DialogDescription>
                  Split {costingData?.project_name}'s budget ({money(costingData?.revised_budget)}) across expense accounts so the job cost report can compare budget with actual cost.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                {budgetDraft.map((line, index) => (
                  <div key={index} className="grid grid-cols-[1fr_140px_36px] gap-2 items-center">
                    <Select value={line.account_id} onValueChange={(value) => setBudgetDraft(d => d.map((l, i) => i === index ? { ...l, account_id: value } : l))}>
                      <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue placeholder="Cost account..." /></SelectTrigger>
                      <SelectContent>
                        {costAccounts.map(a => <SelectItem key={a.id} value={String(a.id)}>{a.code} · {a.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Input type="number" min="0" step="0.01" placeholder="Amount" value={line.amount} onChange={(e) => setBudgetDraft(d => d.map((l, i) => i === index ? { ...l, amount: e.target.value } : l))} className="bg-[#F5F5F5] border-none" />
                    <Button type="button" variant="ghost" size="icon" onClick={() => setBudgetDraft(d => d.filter((_, i) => i !== index))} className="text-red-600" title="Remove line">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => setBudgetDraft(d => [...d, { account_id: '', amount: '', notes: '' }])}>
                  <Plus className="w-3.5 h-3.5" /> Add line
                </Button>
                {(() => {
                  const allocated = budgetDraft.reduce((s, l) => s + (Number(l.amount) || 0), 0);
                  const total = Number(costingData?.revised_budget || 0);
                  return (
                    <p className={`text-sm font-medium ${allocated > total ? 'text-red-600' : 'text-[#8E9299]'}`}>
                      Allocated {money(allocated)} of {money(total)}{allocated > total ? ' — more than the project budget' : ''}
                    </p>
                  );
                })()}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsBudgetModalOpen(false)}>Cancel</Button>
                <Button onClick={handleSaveBudget} disabled={isSavingBudget} className="bg-blue-600 text-white font-bold">
                  {isSavingBudget ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Budget'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Global Module Filters */}
      <Card className="border-none shadow-sm rounded-2xl bg-white p-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-3 h-4 w-4 text-[#8E9299]" />
          <Input 
            placeholder="Governance lookup: name, client or reference..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 h-11 bg-[#F5F5F5] border-none rounded-xl font-medium"
          />
        </div>
      </Card>

      <div className="w-full">
        {renderContent()}
      </div>
    </div>
  );
}

function PaginationControls({ total, current, setPage }: any) {
  return (
    <div className="flex items-center justify-between bg-white p-4 rounded-2xl shadow-sm border border-[#F5F5F5]">
      <div className="flex items-center gap-2">
        <p className="text-[10px] font-bold text-[#8E9299] uppercase tracking-widest px-2">Page {current} of {total}</p>
      </div>
      <div className="flex items-center gap-2">
        <Button 
          variant="outline" 
          size="sm" 
          disabled={current === 1}
          onClick={() => setPage(current - 1)}
          className="rounded-xl border-[#F5F5F5] hover:bg-[#F5F5F5]"
        >
          <ChevronLeft className="w-4 h-4 mr-1" /> Previous
        </Button>
        <Button 
          variant="outline" 
          size="sm" 
          disabled={current === total}
          onClick={() => setPage(current + 1)}
          className="rounded-xl border-[#F5F5F5] hover:bg-[#F5F5F5]"
        >
          Next <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}
