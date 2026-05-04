import React, { useState, useEffect } from 'react';
import { 
  Globe, 
  Shield, 
  Database,
  Save,
  Bell,
  Languages,
  DollarSign,
  Loader2,
  Lock,
  User,
  Key,
  Plus,
  Mail,
  Smartphone,
  ShieldCheck,
  Briefcase,
  MessageSquare,
  Image as ImageIcon,
  Signature,
  FileSpreadsheet,
  Calculator,
  Eye
} from 'lucide-react';
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle,
  CardDescription,
  CardFooter
} from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '../ui/select';
import { Badge } from '../ui/badge';
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
import { toast } from 'sonner';
import { settingsApi } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

export default function Settings() {
  const { user: currentUser } = useAuth();
  const [currency, setCurrency] = useState('GHS');
  const [users, setUsers] = useState<any[]>([]);
  const [smsConfig, setSmsConfig] = useState<any>({
    provider: 'Hubtel',
    api_key: '',
    api_secret: '',
    sender_id: '',
    api_url: ''
  });
  const [payrollConfig, setPayrollConfig] = useState<any>({
    ssnit_employee: '5.5',
    ssnit_employer: '13',
    ssnit_tier2: '5',
    tax_tiers: [
      { threshold: 402, rate: 0 },
      { threshold: 110, rate: 5 },
      { threshold: 130, rate: 10 },
      { threshold: 3000, rate: 17.5 },
      { threshold: 16395, rate: 25 },
      { threshold: 20000, rate: 30 },
      { threshold: 999999, rate: 35 }
    ],
    deduction_types: [
      { name: 'Loan', type: 'fixed', value: 0 },
      { name: 'Staff Advance', type: 'fixed', value: 0 },
      { name: 'Surcharge (Surge Charge)', type: 'fixed', value: 0 },
      { name: 'Health Insurance', type: 'fixed', value: 0 }
    ],
    max_leave_days_per_month: 5
  });

  const [accountingConfig, setAccountingConfig] = useState<any>({
    sales_tax_rate: '15',
    tax_name: 'VAT'
  });
  
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [isViewUserOpen, setIsViewUserOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  
  const [isDeductionModalOpen, setIsDeductionModalOpen] = useState(false);
  const [newDeduction, setNewDeduction] = useState({ name: '', type: 'fixed' as 'fixed' | 'percentage', value: 0 });
  const [logo, setLogo] = useState('');
  const [signature, setSignature] = useState('');
  const [footerNote, setFooterNote] = useState('');

  useEffect(() => {
    fetchSettings();
    if (currentUser?.role === 'admin' || currentUser?.role === 'hr') {
      fetchUsers();
      if (currentUser?.role === 'admin') fetchSMSConfig();
    }
  }, [currentUser]);

  const fetchSettings = async () => {
    try {
      const res = await settingsApi.getSettings();
      const currencySetting = res.data.find((s: any) => s.key === 'currency');
      if (currencySetting) setCurrency(currencySetting.value);
      
      const logoSetting = res.data.find((s: any) => s.key === 'company_logo');
      if (logoSetting) setLogo(logoSetting.value);

      const sigSetting = res.data.find((s: any) => s.key === 'company_signature');
      if (sigSetting) setSignature(sigSetting.value);

      const footerSetting = res.data.find((s: any) => s.key === 'company_footer_note');
      if (footerSetting) setFooterNote(footerSetting.value);

      const payrollSetting = res.data.find((s: any) => s.key === 'payroll_config');
      if (payrollSetting) {
        let config = JSON.parse(payrollSetting.value);
        // Migration: convert string deductions to objects
        if (config.deduction_types && typeof config.deduction_types[0] === 'string') {
          config.deduction_types = config.deduction_types.map((name: string) => ({
            name,
            type: 'fixed',
            value: 0
          }));
        }
        setPayrollConfig(config);
      }

      const accountingSetting = res.data.find((s: any) => s.key === 'accounting_config');
      if (accountingSetting) {
        setAccountingConfig(JSON.parse(accountingSetting.value));
      }
    } catch (error) {
      toast.error('Failed to load settings');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await settingsApi.getUsers();
      setUsers(res.data);
    } catch (error) {
      toast.error('Failed to load users');
    }
  };

  const fetchSMSConfig = async () => {
    try {
      const res = await settingsApi.getSMSConfig();
      if (res.data.id) setSmsConfig(res.data);
    } catch (error) {
      console.error('Failed to load SMS config');
    }
  };

  const handleSaveCurrency = async () => {
    setIsSaving(true);
    try {
      await settingsApi.updateSetting('currency', currency);
      toast.success('Currency updated!');
    } catch (error) {
      toast.error('Failed to save currency');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSavePayroll = async () => {
    setIsSaving(true);
    try {
      await Promise.all([
        settingsApi.updateSetting('payroll_config', JSON.stringify(payrollConfig)),
        settingsApi.updateSetting('accounting_config', JSON.stringify(accountingConfig))
      ]);
      toast.success('Tax and payroll configuration updated!');
    } catch (error) {
      toast.error('Failed to save tax config');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    const formData = new FormData(e.target as HTMLFormElement);
    const data = {
      email: formData.get('email'),
      role: formData.get('role'),
      phone: formData.get('phone')
    };

    try {
      await settingsApi.addUser(data);
      toast.success('User created!');
      setIsInviteModalOpen(false);
      fetchUsers();
    } catch (error) {
      toast.error('Failed to create user');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveSMS = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await settingsApi.updateSMSConfig(smsConfig);
      toast.success('SMS Gateway updated!');
    } catch (error) {
      toast.error('Failed to save SMS config');
    } finally {
      setIsSaving(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, type: 'logo' | 'signature') => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      if (type === 'logo') setLogo(base64String);
      else setSignature(base64String);
    };
    reader.readAsDataURL(file);
  };

  const saveBranding = async () => {
    setIsSaving(true);
    try {
      await Promise.all([
        settingsApi.updateSetting('company_logo', logo),
        settingsApi.updateSetting('company_signature', signature),
        settingsApi.updateSetting('company_footer_note', footerNote)
      ]);
      toast.success('Branding updated successfully');
    } catch (error) {
      toast.error('Failed to update branding');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-12">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[#141414]">Settings</h1>
        <p className="text-[#8E9299] text-lg">Infrastructure governance and local compliance.</p>
      </div>

      <Tabs defaultValue="general" className="w-full">
        <TabsList className="bg-[#F5F5F5] p-1 h-auto mb-8 border-none overflow-x-auto justify-start flex">
          <TabsTrigger value="general" className="px-8 py-3 data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-xl transition-all">
            <Globe className="w-4 h-4 mr-2" /> General
          </TabsTrigger>
          {(currentUser?.role === 'admin' || currentUser?.role === 'hr' || currentUser?.role === 'accountant') && (
            <TabsTrigger value="payroll" className="px-8 py-3 data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-xl transition-all">
              <Calculator className="w-4 h-4 mr-2" /> Payroll & Tax
            </TabsTrigger>
          )}
          {(currentUser?.role === 'admin' || currentUser?.role === 'hr') && (
            <TabsTrigger value="users" className="px-8 py-3 data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-xl transition-all">
              <User className="w-4 h-4 mr-2" /> Users
            </TabsTrigger>
          )}
          {currentUser?.role === 'admin' && (
            <>
              <TabsTrigger value="sms" className="px-8 py-3 data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-xl transition-all">
                <MessageSquare className="w-4 h-4 mr-2" /> SMS Gateway
              </TabsTrigger>
              <TabsTrigger value="branding" className="px-8 py-3 data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-xl transition-all">
                <ImageIcon className="w-4 h-4 mr-2" /> Branding
              </TabsTrigger>
            </>
          )}
          <TabsTrigger value="security" className="px-8 py-3 data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-xl transition-all">
            <Shield className="w-4 h-4 mr-2" /> Security
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-6">
          <Card className="border-none shadow-sm">
            <CardHeader className="bg-[#F5F5F5]/30 border-b border-[#F5F5F5]">
              <CardTitle className="text-xl">Global Preferences</CardTitle>
            </CardHeader>
            <CardContent className="p-8">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 bg-[#F5F5F5] rounded-2xl">
                <div>
                  <p className="font-bold text-[#141414]">System Currency</p>
                  <p className="text-sm text-[#8E9299]">Base monetary unit for all accounts.</p>
                </div>
                <div className="flex items-center gap-3">
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger className="w-48 bg-white border-none shadow-sm rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="GHS">GHS - Ghana Cedi (₵)</SelectItem>
                      <SelectItem value="USD">USD - US Dollar ($)</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button onClick={handleSaveCurrency} className="bg-[#141414] text-white rounded-xl px-6" disabled={isSaving || currentUser?.role !== 'admin'}>Apply</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payroll" className="space-y-8">
          <Card className="border-none shadow-sm overflow-hidden">
            <CardHeader className="bg-[#F5F5F5]/30 border-b border-[#F5F5F5]">
              <CardTitle>Ghana Statutory Deductions</CardTitle>
              <CardDescription>Configure SSNIT and mandatory contribution rates.</CardDescription>
            </CardHeader>
            <CardContent className="p-8 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-2">
                  <Label className="font-bold text-[#141414]">Employee SSNIT Contribution (%)</Label>
                  <Input 
                    type="number" 
                    value={payrollConfig.ssnit_employee} 
                    onChange={(e) => setPayrollConfig({...payrollConfig, ssnit_employee: e.target.value})}
                    className="bg-[#F5F5F5] border-none rounded-xl"
                  />
                  <p className="text-[10px] text-[#8E9299]">Standard rate in Ghana is 5.5%.</p>
                </div>
                <div className="space-y-2">
                  <Label className="font-bold text-[#141414]">Employer SSNIT Contribution (%)</Label>
                  <Input 
                    type="number" 
                    value={payrollConfig.ssnit_employer} 
                    onChange={(e) => setPayrollConfig({...payrollConfig, ssnit_employer: e.target.value})}
                    className="bg-[#F5F5F5] border-none rounded-xl"
                  />
                  <p className="text-[10px] text-[#8E9299]">Standard rate in Ghana is 13%.</p>
                </div>
                <div className="space-y-2">
                  <Label className="font-bold text-[#141414]">Tier 2 Contribution (%)</Label>
                  <Input 
                    type="number" 
                    value={payrollConfig.ssnit_tier2} 
                    onChange={(e) => setPayrollConfig({...payrollConfig, ssnit_tier2: e.target.value})}
                    className="bg-[#F5F5F5] border-none rounded-xl"
                  />
                  <p className="text-[10px] text-[#8E9299]">Portion of employer contribution to private scheme (usually 5%).</p>
                </div>
              </div>

              <div className="pt-8 border-t border-[#F5F5F5] space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="font-bold text-[#141414]">PAYE Tax Tiers (Monthly)</Label>
                    <p className="text-sm text-[#8E9299]">Define monthly income thresholds and applicable tax rates.</p>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="rounded-xl"
                    onClick={() => {
                      const newTiers = [...(payrollConfig.tax_tiers || []), { threshold: 0, rate: 0 }];
                      setPayrollConfig({...payrollConfig, tax_tiers: newTiers});
                    }}
                  >
                    <Plus className="w-4 h-4 mr-2" /> Add Tier
                  </Button>
                </div>
                <div className="grid gap-3">
                  {(payrollConfig.tax_tiers || []).map((tier: any, i: number) => (
                    <div key={i} className="flex items-center gap-4 bg-[#F5F5F5]/50 p-4 rounded-2xl border border-[#F5F5F5]">
                      <div className="flex-1 space-y-1">
                        <Label className="text-[10px] uppercase font-bold text-[#8E9299]">Threshold Amount</Label>
                        <Input 
                          type="number" 
                          value={tier.threshold} 
                          onChange={(e) => {
                            const newTiers = [...payrollConfig.tax_tiers];
                            newTiers[i].threshold = Number(e.target.value);
                            setPayrollConfig({...payrollConfig, tax_tiers: newTiers});
                          }}
                          className="bg-white border-none rounded-xl h-10"
                        />
                      </div>
                      <div className="w-32 space-y-1">
                        <Label className="text-[10px] uppercase font-bold text-[#8E9299]">Rate (%)</Label>
                        <Input 
                          type="number" 
                          value={tier.rate} 
                          onChange={(e) => {
                            const newTiers = [...payrollConfig.tax_tiers];
                            newTiers[i].rate = Number(e.target.value);
                            setPayrollConfig({...payrollConfig, tax_tiers: newTiers});
                          }}
                          className="bg-white border-none rounded-xl h-10"
                        />
                      </div>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="mt-5 text-red-500 hover:bg-red-50 h-10 w-10 rounded-xl"
                        onClick={() => {
                          const newTiers = payrollConfig.tax_tiers.filter((_: any, idx: number) => idx !== i);
                          setPayrollConfig({...payrollConfig, tax_tiers: newTiers});
                        }}
                      >
                        ×
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-8 border-t border-[#F5F5F5] space-y-4">
                <div className="space-y-2">
                  <Label className="font-bold text-[#141414]">Monthly Leave Limit (Days per Employee)</Label>
                  <Input 
                    type="number" 
                    value={payrollConfig.max_leave_days_per_month} 
                    onChange={(e) => setPayrollConfig({...payrollConfig, max_leave_days_per_month: Number(e.target.value)})}
                    className="bg-[#F5F5F5] border-none rounded-xl max-w-xs"
                  />
                  <p className="text-[10px] text-[#8E9299]">Restricts the total number of approved leave days an employee can have in a single calendar month.</p>
                </div>
              </div>

              <div className="pt-8 border-t border-[#F5F5F5] space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-2">
                    <Label className="font-bold text-[#141414]">Sales Tax Name (e.g. VAT)</Label>
                    <Input 
                      value={accountingConfig.tax_name} 
                      onChange={(e) => setAccountingConfig({...accountingConfig, tax_name: e.target.value})}
                      placeholder="VAT"
                      className="bg-[#F5F5F5] border-none rounded-xl"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold text-[#141414]">Standard Tax Rate (%)</Label>
                    <Input 
                      type="number" 
                      value={accountingConfig.sales_tax_rate} 
                      onChange={(e) => setAccountingConfig({...accountingConfig, sales_tax_rate: e.target.value})}
                      className="bg-[#F5F5F5] border-none rounded-xl"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-[#8E9299]">This rate will be applied to all new sales invoices generated in the system.</p>
              </div>

              <div className="pt-8 border-t border-[#F5F5F5] space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="font-bold text-[#141414]">Custom Deduction Types</Label>
                    <p className="text-sm text-[#8E9299]">Define types of deductions applicable to staff salaries.</p>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="rounded-xl"
                    onClick={() => setIsDeductionModalOpen(true)}
                  >
                    <Plus className="w-4 h-4 mr-2" /> Add Type
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(payrollConfig.deduction_types || []).map((d: any, i: number) => (
                    <Badge {...({ key: i } as any)} className="bg-white text-[#141414] border-[#E4E3E0] px-4 py-2 rounded-xl flex items-center gap-2">
                      <span className="font-bold">{d.name}</span>
                      <span className="text-[10px] text-[#8E9299] bg-[#F5F5F5] px-2 py-0.5 rounded-md">
                        {d.type === 'percentage' ? `${d.value}%` : `${currency === 'USD' ? '$' : '₵'}${d.value}`}
                      </span>
                      <button 
                        className="text-[#8E9299] hover:text-red-500 ml-1" 
                        onClick={() => {
                          const newTypes = payrollConfig.deduction_types.filter((_: any, index: number) => index !== i);
                          setPayrollConfig({...payrollConfig, deduction_types: newTypes});
                        }}
                      >
                        ×
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>

              <Dialog open={isDeductionModalOpen} onOpenChange={setIsDeductionModalOpen}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>New Deduction Type</DialogTitle>
                    <DialogDescription>Add a category and default value for payroll subtractions.</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>Deduction Name</Label>
                      <Input 
                        value={newDeduction.name} 
                        onChange={(e) => setNewDeduction({...newDeduction, name: e.target.value})}
                        placeholder="e.g. Welfare Fund"
                        className="bg-[#F5F5F5] border-none rounded-xl"
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Value Type</Label>
                        <Select value={newDeduction.type} onValueChange={(v: any) => setNewDeduction({...newDeduction, type: v})}>
                          <SelectTrigger className="bg-[#F5F5F5] border-none rounded-xl">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="fixed">Fixed Amount</SelectItem>
                            <SelectItem value="percentage">Percentage (%)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Default Value</Label>
                        <Input 
                          type="number"
                          value={newDeduction.value} 
                          onChange={(e) => setNewDeduction({...newDeduction, value: Number(e.target.value)})}
                          className="bg-[#F5F5F5] border-none rounded-xl"
                        />
                      </div>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button 
                      className="bg-[#141414] text-white w-full rounded-xl"
                      onClick={() => {
                        if (newDeduction.name) {
                          setPayrollConfig({
                            ...payrollConfig,
                            deduction_types: [...(payrollConfig.deduction_types || []), newDeduction]
                          });
                          setNewDeduction({ name: '', type: 'fixed', value: 0 });
                          setIsDeductionModalOpen(false);
                        }
                      }}
                    >
                      Add Deduction Type
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardContent>
            <CardFooter className="bg-[#F5F5F5]/30 p-8 border-t border-[#F5F5F5]">
              <Button onClick={handleSavePayroll} className="bg-blue-600 text-white gap-2 rounded-xl font-bold px-10 shadow-lg shadow-blue-500/20" disabled={isSaving}>
                <Save className="w-4 h-4" /> Save Compliance Settings
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>

        <TabsContent value="users" className="space-y-6">
          <Card className="border-none shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between">
              <div><CardTitle>Internal Workspace Users</CardTitle></div>
              <Dialog open={isInviteModalOpen} onOpenChange={setIsInviteModalOpen}>
                <DialogTrigger asChild><Button className="bg-[#141414] text-white gap-2 rounded-xl px-6"><Plus className="w-4 h-4" /> Add Member</Button></DialogTrigger>
                <DialogContent>
                  <form onSubmit={handleAddUser}>
                    <DialogHeader><DialogTitle>Initialize Member Access</DialogTitle></DialogHeader>
                    <div className="p-4 space-y-4">
                      <div className="space-y-2"><Label>Email</Label><Input name="email" type="email" required className="bg-[#F5F5F5] border-none" /></div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2"><Label>Phone</Label><Input name="phone" required className="bg-[#F5F5F5] border-none" /></div>
                        <div className="space-y-2">
                          <Label>Role</Label>
                          <Select name="role" required defaultValue="pm">
                            <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue /></SelectTrigger>
                            <SelectContent><SelectItem value="admin">Admin</SelectItem><SelectItem value="hr">HR</SelectItem><SelectItem value="accountant">Accountant</SelectItem><SelectItem value="pm">Project Manager</SelectItem></SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                    <DialogFooter><Button type="submit" className="bg-[#141414] text-white w-full rounded-xl" disabled={isSaving}>Create Account</Button></DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {users.map((u, i) => (
                  <div key={i} className="flex items-center justify-between p-4 bg-[#F5F5F5]/50 border border-[#F5F5F5] rounded-2xl">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold">{u.email[0].toUpperCase()}</div>
                      <div><p className="font-bold">{u.email}</p><p className="text-xs text-[#8E9299]">{u.phone}</p></div>
                    </div>
                    <div className="flex items-center gap-4">
                      <Badge variant="outline" className="rounded-lg font-bold uppercase text-[10px]">{u.role}</Badge>
                      <Button variant="ghost" size="icon" onClick={() => { setSelectedUser(u); setIsViewUserOpen(true); }} className="h-8 w-8 text-blue-600 hover:bg-blue-50 rounded-full">
                        <Eye className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <Dialog open={isViewUserOpen} onOpenChange={setIsViewUserOpen}>
          <DialogContent>
            {selectedUser && (
              <div>
                <DialogHeader>
                  <DialogTitle>User Access Profile</DialogTitle>
                </DialogHeader>
                <div className="py-6 space-y-4">
                  <div className="flex items-center gap-4 p-4 bg-[#F5F5F5] rounded-2xl">
                    <div className="w-16 h-16 rounded-full bg-blue-600 text-white flex items-center justify-center text-2xl font-bold">{selectedUser.email[0].toUpperCase()}</div>
                    <div>
                      <p className="font-bold text-lg">{selectedUser.email}</p>
                      <Badge className="bg-blue-100 text-blue-700 uppercase">{selectedUser.role}</Badge>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <p className="text-[10px] font-bold uppercase text-[#8E9299]">Phone Number</p>
                      <p className="font-medium">{selectedUser.phone || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase text-[#8E9299]">Employee Link</p>
                      <p className="font-mono text-blue-600 font-bold">{selectedUser.employee_id || 'None'}</p>
                    </div>
                  </div>
                </div>
                <DialogFooter><Button onClick={() => setIsViewUserOpen(false)} className="bg-[#141414] text-white w-full rounded-xl">Close</Button></DialogFooter>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <TabsContent value="sms" className="space-y-6">
          <Card className="border-none shadow-sm">
            <form onSubmit={handleSaveSMS}>
              <CardHeader><CardTitle>SMS Gateway Governance</CardTitle></CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>Provider</Label><Input value={smsConfig.provider} onChange={(e) => setSmsConfig({...smsConfig, provider: e.target.value})} className="bg-[#F5F5F5] border-none rounded-xl" /></div>
                  <div className="space-y-2"><Label>Sender ID</Label><Input value={smsConfig.sender_id} onChange={(e) => setSmsConfig({...smsConfig, sender_id: e.target.value})} className="bg-[#F5F5F5] border-none rounded-xl" /></div>
                </div>
                <div className="space-y-2"><Label>API Endpoint / Custom URL</Label><Input value={smsConfig.api_url} onChange={(e) => setSmsConfig({...smsConfig, api_url: e.target.value})} placeholder="https://api.yourprovider.com/v1?to={to}&msg={msg}&key={key}" className="bg-[#F5F5F5] border-none rounded-xl" /></div>
                <div className="space-y-2"><Label>API Key</Label><Input value={smsConfig.api_key} onChange={(e) => setSmsConfig({...smsConfig, api_key: e.target.value})} type="password" className="bg-[#F5F5F5] border-none rounded-xl" /></div>
                <div className="space-y-2"><Label>API Secret</Label><Input value={smsConfig.api_secret} onChange={(e) => setSmsConfig({...smsConfig, api_secret: e.target.value})} type="password" className="bg-[#F5F5F5] border-none rounded-xl" /></div>
              </CardContent>
              <CardFooter className="bg-[#F5F5F5]/30 p-6"><Button type="submit" className="bg-[#141414] text-white rounded-xl px-10" disabled={isSaving}>Update Gateway</Button></CardFooter>
            </form>
          </Card>
        </TabsContent>

        <TabsContent value="branding" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <Card className="border-none shadow-sm"><CardHeader><CardTitle>Corporate Identity</CardTitle></CardHeader><CardContent className="space-y-4"><div className="w-full h-40 bg-[#F5F5F5] rounded-2xl flex items-center justify-center overflow-hidden">{logo ? <img src={logo} className="max-h-full" /> : <ImageIcon className="w-10 h-10 text-[#8E9299]" />}</div><Input type="file" onChange={(e) => handleFileUpload(e, 'logo')} /></CardContent></Card>
            <Card className="border-none shadow-sm"><CardHeader><CardTitle>Legal Signature</CardTitle></CardHeader><CardContent className="space-y-4"><div className="w-full h-40 bg-[#F5F5F5] rounded-2xl flex items-center justify-center overflow-hidden">{signature ? <img src={signature} className="max-h-full" /> : <Signature className="w-10 h-10 text-[#8E9299]" />}</div><Input type="file" onChange={(e) => handleFileUpload(e, 'signature')} /></CardContent></Card>
          </div>
          <Card className="border-none shadow-sm">
            <CardHeader><CardTitle>Document Footer Note</CardTitle><CardDescription>This text appears at the bottom of all generated documents (Invoices, PVs, etc.)</CardDescription></CardHeader>
            <CardContent>
              <textarea 
                value={footerNote} 
                onChange={(e) => setFooterNote(e.target.value)} 
                placeholder="e.g. Thank you for your business! Please make payments to... / This is a computer generated document."
                className="w-full min-h-[100px] p-4 bg-[#F5F5F5] border-none rounded-2xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </CardContent>
          </Card>
          <div className="flex justify-end"><Button onClick={saveBranding} className="bg-blue-600 text-white rounded-xl px-12 h-11 shadow-lg shadow-blue-500/20" disabled={isSaving}>Deploy Branding</Button></div>
        </TabsContent>

        <TabsContent value="security" className="space-y-6">
          <Card className="border-none shadow-sm"><CardHeader><CardTitle>Encryption & Integrity</CardTitle></CardHeader><CardContent className="p-8"><div className="flex items-center justify-between p-4 bg-green-50 text-green-700 rounded-xl font-bold"><ShieldCheck className="w-5 h-5" /> All Financial Protocols Active</div></CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
