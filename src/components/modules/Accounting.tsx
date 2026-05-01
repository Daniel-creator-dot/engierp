import React, { useState, useEffect } from 'react';
import { 
  Plus, 
  Download,
  Search,
  Printer,
  Loader2,
  BookOpen,
  Calculator,
  ArrowUpDown,
  Building2,
  CreditCard,
  FileText,
  CheckCircle2,
  AlertCircle,
  PiggyBank,
  FileSpreadsheet,
  Edit,
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
import { accountingApi, settingsApi, projectsApi, procurementApi } from '../../lib/api';
import { Transaction, Invoice } from '../../types';

interface AccountingProps {
  activeSub?: string;
}

export default function Accounting({ activeSub = 'accounting-transactions' }: AccountingProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [bills, setBills] = useState<any[]>([]);
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [bankTx, setBankTx] = useState<any[]>([]);
  const [receivables, setReceivables] = useState<any[]>([]);
  const [payables, setPayables] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  
  const [coa, setCOA] = useState<any[]>([]);
  const [trialBalance, setTrialBalance] = useState<any[]>([]);
  const [incomeStatement, setIncomeStatement] = useState<any[]>([]);
  const [balanceSheet, setBalanceSheet] = useState<any>({ accounts: [], retainedEarnings: 0 });
  const [managementAccounts, setManagementAccounts] = useState<any>(null);
  
  const [reportTab, setReportTab] = useState('dashboard');
  const [reportStartDate, setReportStartDate] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]);
  const [reportEndDate, setReportEndDate] = useState(new Date().toISOString().split('T')[0]);
  
  const [isLoading, setIsLoading] = useState(true);
  const [isJournalOpen, setIsJournalOpen] = useState(false);
  const [isCreateInvoiceOpen, setIsCreateInvoiceOpen] = useState(false);
  const [isPayInvoiceOpen, setIsPayInvoiceOpen] = useState(false);
  const [isRecordBillOpen, setIsRecordBillOpen] = useState(false);
  const [isPayBillOpen, setIsPayBillOpen] = useState(false);
  const [isAddBankOpen, setIsAddBankOpen] = useState(false);
  const [isAddAccountOpen, setIsAddAccountOpen] = useState(false);
  const [isEditAccountOpen, setIsEditAccountOpen] = useState(false);
  const [isDeleteAccountOpen, setIsDeleteAccountOpen] = useState(false);
  const [coaFilter, setCoaFilter] = useState('All');
  
  const [selectedTarget, setSelectedTarget] = useState<any>(null);
  const [companySettings, setCompanySettings] = useState<any[]>([]);
  const [billQuantity, setBillQuantity] = useState<number>(1);
  const [billUnitPrice, setBillUnitPrice] = useState<number>(0);

  // Journal Items state
  const [journalItems, setJournalItems] = useState([
    { account_id: '', debit: 0, credit: 0 },
    { account_id: '', debit: 0, credit: 0 }
  ]);

  useEffect(() => {
    fetchData();
  }, [activeSub, reportStartDate, reportEndDate]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const settingsRes = await settingsApi.getSettings();
      setCompanySettings(settingsRes.data);

      if (activeSub === 'accounting-bank') {
        const [accRes, txRes] = await Promise.all([
          accountingApi.getBankAccounts(),
          accountingApi.getBankTransactions()
        ]);
        setBankAccounts(accRes.data);
        setBankTx(txRes.data);
      } else if (activeSub === 'accounting-ar' || activeSub === 'accounting-invoices') {
        const [invRes, projRes, accRes] = await Promise.all([
          accountingApi.getInvoices(),
          projectsApi.getProjects(),
          accountingApi.getBankAccounts()
        ]);
        setInvoices(invRes.data);
        setProjects(projRes.data);
        setBankAccounts(accRes.data);
      } else if (activeSub === 'accounting-ap') {
        const [billsRes, supRes, accRes] = await Promise.all([
          accountingApi.getBills(),
          procurementApi.getSuppliers(),
          accountingApi.getBankAccounts()
        ]);
        setBills(billsRes.data);
        setSuppliers(supRes.data);
        setBankAccounts(accRes.data);
      } else if (activeSub === 'accounting-transactions') {
        const [txRes, coaRes] = await Promise.all([
          accountingApi.getTransactions(),
          accountingApi.getCOA()
        ]);
        setTransactions(txRes.data);
        setCOA(coaRes.data);
      } else if (activeSub === 'accounting-coa') {
        const coaRes = await accountingApi.getCOA();
        setCOA(coaRes.data);
      } else if (activeSub === 'accounting-reports') {
        const [tb, inc, bs, mgmt] = await Promise.all([
          accountingApi.getTrialBalance(reportStartDate, reportEndDate),
          accountingApi.getIncomeStatement(reportStartDate, reportEndDate),
          accountingApi.getBalanceSheet(reportEndDate),
          accountingApi.getManagementAccounts(reportStartDate, reportEndDate)
        ]);
        setTrialBalance(tb.data);
        setIncomeStatement(inc.data);
        setBalanceSheet(bs.data);
        setManagementAccounts(mgmt.data);
      }
    } catch (error) {
      toast.error('Failed to load accounting data');
    } finally {
      setIsLoading(false);
    }
  };

  const getSetting = (key: string) => companySettings.find(s => s.key === key)?.value || '';
  const currSym = getSetting('currency') === 'USD' ? '$' : 'GH₵';

  // Bank Actions
  const handleAddBankAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    const data = {
      account_name: formData.get('account_name'),
      account_number: formData.get('account_number'),
      bank_name: formData.get('bank_name'),
      type: formData.get('type')
    };
    try {
      await accountingApi.addBankAccount(data);
      toast.success('Account verified and added');
      setIsAddBankOpen(false);
      fetchData();
    } catch (error) {
      toast.error('Failed to add bank account');
    }
  };

  const handleSimulateBankFeed = async () => {
    if (bankAccounts.length === 0) return toast.error('Add a bank account first');
    const data = {
      bank_account_id: bankAccounts[0].id,
      date: new Date().toISOString().split('T')[0],
      description: `Feed Import - ${Math.floor(Math.random() * 1000)}`,
      amount: Math.floor(Math.random() * 10000),
      type: Math.random() > 0.5 ? 'Credit' : 'Debit'
    };
    try {
      await accountingApi.importBankTransaction(data);
      toast.success('Simulated transaction imported');
      fetchData();
    } catch (error) {
      toast.error('Feed import failed');
    }
  };

  // AR Actions
  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    const projId = formData.get('project_id') as string;
    const project = projects.find(p => p.id === projId);
    
    const data = {
      id: `INV-${Math.floor(1000 + Math.random() * 9000)}`,
      client: project?.client || formData.get('client_name'),
      amount: Number(formData.get('amount')),
      dueDate: formData.get('dueDate'),
      project_id: projId,
      status: 'unpaid'
    };
    try {
      await accountingApi.createInvoice(data);
      toast.success('Sales invoice generated');
      setIsCreateInvoiceOpen(false);
      fetchData();
    } catch (error) {
      toast.error('Failed to generate invoice');
    }
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    const data = {
      payment_id: `PAY-${Math.floor(10000 + Math.random() * 90000)}`,
      target_type: selectedTarget?.type,
      target_id: selectedTarget?.id,
      amount: Number(formData.get('amount')),
      date: new Date().toISOString().split('T')[0],
      method: formData.get('method'),
      reference: formData.get('reference'),
      bank_account_id: formData.get('bank_account_id')
    };
    try {
      await accountingApi.recordPayment(data);
      toast.success('Payment recorded to ledger');
      setIsPayInvoiceOpen(false);
      setIsPayBillOpen(false);
      fetchData();
    } catch (error) {
      toast.error('Failed to record payment');
    }
  };

  // AP Actions
  const handleRecordBill = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    const data = {
      supplier_id: formData.get('supplier_id'),
      quantity: Number(formData.get('quantity')),
      unit_price: Number(formData.get('unit_price')),
      amount: Number(formData.get('amount')),
      due_date: formData.get('due_date'),
      category: formData.get('category'),
    };
    try {
      await accountingApi.recordBill(data);
      toast.success('Vendor bill recorded');
      setIsRecordBillOpen(false);
      fetchData();
    } catch (error) {
      toast.error('Failed to record bill');
    }
  };

  // COA Actions
  const handleUpdateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTarget) return;
    const formData = new FormData(e.target as HTMLFormElement);
    const data = {
      code: formData.get('code'),
      name: formData.get('name'),
      type: formData.get('type'),
    };
    try {
      await accountingApi.updateCOA(selectedTarget.id, data);
      toast.success('Account updated successfully');
      setIsEditAccountOpen(false);
      fetchData();
    } catch (error) {
      toast.error('Failed to update account');
    }
  };

  const handleDeleteAccount = async () => {
    if (!selectedTarget) return;
    try {
      await accountingApi.deleteCOA(selectedTarget.id);
      toast.success('Account deleted successfully');
      setIsDeleteAccountOpen(false);
      fetchData();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to delete account');
    }
  };

  // General Ledger
  const handlePostJournal = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    const data = {
      date: formData.get('date'),
      description: formData.get('description'),
      items: journalItems.filter(item => item.account_id !== '')
    };
    try {
      await accountingApi.postJournal(data);
      toast.success('Journal entry posted');
      setIsJournalOpen(false);
      setJournalItems([{ account_id: '', debit: 0, credit: 0 }, { account_id: '', debit: 0, credit: 0 }]);
      fetchData();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to post journal entry');
    }
  };

  const handlePrintDocument = (title: string, content: string) => {
    const logo = getSetting('company_logo');
    const signature = getSetting('company_signature');
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
            table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
            th, td { border: 1px solid #E4E3E0; padding: 12px; text-align: left; }
            th { background: #F5F5F5; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; }
            .total-row { font-weight: bold; background: #F5F5F5; }
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

  const handleExportCSV = (filename: string, headers: string[], rows: string[][]) => {
    const csvContent = [headers.join(','), ...rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${filename}_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    toast.success(`${filename}.csv exported successfully`);
  };

  if (isLoading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;
  }

  const renderContent = () => {
    switch (activeSub) {
      case 'accounting-bank':
        return (
          <div className="space-y-6">
            <div className="flex justify-end gap-2">
               <Button variant="outline" className="gap-2 rounded-xl font-bold" onClick={() => handleExportCSV('bank_transactions', ['Date','Description','Bank','Amount','Type','Status'], bankTx.map((tx: any) => [new Date(tx.date).toLocaleDateString(), tx.description, tx.bank_name, String(tx.amount), tx.type, tx.status]))}><FileSpreadsheet className="w-4 h-4" /> Export CSV</Button>
               <Button onClick={handleSimulateBankFeed} variant="outline" className="gap-2 font-bold h-11"><Download className="w-4 h-4" /> Fetch Feeds</Button>
               <Dialog open={isAddBankOpen} onOpenChange={setIsAddBankOpen}>
                 <DialogTrigger asChild><Button className="bg-[#141414] text-white gap-2 font-bold h-11 shadow-lg"><Plus className="w-4 h-4" /> Link Account</Button></DialogTrigger>
                 <DialogContent className="rounded-2xl">
                   <form onSubmit={handleAddBankAccount}>
                     <DialogHeader><DialogTitle>Register Treasury Account</DialogTitle></DialogHeader>
                     <div className="grid gap-4 py-4">
                       <div className="space-y-2"><Label>Institution Name</Label><Input name="bank_name" required className="bg-[#F5F5F5] border-none h-11" placeholder="e.g. Standard Chartered"/></div>
                       <div className="space-y-2"><Label>Account Name</Label><Input name="account_name" required className="bg-[#F5F5F5] border-none h-11" /></div>
                       <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2"><Label>Account Number</Label><Input name="account_number" required className="bg-[#F5F5F5] border-none h-11" /></div>
                          <div className="space-y-2">
                            <Label>Account Type</Label>
                            <Select name="type" required>
                              <SelectTrigger className="bg-[#F5F5F5] border-none h-11"><SelectValue /></SelectTrigger>
                              <SelectContent><SelectItem value="Current">Current / Checking</SelectItem><SelectItem value="Savings">Savings</SelectItem><SelectItem value="Mobile Money">Mobile Money</SelectItem><SelectItem value="Petty Cash">Petty Cash</SelectItem></SelectContent>
                            </Select>
                          </div>
                       </div>
                     </div>
                     <DialogFooter><Button type="submit" className="w-full bg-[#141414] text-white h-11 font-bold">VERIFY & LINK</Button></DialogFooter>
                   </form>
                 </DialogContent>
               </Dialog>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {bankAccounts.map(b => (
                <Card key={b.id} className="border-none shadow-sm rounded-2xl bg-gradient-to-br from-[#141414] to-slate-900 text-white overflow-hidden">
                  <CardHeader className="pb-2">
                    <div className="flex justify-between items-start">
                      <div className="p-2 bg-white/10 rounded-xl"><PiggyBank className="w-5 h-5 text-white" /></div>
                      <Badge className="bg-white/10 text-white border-none text-[10px] uppercase font-bold">{b.type}</Badge>
                    </div>
                    <CardDescription className="text-white/60 mt-4 text-xs font-bold uppercase tracking-widest">{b.bank_name}</CardDescription>
                    <CardTitle className="text-lg">{b.account_name}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-sm font-mono text-white/50 mb-4">{b.account_number.replace(/\d(?=\d{4})/g, "*")}</div>
                    <div className="text-3xl font-black">{currSym}{Number(b.balance).toLocaleString()}</div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="overflow-x-auto rounded-2xl border border-[#F5F5F5] shadow-sm">
              <Table className="bg-white">
                  <TableHeader><TableRow className="bg-[#F5F5F5]/50"><TableHead>Date</TableHead><TableHead>Description</TableHead><TableHead>Account</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {bankTx.map((tx, idx) => (
                      <TableRow key={idx} className="hover:bg-blue-50/20">
                        <TableCell className="text-xs font-bold text-[#8E9299]">{new Date(tx.date).toLocaleDateString()}</TableCell>
                        <TableCell className="font-bold">{tx.description}</TableCell>
                        <TableCell className="text-xs">{tx.bank_name}</TableCell>
                        <TableCell className={`text-right font-black ${tx.type === 'Credit' ? 'text-green-600' : 'text-[#141414]'}`}>{tx.type === 'Credit' ? '+' : '-'}{currSym}{Number(tx.amount).toLocaleString()}</TableCell>
                        <TableCell><Badge className={tx.status === 'Reconciled' ? 'bg-green-100 text-green-700 border-none' : 'bg-yellow-100 text-yellow-700 border-none'}>{tx.status}</Badge></TableCell>
                      </TableRow>
                    ))}
                    {bankTx.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-10 text-[#8E9299]">No transactions to reconcile. Fetch feeds to populate.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </div>
            </div>
          );

      case 'accounting-ap':
        return (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold">Accounts Payable</h2>
                <p className="text-sm text-[#8E9299]">Vendor bills and cash outflows.</p>
              </div>
              <div className="flex gap-2">
              <Button variant="outline" className="gap-2 rounded-xl font-bold" onClick={() => handleExportCSV('accounts_payable', ['Supplier','Category','Due Date','Amount','Status'], bills.map((b: any) => [b.supplier_name, b.category, new Date(b.due_date).toLocaleDateString(), String(b.amount), b.status]))}><FileSpreadsheet className="w-4 h-4" /> Export CSV</Button>
              <Dialog open={isRecordBillOpen} onOpenChange={setIsRecordBillOpen}>
                <DialogTrigger asChild><Button className="bg-[#141414] text-white gap-2 font-bold h-11"><Plus className="w-4 h-4" /> Enter Bill</Button></DialogTrigger>
                <DialogContent className="rounded-2xl">
                  <form onSubmit={handleRecordBill}>
                    <DialogHeader><DialogTitle>Log Vendor Vendor</DialogTitle></DialogHeader>
                    <div className="grid gap-4 py-4">
                      <div className="space-y-2">
                        <Label>Supplier</Label>
                        <Select name="supplier_id" required>
                          <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue /></SelectTrigger>
                          <SelectContent>{suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-2"><Label>Quantity</Label><Input type="number" name="quantity" required min="1" value={billQuantity} onChange={e => setBillQuantity(Number(e.target.value))} className="bg-[#F5F5F5] border-none" /></div>
                        <div className="space-y-2"><Label>Unit Price</Label><Input type="number" name="unit_price" required min="0" step="0.01" value={billUnitPrice || ''} onChange={e => setBillUnitPrice(Number(e.target.value))} className="bg-[#F5F5F5] border-none" /></div>
                        <div className="space-y-2"><Label>Total Amount ({currSym})</Label><Input type="number" name="amount" required readOnly value={(billQuantity * billUnitPrice).toFixed(2)} className="bg-blue-50 border-none font-bold text-lg text-blue-900" /></div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2"><Label>Due Date</Label><Input type="date" name="due_date" required className="bg-[#F5F5F5] border-none" /></div>
                        <div className="space-y-2"><Label>Category</Label><Input name="category" placeholder="e.g. Materials, Software" required className="bg-[#F5F5F5] border-none" /></div>
                      </div>
                    </div>
                    <DialogFooter><Button type="submit" className="w-full bg-[#141414] text-white h-11 font-bold">AUTHORIZE PAYABLE</Button></DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
              </div>
            </div>
            
            <div className="overflow-x-auto rounded-2xl border border-[#F5F5F5] shadow-sm">
              <Table className="bg-white">
                <TableHeader><TableRow className="bg-[#F5F5F5]/50"><TableHead>Supplier</TableHead><TableHead>Category</TableHead><TableHead>Due Date</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
                <TableBody>
                  {bills.map((bill, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-bold text-[#141414]">{bill.supplier_name}</TableCell>
                      <TableCell className="text-[#8E9299] text-xs font-medium">{bill.category}</TableCell>
                      <TableCell className="font-mono text-xs">{new Date(bill.due_date).toLocaleDateString()}</TableCell>
                      <TableCell className="text-right font-black text-red-600">{currSym}{Number(bill.amount).toLocaleString()}</TableCell>
                      <TableCell><Badge className={bill.status === 'Paid' ? 'bg-green-100 text-green-700 border-none' : 'bg-red-50 text-red-600 border-none'}>{bill.status.toUpperCase()}</Badge></TableCell>
                      <TableCell className="text-right">
                        {bill.status !== 'Paid' && (
                          <Button variant="outline" size="sm" className="font-bold h-8 text-xs border-[#141414]" onClick={() => { setSelectedTarget({type: 'Bill', id: bill.id, amount: bill.amount}); setIsPayBillOpen(true); }}>
                            PAY
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Payment Modal */}
            <Dialog open={isPayBillOpen} onOpenChange={setIsPayBillOpen}>
              <DialogContent className="rounded-2xl">
                <form onSubmit={handleRecordPayment}>
                  <DialogHeader><DialogTitle>Process Payment</DialogTitle></DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2"><Label>Amount to Pay</Label><Input name="amount" type="number" defaultValue={selectedTarget?.amount} max={selectedTarget?.amount} required className="bg-[#F5F5F5] border-none font-bold" /></div>
                      <div className="space-y-2">
                        <Label>Payment Method</Label>
                        <Select name="method" required>
                          <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="Bank Transfer">Bank Transfer</SelectItem><SelectItem value="Cheque">Cheque</SelectItem><SelectItem value="Mobile Money">Momo</SelectItem></SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Source Bank Account</Label>
                      <Select name="bank_account_id" required>
                        <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue /></SelectTrigger>
                        <SelectContent>{bankAccounts.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.account_name} ({b.bank_name})</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2"><Label>Reference Note</Label><Input name="reference" required className="bg-[#F5F5F5] border-none" placeholder="Cheque No. / TX Hash" /></div>
                  </div>
                  <DialogFooter><Button type="submit" className="w-full bg-[#141414] text-white h-11 font-bold">CONFIRM DISBURSEMENT</Button></DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        );

      case 'accounting-ar':
      case 'accounting-invoices':
        return (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold">Accounts Receivable</h2>
                <p className="text-sm text-[#8E9299]">Client invoicing, statements, and revenue tracking.</p>
              </div>
              <div className="flex gap-2">
              <Button variant="outline" className="gap-2 rounded-xl font-bold" onClick={() => handleExportCSV('accounts_receivable', ['Invoice ID','Customer','Due Date','Amount','Status'], invoices.map(inv => [inv.id, inv.client, inv.dueDate, String(inv.amount), inv.status]))}><FileSpreadsheet className="w-4 h-4" /> Export CSV</Button>
              <Dialog open={isCreateInvoiceOpen} onOpenChange={setIsCreateInvoiceOpen}>
                <DialogTrigger asChild><Button className="bg-blue-600 text-white gap-2 font-bold h-11 px-6 rounded-xl shadow-lg shadow-blue-500/20"><Plus className="w-4 h-4" /> Raise Sales Invoice</Button></DialogTrigger>
                <DialogContent className="rounded-2xl">
                  <form onSubmit={handleCreateInvoice}>
                    <DialogHeader><DialogTitle>New Sales Invoice</DialogTitle></DialogHeader>
                    <div className="grid gap-4 py-4">
                      <div className="space-y-2">
                        <Label>Project / Client</Label>
                        <Select name="project_id" required>
                          <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue placeholder="Select project..." /></SelectTrigger>
                          <SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name} ({p.client})</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2"><Label>Amount ({currSym})</Label><Input name="amount" type="number" required className="bg-[#F5F5F5] border-none font-bold" /></div>
                        <div className="space-y-2"><Label>Due Date</Label><Input name="dueDate" type="date" required className="bg-[#F5F5F5] border-none" /></div>
                      </div>
                    </div>
                    <DialogFooter><Button type="submit" className="bg-blue-600 text-white w-full rounded-xl font-bold h-11">GENERATE INVOICE</Button></DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
              </div>
            </div>
            
            <div className="overflow-x-auto rounded-2xl border border-[#F5F5F5] shadow-sm">
              <Table className="bg-white">
                <TableHeader><TableRow className="bg-[#F5F5F5]/50"><TableHead>Invoice ID</TableHead><TableHead>Customer</TableHead><TableHead>Due Date</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
                <TableBody>
                  {invoices.map((inv) => (
                    <TableRow key={inv.id} className="hover:bg-blue-50/20">
                      <TableCell className="font-bold text-blue-600">{inv.id}</TableCell>
                      <TableCell className="font-bold text-[#141414]">{inv.client}</TableCell>
                      <TableCell className="text-[#8E9299] text-xs font-mono">{inv.dueDate}</TableCell>
                      <TableCell className="text-right font-black">{currSym}{Number(inv.amount).toLocaleString()}</TableCell>
                      <TableCell><Badge className={inv.status === 'paid' ? 'bg-green-100 text-green-700 border-none' : 'bg-yellow-50 text-yellow-600 border-none'}>{inv.status.toUpperCase()}</Badge></TableCell>
                      <TableCell className="text-right space-x-2">
                        {inv.status !== 'paid' && (
                          <Button variant="outline" size="sm" className="font-bold h-8 text-xs border-[#141414]" onClick={() => { setSelectedTarget({type: 'Invoice', id: inv.id, amount: inv.amount}); setIsPayInvoiceOpen(true); }}>
                            RECEIVE
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" className="font-bold h-8 text-xs text-blue-600" onClick={() => handlePrintDocument(`INVOICE - ${inv.id}`, `<h3>To: ${inv.client}</h3><p>Amount: ${currSym}${inv.amount}</p>`)}><Printer className="w-3 h-3" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Receive Payment Modal */}
            <Dialog open={isPayInvoiceOpen} onOpenChange={setIsPayInvoiceOpen}>
              <DialogContent className="rounded-2xl">
                <form onSubmit={handleRecordPayment}>
                  <DialogHeader><DialogTitle>Receive Payment</DialogTitle></DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2"><Label>Amount Received</Label><Input name="amount" type="number" defaultValue={selectedTarget?.amount} required className="bg-[#F5F5F5] border-none font-bold" /></div>
                      <div className="space-y-2">
                        <Label>Depost Method</Label>
                        <Select name="method" required>
                          <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="Bank Direct">Bank Direct</SelectItem><SelectItem value="Cheque">Cheque</SelectItem><SelectItem value="Mobile Money">Momo</SelectItem></SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Destination Bank Account</Label>
                      <Select name="bank_account_id" required>
                        <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue placeholder="Select bank account..." /></SelectTrigger>
                        <SelectContent>{bankAccounts.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.account_name} ({b.bank_name})</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2"><Label>Reference / Cheque No.</Label><Input name="reference" required className="bg-[#F5F5F5] border-none" /></div>
                  </div>
                  <DialogFooter><Button type="submit" className="w-full bg-blue-600 text-white h-11 font-bold">CLEAR INVOICE BALANCE</Button></DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        );

      case 'accounting-transactions':
        return (
          <div className="space-y-6">
            {/* GL Implementation kept relatively same, hidden for brevity but completely functional */}
            <div className="flex justify-between items-center">
              <div><h2 className="text-xl font-bold">General Ledger</h2><p className="text-sm text-[#8E9299]">Live auditing of all fiscal transactions.</p></div>
              <div className="flex gap-2">
              <Button variant="outline" className="gap-2 rounded-xl font-bold" onClick={() => handleExportCSV('general_ledger', ['Date','Reference','Category','Amount','Type'], transactions.map(tx => [tx.date, tx.description, tx.category, String(tx.amount), tx.type]))}><FileSpreadsheet className="w-4 h-4" /> Export CSV</Button>
              <Dialog open={isJournalOpen} onOpenChange={setIsJournalOpen}>
                 <DialogTrigger asChild><Button variant="outline" className="gap-2 border-[#141414] text-[#141414] rounded-xl font-bold shadow-sm"><BookOpen className="w-4 h-4" /> Manual Journal Post</Button></DialogTrigger>
                 <DialogContent className="max-w-3xl rounded-2xl">
                   <form onSubmit={handlePostJournal}>
                     <DialogHeader><DialogTitle>Double-Entry Journal</DialogTitle></DialogHeader>
                     <div className="grid gap-6 py-6">
                       <div className="grid grid-cols-2 gap-4">
                         <div className="grid gap-2"><Label>Date</Label><Input type="date" name="date" required defaultValue={new Date().toISOString().split('T')[0]} className="bg-[#F5F5F5] border-none" /></div>
                         <div className="grid gap-2"><Label>Reference</Label><Input name="description" placeholder="e.g. Asset Depreciation" required className="bg-[#F5F5F5] border-none" /></div>
                       </div>
                       <div className="space-y-4">
                         <div className="grid grid-cols-12 gap-2 text-xs font-bold uppercase text-[#8E9299]"><div className="col-span-6">Account</div><div className="col-span-3">Debit</div><div className="col-span-3">Credit</div></div>
                         {journalItems.map((item, idx) => (
                           <div key={idx} className="grid grid-cols-12 gap-2">
                             <div className="col-span-6">
                               <Select onValueChange={(val) => { const n = [...journalItems]; n[idx].account_id = val; setJournalItems(n); }}>
                                 <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue placeholder="Select Account" /></SelectTrigger>
                                 <SelectContent>{coa.map(a => <SelectItem key={a.id} value={String(a.id)}>{a.code} - {a.name}</SelectItem>)}</SelectContent>
                               </Select>
                             </div>
                             <div className="col-span-3"><Input type="number" step="0.01" placeholder="0.00" value={item.debit} onChange={(e) => { const n = [...journalItems]; n[idx].debit = Number(e.target.value); setJournalItems(n); }} className="bg-[#F5F5F5] border-none font-bold text-green-600" /></div>
                             <div className="col-span-3"><Input type="number" step="0.01" placeholder="0.00" value={item.credit} onChange={(e) => { const n = [...journalItems]; n[idx].credit = Number(e.target.value); setJournalItems(n); }} className="bg-[#F5F5F5] border-none font-bold text-red-600" /></div>
                           </div>
                         ))}
                         <Button type="button" variant="ghost" onClick={() => setJournalItems([...journalItems, { account_id: '', debit: 0, credit: 0 }])} className="w-full text-blue-600 font-bold hover:bg-blue-50 rounded-xl">+ APPEND LINE</Button>
                       </div>
                     </div>
                     <DialogFooter className="bg-[#F5F5F5] p-6 -mx-6 -mb-6">
                       <div className="flex-1 flex gap-4 font-mono font-bold">
                         <div className="text-green-600">DR: {currSym}{journalItems.reduce((s, i) => s + i.debit, 0).toLocaleString()}</div>
                         <div className="text-red-600">CR: {currSym}{journalItems.reduce((s, i) => s + i.credit, 0).toLocaleString()}</div>
                       </div>
                       <Button type="submit" className="bg-[#141414] text-white h-11 px-8 rounded-xl font-bold">POST TO LEDGER</Button>
                     </DialogFooter>
                   </form>
                 </DialogContent>
               </Dialog>
              </div>
            </div>
            
            <div className="overflow-x-auto rounded-2xl border border-[#F5F5F5] shadow-sm">
              <Table className="bg-white">
                <TableHeader><TableRow className="bg-[#F5F5F5]/50"><TableHead>Date</TableHead><TableHead>Reference</TableHead><TableHead>Category / Account</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                <TableBody>
                  {transactions.map((tx) => (
                    <TableRow key={tx.id} className="hover:bg-blue-50/20">
                      <TableCell className="text-[#8E9299] font-mono text-xs">{tx.date}</TableCell>
                      <TableCell className="font-bold text-[#141414]">{tx.description}</TableCell>
                      <TableCell><Badge variant="outline" className="border-[#E4E3E0] text-[#141414]">{tx.category}</Badge></TableCell>
                      <TableCell className={`text-right font-black ${tx.type === 'income' ? 'text-green-600' : 'text-red-600'}`}>{tx.type === 'income' ? '+' : '-'}{currSym}{Number(tx.amount).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        );

      case 'accounting-reports':
        return (
          <div className="space-y-8">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-[#141414]">Financial Position</h2>
                <p className="text-[#8E9299]">Enterprise Reporting driven by Double-Entry Ledger.</p>
              </div>
              <div className="flex items-center gap-2 bg-[#F5F5F5] p-1 rounded-xl">
                <Input type="date" value={reportStartDate} onChange={e => setReportStartDate(e.target.value)} className="bg-transparent border-none w-36 text-sm font-bold" />
                <span className="text-[#8E9299] font-bold">to</span>
                <Input type="date" value={reportEndDate} onChange={e => setReportEndDate(e.target.value)} className="bg-transparent border-none w-36 text-sm font-bold" />
                <Button size="icon" className="bg-[#141414] text-white rounded-lg h-8 w-8 ml-2" onClick={fetchData}><Search className="w-4 h-4" /></Button>
              </div>
            </div>

            <div className="flex gap-2 border-b border-[#F5F5F5] overflow-x-auto pb-2">
              {['dashboard', 'income-statement', 'balance-sheet', 'trial-balance'].map(tab => (
                <button
                  key={tab}
                  onClick={() => setReportTab(tab)}
                  className={`px-4 py-2 rounded-xl text-sm font-bold capitalize whitespace-nowrap transition-all ${reportTab === tab ? 'bg-[#141414] text-white' : 'text-[#8E9299] hover:bg-[#F5F5F5]'}`}
                >
                  {tab.replace('-', ' ')}
                </button>
              ))}
            </div>

            {reportTab === 'dashboard' && managementAccounts && (
              <div className="grid gap-6 md:grid-cols-4">
                <Card className="border-none shadow-sm rounded-2xl overflow-hidden border-t-4 border-t-blue-500">
                  <CardHeader className="pb-2">
                    <CardDescription className="text-xs uppercase font-bold text-[#8E9299]">Operating Profit</CardDescription>
                    <CardTitle className="text-3xl font-black text-blue-600">{currSym}{(managementAccounts.Income - managementAccounts.Expense).toLocaleString()}</CardTitle>
                  </CardHeader>
                </Card>
                <Card className="border-none shadow-sm rounded-2xl overflow-hidden border-t-4 border-t-green-500">
                  <CardHeader className="pb-2">
                    <CardDescription className="text-xs uppercase font-bold text-[#8E9299]">Total Revenue</CardDescription>
                    <CardTitle className="text-3xl font-black text-green-600">{currSym}{managementAccounts.Income.toLocaleString()}</CardTitle>
                  </CardHeader>
                </Card>
                <Card className="border-none shadow-sm rounded-2xl overflow-hidden border-t-4 border-t-red-500">
                  <CardHeader className="pb-2">
                    <CardDescription className="text-xs uppercase font-bold text-[#8E9299]">Total Expenses</CardDescription>
                    <CardTitle className="text-3xl font-black text-red-600">{currSym}{managementAccounts.Expense.toLocaleString()}</CardTitle>
                  </CardHeader>
                </Card>
                <Card className="border-none shadow-sm rounded-2xl overflow-hidden border-t-4 border-t-purple-500">
                  <CardHeader className="pb-2">
                    <CardDescription className="text-xs uppercase font-bold text-[#8E9299]">Total Payroll Paid</CardDescription>
                    <CardTitle className="text-3xl font-black text-purple-600">{currSym}{(managementAccounts.TotalPayroll || 0).toLocaleString()}</CardTitle>
                  </CardHeader>
                </Card>
              </div>
            )}

            {reportTab === 'income-statement' && (
              <Card className="border-none shadow-sm rounded-2xl bg-white overflow-hidden max-w-4xl">
                <CardHeader className="bg-[#F5F5F5]/30 border-b border-[#F5F5F5] flex flex-row justify-between items-center">
                  <CardTitle>Income Statement</CardTitle>
                  <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="w-4 h-4 mr-2" /> Print</Button>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader><TableRow className="bg-[#F5F5F5]/50"><TableHead>Account</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                    <TableBody>
                      <TableRow className="bg-green-50/30 hover:bg-green-50/30"><TableCell colSpan={2} className="font-bold text-green-700">Revenue</TableCell></TableRow>
                      {incomeStatement.filter(a => a.type === 'Income').map(a => (
                         <TableRow key={a.id}><TableCell className="pl-8 font-bold text-[#141414]">{a.name}</TableCell><TableCell className="text-right font-mono">{currSym}{(a.total_credit - a.total_debit).toLocaleString()}</TableCell></TableRow>
                      ))}
                      <TableRow className="bg-[#F5F5F5]/50 hover:bg-[#F5F5F5]/50"><TableCell className="font-bold">Total Revenue</TableCell><TableCell className="text-right font-black text-green-600">{currSym}{incomeStatement.filter(a => a.type === 'Income').reduce((s,a) => s + (a.total_credit - a.total_debit), 0).toLocaleString()}</TableCell></TableRow>
                      
                      <TableRow className="bg-red-50/30 hover:bg-red-50/30"><TableCell colSpan={2} className="font-bold text-red-700">Operating Expenses</TableCell></TableRow>
                      {incomeStatement.filter(a => a.type === 'Expense').map(a => (
                         <TableRow key={a.id}><TableCell className="pl-8 font-bold text-[#141414]">{a.name}</TableCell><TableCell className="text-right font-mono">{currSym}{(a.total_debit - a.total_credit).toLocaleString()}</TableCell></TableRow>
                      ))}
                      <TableRow className="bg-[#F5F5F5]/50 hover:bg-[#F5F5F5]/50"><TableCell className="font-bold">Total Expenses</TableCell><TableCell className="text-right font-black text-red-600">{currSym}{incomeStatement.filter(a => a.type === 'Expense').reduce((s,a) => s + (a.total_debit - a.total_credit), 0).toLocaleString()}</TableCell></TableRow>
                      
                      <TableRow className="bg-[#141414] text-white hover:bg-[#141414]">
                        <TableCell className="font-black text-lg">Net Income</TableCell>
                        <TableCell className="text-right font-black text-xl">
                          {currSym}{(incomeStatement.filter(a => a.type === 'Income').reduce((s,a) => s + (a.total_credit - a.total_debit), 0) - incomeStatement.filter(a => a.type === 'Expense').reduce((s,a) => s + (a.total_debit - a.total_credit), 0)).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            {reportTab === 'balance-sheet' && (
              <Card className="border-none shadow-sm rounded-2xl bg-white overflow-hidden max-w-4xl">
                <CardHeader className="bg-[#F5F5F5]/30 border-b border-[#F5F5F5] flex flex-row justify-between items-center">
                  <CardTitle>Balance Sheet <span className="text-sm font-normal text-[#8E9299]">As of {reportEndDate}</span></CardTitle>
                  <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="w-4 h-4 mr-2" /> Print</Button>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader><TableRow className="bg-[#F5F5F5]/50"><TableHead>Account</TableHead><TableHead className="text-right">Balance</TableHead></TableRow></TableHeader>
                    <TableBody>
                      <TableRow className="bg-blue-50/30 hover:bg-blue-50/30"><TableCell colSpan={2} className="font-bold text-blue-700">Assets</TableCell></TableRow>
                      {balanceSheet.accounts.filter((a: any) => a.type === 'Asset').map((a: any) => (
                         <TableRow key={a.id}><TableCell className="pl-8 font-bold text-[#141414]">{a.name}</TableCell><TableCell className="text-right font-mono">{currSym}{(a.total_debit - a.total_credit).toLocaleString()}</TableCell></TableRow>
                      ))}
                      <TableRow className="bg-[#F5F5F5]/50 hover:bg-[#F5F5F5]/50"><TableCell className="font-bold">Total Assets</TableCell><TableCell className="text-right font-black text-blue-600">{currSym}{balanceSheet.accounts.filter((a: any) => a.type === 'Asset').reduce((s: number,a: any) => s + (a.total_debit - a.total_credit), 0).toLocaleString()}</TableCell></TableRow>
                      
                      <TableRow className="bg-red-50/30 hover:bg-red-50/30"><TableCell colSpan={2} className="font-bold text-red-700">Liabilities</TableCell></TableRow>
                      {balanceSheet.accounts.filter((a: any) => a.type === 'Liability').map((a: any) => (
                         <TableRow key={a.id}><TableCell className="pl-8 font-bold text-[#141414]">{a.name}</TableCell><TableCell className="text-right font-mono">{currSym}{(a.total_credit - a.total_debit).toLocaleString()}</TableCell></TableRow>
                      ))}
                      <TableRow className="bg-[#F5F5F5]/50 hover:bg-[#F5F5F5]/50"><TableCell className="font-bold">Total Liabilities</TableCell><TableCell className="text-right font-black text-red-600">{currSym}{balanceSheet.accounts.filter((a: any) => a.type === 'Liability').reduce((s: number,a: any) => s + (a.total_credit - a.total_debit), 0).toLocaleString()}</TableCell></TableRow>

                      <TableRow className="bg-purple-50/30 hover:bg-purple-50/30"><TableCell colSpan={2} className="font-bold text-purple-700">Equity</TableCell></TableRow>
                      {balanceSheet.accounts.filter((a: any) => a.type === 'Equity').map((a: any) => (
                         <TableRow key={a.id}><TableCell className="pl-8 font-bold text-[#141414]">{a.name}</TableCell><TableCell className="text-right font-mono">{currSym}{(a.total_credit - a.total_debit).toLocaleString()}</TableCell></TableRow>
                      ))}
                      <TableRow><TableCell className="pl-8 font-bold text-[#141414]">Retained Earnings</TableCell><TableCell className="text-right font-mono">{currSym}{balanceSheet.retainedEarnings.toLocaleString()}</TableCell></TableRow>
                      <TableRow className="bg-[#F5F5F5]/50 hover:bg-[#F5F5F5]/50"><TableCell className="font-bold">Total Equity</TableCell><TableCell className="text-right font-black text-purple-600">{currSym}{(balanceSheet.accounts.filter((a: any) => a.type === 'Equity').reduce((s: number,a: any) => s + (a.total_credit - a.total_debit), 0) + balanceSheet.retainedEarnings).toLocaleString()}</TableCell></TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            {reportTab === 'trial-balance' && (
              <div className="overflow-x-auto rounded-2xl border border-[#F5F5F5] shadow-sm">
                <Table className="bg-white">
                  <TableHeader>
                    <TableRow className="bg-[#F5F5F5]/50 border-none">
                      <TableHead colSpan={4}>
                        <div className="flex justify-between items-center w-full">
                          <span>Trial Balance</span>
                          <Button variant="outline" size="sm" onClick={() => handleExportCSV('trial_balance', ['Code','Account Name','Type','Debit','Credit'], trialBalance.map(a => [a.code, a.name, a.type, String(a.total_debit), String(a.total_credit)]))}><FileSpreadsheet className="w-4 h-4 mr-2" /> Export CSV</Button>
                        </div>
                      </TableHead>
                    </TableRow>
                    <TableRow className="bg-[#F5F5F5]/50">
                      <TableHead className="font-bold text-[#141414]">Code</TableHead>
                      <TableHead className="font-bold text-[#141414]">Account Name</TableHead>
                      <TableHead className="text-right font-bold text-[#141414]">Debit</TableHead>
                      <TableHead className="text-right font-bold text-[#141414]">Credit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trialBalance.map(a => (
                      <TableRow key={a.id} className="hover:bg-[#F5F5F5]/50">
                        <TableCell className="font-mono text-xs font-bold text-[#8E9299]">{a.code}</TableCell>
                        <TableCell className="font-bold text-[#141414]">{a.name}</TableCell>
                        <TableCell className="text-right font-mono text-[#8E9299]">{Number(a.total_debit) > 0 ? `${currSym}${Number(a.total_debit).toLocaleString()}` : '-'}</TableCell>
                        <TableCell className="text-right font-mono text-[#8E9299]">{Number(a.total_credit) > 0 ? `${currSym}${Number(a.total_credit).toLocaleString()}` : '-'}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-[#141414] text-white hover:bg-[#141414]">
                      <TableCell colSpan={2} className="font-black text-right text-lg">BALANCING TOTAL</TableCell>
                      <TableCell className="text-right font-black text-lg">{currSym}{trialBalance.reduce((s, a) => s + Number(a.total_debit), 0).toLocaleString()}</TableCell>
                      <TableCell className="text-right font-black text-lg">{currSym}{trialBalance.reduce((s, a) => s + Number(a.total_credit), 0).toLocaleString()}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        );

      case 'accounting-coa': {
        const typeColors: Record<string, string> = {
          'Asset': 'bg-blue-100 text-blue-700',
          'Liability': 'bg-red-100 text-red-700',
          'Equity': 'bg-purple-100 text-purple-700',
          'Income': 'bg-green-100 text-green-700',
          'Expense': 'bg-orange-100 text-orange-700',
        };
        const filteredCOA = coa.filter(a => {
          if (coaFilter !== 'All' && a.type !== coaFilter) return false;
          return true;
        });
        const groupedByType = ['Asset', 'Liability', 'Equity', 'Income', 'Expense'];
        const totalsByType = groupedByType.map(type => ({
          type,
          count: coa.filter(a => a.type === type).length,
          balance: coa.filter(a => a.type === type).reduce((s: number, a: any) => s + Number(a.balance || 0), 0)
        }));

        return (
          <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
              {totalsByType.map(t => (
                <button
                  key={t.type}
                  onClick={() => setCoaFilter(coaFilter === t.type ? 'All' : t.type)}
                  className={`p-4 rounded-2xl border-2 transition-all text-left ${
                    coaFilter === t.type ? 'border-[#141414] bg-[#141414] text-white shadow-xl' : 'border-[#F5F5F5] bg-white hover:border-[#8E9299]'
                  }`}
                >
                  <p className={`text-[10px] font-bold uppercase tracking-widest ${coaFilter === t.type ? 'text-white/60' : 'text-[#8E9299]'}`}>{t.type}</p>
                  <p className={`text-2xl font-black ${coaFilter === t.type ? 'text-white' : 'text-[#141414]'}`}>{t.count}</p>
                  <p className={`text-xs font-bold mt-1 ${coaFilter === t.type ? 'text-white/70' : 'text-[#8E9299]'}`}>{currSym}{Math.abs(t.balance).toLocaleString()}</p>
                </button>
              ))}
            </div>

            {/* Header */}
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold">Chart of Accounts</h2>
                <p className="text-sm text-[#8E9299]">{filteredCOA.length} accounts {coaFilter !== 'All' ? `(${coaFilter})` : ''}</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="gap-2 rounded-xl font-bold" onClick={() => handleExportCSV('chart_of_accounts', ['Code','Name','Type','Balance'], coa.map(a => [a.code, a.name, a.type, String(a.balance)]))}><FileSpreadsheet className="w-4 h-4" /> Export CSV</Button>
                <Dialog open={isAddAccountOpen} onOpenChange={setIsAddAccountOpen}>
                  <DialogTrigger asChild><Button className="bg-[#141414] text-white gap-2 font-bold h-11 px-6 rounded-xl shadow-lg"><Plus className="w-4 h-4" /> New Account</Button></DialogTrigger>
                  <DialogContent className="rounded-3xl border-none shadow-2xl overflow-hidden p-0">
                    <form onSubmit={async (e) => {
                      e.preventDefault();
                      const fd = new FormData(e.target as HTMLFormElement);
                      try {
                        await accountingApi.createCOA({
                          code: fd.get('code'),
                          name: fd.get('name'),
                          type: fd.get('type'),
                          balance: 0
                        });
                        toast.success('Ledger account created');
                        setIsAddAccountOpen(false);
                        fetchData();
                      } catch (error) {
                        toast.error('Failed to create account');
                      }
                    }}>
                      <DialogHeader className="p-8 bg-blue-50">
                        <DialogTitle className="text-2xl font-bold text-blue-900">Register Ledger Account</DialogTitle>
                        <DialogDescription className="text-blue-700">Add a new account to your Chart of Accounts.</DialogDescription>
                      </DialogHeader>
                      <div className="p-8 space-y-4">
                        <div className="grid grid-cols-3 gap-4">
                          <div className="space-y-2">
                            <Label className="font-bold text-xs uppercase text-[#8E9299]">Code</Label>
                            <Input name="code" placeholder="e.g. 5200" required className="h-12 bg-[#F5F5F5] border-none rounded-xl font-mono font-bold text-lg" />
                          </div>
                          <div className="col-span-2 space-y-2">
                            <Label className="font-bold text-xs uppercase text-[#8E9299]">Account Name</Label>
                            <Input name="name" placeholder="e.g. Marketing Expense" required className="h-12 bg-[#F5F5F5] border-none rounded-xl font-bold" />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label className="font-bold text-xs uppercase text-[#8E9299]">Account Type</Label>
                          <Select name="type" required>
                            <SelectTrigger className="h-12 bg-[#F5F5F5] border-none rounded-xl font-bold"><SelectValue placeholder="Select type..." /></SelectTrigger>
                            <SelectContent className="rounded-xl border-none shadow-2xl">
                              <SelectItem value="Asset">Asset</SelectItem>
                              <SelectItem value="Liability">Liability</SelectItem>
                              <SelectItem value="Equity">Equity</SelectItem>
                              <SelectItem value="Income">Income / Revenue</SelectItem>
                              <SelectItem value="Expense">Expense</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <DialogFooter className="p-8 bg-[#F5F5F5]/30 border-t border-[#F5F5F5]">
                        <Button type="submit" className="bg-blue-600 text-white w-full h-12 rounded-xl font-bold shadow-lg shadow-blue-500/20">REGISTER ACCOUNT</Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
                
                {/* Edit Account Dialog */}
                <Dialog open={isEditAccountOpen} onOpenChange={setIsEditAccountOpen}>
                  <DialogContent className="rounded-3xl border-none shadow-2xl overflow-hidden p-0">
                    <form onSubmit={handleUpdateAccount}>
                      <DialogHeader className="p-8 bg-blue-50">
                        <DialogTitle className="text-2xl font-bold text-blue-900">Edit Ledger Account</DialogTitle>
                        <DialogDescription className="text-blue-700">Update account details.</DialogDescription>
                      </DialogHeader>
                      <div className="p-8 space-y-4">
                        <div className="grid grid-cols-3 gap-4">
                          <div className="space-y-2">
                            <Label className="font-bold text-xs uppercase text-[#8E9299]">Code</Label>
                            <Input name="code" defaultValue={selectedTarget?.code} required className="h-12 bg-[#F5F5F5] border-none rounded-xl font-mono font-bold text-lg" />
                          </div>
                          <div className="col-span-2 space-y-2">
                            <Label className="font-bold text-xs uppercase text-[#8E9299]">Account Name</Label>
                            <Input name="name" defaultValue={selectedTarget?.name} required className="h-12 bg-[#F5F5F5] border-none rounded-xl font-bold" />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label className="font-bold text-xs uppercase text-[#8E9299]">Account Type</Label>
                          <Select name="type" defaultValue={selectedTarget?.type} required>
                            <SelectTrigger className="h-12 bg-[#F5F5F5] border-none rounded-xl font-bold"><SelectValue /></SelectTrigger>
                            <SelectContent className="rounded-xl border-none shadow-2xl">
                              <SelectItem value="Asset">Asset</SelectItem>
                              <SelectItem value="Liability">Liability</SelectItem>
                              <SelectItem value="Equity">Equity</SelectItem>
                              <SelectItem value="Income">Income / Revenue</SelectItem>
                              <SelectItem value="Expense">Expense</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <DialogFooter className="p-8 bg-[#F5F5F5]/30 border-t border-[#F5F5F5]">
                        <Button type="submit" className="bg-blue-600 text-white w-full h-12 rounded-xl font-bold shadow-lg shadow-blue-500/20">SAVE CHANGES</Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>

                {/* Delete Account Dialog */}
                <Dialog open={isDeleteAccountOpen} onOpenChange={setIsDeleteAccountOpen}>
                  <DialogContent className="rounded-3xl border-none shadow-2xl p-6 max-w-sm">
                    <DialogHeader>
                      <DialogTitle className="text-xl font-black text-red-600">Delete Account</DialogTitle>
                      <DialogDescription className="font-bold text-[#141414] mt-2">
                        Are you sure you want to delete {selectedTarget?.code} - {selectedTarget?.name}?
                      </DialogDescription>
                    </DialogHeader>
                    <p className="text-sm text-[#8E9299] mt-2 mb-6">
                      This action cannot be undone. You cannot delete accounts that have existing ledger entries.
                    </p>
                    <DialogFooter className="gap-2 sm:gap-0">
                      <Button variant="outline" onClick={() => setIsDeleteAccountOpen(false)} className="rounded-xl font-bold border-[#E4E3E0]">CANCEL</Button>
                      <Button variant="destructive" onClick={handleDeleteAccount} className="rounded-xl font-bold">DELETE ACCOUNT</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </div>

            {/* Accounts Table */}
            <Card className="border-none shadow-sm rounded-2xl bg-white overflow-hidden">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-[#F5F5F5]/50 hover:bg-[#F5F5F5]/50 border-none">
                        <TableHead className="font-bold w-24">Code</TableHead>
                        <TableHead className="font-bold">Account Name</TableHead>
                        <TableHead className="font-bold w-32">Type</TableHead>
                        <TableHead className="font-bold text-right w-40">Balance</TableHead>
                        <TableHead className="font-bold text-right w-24">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredCOA.map(a => (
                        <TableRow key={a.id} className="border-b border-[#F5F5F5] hover:bg-[#F5F5F5]/30">
                          <TableCell className="font-mono font-bold text-blue-600">{a.code}</TableCell>
                          <TableCell className="font-bold text-[#141414]">{a.name}</TableCell>
                          <TableCell><Badge className={`${typeColors[a.type] || 'bg-gray-100 text-gray-700'} border-none font-bold text-[10px]`}>{a.type.toUpperCase()}</Badge></TableCell>
                          <TableCell className={`text-right font-black ${Number(a.balance) >= 0 ? 'text-[#141414]' : 'text-red-600'}`}>{currSym}{Number(a.balance).toLocaleString()}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50" onClick={() => { setSelectedTarget(a); setIsEditAccountOpen(true); }}>
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => { setSelectedTarget(a); setIsDeleteAccountOpen(true); }}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                      {filteredCOA.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-12 text-[#8E9299]">No accounts match the selected filter.</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>
        );
      }

      default: return null;
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-black tracking-tight text-[#141414]">Finance Hub.</h1>
        <p className="text-[#8E9299] text-lg mt-1 font-medium">Enterprise Treasury, AP/AR, and Ledger Configuration.</p>
      </div>
      {renderContent()}
    </div>
  );
}
