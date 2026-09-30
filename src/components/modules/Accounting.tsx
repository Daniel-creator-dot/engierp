import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
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
  AlertTriangle,
  PiggyBank,
  FileSpreadsheet,
  Edit,
  Trash2,
  Check,
  ChevronsUpDown,
  ExternalLink,
  Globe,
  Calendar,
  Eye,
  ShieldCheck,
  History,
  RefreshCw,
  Info,
  X
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
import { Textarea } from '../ui/textarea';
import { AmountInput } from '../ui/amount-input';
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
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { ScrollArea } from '../ui/scroll-area';
import { toast } from 'sonner';
import { accountingApi, settingsApi, projectsApi, procurementApi, catalogApi } from '../../lib/api';
import { Service, useCategories } from '../../lib/catalog';
import CategorySelect from '../CategorySelect';
import { Invoice } from '../../types';
import { getCurrencySymbol, formatCompactWithSymbol, formatWithSymbol } from '../../lib/currency';
import { escapeHtml } from '../../lib/html';
import { formatDate, inclusiveDays, todayIso } from '../../lib/dates';
import { brandingFrom, downloadCsv, errorText, fmtMoney, openPrintWindow } from './accounting/print';
import AttachmentsButton from './accounting/AttachmentsButton';
import ArAgingPanel from './accounting/ArAgingPanel';
import BankReconcilePanel from './accounting/BankReconcilePanel';
import CashFlowPanel from './accounting/CashFlowPanel';
import TaxReportsPanel from './accounting/TaxReportsPanel';
import RecurringPanel from './accounting/RecurringPanel';
import { ApprovalLimitCard, PeriodLockCard, TaxSettingsCard } from './accounting/SettingsCards';
import ApprovalsPanel from './accounting/ApprovalsPanel';
import CorrectionDialog, { CorrectionTarget } from './accounting/CorrectionDialog';
import PaymentsDialog, { PaymentsTarget } from './accounting/PaymentsDialog';
import ReportsDashboard, { PeriodPresets, presetRange } from './accounting/ReportsDashboard';

const LEDGER_TYPES = ['manual', 'invoice', 'bill', 'payment', 'credit_note', 'invoice_void', 'bill_void', 'reversal', 'opening_balance', 'payroll', 'depreciation', 'disposal'];
const JOURNAL_PAGE_SIZE = 50;


interface AccountingProps {
  activeSub?: string;
  user?: any;
  onNavigate?: (module: any) => void;
}

const typeColors: Record<string, string> = {
  'Asset': 'bg-blue-500',
  'Liability': 'bg-red-500',
  'Equity': 'bg-purple-500',
  'Income': 'bg-green-500',
  'Expense': 'bg-orange-500',
};

const AccountSelect = ({ value, onValueChange, accounts, placeholder }: any) => {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');

  const selectedAccount = accounts.find((a: any) => String(a.id) === value);

  const filtered = accounts.filter((a: any) =>
    a.name.toLowerCase().includes(search.toLowerCase()) ||
    a.code.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            title={selectedAccount ? `${selectedAccount.code} - ${selectedAccount.name}` : undefined}
            className="w-full min-w-0 justify-between bg-[#F5F5F5] border-none h-11 rounded-xl font-bold text-left px-4 hover:bg-[#F5F5F5]/80 text-[#141414] transition-all"
          />
        }
      >
        <span className="truncate">
          {selectedAccount ? `${selectedAccount.code} - ${selectedAccount.name}` : placeholder}
        </span>
        <ChevronsUpDown className={`ml-2 h-4 w-4 shrink-0 opacity-50 transition-transform ${open ? 'rotate-180' : ''}`} />
      </PopoverTrigger>
      <PopoverContent className="p-0 gap-0 w-[max(var(--anchor-width),18rem)] max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-[#F5F5F5] z-[1000] overflow-hidden" align="start">
        <div className="flex items-center border-b border-[#F5F5F5] px-3 sticky top-0 bg-white z-10">
          <Search className="mr-2 h-4 w-4 shrink-0 opacity-50 text-[#8E9299]" />
          <input
            placeholder="Search accounts..."
            className="flex h-12 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-[#8E9299] font-medium"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
            }}
          />
        </div>
        <ScrollArea className="h-[250px] bg-white">
          <div className="p-1">
            {filtered.map((account: any) => (
              <div
                key={account.id}
                onClick={() => {
                  onValueChange(String(account.id));
                  setOpen(false);
                  setSearch('');
                }}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-blue-50 text-left transition-colors cursor-pointer group"
              >
                <div className={`w-2 h-2 rounded-full shrink-0 ${typeColors[account.type] || 'bg-gray-400'}`} />
                <div className="flex flex-col flex-1 truncate">
                  <span className="font-mono font-bold text-blue-600 text-[10px] leading-tight tracking-wider">{account.code}</span>
                  <span className="font-bold text-[#141414] truncate">{account.name}</span>
                </div>
                {value === String(account.id) && <Check className="h-4 w-4 text-blue-600 shrink-0" />}
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="py-12 text-center flex flex-col items-center justify-center gap-2">
                <AlertCircle className="w-6 h-6 text-[#8E9299] opacity-20" />
                <p className="text-[10px] font-black text-[#8E9299] uppercase tracking-widest">No matching accounts</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
};

const SECTION_SUBTITLES: Record<string, string> = {
  'accounting-approvals': 'Bills and corrections waiting for a decision.',
  'accounting-bank': 'Bank and cash balances, statement import and reconciliation.',
  'accounting-ap': 'Supplier bills and payments.',
  'accounting-ar': 'Customer invoices, receipts and statements.',
  'accounting-invoices': 'Customer invoices, receipts and statements.',
  'accounting-transactions': 'Every journal in the ledger, searchable.',
  'accounting-reports': 'Financial statements, tax and management reports.',
  'accounting-coa': 'Accounts and their balances.',
  'accounting-foundation': 'Fiscal year, company identity and opening balances.',
};

const hintKey = (title: string) => `finance-hint-dismissed:${title}`;

/** A one-line "how this works" hint that the user can dismiss for good. */
const AccountingGuidance = ({ title, message }: { title: string, message: string }) => {
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(hintKey(title)) === '1'; } catch { return false; }
  });
  if (hidden) return null;
  const dismiss = () => {
    try { localStorage.setItem(hintKey(title), '1'); } catch { /* storage unavailable */ }
    setHidden(true);
  };
  return (
    <div className="mb-6 flex items-start gap-3 rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-black/[0.03]">
      <Info className="w-4 h-4 mt-0.5 shrink-0 text-blue-600" />
      <p className="flex-1 text-xs leading-relaxed text-[#6B7280]"><span className="font-bold text-[#141414]">{title}.</span> {message}</p>
      <button type="button" onClick={dismiss} className="shrink-0 p-1 -m-1 rounded-lg text-[#8E9299] hover:text-[#141414] hover:bg-[#F5F5F5]" aria-label={`Hide the ${title} tip`}>
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

export default function Accounting({ activeSub = 'accounting-transactions', user, onNavigate }: AccountingProps) {
  const [transactions, setTransactions] = useState<any[]>([]);
  const [ledgerTotal, setLedgerTotal] = useState(0);
  const [ledgerFilters, setLedgerFilters] = useState({ q: '', startDate: '', endDate: '', type: 'all', page: 1 });
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [isLedgerLoading, setIsLedgerLoading] = useState(false);
  const [editingJournal, setEditingJournal] = useState<{ date: string; description: string; project_id?: string | null } | null>(null);
  const [journalFormKey, setJournalFormKey] = useState(0);
  const [taxComponents, setTaxComponents] = useState<{ code: string; name: string; rate: number }[]>([]);
  const [invoiceApplyTax, setInvoiceApplyTax] = useState(true);
  const [billPaymentWhtRate, setBillPaymentWhtRate] = useState('0');
  const [defaultWhtRate, setDefaultWhtRate] = useState(7.5);
  const [obDate, setObDate] = useState('');
  const [obInfo, setObInfo] = useState<{ journal: { id: number; date: string } | null; entries_on_or_before: number; entries_after: number } | null>(null);
  const [voidTarget, setVoidTarget] = useState<{ kind: 'invoice' | 'bill'; id: string; label: string } | null>(null);
  const [creditNoteTarget, setCreditNoteTarget] = useState<any>(null);
  const [correctionTarget, setCorrectionTarget] = useState<CorrectionTarget>(null);
  const [paymentsTarget, setPaymentsTarget] = useState<PaymentsTarget>(null);
  const [approvalCount, setApprovalCount] = useState(0);
  const isAdmin = user?.role === 'admin';
  const [linkBankTarget, setLinkBankTarget] = useState<any>(null);
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
  const [reportStartDate, setReportStartDate] = useState(`${todayIso().slice(0, 8)}01`);
  const [reportEndDate, setReportEndDate] = useState(todayIso());
  const reportRequest = React.useRef(0);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [openingBalances, setOpeningBalances] = useState<Record<string, number>>({});
  const [isJournalOpen, setIsJournalOpen] = useState(false);
  const [isCreateInvoiceOpen, setIsCreateInvoiceOpen] = useState(false);
  const [isPayInvoiceOpen, setIsPayInvoiceOpen] = useState(false);
  const [isRecordBillOpen, setIsRecordBillOpen] = useState(false);
  const [isPayBillOpen, setIsPayBillOpen] = useState(false);
  const [isBillDetailsOpen, setIsBillDetailsOpen] = useState(false);
  const [isAddBankOpen, setIsAddBankOpen] = useState(false);
  const [isAddAccountOpen, setIsAddAccountOpen] = useState(false);
  const [isEditAccountOpen, setIsEditAccountOpen] = useState(false);
  const [isDeleteAccountOpen, setIsDeleteAccountOpen] = useState(false);
  const [coaFilter, setCoaFilter] = useState('All');
  const [coaSearch, setCoaSearch] = useState('');
  const [obSearch, setObSearch] = useState('');

  const [selectedTarget, setSelectedTarget] = useState<any>(null);
  const [selectedBill, setSelectedBill] = useState<any>(null);
  const [companySettings, setCompanySettings] = useState<any[]>([]);
  const [invoiceItems, setInvoiceItems] = useState<{ description: string, quantity: number, unitPrice: number, service_id?: number | null }[]>([{ description: '', quantity: 1, unitPrice: 0 }]);
  const [billQuantity, setBillQuantity] = useState<number>(1);
  const [billUnitPrice, setBillUnitPrice] = useState<number>(0);
  const [billCategory, setBillCategory] = useState('');
  const [billAccountId, setBillAccountId] = useState('');
  const expenseCategories = useCategories('expense');
  const [services, setServices] = useState<Service[]>([]);
  const [arView, setArView] = useState<'invoices' | 'aging'>('invoices');

  // Journal Items state
  const [journalItems, setJournalItems] = useState([
    { account_id: '', debit: 0, credit: 0 },
    { account_id: '', debit: 0, credit: 0 }
  ]);

  const [isPeriodBankDetailsOpen, setIsPeriodBankDetailsOpen] = useState(false);
  const [selectedPeriodLabel, setSelectedPeriodLabel] = useState('');
  const [periodFilterDates, setPeriodFilterDates] = useState<{ start: string, end: string } | null>(null);
  const [periodFilterAccountId, setPeriodFilterAccountId] = useState<string | null>(null);
  const [ledgerEntries, setLedgerEntries] = useState<any[]>([]);
  const [drillDownMode, setDrillDownMode] = useState<'bank' | 'ledger'>('bank');
  const [selectedCOAId, setSelectedCOAId] = useState<string | null>(null);
  const [editingJournalId, setEditingJournalId] = useState<string | null>(null);
  const [isEditBankTxOpen, setIsEditBankTxOpen] = useState(false);
  const [selectedBankTx, setSelectedBankTx] = useState<any>(null);
  const [fiscalYear, setFiscalYear] = useState({ startMonth: 1, startDay: 1 });
  const [isFiscalYearLoading, setIsFiscalYearLoading] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('');
  const [selectedBankId, setSelectedBankId] = useState('');
  const [profileData, setProfileData] = useState({
    name: '',
    address: '',
    tin: '',
    phone: ''
  });

  useEffect(() => {
    fetchData();
  }, [activeSub, reportStartDate, reportEndDate]);

  const refreshApprovalCount = () => {
    accountingApi.getApprovalCount().then(res => setApprovalCount(Number(res.data.count) || 0)).catch(() => undefined);
  };
  useEffect(refreshApprovalCount, [activeSub]);

  useEffect(() => {
    if (activeSub === 'accounting-transactions') fetchLedger();
  }, [activeSub, ledgerFilters]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setLedgerFilters(f => (f.q === ledgerSearch.trim() ? f : { ...f, q: ledgerSearch.trim(), page: 1 }));
    }, 350);
    return () => clearTimeout(timer);
  }, [ledgerSearch]);

  const ledgerParams = () => ({
    q: ledgerFilters.q || undefined,
    startDate: ledgerFilters.startDate || undefined,
    endDate: ledgerFilters.endDate || undefined,
    type: ledgerFilters.type !== 'all' ? ledgerFilters.type : undefined,
  });

  const fetchLedger = async () => {
    setIsLedgerLoading(true);
    try {
      const res = await accountingApi.getTransactions({ ...ledgerParams(), page: ledgerFilters.page, pageSize: JOURNAL_PAGE_SIZE });
      setTransactions(res.data.rows);
      setLedgerTotal(res.data.total);
    } catch (error: any) {
      toast.error(errorText(error, 'Failed to load the general ledger'));
    } finally {
      setIsLedgerLoading(false);
    }
  };

  const loadOpeningBalances = async (date?: string) => {
    const res = await accountingApi.getOpeningBalances(date);
    setObInfo(res.data);
    return res.data;
  };

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const settingsRes = await settingsApi.getSettings();
      setCompanySettings(settingsRes.data);

      if (activeSub === 'accounting-bank') {
        const [accRes, txRes, coaRes] = await Promise.all([
          accountingApi.getBankAccounts(),
          accountingApi.getBankTransactions(),
          accountingApi.getCOA()
        ]);
        setBankAccounts(accRes.data);
        setBankTx(txRes.data);
        setCOA(coaRes.data);
      } else if (activeSub === 'accounting-ar' || activeSub === 'accounting-invoices') {
        const [invRes, projRes, accRes, svcRes, taxRes] = await Promise.all([
          accountingApi.getInvoices(),
          projectsApi.getProjects(),
          accountingApi.getBankAccounts(),
          catalogApi.getServices({ active: true }).catch(() => ({ data: [] as Service[] })),
          accountingApi.getTaxSettings().catch(() => ({ data: { tax_components: [] } }))
        ]);
        setInvoices(invRes.data);
        setProjects(projRes.data);
        setBankAccounts(accRes.data);
        setServices(svcRes.data);
        setTaxComponents(taxRes.data.tax_components || []);
      } else if (activeSub === 'accounting-ap') {
        const [billsRes, supRes, accRes, coaRes, projRes, taxRes] = await Promise.all([
          accountingApi.getBills(),
          procurementApi.getSuppliers(),
          accountingApi.getBankAccounts(),
          accountingApi.getCOA(),
          projectsApi.getProjects(),
          accountingApi.getTaxSettings().catch(() => ({ data: { wht_rate: 7.5 } }))
        ]);
        setBills(billsRes.data);
        setSuppliers(supRes.data);
        setBankAccounts(accRes.data);
        setCOA(coaRes.data);
        setProjects(projRes.data);
        setDefaultWhtRate(Number(taxRes.data.wht_rate ?? 7.5));
      } else if (activeSub === 'accounting-transactions') {
        const [coaRes, btx, projRes] = await Promise.all([
          accountingApi.getCOA(),
          accountingApi.getBankTransactions(),
          projectsApi.getProjects().catch(() => ({ data: [] }))
        ]);
        setCOA(coaRes.data);
        setBankTx(btx.data);
        setProjects(projRes.data);
      } else if (activeSub === 'accounting-coa') {
        const [coaRes, accRes] = await Promise.all([
          accountingApi.getCOA(),
          accountingApi.getBankAccounts()
        ]);
        setCOA(coaRes.data);
        setBankAccounts(accRes.data);
      } else if (activeSub === 'accounting-reports') {
        const request = ++reportRequest.current;
        const [tb, inc, bs, mgmt, btx, invRes, billsRes, projRes, accRes, fyRes] = await Promise.all([
          accountingApi.getTrialBalance(reportStartDate, reportEndDate),
          accountingApi.getIncomeStatement(reportStartDate, reportEndDate),
          accountingApi.getBalanceSheet(reportEndDate),
          accountingApi.getManagementAccounts(reportStartDate, reportEndDate),
          accountingApi.getBankTransactions(),
          accountingApi.getInvoices(),
          accountingApi.getBills(),
          projectsApi.getProjects().catch(() => ({ data: [] })),
          accountingApi.getBankAccounts(),
          accountingApi.getFiscalYear().catch(() => null)
        ]);
        if (request !== reportRequest.current) return;
        if (fyRes?.data) setFiscalYear(fyRes.data);
        setTrialBalance(tb.data);
        setIncomeStatement(inc.data);
        setBalanceSheet(bs.data);
        setManagementAccounts(mgmt.data);
        setBankTx(btx.data);
        setInvoices(invRes.data);
        setBills(billsRes.data);
        setProjects(projRes.data);
        setBankAccounts(accRes.data);
      } else if (activeSub === 'accounting-foundation') {
        const [fyRes, coaRes, obRes] = await Promise.all([
          accountingApi.getFiscalYear(),
          accountingApi.getCOA(),
          accountingApi.getOpeningBalances()
        ]);
        setFiscalYear(fyRes.data);
        setCOA(coaRes.data);

        // Prefill only from the existing opening-balance journal, never from running balances.
        const balMap: Record<string, number> = {};
        (obRes.data.balances || []).forEach((b: any) => { balMap[String(b.account_id)] = Number(b.amount || 0); });
        setOpeningBalances(balMap);
        setObInfo(obRes.data);
        setObDate(obRes.data.journal?.date || '');
        
        // Initialize profile data from settings
        setProfileData({
          name: settingsRes.data.find((s: any) => s.key === 'company_name')?.value || '',
          address: settingsRes.data.find((s: any) => s.key === 'company_address')?.value || '',
          tin: settingsRes.data.find((s: any) => s.key === 'company_tin')?.value || '',
          phone: settingsRes.data.find((s: any) => s.key === 'company_phone')?.value || ''
        });
      }
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to load accounting data');
    } finally {
      setIsLoading(false);
    }
  };

  const getSetting = (key: string) => companySettings.find(s => s.key === key)?.value || '';
  const currSym = getCurrencySymbol(getSetting('currency'));
  const money = (value: unknown) => formatWithSymbol(value, currSym);
  const compactMoney = (value: number) => formatCompactWithSymbol(value, currSym);

  const [showZeroRows, setShowZeroRows] = useState(false);
  const showStatementRow = (a: any) => showZeroRows || Math.abs(Number(a.total_debit || 0) - Number(a.total_credit || 0)) >= 0.005;
  const showTrialBalanceRow = (a: any) => showZeroRows
    || [a.opening_balance, a.period_debit, a.period_credit, a.total_debit, a.total_credit].some(v => Math.abs(Number(v || 0)) >= 0.005);
  const signTone = (value: number) => (value < -0.005 ? 'text-rose-600' : '');

  const statementRevenue = incomeStatement.filter(a => a.type === 'Income').reduce((s, a) => s + (Number(a.total_credit || 0) - Number(a.total_debit || 0)), 0);
  const statementExpenses = incomeStatement.filter(a => a.type === 'Expense').reduce((s, a) => s + (Number(a.total_debit || 0) - Number(a.total_credit || 0)), 0);
  const statementNet = statementRevenue - statementExpenses;

  const projectFigures = (p: any) => {
    const projectInvoices = invoices.filter(inv => inv.project_id === p.id && inv.status !== 'void');
    const projectBills = bills.filter(b => b.project_id === p.id && String(b.status).toLowerCase() !== 'void');
    const revenue = projectInvoices.reduce((s, inv: any) => s + Number(inv.subtotal ?? inv.amount) * (Number(inv.amount) > 0 ? 1 - Number(inv.credited_amount || 0) / Number(inv.amount) : 1), 0);
    const cost = projectBills.reduce((s, b) => s + Number(b.amount), 0);
    return { revenue, cost, profit: revenue - cost };
  };

  const openAccountDrill = async (a: any, dates: { start: string; end: string }, label: string) => {
    const matchingBank = bankAccounts.find((ba: any) => String(ba.coa_account_id) === String(a.id));
    setSelectedPeriodLabel(label);
    setPeriodFilterDates(dates);
    setPeriodFilterAccountId(matchingBank ? String(matchingBank.id) : null);
    setSelectedCOAId(String(a.id));
    setDrillDownMode(matchingBank ? 'bank' : 'ledger');
    setIsPeriodBankDetailsOpen(true);
    try {
      const res = await accountingApi.getLedgerEntries(a.id);
      setLedgerEntries(res.data);
    } catch (error) {
      toast.error("Failed to load ledger details");
    }
  };
  const accountingConfig = JSON.parse(getSetting('accounting_config') || '{"sales_tax_rate": "15", "tax_name": "VAT"}');


  // Bank Actions
  const handleAddBankAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    const coaLink = formData.get('coa_account_id') as string;
    const data = {
      account_name: formData.get('account_name'),
      account_number: formData.get('account_number'),
      bank_name: formData.get('bank_name'),
      type: formData.get('type'),
      coa_account_id: coaLink && coaLink !== 'new' ? Number(coaLink) : null
    };
    try {
      await accountingApi.addBankAccount(data);
      toast.success('Bank account added');
      setIsAddBankOpen(false);
      fetchData();
    } catch (error: any) {
      toast.error(errorText(error, 'Failed to add bank account'));
    }
  };

  const handleLinkBank = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    try {
      await accountingApi.updateBankAccount(linkBankTarget.id, { coa_account_id: Number(formData.get('coa_account_id')) });
      toast.success('Bank account linked to the ledger');
      setLinkBankTarget(null);
      fetchData();
    } catch (error: any) {
      toast.error(errorText(error, 'Failed to link bank account'));
    }
  };

  // AR Actions
  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    const projId = formData.get('project_id') as string;
    const project = projects.find(p => p.id === projId);

    const subtotal = invoiceItems.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
    const taxAmount = invoiceApplyTax ? taxComponents.reduce((s, c) => s + Math.round(subtotal * c.rate) / 100, 0) : 0;
    const totalAmount = subtotal + taxAmount;
    const invoiceDate = (formData.get('date') as string) || todayIso();

    const initialPaymentAmount = Number(formData.get('initial_payment') || 0);
    const paymentMethod = formData.get('payment_method') as string;
    const paymentBankAccountId = formData.get('payment_bank_account_id') as string;
    const paymentReference = formData.get('payment_reference') as string;

    if (initialPaymentAmount > totalAmount) {
      toast.error('Payment cannot exceed the invoice total');
      return;
    }

    if (initialPaymentAmount > 0 && !paymentMethod) {
      toast.error('Payment method is required to record the initial payment');
      return;
    }

    if (initialPaymentAmount > 0 && paymentMethod !== 'Cash' && !paymentBankAccountId) {
      toast.error('Bank account is required for non-cash payments');
      return;
    }

    const data = {
      client: project?.client || formData.get('client_name'),
      date: invoiceDate,
      dueDate: formData.get('dueDate'),
      project_id: projId,
      apply_tax: invoiceApplyTax,
      items: invoiceItems
    };
    try {
      const created = await accountingApi.createInvoice(data);
      const invoiceId = created.data.id;
      if (initialPaymentAmount > 0) {
        const paymentData: any = {
          target_type: 'Invoice',
          target_id: invoiceId,
          amount: initialPaymentAmount,
          date: invoiceDate,
          method: paymentMethod,
          reference: paymentReference || (paymentMethod === 'Cash' ? 'Cash Payment' : '')
        };
        // Only include bank_account_id if not Cash payment
        if (paymentMethod !== 'Cash') {
          paymentData.bank_account_id = paymentBankAccountId;
        }
        try {
          await accountingApi.recordPayment(paymentData);
          toast.success(`Invoice ${invoiceId} posted and initial payment recorded`);
        } catch (paymentError: any) {
          toast.error(`Invoice ${invoiceId} was posted, but the payment failed: ${errorText(paymentError, 'unknown error')}`);
        }
      } else {
        toast.success(`Invoice ${invoiceId} posted`);
      }
      setIsCreateInvoiceOpen(false);
      setInvoiceItems([{ description: '', quantity: 1, unitPrice: 0 }]);
      setInvoiceApplyTax(true);
      fetchData();
    } catch (error: any) {
      toast.error(errorText(error, 'Failed to generate invoice'));
    }
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    const method = formData.get('method') as string;
    const data: any = {
      target_type: selectedTarget?.type,
      target_id: selectedTarget?.id,
      amount: Number(formData.get('amount')),
      date: (formData.get('date') as string) || todayIso(),
      method: method,
      reference: formData.get('reference') || (method === 'Cash' ? 'Cash Payment' : ''),
      wht_rate: Number(formData.get('wht_rate') || 0)
    };
    // Only include bank_account_id if not Cash payment
    if (method !== 'Cash') {
      data.bank_account_id = formData.get('bank_account_id');
    }
    try {
      await accountingApi.recordPayment(data);
      toast.success('Payment recorded to ledger');
      setIsPayInvoiceOpen(false);
      setIsPayBillOpen(false);
      setBillPaymentWhtRate('0');
      fetchData();
    } catch (error: any) {
      toast.error(errorText(error, 'Failed to record payment'));
    }
  };

  const handleVoid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!voidTarget) return;
    const formData = new FormData(e.target as HTMLFormElement);
    const payload = { date: formData.get('date') as string, reason: formData.get('reason') as string };
    try {
      const res = voidTarget.kind === 'invoice'
        ? await accountingApi.voidInvoice(voidTarget.id, payload)
        : await accountingApi.voidBill(voidTarget.id, payload);
      toast.success(res.data.message);
      setVoidTarget(null);
      fetchData();
      refreshApprovalCount();
    } catch (error: any) {
      toast.error(errorText(error, 'Failed to void'));
    }
  };

  const handleCreditNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!creditNoteTarget) return;
    const formData = new FormData(e.target as HTMLFormElement);
    try {
      const res = await accountingApi.createCreditNote(creditNoteTarget.id, {
        date: formData.get('date') as string,
        amount: Number(formData.get('amount')),
        reason: formData.get('reason') as string
      });
      toast.success(res.data.message);
      setCreditNoteTarget(null);
      fetchData();
      refreshApprovalCount();
    } catch (error: any) {
      toast.error(errorText(error, 'Failed to issue credit note'));
    }
  };

  // AP Actions
  const handleRecordBill = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    if (!billAccountId) {
      toast.error('Select the expense or asset account for this bill');
      return;
    }
    const data = {
      supplier_id: formData.get('supplier_id'),
      quantity: Number(formData.get('quantity')),
      unit_price: Number(formData.get('unit_price')),
      amount: Number(formData.get('amount')),
      date: (formData.get('date') as string) || todayIso(),
      due_date: formData.get('due_date'),
      reference: formData.get('reference') || undefined,
      category: billCategory || coa.find(a => String(a.id) === billAccountId)?.name,
      account_id: Number(billAccountId),
      project_id: formData.get('project_id')
    };
    try {
      const res = await accountingApi.recordBill(data);
      if (res.data.request) toast.info(res.data.message);
      else toast.success('Vendor bill recorded');
      refreshApprovalCount();
      setIsRecordBillOpen(false);
      setBillCategory('');
      setBillAccountId('');
      fetchData();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to record bill');
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
      type: formData.get('type')
    };
    try {
      await accountingApi.updateCOA(selectedTarget.id, data);
      toast.success('Account updated successfully');
      setIsEditAccountOpen(false);
      fetchData();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to update account');
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
    const projectId = formData.get('project_id') as string;
    const data: any = {
      date: formData.get('date'),
      description: formData.get('description'),
      project_id: projectId && projectId !== 'none' ? projectId : null,
      items: journalItems.filter(item => item.account_id !== ''),
      reason: formData.get('correction_reason') || undefined
    };
    try {
      if (editingJournalId) {
        const res = await accountingApi.updateJournal(editingJournalId, data);
        toast.success(res.data.message);
        refreshApprovalCount();
      } else {
        try {
          await accountingApi.postJournal(data);
        } catch (error: any) {
          if (error.response?.status !== 409 || !error.response?.data?.duplicate) throw error;
          if (!window.confirm(error.response.data.message)) return;
          await accountingApi.postJournal({ ...data, force: true });
        }
      }
      if (!editingJournalId) toast.success('Journal entry posted');
      setIsJournalOpen(false);
      setEditingJournalId(null);
      setEditingJournal(null);
      setJournalItems([{ account_id: '', debit: 0, credit: 0 }, { account_id: '', debit: 0, credit: 0 }]);
      fetchData();
      if (activeSub === 'accounting-transactions') fetchLedger();
    } catch (error: any) {
      toast.error(errorText(error, 'Failed to post journal entry'));
    }
  };

  const openNewJournal = () => {
    setJournalItems([{ account_id: '', debit: 0, credit: 0 }, { account_id: '', debit: 0, credit: 0 }]);
    setEditingJournalId(null);
    setEditingJournal(null);
    setJournalFormKey(k => k + 1);
    setIsJournalOpen(true);
  };

  /** Loads a journal into the editor; system-generated entries must be changed from their source document. */
  const openJournalEditor = async (journalId: string | number) => {
    try {
      const res = await accountingApi.getJournalDetails(journalId);
      if (res.data.status === 'reversed') {
        toast.info(`Journal #${res.data.id} has already been reversed${res.data.reversed_by_journal_id ? ` by #${res.data.reversed_by_journal_id}` : ''}.`);
        return false;
      }
      if (!res.data.editable) {
        toast.info(`This is a ${String(res.data.reference_type).replace('_', ' ')} entry. Change it from its source document (void or credit note) instead of editing the journal.`);
        return false;
      }
      if (res.data.pending_request) {
        toast.info(`Request #${res.data.pending_request.id} for this journal is already waiting for admin approval.`);
        return false;
      }
      if (!coa.length) {
        const coaRes = await accountingApi.getCOA();
        setCOA(coaRes.data);
      }
      setJournalItems(res.data.items.map((i: any) => ({ account_id: String(i.account_id), debit: Number(i.debit), credit: Number(i.credit) })));
      setEditingJournal({ date: String(res.data.date).slice(0, 10), description: res.data.description || '', project_id: res.data.project_id });
      setEditingJournalId(String(res.data.id));
      setJournalFormKey(k => k + 1);
      setIsJournalOpen(true);
      return true;
    } catch (error: any) {
      toast.error(errorText(error, 'Failed to load journal'));
      return false;
    }
  };

  const handleDeleteJournal = async (journalId: string | number) => {
    const reason = window.prompt('Void this journal entry? Once an admin approves, a reversing entry is posted and the original stays on record.\n\nReason for voiding:');
    if (reason === null) return false;
    if (reason.trim().length < 3) {
      toast.error('A reason is required to void a journal');
      return false;
    }
    try {
      const res = await accountingApi.deleteJournal(journalId, reason.trim());
      toast.success(res.data.message);
      refreshApprovalCount();
      fetchData();
      if (activeSub === 'accounting-transactions') fetchLedger();
      return true;
    } catch (error: any) {
      toast.error(errorText(error, 'Failed to delete journal'));
      return false;
    }
  };

  const handleExportLedger = async () => {
    try {
      const res = await accountingApi.exportTransactions(ledgerParams());
      downloadCsv('general_ledger', ['Date', 'Journal #', 'Description', 'Type', 'Reference', 'Project', 'Account Code', 'Account Name', 'Debit', 'Credit'],
        res.data.map((r: any) => [String(r.date).slice(0, 10), r.journal_id, r.description, r.reference_type, r.reference_id, r.project_id, r.account_code, r.account_name, Number(r.debit || 0).toFixed(2), Number(r.credit || 0).toFixed(2)]));
    } catch (error: any) {
      toast.error(errorText(error, 'Failed to export the ledger'));
    }
  };

  const handleSaveProfile = async () => {
    setIsSaving(true);
    try {
      await Promise.all([
        settingsApi.updateSetting('company_name', profileData.name),
        settingsApi.updateSetting('company_address', profileData.address),
        settingsApi.updateSetting('company_tin', profileData.tin),
        settingsApi.updateSetting('company_phone', profileData.phone)
      ]);
      toast.success('Company profile saved');
      fetchData();
    } catch (error: any) {
      toast.error(errorText(error, 'Failed to update company profile'));
    } finally {
      setIsSaving(false);
    }
  };

  const branding = () => brandingFrom(companySettings, user);

  /** `content` must already be escaped; docNumber is printed in the header and footer. */
  const handlePrintDocument = (title: string, content: string, docNumber?: string) => {
    openPrintWindow(title, content, branding(), docNumber);
  };

  const handleExportCSV = (filename: string, headers: string[], rows: string[][]) => downloadCsv(filename, headers, rows);

  const handlePrintIncomeStatement = () => {
    const logo = getSetting('company_logo');
    const companyName = getSetting('company_name') || 'ENGINEERING ERP';
    const companyAddress = getSetting('company_address') || '';
    const signature = getSetting('company_signature');

    const totalRevenue = incomeStatement.filter(a => a.type === 'Income').reduce((s: number, a: any) => s + (a.total_credit - a.total_debit), 0);
    const totalExpenses = incomeStatement.filter(a => a.type === 'Expense').reduce((s: number, a: any) => s + (a.total_debit - a.total_credit), 0);
    const netIncome = totalRevenue - totalExpenses;

    const revenueRows = incomeStatement.filter(a => a.type === 'Income').map((a: any) => 
      `<tr><td style="padding: 8px 16px;">${escapeHtml(a.name)}</td><td style="padding: 8px 16px; text-align: right;">${money((a.total_credit - a.total_debit))}</td></tr>`
    ).join('');

    const expenseRows = incomeStatement.filter(a => a.type === 'Expense').map((a: any) => 
      `<tr><td style="padding: 8px 16px;">${escapeHtml(a.name)}</td><td style="padding: 8px 16px; text-align: right;">${money((a.total_debit - a.total_credit))}</td></tr>`
    ).join('');

    const content = `
      <div style="margin-bottom: 30px;">
        <h3 style="font-size: 0.9rem; color: #666; margin-bottom: 10px;">Period: ${reportStartDate} to ${reportEndDate}</h3>
      </div>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
        <thead>
          <tr style="background: #F5F5F5;">
            <th style="border: 1px solid #E4E3E0; padding: 12px; text-align: left; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em;">Account</th>
            <th style="border: 1px solid #E4E3E0; padding: 12px; text-align: right; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em;">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr style="background: #E8F5E9;">
            <td colspan="2" style="border: 1px solid #E4E3E0; padding: 12px; font-weight: bold; color: #2E7D32;">Revenue</td>
          </tr>
          ${revenueRows}
          <tr style="background: #F5F5F5; font-weight: bold;">
            <td style="border: 1px solid #E4E3E0; padding: 12px;">Total Revenue</td>
            <td style="border: 1px solid #E4E3E0; padding: 12px; text-align: right; font-weight: bold; color: #2E7D32;">${money(totalRevenue)}</td>
          </tr>
          <tr style="background: #FFEBEE;">
            <td colspan="2" style="border: 1px solid #E4E3E0; padding: 12px; font-weight: bold; color: #C62828;">Operating Expenses</td>
          </tr>
          ${expenseRows}
          <tr style="background: #F5F5F5; font-weight: bold;">
            <td style="border: 1px solid #E4E3E0; padding: 12px;">Total Expenses</td>
            <td style="border: 1px solid #E4E3E0; padding: 12px; text-align: right; font-weight: bold; color: #C62828;">${money(totalExpenses)}</td>
          </tr>
          <tr style="background: #141414; color: white;">
            <td style="border: 1px solid #E4E3E0; padding: 12px; font-weight: bold; font-size: 1.1rem;">${netIncome < 0 ? 'Net Loss' : 'Net Income'}</td>
            <td style="border: 1px solid #E4E3E0; padding: 12px; text-align: right; font-weight: bold; font-size: 1.2rem;">${money(netIncome)}</td>
          </tr>
        </tbody>
      </table>
    `;

    handlePrintDocument(`INCOME STATEMENT - ${companyName}`, content);
  };

  const handleExportIncomeStatementExcel = () => {
    const totalRevenue = incomeStatement.filter(a => a.type === 'Income').reduce((s: number, a: any) => s + (a.total_credit - a.total_debit), 0);
    const totalExpenses = incomeStatement.filter(a => a.type === 'Expense').reduce((s: number, a: any) => s + (a.total_debit - a.total_credit), 0);
    const netIncome = totalRevenue - totalExpenses;

    const data = [
      ['Income Statement'],
      [`Company: ${getSetting('company_name') || 'ENGINEERING ERP'}`],
      [`Period: ${reportStartDate} to ${reportEndDate}`],
      [`Generated: ${new Date().toLocaleDateString()}`],
      [],
      ['Account', 'Amount'],
      [],
      ['Revenue'],
      ...incomeStatement.filter(a => a.type === 'Income').map((a: any) => [`  ${a.name}`, Number(a.total_credit || 0) - Number(a.total_debit || 0)]),
      ['Total Revenue', totalRevenue],
      [],
      ['Operating Expenses'],
      ...incomeStatement.filter(a => a.type === 'Expense').map((a: any) => [`  ${a.name}`, Number(a.total_debit || 0) - Number(a.total_credit || 0)]),
      ['Total Expenses', totalExpenses],
      [],
      ['Net Income', netIncome],
    ];

    const ws = XLSX.utils.aoa_to_sheet(data);
    
    // Set column widths
    ws['!cols'] = [{ wch: 35 }, { wch: 20 }];

    // Apply number formats
    const currency = getSetting('currency') || 'GHS';
    const numFormat = currency === 'USD' ? '"$"#,##0.00;-"$"#,##0.00' : '"GH₵ "#,##0.00;-"GH₵ "#,##0.00';
    
    for (const cellId in ws) {
      if (cellId.startsWith('!')) continue;
      const cell = ws[cellId];
      if (cell && cell.t === 'n') {
        cell.z = numFormat;
      }
    }
    
    // Create workbook
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Income Statement');

    // Generate and download
    XLSX.writeFile(wb, `Income_Statement_${new Date().toISOString().split('T')[0]}.xlsx`);
    toast.success('Income Statement exported to Excel successfully');
  };

  const handlePrintBalanceSheet = () => {
    const logo = getSetting('company_logo');
    const companyName = getSetting('company_name') || 'ENGINEERING ERP';
    const companyAddress = getSetting('company_address') || '';
    const signature = getSetting('company_signature');

    const assets = balanceSheet.accounts.filter((a: any) => a.type === 'Asset');
    const liabilities = balanceSheet.accounts.filter((a: any) => a.type === 'Liability');
    const equity = balanceSheet.accounts.filter((a: any) => a.type === 'Equity');
    
    const totalAssets = assets.reduce((s: number, a: any) => s + (Number(a.total_debit || 0) - Number(a.total_credit || 0)), 0);
    const totalLiabilities = liabilities.reduce((s: number, a: any) => s + (Number(a.total_credit || 0) - Number(a.total_debit || 0)), 0);
    const totalEquity = equity.reduce((s: number, a: any) => s + (Number(a.total_credit || 0) - Number(a.total_debit || 0)), 0) + Number(balanceSheet.retainedEarnings || 0);

    const assetRows = assets.map((a: any) => {
      const bal = Number(a.total_debit || 0) - Number(a.total_credit || 0);
      return `<tr><td style="padding: 8px 16px;">${escapeHtml(a.name)}</td><td style="padding: 8px 16px; text-align: right;">${money(bal)}</td></tr>`;
    }).join('');

    const liabilityRows = liabilities.map((a: any) => {
      const bal = Number(a.total_credit || 0) - Number(a.total_debit || 0);
      return `<tr><td style="padding: 8px 16px;">${escapeHtml(a.name)}</td><td style="padding: 8px 16px; text-align: right;">${money(bal)}</td></tr>`;
    }).join('');

    const equityRows = equity.map((a: any) => {
      const bal = Number(a.total_credit || 0) - Number(a.total_debit || 0);
      return `<tr><td style="padding: 8px 16px;">${escapeHtml(a.name)}</td><td style="padding: 8px 16px; text-align: right;">${money(bal)}</td></tr>`;
    }).join('');

    const content = `
      <div style="margin-bottom: 30px;">
        <h3 style="font-size: 0.9rem; color: #666; margin-bottom: 10px;">As of: ${reportEndDate}</h3>
      </div>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
        <thead>
          <tr style="background: #F5F5F5;">
            <th style="border: 1px solid #E4E3E0; padding: 12px; text-align: left; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em;">Account</th>
            <th style="border: 1px solid #E4E3E0; padding: 12px; text-align: right; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em;">Balance</th>
          </tr>
        </thead>
        <tbody>
          <tr style="background: #E3F2FD;">
            <td colspan="2" style="border: 1px solid #E4E3E0; padding: 12px; font-weight: bold; color: #1565C0;">Assets</td>
          </tr>
          ${assetRows}
          <tr style="background: #F5F5F5; font-weight: bold;">
            <td style="border: 1px solid #E4E3E0; padding: 12px;">Total Assets</td>
            <td style="border: 1px solid #E4E3E0; padding: 12px; text-align: right; font-weight: bold; color: #1565C0;">${money(totalAssets)}</td>
          </tr>
          <tr style="background: #FFEBEE;">
            <td colspan="2" style="border: 1px solid #E4E3E0; padding: 12px; font-weight: bold; color: #C62828;">Liabilities</td>
          </tr>
          ${liabilityRows}
          <tr style="background: #F5F5F5; font-weight: bold;">
            <td style="border: 1px solid #E4E3E0; padding: 12px;">Total Liabilities</td>
            <td style="border: 1px solid #E4E3E0; padding: 12px; text-align: right; font-weight: bold; color: #C62828;">${money(totalLiabilities)}</td>
          </tr>
          <tr style="background: #F3E5F5;">
            <td colspan="2" style="border: 1px solid #E4E3E0; padding: 12px; font-weight: bold; color: #6A1B9A;">Equity</td>
          </tr>
          ${equityRows}
          <tr style="background: #F5F5F5;">
            <td style="border: 1px solid #E4E3E0; padding: 12px;">Retained Earnings</td>
            <td style="border: 1px solid #E4E3E0; padding: 12px; text-align: right;">${money(balanceSheet.retainedEarnings)}</td>
          </tr>
          <tr style="background: #F5F5F5; font-weight: bold;">
            <td style="border: 1px solid #E4E3E0; padding: 12px;">Total Equity</td>
            <td style="border: 1px solid #E4E3E0; padding: 12px; text-align: right; font-weight: bold; color: #6A1B9A;">${money(totalEquity)}</td>
          </tr>
          <tr style="background: #141414; color: white;">
            <td style="border: 1px solid #E4E3E0; padding: 12px; font-weight: bold; font-size: 1.1rem;">Total Liabilities & Equity</td>
            <td style="border: 1px solid #E4E3E0; padding: 12px; text-align: right; font-weight: bold; font-size: 1.2rem;">${money((totalLiabilities + totalEquity))}</td>
          </tr>
        </tbody>
      </table>
    `;

    handlePrintDocument(`BALANCE SHEET - ${companyName}`, content);
  };

  const handleExportBalanceSheetExcel = () => {
    const assets = balanceSheet.accounts.filter((a: any) => a.type === 'Asset');
    const liabilities = balanceSheet.accounts.filter((a: any) => a.type === 'Liability');
    const equity = balanceSheet.accounts.filter((a: any) => a.type === 'Equity');
    
    const totalAssets = assets.reduce((s: number, a: any) => s + (Number(a.total_debit || 0) - Number(a.total_credit || 0)), 0);
    const totalLiabilities = liabilities.reduce((s: number, a: any) => s + (Number(a.total_credit || 0) - Number(a.total_debit || 0)), 0);
    const totalEquity = equity.reduce((s: number, a: any) => s + (Number(a.total_credit || 0) - Number(a.total_debit || 0)), 0) + Number(balanceSheet.retainedEarnings || 0);

    const data = [
      ['Balance Sheet'],
      [`Company: ${getSetting('company_name') || 'ENGINEERING ERP'}`],
      [`As of: ${reportEndDate}`],
      [`Generated: ${new Date().toLocaleDateString()}`],
      [],
      ['Account', 'Balance'],
      [],
      ['Assets'],
      ...assets.map((a: any) => [`  ${a.name}`, Number(a.total_debit || 0) - Number(a.total_credit || 0)]),
      ['Total Assets', totalAssets],
      [],
      ['Liabilities'],
      ...liabilities.map((a: any) => [`  ${a.name}`, Number(a.total_credit || 0) - Number(a.total_debit || 0)]),
      ['Total Liabilities', totalLiabilities],
      [],
      ['Equity'],
      ...equity.map((a: any) => [`  ${a.name}`, Number(a.total_credit || 0) - Number(a.total_debit || 0)]),
      ['  Retained Earnings', Number(balanceSheet.retainedEarnings || 0)],
      ['Total Equity', totalEquity],
      [],
      ['Total Liabilities & Equity', totalLiabilities + totalEquity],
    ];

    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [{ wch: 35 }, { wch: 20 }];
    
    // Apply number formats
    const currency = getSetting('currency') || 'GHS';
    const numFormat = currency === 'USD' ? '"$"#,##0.00;-"$"#,##0.00' : '"GH₵ "#,##0.00;-"GH₵ "#,##0.00';
    
    for (const cellId in ws) {
      if (cellId.startsWith('!')) continue;
      const cell = ws[cellId];
      if (cell && cell.t === 'n') {
        cell.z = numFormat;
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Balance Sheet');

    XLSX.writeFile(wb, `Balance_Sheet_${new Date().toISOString().split('T')[0]}.xlsx`);
    toast.success('Balance Sheet exported to Excel successfully');
  };

  if (isLoading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;
  }

  const renderContent = () => {
    switch (activeSub) {
      case 'accounting-approvals':
        return <ApprovalsPanel isAdmin={isAdmin} onChanged={refreshApprovalCount} />;
      case 'accounting-bank':
        return (
          <div className="space-y-6">
            <AccountingGuidance 
              title="Bank & Cash" 
              message="Each bank account is linked to a ledger account; the balance shown is the ledger balance. Import your bank statement, let the system match lines to ledger postings, and post anything unmatched (e.g. bank charges)." 
            />
            <div className="flex justify-end gap-2">
               <Dialog open={isAddBankOpen} onOpenChange={setIsAddBankOpen}>
                 <DialogTrigger asChild><Button className="bg-[#141414] text-white gap-2 font-bold h-11 shadow-lg"><Plus className="w-4 h-4" /> Add Bank Account</Button></DialogTrigger>
                 <DialogContent className="rounded-2xl">
                   <form onSubmit={handleAddBankAccount}>
                     <DialogHeader><DialogTitle>Add Bank Account</DialogTitle></DialogHeader>
                     <div className="grid gap-4 py-4">
                       <div className="space-y-2"><Label>Bank Name</Label><Input name="bank_name" required className="bg-[#F5F5F5] border-none h-11" placeholder="e.g. Standard Chartered"/></div>
                       <div className="space-y-2"><Label>Account Name</Label><Input name="account_name" required className="bg-[#F5F5F5] border-none h-11" /></div>
                       <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-2"><Label>Account Number</Label><Input name="account_number" required className="bg-[#F5F5F5] border-none h-11" /></div>
                          <div className="space-y-2">
                            <Label>Account Type</Label>
                            <Select name="type" required defaultValue="Current">
                              <SelectTrigger className="bg-[#F5F5F5] border-none h-11"><SelectValue /></SelectTrigger>
                              <SelectContent><SelectItem value="Current">Current / Checking</SelectItem><SelectItem value="Savings">Savings</SelectItem><SelectItem value="Mobile Money">Mobile Money</SelectItem><SelectItem value="Petty Cash">Petty Cash</SelectItem></SelectContent>
                            </Select>
                          </div>
                       </div>
                       <div className="space-y-2">
                         <Label>Ledger Account</Label>
                         <Select name="coa_account_id" defaultValue="new">
                           <SelectTrigger className="bg-[#F5F5F5] border-none h-11"><SelectValue /></SelectTrigger>
                           <SelectContent>
                             <SelectItem value="new">Create a new ledger account</SelectItem>
                             {coa.filter(a => a.type === 'Asset').map(a => <SelectItem key={a.id} value={String(a.id)}>{a.code} - {a.name}</SelectItem>)}
                           </SelectContent>
                         </Select>
                         <p className="text-xs text-[#8E9299]">To bring in an existing balance, use Opening Balances under Foundation & Setup.</p>
                       </div>
                     </div>
                     <DialogFooter><Button type="submit" className="w-full bg-[#141414] text-white h-11 font-bold">ADD ACCOUNT</Button></DialogFooter>
                   </form>
                 </DialogContent>
               </Dialog>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {bankAccounts.map(b => (
                <Card 
                  key={b.id} 
                  className="border-none shadow-sm rounded-2xl bg-gradient-to-br from-[#141414] to-slate-900 text-white overflow-hidden cursor-pointer transition-all hover:scale-[1.02] hover:shadow-xl active:scale-[0.98]"
                  onClick={() => {
                    setSelectedPeriodLabel(`Statement for ${b.account_name} (${b.bank_name})`);
                    setPeriodFilterDates(null);
                    setPeriodFilterAccountId(String(b.id));
                    setSelectedCOAId(b.coa_account_id ? String(b.coa_account_id) : null);
                    setDrillDownMode('ledger');
                    setIsPeriodBankDetailsOpen(true);
                    if (b.coa_account_id) {
                      accountingApi.getLedgerEntries(b.coa_account_id).then(res => setLedgerEntries(res.data));
                    } else {
                      setLedgerEntries([]);
                    }
                  }}
                >
                  <CardHeader className="pb-2">
                    <div className="flex justify-between items-start">
                      <div className="p-2 bg-white/10 rounded-xl"><PiggyBank className="w-5 h-5 text-white" /></div>
                      <Badge className="bg-white/10 text-white border-none text-[10px] uppercase font-bold">{b.type}</Badge>
                    </div>
                    <CardDescription className="text-white/60 mt-4 text-xs font-bold uppercase tracking-widest">{b.bank_name}</CardDescription>
                    <CardTitle className="text-lg">{b.account_name}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-sm font-mono text-white/50 mb-1">{String(b.account_number || '').replace(/\d(?=\d{4})/g, "*")}</div>
                    {b.coa_account_id ? (
                      <>
                        <div className="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-3">Ledger: {b.coa_code} {b.coa_name}</div>
                        <div className="text-3xl font-black">{money(b.ledger_balance)}</div>
                      </>
                    ) : (
                      <div className="mt-3 space-y-2">
                        <p className="text-xs text-yellow-300 font-bold">Not linked to a ledger account</p>
                        <Button size="sm" variant="secondary" className="h-8 text-xs font-bold" onClick={(e) => { e.stopPropagation(); setLinkBankTarget(b); }}>Link ledger account</Button>
                      </div>
                    )}
                    <div className="mt-4 flex items-center justify-between">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-white/40">Next Cheque</div>
                      <div className="flex items-center gap-2">
                        <div className="text-xs font-mono font-bold text-blue-400 bg-blue-400/10 px-2 py-1 rounded-lg">#{b.next_cheque_number || 1}</div>
                        {b.coa_account_id && (
                          <button className="text-[10px] font-bold text-white/40 hover:text-white underline" onClick={(e) => { e.stopPropagation(); setLinkBankTarget(b); }}>Change link</button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <BankReconcilePanel
              bankAccounts={bankAccounts}
              bankTx={bankTx}
              coa={coa}
              currSym={currSym}
              onChanged={fetchData}
              onEditLine={(tx) => { setSelectedBankTx(tx); setIsEditBankTxOpen(true); }}
              onOpenJournal={(journalId) => { openJournalEditor(journalId); }}
            />

            <Dialog open={!!linkBankTarget} onOpenChange={(open) => !open && setLinkBankTarget(null)}>
              <DialogContent className="rounded-2xl">
                <form onSubmit={handleLinkBank}>
                  <DialogHeader>
                    <DialogTitle>Link {linkBankTarget?.account_name} to the ledger</DialogTitle>
                    <DialogDescription>Payments through this bank account will post to the chosen ledger account.</DialogDescription>
                  </DialogHeader>
                  <div className="py-4 space-y-2">
                    <Label>Ledger Account</Label>
                    <Select name="coa_account_id" required defaultValue={linkBankTarget?.coa_account_id ? String(linkBankTarget.coa_account_id) : undefined}>
                      <SelectTrigger className="bg-[#F5F5F5] border-none h-11"><SelectValue placeholder="Choose an asset account" /></SelectTrigger>
                      <SelectContent>{coa.filter(a => a.type === 'Asset').map(a => <SelectItem key={a.id} value={String(a.id)}>{a.code} - {a.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <DialogFooter><Button type="submit" className="w-full bg-[#141414] text-white h-11 font-bold">SAVE LINK</Button></DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        );

      case 'accounting-ap':
        return (
          <div className="space-y-6">
            <AccountingGuidance 
              title="Accounts Payable (AP) Control" 
              message="Track obligations to suppliers. Recording a bill increases liabilities and expenses. Payments clear these liabilities and reduce cash assets." 
            />
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold">Accounts Payable</h2>
                <p className="text-sm text-[#8E9299]">Vendor bills and cash outflows.</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="gap-2 rounded-xl font-bold" onClick={() => handleExportCSV('accounts_payable', ['Supplier', 'Category', 'Due Date', 'Amount', 'Status'], bills.map((b: any) => [b.supplier_name, b.category, new Date(b.due_date).toLocaleDateString(), String(b.amount), b.status]))}><FileSpreadsheet className="w-4 h-4" /> Export CSV</Button>
                <Dialog open={isRecordBillOpen} onOpenChange={setIsRecordBillOpen}>
                  <DialogTrigger asChild><Button className="bg-[#141414] text-white gap-2 font-bold h-11"><Plus className="w-4 h-4" /> Enter Bill</Button></DialogTrigger>
                  <DialogContent className="rounded-2xl">
                    <form onSubmit={handleRecordBill}>
                      <DialogHeader><DialogTitle>Log Vendor</DialogTitle></DialogHeader>
                      <div className="grid gap-4 py-4">
                        <div className="space-y-2">
                          <Label>Supplier</Label>
                          <Select name="supplier_id" required>
                            <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue /></SelectTrigger>
                            <SelectContent>{suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Expense Category</Label>
                          <CategorySelect
                            type="expense"
                            value={billCategory}
                            onValueChange={(name) => {
                              setBillCategory(name);
                              const linkedAccount = expenseCategories.find(c => c.name === name)?.account_id;
                              if (linkedAccount && coa.some(a => a.id === linkedAccount)) setBillAccountId(String(linkedAccount));
                            }}
                            placeholder="e.g. Food, Fuel, Transport..."
                            triggerClassName="bg-[#F5F5F5] border-none"
                          />
                        </div>
                        <div className="grid gap-4 sm:grid-cols-3">
                          <div className="space-y-2"><Label>Quantity</Label><Input type="number" name="quantity" required min="1" value={billQuantity} onChange={e => setBillQuantity(Number(e.target.value))} className="bg-[#F5F5F5] border-none" /></div>
                          <div className="space-y-2"><Label>Unit Price</Label><AmountInput required value={billUnitPrice} onValueChange={setBillUnitPrice} className="bg-[#F5F5F5] border-none text-right" /><input type="hidden" name="unit_price" value={billUnitPrice} /></div>
                          <div className="space-y-2 col-span-full sm:col-span-1"><Label>Total Amount ({currSym})</Label><Input type="number" name="amount" required readOnly value={(billQuantity * billUnitPrice).toFixed(2)} className="bg-blue-50 border-none font-bold text-lg text-blue-900" /></div>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-2"><Label>Bill Date</Label><Input type="date" name="date" required defaultValue={todayIso()} className="bg-[#F5F5F5] border-none" /></div>
                          <div className="space-y-2"><Label>Supplier Invoice No.</Label><Input name="reference" placeholder="Optional" className="bg-[#F5F5F5] border-none" /></div>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-2"><Label>Due Date</Label><Input type="date" name="due_date" required className="bg-[#F5F5F5] border-none" /></div>
                          <div className="space-y-2">
                            <Label>Project Assignment</Label>
                            <Select name="project_id">
                              <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue placeholder="Select Project" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">General Office / No Project</SelectItem>
                                {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.id} - {p.name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="space-y-2">
<Label>Expense / Asset Account (Job Cost Category)</Label>
                          <Select name="account_id" required value={billAccountId} onValueChange={setBillAccountId}>
                            <SelectTrigger className="bg-[#F5F5F5] border-none font-bold"><SelectValue placeholder="Select Account" /></SelectTrigger>
                            <SelectContent>
                              {coa.filter(a => a.type === 'Expense' || (a.type === 'Asset' && a.code.startsWith('12'))).map(a => (
                                <SelectItem key={a.id} value={String(a.id)}>{a.code} - {a.name} ({a.type === 'Asset' ? 'Fixed Asset' : 'Expense'})</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
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
                <TableHeader><TableRow className="bg-[#F5F5F5]/50"><TableHead>Supplier</TableHead><TableHead>Category</TableHead><TableHead>Bill Date</TableHead><TableHead>Due Date</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
                <TableBody>
                  {bills.map((bill, idx) => {
                    const statusLower = bill.status?.toLowerCase();
                    return (
                      <TableRow key={idx} className={statusLower === 'void' ? 'opacity-50' : ''}>
                        <TableCell className="font-bold text-[#141414]">{bill.supplier_name}{bill.reference && <p className="text-[10px] text-[#8E9299] font-mono">Inv {bill.reference}</p>}</TableCell>
                        <TableCell className="text-[#8E9299] text-xs font-medium">{bill.category}</TableCell>
                        <TableCell className="font-mono text-xs">{formatDate(bill.date || bill.created_at)}</TableCell>
                        <TableCell className="font-mono text-xs">{formatDate(bill.due_date)}</TableCell>
                        <TableCell className="text-right font-black text-red-600">
                          {money(Number(bill.amount))}
                          {statusLower === 'partially_paid' && bill.balance_due !== undefined && (
                            <p className="text-[10px] text-orange-600 mt-1">Due: {money(Number(bill.balance_due))}</p>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge className={
                            statusLower === 'paid' ? 'bg-green-100 text-green-700 border-none' : 
                            statusLower === 'partially_paid' ? 'bg-orange-100 text-orange-700 border-none' : 
                            statusLower === 'void' ? 'bg-gray-100 text-gray-500 border-none' :
                            statusLower === 'pending_approval' ? 'bg-yellow-100 text-yellow-700 border-none' :
                            'bg-red-50 text-red-600 border-none'
                          }>
                            {bill.status.replace('_', ' ').toUpperCase()}
                          </Badge>
                          {bill.pending_request && bill.pending_request.action !== 'create' && (
                            <Badge className="ml-1 bg-yellow-100 text-yellow-700 border-none">{bill.pending_request.action === 'void' ? 'VOID PENDING' : 'CORRECTION PENDING'}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end items-center">
                            <Button variant="ghost" size="sm" className="font-bold h-8 text-xs" onClick={() => { setSelectedBill(bill); setIsBillDetailsOpen(true); }}>
                              <Eye className="w-4 h-4" />
                            </Button>
                            <AttachmentsButton entityType="bill" entityId={bill.id} label={`Bill ${bill.id}`} />
                            {Number(bill.paid_amount || 0) > 0 && (
                              <Button variant="ghost" size="sm" className="h-8 text-xs" title="Payments on this bill" onClick={() => setPaymentsTarget({ type: 'Bill', id: String(bill.id), label: `Bill ${bill.id} (${bill.supplier_name})` })}>
                                <History className="w-4 h-4" />
                              </Button>
                            )}
                            {statusLower !== 'paid' && statusLower !== 'void' && statusLower !== 'pending_approval' && bill.pending_request?.action !== 'void' && (
                              <Button variant="outline" size="sm" className="font-bold h-8 text-xs border-[#141414]" onClick={() => { setSelectedTarget({ type: 'Bill', id: bill.id, amount: bill.amount, balance_due: bill.balance_due ?? bill.amount }); setBillPaymentWhtRate('0'); setIsPayBillOpen(true); }}>
                                PAY
                              </Button>
                            )}
                            {statusLower !== 'void' && statusLower !== 'pending_approval' && !bill.pending_request && (
                              <Button variant="ghost" size="sm" className="font-bold h-8 text-xs text-amber-600" onClick={() => setCorrectionTarget({ kind: 'bill', record: bill })}>
                                CORRECT
                              </Button>
                            )}
                            {statusLower === 'unpaid' && Number(bill.paid_amount || 0) === 0 && !bill.pending_request && (
                              <Button variant="ghost" size="sm" className="font-bold h-8 text-xs text-red-600" onClick={() => setVoidTarget({ kind: 'bill', id: String(bill.id), label: `Bill ${bill.id} (${bill.supplier_name})` })}>
                                VOID
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Payment Modal */}
            <Dialog open={isPayBillOpen} onOpenChange={setIsPayBillOpen}>
              <DialogContent className="rounded-2xl">
                <form onSubmit={handleRecordPayment}>
                  <DialogHeader><DialogTitle>Process Payment</DialogTitle></DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Amount Settled (gross)</Label>
                        <Input 
                          name="amount" 
                          type="number" 
                          step="0.01"
                          defaultValue={selectedTarget?.balance_due ?? selectedTarget?.amount} 
                          max={selectedTarget?.balance_due ?? selectedTarget?.amount} 
                          required 
                          className="bg-[#F5F5F5] border-none font-bold" 
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Payment Date</Label>
                        <Input name="date" type="date" required defaultValue={todayIso()} className="bg-[#F5F5F5] border-none" />
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Withholding Tax</Label>
                        <Select name="wht_rate" value={billPaymentWhtRate} onValueChange={setBillPaymentWhtRate}>
                          <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="0">None</SelectItem>
                            {[...new Set([defaultWhtRate, 3, 5, 7.5, 15, 20])].map(r => <SelectItem key={r} value={String(r)}>{r}%</SelectItem>)}
                          </SelectContent>
                        </Select>
                        {Number(billPaymentWhtRate) > 0 && <p className="text-[10px] text-[#8E9299]">Withheld amount is credited to Withholding Tax Payable (2102); the bank pays the net.</p>}
                      </div>
                      <div className="space-y-2">
                        <Label>Method</Label>
                        <Select name="method" required onValueChange={setPaymentMethod}>
                          <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="Bank Transfer">Bank Transfer</SelectItem><SelectItem value="Cheque">Cheque</SelectItem><SelectItem value="Mobile Money">Momo</SelectItem><SelectItem value="Cash">Cash</SelectItem></SelectContent>
                        </Select>
                      </div>
                    </div>
                    {paymentMethod !== 'Cash' && (
                      <div className="space-y-2">
                        <Label>Source Bank Account</Label>
                        <Select name="bank_account_id" required onValueChange={setSelectedBankId}>
                          <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue /></SelectTrigger>
                          <SelectContent>{bankAccounts.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.account_name} ({b.bank_name})</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    )}
                    <div className="space-y-2">
                      <Label>Reference Note</Label>
                      <Input 
                        name="reference" 
                        required={paymentMethod !== 'Cash'}
                        className="bg-[#F5F5F5] border-none" 
                        placeholder={paymentMethod === 'Cash' ? "Optional (e.g., Receipt #)" : paymentMethod === 'Cheque' ? "Cheque No." : "Reference / TX Hash"} 
                        defaultValue={paymentMethod === 'Cheque' && selectedBankId ? (bankAccounts.find(b => String(b.id) === selectedBankId)?.next_cheque_number || '') : ''}
                        key={`${paymentMethod}-${selectedBankId}`}
                      />
                    </div>
                  </div>
                  <DialogFooter><Button type="submit" className="w-full bg-[#141414] text-white h-11 font-bold">CONFIRM DISBURSEMENT</Button></DialogFooter>
                </form>
              </DialogContent>
            </Dialog>

            {/* Bill Details Modal */}
            <Dialog open={isBillDetailsOpen} onOpenChange={setIsBillDetailsOpen}>
              <DialogContent className="rounded-2xl">
                <DialogHeader>
                  <DialogTitle>Bill Details</DialogTitle>
                  <DialogDescription>View complete information about this bill</DialogDescription>
                </DialogHeader>
                {selectedBill && (
                  <div className="grid gap-4 py-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label className="text-xs font-bold text-[#8E9299]">Supplier</Label>
                        <div className="p-3 bg-[#F5F5F5] rounded-xl font-bold">{selectedBill.supplier_name}</div>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs font-bold text-[#8E9299]">Category</Label>
                        <div className="p-3 bg-[#F5F5F5] rounded-xl font-medium">{selectedBill.category}</div>
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label className="text-xs font-bold text-[#8E9299]">Amount</Label>
                        <div className="p-3 bg-red-50 rounded-xl font-black text-red-600">{money(Number(selectedBill.amount))}</div>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs font-bold text-[#8E9299]">Due Date</Label>
                        <div className="p-3 bg-[#F5F5F5] rounded-xl font-mono">{new Date(selectedBill.due_date).toLocaleDateString()}</div>
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label className="text-xs font-bold text-[#8E9299]">Status</Label>
                        <Badge className={
                          selectedBill.status?.toLowerCase() === 'paid' ? 'bg-green-100 text-green-700 border-none' : 
                          selectedBill.status?.toLowerCase() === 'partially_paid' ? 'bg-orange-100 text-orange-700 border-none' : 
                          'bg-red-50 text-red-600 border-none'
                        }>
                          {selectedBill.status?.toUpperCase()}
                        </Badge>
                      </div>
                      {selectedBill.status?.toLowerCase() === 'partially_paid' && selectedBill.balance_due !== undefined && (
                        <div className="space-y-2">
                          <Label className="text-xs font-bold text-[#8E9299]">Balance Due</Label>
                          <div className="p-3 bg-orange-50 rounded-xl font-bold text-orange-600">{money(Number(selectedBill.balance_due))}</div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsBillDetailsOpen(false)} className="font-bold">Close</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        );

      case 'accounting-ar':
      case 'accounting-invoices': {
        const invoiceSubtotal = invoiceItems.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
        const invoiceTaxLines = invoiceApplyTax ? taxComponents.map(c => ({ ...c, amount: Math.round(invoiceSubtotal * c.rate) / 100 })) : [];
        const invoiceTotal = invoiceSubtotal + invoiceTaxLines.reduce((s, c) => s + c.amount, 0);
        const printInvoice = (inv: any) => {
          let itemsArr: any[] = [];
          try {
            itemsArr = typeof inv.items === 'string' ? JSON.parse(inv.items) : (inv.items || []);
          } catch {
            itemsArr = [];
          }
          let breakdown: any[] = [];
          try {
            breakdown = typeof inv.tax_breakdown === 'string' ? JSON.parse(inv.tax_breakdown) : (inv.tax_breakdown || []);
          } catch {
            breakdown = [];
          }
          const cell = 'padding: 10px; border-bottom: 1px solid #E4E3E0;';
          const itemsHtml = itemsArr.length > 0 ? itemsArr.map((it: any) => `
            <tr>
              <td style="${cell}">${escapeHtml(it.description || 'Service')}</td>
              <td style="${cell} text-align: center;">${escapeHtml(it.quantity ?? 1)}</td>
              <td style="${cell} text-align: right;">${money(it.unitPrice)}</td>
              <td style="${cell} text-align: right;">${money(Number(it.quantity || 1) * Number(it.unitPrice || 0))}</td>
            </tr>`).join('') : `<tr><td colspan="4" style="padding: 20px; text-align: center;">Standard Service Charge</td></tr>`;
          const taxRows = breakdown.length > 0
            ? breakdown.map((b: any) => `<tr><td colspan="3" style="padding: 6px 10px; text-align: right; color: #8E9299;">${escapeHtml(b.name)} (${escapeHtml(b.rate)}%):</td><td style="padding: 6px 10px; text-align: right;">${money(b.amount)}</td></tr>`).join('')
            : Number(inv.tax_amount || 0) > 0
              ? `<tr><td colspan="3" style="padding: 6px 10px; text-align: right; color: #8E9299;">${escapeHtml(inv.tax_name || 'Tax')}:</td><td style="padding: 6px 10px; text-align: right;">${money(inv.tax_amount)}</td></tr>`
              : '';
          const content = `
            <div style="margin-top: 40px;">
              ${inv.status === 'void' ? '<p style="color: #C62828; font-weight: bold; font-size: 1.2rem;">VOID</p>' : ''}
              <div style="display: flex; justify-content: space-between; margin-bottom: 40px; gap: 20px; flex-wrap: wrap;">
                <div>
                  <h4 style="color: #8E9299; text-transform: uppercase; font-size: 0.7rem; margin-bottom: 5px;">Bill To:</h4>
                  <h3 style="margin: 0;">${escapeHtml(inv.client)}</h3>
                </div>
                <div style="text-align: right;">
                  <h4 style="color: #8E9299; text-transform: uppercase; font-size: 0.7rem; margin-bottom: 5px;">Invoice Details:</h4>
                  <p style="margin: 0;"><strong>Invoice No:</strong> ${escapeHtml(inv.id)}</p>
                  <p style="margin: 0;"><strong>Invoice Date:</strong> ${escapeHtml(formatDate(inv.date || inv.created_at))}</p>
                  <p style="margin: 0;"><strong>Due Date:</strong> ${escapeHtml(formatDate(inv.dueDate))}</p>
                </div>
              </div>
              <div style="margin-bottom: 24px; display: flex; gap: 24px; flex-wrap: wrap;">
                <div style="min-width: 160px;"><p style="margin: 0 0 8px 0; color: #8E9299; font-size: 0.75rem; text-transform: uppercase;">Amount Paid</p><p style="margin: 0; font-weight: 700;">${money(inv.paid_amount)}</p></div>
                ${Number(inv.credited_amount || 0) > 0 ? `<div style="min-width: 160px;"><p style="margin: 0 0 8px 0; color: #8E9299; font-size: 0.75rem; text-transform: uppercase;">Credited</p><p style="margin: 0; font-weight: 700;">${money(inv.credited_amount)}</p></div>` : ''}
                <div style="min-width: 160px;"><p style="margin: 0 0 8px 0; color: #8E9299; font-size: 0.75rem; text-transform: uppercase;">Balance Due</p><p style="margin: 0; font-weight: 700;">${money(inv.balance_due)}</p></div>
              </div>
              <table style="width: 100%; border-collapse: collapse;">
                <thead style="background: #F5F5F5;">
                  <tr>
                    <th style="padding: 10px; text-align: left;">Description</th>
                    <th style="padding: 10px; text-align: center;">Qty</th>
                    <th style="padding: 10px; text-align: right;">Unit Price</th>
                    <th style="padding: 10px; text-align: right;">Total</th>
                  </tr>
                </thead>
                <tbody>${itemsHtml}</tbody>
                <tfoot>
                  <tr><td colspan="3" style="padding: 10px; text-align: right; color: #8E9299;">Subtotal:</td><td style="padding: 10px; text-align: right;">${money(inv.subtotal ?? inv.amount)}</td></tr>
                  ${taxRows}
                  <tr style="font-size: 1.2rem; font-weight: bold;"><td colspan="3" style="padding: 20px 10px; text-align: right;">Grand Total:</td><td style="padding: 20px 10px; text-align: right; color: #2563eb;">${money(inv.amount)}</td></tr>
                </tfoot>
              </table>
            </div>`;
          handlePrintDocument('SALES INVOICE', content, String(inv.id));
        };
        return (
          <div className="space-y-6">
            <AccountingGuidance 
              title="Accounts Receivable" 
              message="Raising an invoice records income and creates a receivable. Receiving payment converts receivables into cash. Mistakes are corrected with a void (unpaid invoices) or a credit note, so the ledger keeps a full audit trail." 
            />
            <div className="flex flex-wrap justify-between items-center gap-3">
              <div className="flex gap-1 bg-[#F5F5F5] p-1 rounded-xl">
                <Button variant={arView === 'invoices' ? 'default' : 'ghost'} size="sm" className="rounded-lg font-bold" onClick={() => setArView('invoices')}>Invoices</Button>
                <Button variant={arView === 'aging' ? 'default' : 'ghost'} size="sm" className="rounded-lg font-bold" onClick={() => setArView('aging')}>Aging & Statements</Button>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="gap-2 rounded-xl font-bold" onClick={() => handleExportCSV('accounts_receivable', ['Invoice No', 'Customer', 'Invoice Date', 'Due Date', 'Amount', 'Paid', 'Credited', 'Balance Due', 'Status'], invoices.map((inv: any) => [inv.id, inv.client, formatDate(inv.date || inv.created_at), formatDate(inv.dueDate), Number(inv.amount).toFixed(2), Number(inv.paid_amount || 0).toFixed(2), Number(inv.credited_amount || 0).toFixed(2), Number(inv.balance_due || 0).toFixed(2), inv.status]))}><FileSpreadsheet className="w-4 h-4" /> Export CSV</Button>
                <Dialog open={isCreateInvoiceOpen} onOpenChange={setIsCreateInvoiceOpen}>
                  <DialogTrigger asChild><Button className="bg-blue-600 text-white gap-2 font-bold h-11 px-6 rounded-xl shadow-lg shadow-blue-500/20"><Plus className="w-4 h-4" /> Raise Sales Invoice</Button></DialogTrigger>
                  <DialogContent className="max-w-2xl rounded-2xl">
                    <form onSubmit={handleCreateInvoice}>
                      <DialogHeader><DialogTitle>New Sales Invoice</DialogTitle><DialogDescription>The invoice number is assigned automatically when it is posted.</DialogDescription></DialogHeader>
                      <div className="grid gap-6 py-4">
                        <div className="grid gap-4 sm:grid-cols-3">
                          <div className="space-y-2">
                            <Label>Project / Client</Label>
                            <Select name="project_id" required>
                              <SelectTrigger className="bg-[#F5F5F5] border-none rounded-xl h-11"><SelectValue placeholder="Select project..." /></SelectTrigger>
                              <SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name} ({p.client})</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2"><Label>Invoice Date</Label><Input name="date" type="date" required defaultValue={todayIso()} className="bg-[#F5F5F5] border-none rounded-xl h-11" /></div>
                          <div className="space-y-2"><Label>Due Date</Label><Input name="dueDate" type="date" required className="bg-[#F5F5F5] border-none rounded-xl h-11" /></div>
                        </div>

                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <Label className="font-bold text-blue-600">Invoice Line Items</Label>
                            <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg border-blue-200 text-blue-600 hover:bg-blue-50" onClick={() => setInvoiceItems([...invoiceItems, { description: '', quantity: 1, unitPrice: 0 }])}>
                              <Plus className="w-3 h-3 mr-1" /> Add New Row
                            </Button>
                          </div>
                          <div className="hidden sm:grid grid-cols-12 gap-2 px-3 text-[10px] font-black uppercase text-[#8E9299]">
                            <div className="col-span-5">Description</div>
                            <div className="col-span-2 text-center">Qty</div>
                            <div className="col-span-2 text-right">Price</div>
                            <div className="col-span-2 text-right">Total</div>
                          </div>
                          <div className="space-y-2">
                            {invoiceItems.map((item, idx) => (
                              <div key={idx} className="grid grid-cols-12 gap-2 items-center bg-[#F5F5F5]/50 p-2 rounded-xl border border-[#F5F5F5]">
                                <div className="col-span-12 sm:col-span-5 min-w-0 space-y-1">
                                  {services.length > 0 && (
                                    <Select
                                      value={item.service_id ? String(item.service_id) : ''}
                                      onValueChange={(serviceId) => {
                                        const service = services.find(s => String(s.id) === serviceId);
                                        if (!service) return;
                                        const newItems = [...invoiceItems];
                                        newItems[idx] = { ...newItems[idx], description: service.name, unitPrice: Number(service.default_price), service_id: String(service.id) };
                                        setInvoiceItems(newItems);
                                      }}
                                    >
                                      <SelectTrigger className="bg-white border-none h-8 rounded-lg text-xs text-[#8E9299]"><SelectValue placeholder="Pick a saved service..." /></SelectTrigger>
                                      <SelectContent>
                                        {services.map(s => (
                                          <SelectItem key={s.id} value={String(s.id)}>{s.name} ({money(Number(s.default_price))} / {s.unit})</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  )}
                                  <Input
                                    placeholder="Item/Service name"
                                    value={item.description}
                                    onChange={(e) => {
                                      const newItems = [...invoiceItems];
                                      newItems[idx] = { ...newItems[idx], description: e.target.value };
                                      setInvoiceItems(newItems);
                                    }}
                                    required
                                    className="bg-white border-none h-9 rounded-lg text-xs"
                                  />
                                </div>
                                <div className="col-span-3 sm:col-span-2">
                                  <Input
                                    type="number"
                                    step="any"
                                    aria-label={`Line ${idx + 1} quantity`}
                                    value={item.quantity}
                                    onChange={(e) => {
                                      const newItems = [...invoiceItems];
                                      newItems[idx] = { ...newItems[idx], quantity: Number(e.target.value) };
                                      setInvoiceItems(newItems);
                                    }}
                                    required
                                    className="bg-white border-none h-9 rounded-lg text-xs text-center"
                                  />
                                </div>
                                <div className="col-span-4 sm:col-span-2">
                                  <AmountInput
                                    aria-label={`Line ${idx + 1} unit price`}
                                    value={item.unitPrice}
                                    onValueChange={(v) => {
                                      const newItems = [...invoiceItems];
                                      newItems[idx] = { ...newItems[idx], unitPrice: v };
                                      setInvoiceItems(newItems);
                                    }}
                                    className="bg-white border-none h-9 rounded-lg text-xs text-right"
                                  />
                                </div>
                                <div className="col-span-4 sm:col-span-2 text-right font-bold text-xs text-[#141414] whitespace-nowrap tabular-nums">
                                  {fmtMoney(item.quantity * item.unitPrice)}
                                </div>
                                <div className="col-span-1 flex justify-end">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-red-500 hover:bg-red-50 rounded-lg"
                                    aria-label={`Remove line ${idx + 1}`}
                                    title="Remove line"
                                    onClick={() => {
                                      if (invoiceItems.length > 1) {
                                        setInvoiceItems(invoiceItems.filter((_, i) => i !== idx));
                                      }
                                    }}
                                  >
                                    ×
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="p-4 bg-blue-50/50 border border-blue-100 rounded-2xl space-y-2">
                          <div className="flex justify-between items-center text-sm">
                            <span className="text-blue-600 font-medium">Subtotal</span>
                            <span className="font-bold">{money(invoiceSubtotal)}</span>
                          </div>
                          <label className="flex items-center gap-2 text-sm text-blue-700 font-medium cursor-pointer">
                            <input type="checkbox" checked={invoiceApplyTax} onChange={(e) => setInvoiceApplyTax(e.target.checked)} />
                            Charge taxes ({taxComponents.map(c => `${c.name} ${c.rate}%`).join(' + ') || 'none configured'})
                          </label>
                          {invoiceTaxLines.map(c => (
                            <div key={c.code} className="flex justify-between items-center text-sm">
                              <span className="text-blue-600 font-medium">{c.name} ({c.rate}%)</span>
                              <span className="font-bold">{money(c.amount)}</span>
                            </div>
                          ))}
                          <div className="flex justify-between items-center pt-2 border-t border-blue-100">
                            <div>
                              <p className="text-[10px] font-black uppercase text-blue-600 tracking-widest">Total Invoice Amount</p>
                              <p className="text-xs text-blue-800 font-medium">{invoiceItems.length} line items specified</p>
                            </div>
                            <div className="text-right">
                              <p className="text-2xl font-black text-blue-700">{money(invoiceTotal)}</p>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-4">
                          <div>
                            <p className="text-sm font-bold text-slate-800">Record initial payment</p>
                            <p className="text-xs text-slate-500">Optional: capture the first payment when raising the invoice.</p>
                          </div>
                          <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                              <Label>Amount Received</Label>
                              <Input name="initial_payment" type="number" min="0" step="0.01" defaultValue={0} className="bg-white border-slate-200" />
                            </div>
                            <div className="space-y-2">
                              <Label>Payment Method</Label>
                              <Select name="payment_method" onValueChange={(value) => setPaymentMethod(value)}>
                                <SelectTrigger className="bg-white border-slate-200"><SelectValue placeholder="Optional" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="Bank Direct">Bank Direct</SelectItem>
                                  <SelectItem value="Cheque">Cheque</SelectItem>
                                  <SelectItem value="Mobile Money">Mobile Money</SelectItem>
                                  <SelectItem value="Cash">Cash</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          {paymentMethod !== 'Cash' && (
                            <div className="grid gap-4 sm:grid-cols-2">
                              <div className="space-y-2">
                                <Label>Destination Bank Account</Label>
                                <Select name="payment_bank_account_id">
                                  <SelectTrigger className="bg-white border-slate-200"><SelectValue placeholder="Select bank account" /></SelectTrigger>
                                  <SelectContent>
                                    {bankAccounts.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.account_name} ({b.bank_name})</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-2">
                                <Label>Reference / Cheque No.</Label>
                                <Input name="payment_reference" className="bg-white border-slate-200" placeholder="Reference / Cheque No." />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                      <DialogFooter><Button type="submit" className="bg-blue-600 text-white w-full rounded-xl font-bold h-12 shadow-lg shadow-blue-500/20 uppercase tracking-wider">GENERATE & POST INVOICE</Button></DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            </div>

            {arView === 'aging' ? (
              <ArAgingPanel currSym={currSym} branding={branding()} />
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-[#F5F5F5] shadow-sm">
                <Table className="bg-white">
                  <TableHeader><TableRow className="bg-[#F5F5F5]/50"><TableHead>Invoice No</TableHead><TableHead>Customer</TableHead><TableHead>Invoice Date</TableHead><TableHead>Due Date</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {invoices.map((inv: any) => {
                      const isVoid = inv.status === 'void';
                      const hasPayments = Number(inv.paid_amount || 0) > 0 || Number(inv.credited_amount || 0) > 0;
                      return (
                        <TableRow key={inv.id} className={isVoid ? 'opacity-50' : 'hover:bg-blue-50/20'}>
                          <TableCell className="font-bold text-blue-600">{inv.id}</TableCell>
                          <TableCell className="font-bold text-[#141414]">{inv.client}</TableCell>
                          <TableCell className="text-[#8E9299] text-xs font-mono">{formatDate(inv.date || inv.created_at)}</TableCell>
                          <TableCell className="text-[#8E9299] text-xs font-mono">{formatDate(inv.dueDate)}</TableCell>
                          <TableCell className="text-right font-black">
                            {money(inv.amount)}
                            {!isVoid && Number(inv.balance_due) > 0 && Number(inv.balance_due) < Number(inv.amount) && (
                              <p className="text-[10px] text-orange-600 mt-1">Due: {money(inv.balance_due)}</p>
                            )}
                            {Number(inv.credited_amount || 0) > 0 && <p className="text-[10px] text-purple-600">Credited: {money(inv.credited_amount)}</p>}
                          </TableCell>
                          <TableCell>
                            <Badge className={inv.status === 'paid' ? 'bg-green-100 text-green-700 border-none' : inv.status === 'partially_paid' ? 'bg-orange-100 text-orange-700 border-none' : isVoid ? 'bg-gray-100 text-gray-500 border-none' : 'bg-yellow-50 text-yellow-600 border-none'}>{String(inv.status).replace('_', ' ').toUpperCase()}</Badge>
                            {inv.pending_request && (
                              <Badge className="ml-1 bg-yellow-100 text-yellow-700 border-none">
                                {inv.pending_request.action === 'void' ? 'VOID PENDING' : inv.pending_request.action === 'credit_note' ? 'CREDIT PENDING' : 'CORRECTION PENDING'}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex gap-1 justify-end items-center">
                              {hasPayments && (
                                <Button variant="ghost" size="sm" className="h-8 text-xs" title="Payments on this invoice" onClick={() => setPaymentsTarget({ type: 'Invoice', id: String(inv.id), label: `Invoice ${inv.id}` })}>
                                  <History className="w-4 h-4" />
                                </Button>
                              )}
                              {!isVoid && !inv.pending_request && (
                                <Button variant="ghost" size="sm" className="font-bold h-8 text-xs text-amber-600" onClick={() => setCorrectionTarget({ kind: 'invoice', record: inv })}>CORRECT</Button>
                              )}
                              {!isVoid && inv.status !== 'paid' && inv.pending_request?.action !== 'void' && (
                                <Button variant="outline" size="sm" className="font-bold h-8 text-xs border-[#141414]" onClick={() => { setSelectedTarget({ type: 'Invoice', id: inv.id, amount: inv.amount, balance_due: inv.balance_due ?? inv.amount }); setIsPayInvoiceOpen(true); }}>
                                  RECEIVE
                                </Button>
                              )}
                              <Button variant="ghost" size="sm" className="font-bold h-8 text-xs text-blue-600" title="Print invoice" onClick={() => printInvoice(inv)}><Printer className="w-3 h-3" /></Button>
                              <AttachmentsButton entityType="invoice" entityId={inv.id} label={`Invoice ${inv.id}`} />
                              {!isVoid && Number(inv.balance_due) > 0 && !inv.pending_request && (
                                <Button variant="ghost" size="sm" className="font-bold h-8 text-xs text-purple-600" onClick={() => setCreditNoteTarget(inv)}>CREDIT</Button>
                              )}
                              {!isVoid && !hasPayments && !inv.pending_request && (
                                <Button variant="ghost" size="sm" className="font-bold h-8 text-xs text-red-600" onClick={() => setVoidTarget({ kind: 'invoice', id: String(inv.id), label: `Invoice ${inv.id}` })}>VOID</Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Receive Payment Modal */}
            <Dialog open={isPayInvoiceOpen} onOpenChange={setIsPayInvoiceOpen}>
              <DialogContent className="rounded-2xl">
                <form onSubmit={handleRecordPayment}>
                  <DialogHeader><DialogTitle>Receive Payment</DialogTitle></DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2"><Label>Amount Settled (gross)</Label><Input name="amount" type="number" step="0.01" defaultValue={selectedTarget?.balance_due ?? selectedTarget?.amount} max={selectedTarget?.balance_due ?? selectedTarget?.amount} required className="bg-[#F5F5F5] border-none font-bold" /></div>
                      <div className="space-y-2"><Label>Date Received</Label><Input name="date" type="date" required defaultValue={todayIso()} className="bg-[#F5F5F5] border-none" /></div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Deposit Method</Label>
                        <Select name="method" required onValueChange={setPaymentMethod}>
                          <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="Bank Direct">Bank Direct</SelectItem><SelectItem value="Cheque">Cheque</SelectItem><SelectItem value="Mobile Money">Momo</SelectItem><SelectItem value="Cash">Cash</SelectItem></SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Tax Withheld by Client</Label>
                        <Select name="wht_rate" defaultValue="0">
                          <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="0">None</SelectItem>
                            {[...new Set([defaultWhtRate, 3, 5, 7.5])].map(r => <SelectItem key={r} value={String(r)}>{r}%</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    {paymentMethod !== 'Cash' && (
                      <div className="space-y-2">
                        <Label>Destination Bank Account</Label>
                        <Select name="bank_account_id" required>
                          <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue placeholder="Select bank account..." /></SelectTrigger>
                          <SelectContent>{bankAccounts.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.account_name} ({b.bank_name})</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    )}
                    <div className="space-y-2"><Label>Reference / Cheque No.</Label><Input name="reference" required={paymentMethod !== 'Cash'} className="bg-[#F5F5F5] border-none" placeholder={paymentMethod === 'Cash' ? "Optional (e.g., Receipt #)" : "Reference / Cheque No."} /></div>
                  </div>
                  <DialogFooter><Button type="submit" className="w-full bg-blue-600 text-white h-11 font-bold">RECORD PAYMENT</Button></DialogFooter>
                </form>
              </DialogContent>
            </Dialog>

            {/* Credit Note Modal */}
            <Dialog open={!!creditNoteTarget} onOpenChange={(open) => !open && setCreditNoteTarget(null)}>
              <DialogContent className="rounded-2xl">
                <form onSubmit={handleCreditNote}>
                  <DialogHeader>
                    <DialogTitle>Credit Note for {creditNoteTarget?.id}</DialogTitle>
                    <DialogDescription>Reduces what {creditNoteTarget?.client} owes. Revenue and output taxes are reversed in proportion to the original invoice. An admin must approve it before it posts.</DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2"><Label>Amount (incl. tax)</Label><Input name="amount" type="number" step="0.01" min="0.01" max={creditNoteTarget?.balance_due} defaultValue={creditNoteTarget?.balance_due} required className="bg-[#F5F5F5] border-none font-bold" /></div>
                      <div className="space-y-2"><Label>Date</Label><Input name="date" type="date" required defaultValue={todayIso()} className="bg-[#F5F5F5] border-none" /></div>
                    </div>
                    <div className="space-y-2"><Label>Reason</Label><Input name="reason" required className="bg-[#F5F5F5] border-none" placeholder="e.g. Discount agreed, work not delivered" /></div>
                  </div>
                  <DialogFooter><Button type="submit" className="w-full bg-purple-600 text-white h-11 font-bold">REQUEST CREDIT NOTE</Button></DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        );
      }

      case 'accounting-transactions': {
        const pageCount = Math.max(1, Math.ceil(ledgerTotal / JOURNAL_PAGE_SIZE));
        const openJournalDrillDown = async (tx: any) => {
          try {
            const res = await accountingApi.getJournalDetails(tx.id);
            setSelectedPeriodLabel(`Journal #${tx.id}: ${tx.description || ''}`);
            setPeriodFilterDates(null);
            setPeriodFilterAccountId(null);
            setSelectedCOAId(null);
            setLedgerEntries(res.data.items.map((i: any) => ({ ...i, journal_id: res.data.id, date: res.data.date, description: res.data.description, reference_type: res.data.reference_type })));
            setDrillDownMode('ledger');
            setIsPeriodBankDetailsOpen(true);
          } catch (error: any) {
            toast.error(errorText(error, 'Failed to load journal details'));
          }
        };
        const sourceTarget = (referenceType: string) => {
          const type = String(referenceType || '').toLowerCase();
          if (type.startsWith('bill')) return 'accounting-ap';
          if (type.startsWith('invoice') || type === 'credit_note') return 'accounting-ar';
          if (type === 'payroll') return 'hr-payroll';
          if (type === 'payment' || type === 'bank_transaction') return 'accounting-bank';
          return null;
        };
        return (
          <div className="space-y-6">
            <AccountingGuidance 
              title="Double-Entry General Ledger" 
              message="The General Ledger is the master record of all financial transactions. Only manual journals can be edited or deleted here; invoices, bills and payments are corrected from their source document so the audit trail stays intact." 
            />
            <div className="flex flex-wrap justify-between items-center gap-3">
              <div><h2 className="text-xl font-bold">General Ledger</h2><p className="text-sm text-[#8E9299]">{ledgerTotal.toLocaleString()} journal entries match the current filters.</p></div>
              <div className="flex gap-2">
                <Button variant="outline" className="gap-2 rounded-xl font-bold" onClick={handleExportLedger}><FileSpreadsheet className="w-4 h-4" /> Export CSV</Button>
                <Button variant="outline" className="gap-2 border-[#141414] text-[#141414] rounded-xl font-bold shadow-sm" onClick={openNewJournal}><BookOpen className="w-4 h-4" /> Manual Journal Post</Button>
              </div>
            </div>

            <div className="flex flex-wrap gap-3 items-end bg-white p-4 rounded-2xl border border-[#F5F5F5] shadow-sm">
              <div className="space-y-1 flex-1 min-w-[200px]">
                <Label className="text-[10px] font-bold uppercase text-[#8E9299]">Search</Label>
                <Input value={ledgerSearch} onChange={(e) => setLedgerSearch(e.target.value)} placeholder="Description, reference or journal #" className="bg-[#F5F5F5] border-none h-10" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] font-bold uppercase text-[#8E9299]">From</Label>
                <Input type="date" value={ledgerFilters.startDate} onChange={(e) => setLedgerFilters(f => ({ ...f, startDate: e.target.value, page: 1 }))} className="bg-[#F5F5F5] border-none h-10" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] font-bold uppercase text-[#8E9299]">To</Label>
                <Input type="date" value={ledgerFilters.endDate} onChange={(e) => setLedgerFilters(f => ({ ...f, endDate: e.target.value, page: 1 }))} className="bg-[#F5F5F5] border-none h-10" />
              </div>
              <div className="space-y-1 w-44">
                <Label className="text-[10px] font-bold uppercase text-[#8E9299]">Type</Label>
                <Select value={ledgerFilters.type} onValueChange={(v) => setLedgerFilters(f => ({ ...f, type: v, page: 1 }))}>
                  <SelectTrigger className="bg-[#F5F5F5] border-none h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    {LEDGER_TYPES.map(t => <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button variant="ghost" className="h-10 font-bold" onClick={() => { setLedgerSearch(''); setLedgerFilters({ q: '', startDate: '', endDate: '', type: 'all', page: 1 }); }}>Clear</Button>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-[#F5F5F5] shadow-sm">
              <Table className="bg-white">
                <TableHeader><TableRow className="bg-[#F5F5F5]/50"><TableHead>Date</TableHead><TableHead>#</TableHead><TableHead>Description</TableHead><TableHead>Type</TableHead><TableHead>Accounts</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
                <TableBody>
                  {transactions.map((tx: any) => {
                    const isReversed = tx.status === 'reversed';
                    const isManual = tx.reference_type === 'manual' && !isReversed && !tx.pending_request;
                    const target = sourceTarget(tx.reference_type);
                    return (
                      <TableRow key={tx.id} className="hover:bg-blue-50/20 cursor-pointer" onClick={() => openJournalDrillDown(tx)}>
                        <TableCell className="text-[#8E9299] font-mono text-xs whitespace-nowrap">{formatDate(tx.date)}</TableCell>
                        <TableCell className="text-[#8E9299] font-mono text-xs">{tx.id}</TableCell>
                        <TableCell className="font-bold text-[#141414]">{tx.description}{tx.reference_id && <p className="text-[10px] text-[#8E9299] font-mono">{tx.reference_id}</p>}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="border-[#E4E3E0] text-[#141414] uppercase text-[10px]">{String(tx.reference_type || '').replace(/_/g, ' ')}</Badge>
                          {isReversed && <Badge className="ml-1 bg-gray-100 text-gray-600 border-none text-[10px]">{tx.reversed_by_journal_id ? `REVERSED BY #${tx.reversed_by_journal_id}` : 'REVERSED'}</Badge>}
                          {tx.pending_request && <Badge className="ml-1 bg-yellow-100 text-yellow-700 border-none text-[10px]">{tx.pending_request.action === 'void' ? 'VOID PENDING' : 'CORRECTION PENDING'}</Badge>}
                          {tx.approval_request_id && <p className="text-[10px] text-[#8E9299] mt-1">Approval #{tx.approval_request_id}</p>}
                        </TableCell>
                        <TableCell className="text-xs text-[#8E9299] max-w-[260px] truncate" title={tx.accounts}>{tx.accounts}</TableCell>
                        <TableCell className="text-right font-black text-[#141414]">{money(tx.total_amount)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1 items-center" onClick={(e) => e.stopPropagation()}>
                            <AttachmentsButton entityType="journal" entityId={tx.id} label={`Journal #${tx.id}`} />
                            {isManual && (
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50" title="Request a correction" onClick={() => openJournalEditor(tx.id)}>
                                <Edit className="w-4 h-4" />
                              </Button>
                            )}
                            {target && onNavigate && (
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50" title={`Open source (${tx.reference_type})`} onClick={() => onNavigate(target)}>
                                <ExternalLink className="w-4 h-4" />
                              </Button>
                            )}
                            {isManual && (
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50" title="Request a void" onClick={() => handleDeleteJournal(tx.id)}>
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!isLedgerLoading && transactions.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-center py-16 text-[#8E9299]">No journal entries match these filters.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-[#8E9299] font-medium">{isLedgerLoading ? 'Loading…' : `Page ${ledgerFilters.page} of ${pageCount}`}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={ledgerFilters.page <= 1 || isLedgerLoading} onClick={() => setLedgerFilters(f => ({ ...f, page: f.page - 1 }))}>Previous</Button>
                <Button variant="outline" size="sm" disabled={ledgerFilters.page >= pageCount || isLedgerLoading} onClick={() => setLedgerFilters(f => ({ ...f, page: f.page + 1 }))}>Next</Button>
              </div>
            </div>

            <RecurringPanel coa={coa} projects={projects} currSym={currSym} onGenerated={() => { fetchLedger(); }} />
          </div>
        );
      }

      case 'accounting-reports':
        return (
          <div className="space-y-8">
            <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-[#141414]">Financial Position</h2>
                <p className="text-sm text-[#8E9299]">
                  {formatDate(reportStartDate)} – {formatDate(reportEndDate)}
                  {inclusiveDays(reportStartDate, reportEndDate) > 0 && ` · ${inclusiveDays(reportStartDate, reportEndDate)} days`}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <PeriodPresets startDate={reportStartDate} endDate={reportEndDate} fiscal={fiscalYear}
                  onChange={(start, end) => { setReportStartDate(start); setReportEndDate(end); }} />
                <div className="flex items-center gap-1 bg-[#F5F5F5] p-1 rounded-xl">
                  <Input type="date" aria-label="From" value={reportStartDate} max={reportEndDate} onChange={e => setReportStartDate(e.target.value)} className="bg-transparent border-none w-36 h-8 text-sm font-bold" />
                  <span className="text-[#8E9299] text-xs font-bold">to</span>
                  <Input type="date" aria-label="To" value={reportEndDate} min={reportStartDate} onChange={e => setReportEndDate(e.target.value)} className="bg-transparent border-none w-36 h-8 text-sm font-bold" />
                  <Button size="icon" title="Refresh" aria-label="Refresh reports" className="bg-[#141414] text-white rounded-lg h-8 w-8 ml-1" onClick={fetchData} disabled={isLoading}>
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex gap-2 border-b border-[#F5F5F5] overflow-x-auto pb-2">
              {['dashboard', 'income-statement', 'balance-sheet', 'trial-balance', 'cash-flow', 'tax-reports', 'project-analysis'].map(tab => (
                <button
                  key={tab}
                  onClick={() => setReportTab(tab)}
                  className={`px-4 py-2 rounded-xl text-sm font-bold capitalize whitespace-nowrap transition-all ${reportTab === tab ? 'bg-[#141414] text-white' : 'text-[#8E9299] hover:bg-[#F5F5F5]'}`}
                >
                  {tab.replace('-', ' ')}
                </button>
              ))}
              {['income-statement', 'balance-sheet', 'trial-balance'].includes(reportTab) && (
                <label className="ml-auto flex items-center gap-2 pl-4 text-xs font-bold text-[#8E9299] whitespace-nowrap cursor-pointer select-none">
                  <input type="checkbox" checked={showZeroRows} onChange={e => setShowZeroRows(e.target.checked)} className="accent-[#141414]" />
                  Show zero balances
                </label>
              )}
            </div>

            {reportTab === 'cash-flow' && <CashFlowPanel startDate={reportStartDate} endDate={reportEndDate} currSym={currSym} branding={branding()} />}

            {reportTab === 'tax-reports' && <TaxReportsPanel startDate={reportStartDate} endDate={reportEndDate} currSym={currSym} branding={branding()} />}

            {reportTab === 'dashboard' && (
              <ReportsDashboard
                data={managementAccounts}
                incomeStatement={incomeStatement}
                startDate={reportStartDate}
                endDate={reportEndDate}
                loading={isLoading}
                money={money}
                compact={compactMoney}
                branding={branding()}
                onOpenTab={setReportTab}
                onOpenAccount={(a) => openAccountDrill(a, { start: reportStartDate, end: reportEndDate }, `${a.name} (${reportStartDate} to ${reportEndDate})`)}
                onShowYtd={() => { const r = presetRange('ytd', fiscalYear); setReportStartDate(r.start); setReportEndDate(r.end); }}
              />
            )}

            {reportTab === 'income-statement' && (
              <Card className="border-none shadow-sm rounded-2xl bg-white overflow-hidden max-w-4xl">
                <CardHeader className="bg-[#F5F5F5]/30 border-b border-[#F5F5F5] flex flex-row justify-between items-center">
                  <CardTitle>Income Statement <span className="text-sm font-normal text-[#8E9299]">{formatDate(reportStartDate)} – {formatDate(reportEndDate)}</span></CardTitle>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={handlePrintIncomeStatement}><Printer className="w-4 h-4 mr-2" /> Print</Button>
                    <Button variant="outline" size="sm" onClick={handleExportIncomeStatementExcel}><FileSpreadsheet className="w-4 h-4 mr-2" /> Excel</Button>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader><TableRow className="bg-[#F5F5F5]/50"><TableHead>Account</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                    <TableBody>
                      <TableRow className="bg-green-50/30 hover:bg-green-50/30"><TableCell colSpan={2} className="font-bold text-green-700">Revenue</TableCell></TableRow>
                      {incomeStatement.filter(a => a.type === 'Income' && showStatementRow(a)).map(a => (
                        <TableRow 
                          key={a.id} 
                          className="hover:bg-green-50/50 cursor-pointer"
                          onClick={async () => {
                            const matchingBank = bankAccounts.find((ba: any) => String(ba.coa_account_id) === String(a.id));
                            setSelectedPeriodLabel(`${a.name} (${reportStartDate} to ${reportEndDate})`);
                            setPeriodFilterDates({ start: reportStartDate, end: reportEndDate });
                            setPeriodFilterAccountId(matchingBank ? String(matchingBank.id) : null);
                            setSelectedCOAId(String(a.id));
                            setDrillDownMode(matchingBank ? 'bank' : 'ledger');
                            setIsPeriodBankDetailsOpen(true);
                            try {
                              const res = await accountingApi.getLedgerEntries(a.id);
                              setLedgerEntries(res.data);
                            } catch (error) {
                              toast.error("Failed to load ledger details");
                            }
                          }}
                        >
                          <TableCell className="pl-8 font-bold text-[#141414]">{a.name}</TableCell>
                          <TableCell className={`text-right font-mono ${signTone(a.total_credit - a.total_debit)}`}>{money(a.total_credit - a.total_debit)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-[#F5F5F5]/50 hover:bg-[#F5F5F5]/50"><TableCell className="font-bold">Total Revenue</TableCell><TableCell className="text-right font-black text-green-600">{money(incomeStatement.filter(a => a.type === 'Income').reduce((s, a) => s + (a.total_credit - a.total_debit), 0))}</TableCell></TableRow>

                      <TableRow className="bg-red-50/30 hover:bg-red-50/30"><TableCell colSpan={2} className="font-bold text-red-700">Operating Expenses</TableCell></TableRow>
                      {incomeStatement.filter(a => a.type === 'Expense' && showStatementRow(a)).map(a => (
                        <TableRow 
                          key={a.id} 
                          className="hover:bg-red-50/50 cursor-pointer"
                          onClick={async () => {
                            const matchingBank = bankAccounts.find((ba: any) => String(ba.coa_account_id) === String(a.id));
                            setSelectedPeriodLabel(`${a.name} (${reportStartDate} to ${reportEndDate})`);
                            setPeriodFilterDates({ start: reportStartDate, end: reportEndDate });
                            setPeriodFilterAccountId(matchingBank ? String(matchingBank.id) : null);
                            setSelectedCOAId(String(a.id));
                            setDrillDownMode(matchingBank ? 'bank' : 'ledger');
                            setIsPeriodBankDetailsOpen(true);
                            try {
                              const res = await accountingApi.getLedgerEntries(a.id);
                              setLedgerEntries(res.data);
                            } catch (error) {
                              toast.error("Failed to load ledger details");
                            }
                          }}
                        >
                          <TableCell className="pl-8 font-bold text-[#141414]">{a.name}</TableCell>
                          <TableCell className={`text-right font-mono ${signTone(a.total_debit - a.total_credit)}`}>{money(a.total_debit - a.total_credit)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-[#F5F5F5]/50 hover:bg-[#F5F5F5]/50"><TableCell className="font-bold">Total Expenses</TableCell><TableCell className="text-right font-black text-red-600">{money(incomeStatement.filter(a => a.type === 'Expense').reduce((s, a) => s + (a.total_debit - a.total_credit), 0))}</TableCell></TableRow>

                      <TableRow className="bg-[#141414] text-white hover:bg-[#141414]">
                        <TableCell className="font-black text-lg">{statementNet < 0 ? 'Net Loss' : 'Net Income'}</TableCell>
                        <TableCell className={`text-right font-black text-xl ${statementNet < 0 ? 'text-rose-300' : 'text-emerald-300'}`}>
                          {money(statementNet)}
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
                  <CardTitle>Balance Sheet <span className="text-sm font-normal text-[#8E9299]">As of {formatDate(reportEndDate)}</span></CardTitle>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={handlePrintBalanceSheet}><Printer className="w-4 h-4 mr-2" /> Print</Button>
                    <Button variant="outline" size="sm" onClick={handleExportBalanceSheetExcel}><FileSpreadsheet className="w-4 h-4 mr-2" /> Excel</Button>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader><TableRow className="bg-[#F5F5F5]/50"><TableHead>Account</TableHead><TableHead className="text-right">Balance</TableHead></TableRow></TableHeader>
                    <TableBody>
                      <TableRow className="bg-blue-50/30 hover:bg-blue-50/30"><TableCell colSpan={2} className="font-bold text-blue-700">Assets</TableCell></TableRow>
                      {balanceSheet.accounts.filter((a: any) => a.type === 'Asset' && showStatementRow(a)).map((a: any) => (
                        <TableRow 
                          key={a.id} 
                          className="hover:bg-blue-50/50 cursor-pointer"
                          onClick={async () => {
                            const matchingBank = bankAccounts.find((ba: any) => String(ba.coa_account_id) === String(a.id));
                            setSelectedPeriodLabel(`${a.name} (as of ${reportEndDate})`);
                            setPeriodFilterDates({ start: '1970-01-01', end: reportEndDate });
                            setPeriodFilterAccountId(matchingBank ? String(matchingBank.id) : null);
                            setSelectedCOAId(String(a.id));
                            setDrillDownMode(matchingBank ? 'bank' : 'ledger');
                            setIsPeriodBankDetailsOpen(true);
                            try {
                              const res = await accountingApi.getLedgerEntries(a.id);
                              setLedgerEntries(res.data);
                            } catch (error) {
                              toast.error("Failed to load ledger details");
                            }
                          }}
                        >
                          <TableCell className="pl-8 font-bold text-[#141414]">{a.name}</TableCell>
                          <TableCell className={`text-right font-mono ${signTone(a.total_debit - a.total_credit)}`}>{money(a.total_debit - a.total_credit)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-[#F5F5F5]/50 hover:bg-[#F5F5F5]/50"><TableCell className="font-bold">Total Assets</TableCell><TableCell className="text-right font-black text-blue-600">{money(balanceSheet.accounts.filter((a: any) => a.type === 'Asset').reduce((s: number, a: any) => s + (a.total_debit - a.total_credit), 0))}</TableCell></TableRow>

                      <TableRow className="bg-red-50/30 hover:bg-red-50/30"><TableCell colSpan={2} className="font-bold text-red-700">Liabilities</TableCell></TableRow>
                      {balanceSheet.accounts.filter((a: any) => a.type === 'Liability' && showStatementRow(a)).map((a: any) => (
                        <TableRow 
                          key={a.id} 
                          className="hover:bg-red-50/50 cursor-pointer"
                          onClick={async () => {
                            const matchingBank = bankAccounts.find((ba: any) => String(ba.coa_account_id) === String(a.id));
                            setSelectedPeriodLabel(`${a.name} (as of ${reportEndDate})`);
                            setPeriodFilterDates({ start: '1970-01-01', end: reportEndDate });
                            setPeriodFilterAccountId(matchingBank ? String(matchingBank.id) : null);
                            setSelectedCOAId(String(a.id));
                            setDrillDownMode(matchingBank ? 'bank' : 'ledger');
                            setIsPeriodBankDetailsOpen(true);
                            try {
                              const res = await accountingApi.getLedgerEntries(a.id);
                              setLedgerEntries(res.data);
                            } catch (error) {
                              toast.error("Failed to load ledger details");
                            }
                          }}
                        >
                          <TableCell className="pl-8 font-bold text-[#141414]">{a.name}</TableCell>
                          <TableCell className={`text-right font-mono ${signTone(a.total_credit - a.total_debit)}`}>{money(a.total_credit - a.total_debit)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-[#F5F5F5]/50 hover:bg-[#F5F5F5]/50"><TableCell className="font-bold">Total Liabilities</TableCell><TableCell className="text-right font-black text-red-600">{money(balanceSheet.accounts.filter((a: any) => a.type === 'Liability').reduce((s: number, a: any) => s + (a.total_credit - a.total_debit), 0))}</TableCell></TableRow>

                      <TableRow className="bg-purple-50/30 hover:bg-purple-50/30"><TableCell colSpan={2} className="font-bold text-purple-700">Equity</TableCell></TableRow>
                      {balanceSheet.accounts.filter((a: any) => a.type === 'Equity' && showStatementRow(a)).map((a: any) => (
                        <TableRow 
                          key={a.id} 
                          className="hover:bg-purple-50/50 cursor-pointer"
                          onClick={async () => {
                            const matchingBank = bankAccounts.find((ba: any) => String(ba.coa_account_id) === String(a.id));
                            setSelectedPeriodLabel(`${a.name} (as of ${reportEndDate})`);
                            setPeriodFilterDates({ start: '1970-01-01', end: reportEndDate });
                            setPeriodFilterAccountId(matchingBank ? String(matchingBank.id) : null);
                            setSelectedCOAId(String(a.id));
                            setDrillDownMode(matchingBank ? 'bank' : 'ledger');
                            setIsPeriodBankDetailsOpen(true);
                            try {
                              const res = await accountingApi.getLedgerEntries(a.id);
                              setLedgerEntries(res.data);
                            } catch (error) {
                              toast.error("Failed to load ledger details");
                            }
                          }}
                        >
                          <TableCell className="pl-8 font-bold text-[#141414]">{a.name}</TableCell>
                          <TableCell className={`text-right font-mono ${signTone(a.total_credit - a.total_debit)}`}>{money(a.total_credit - a.total_debit)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow><TableCell className="pl-8 font-bold text-[#141414]">Retained Earnings</TableCell><TableCell className="text-right font-mono">{money(balanceSheet.retainedEarnings)}</TableCell></TableRow>
                      <TableRow className="bg-[#F5F5F5]/50 hover:bg-[#F5F5F5]/50"><TableCell className="font-bold">Total Equity</TableCell><TableCell className="text-right font-black text-purple-600">{money((balanceSheet.accounts.filter((a: any) => a.type === 'Equity').reduce((s: number, a: any) => s + (a.total_credit - a.total_debit), 0) + balanceSheet.retainedEarnings))}</TableCell></TableRow>
                      {(() => {
                        const sum = (type: string, sign: 1 | -1) => balanceSheet.accounts.filter((a: any) => a.type === type).reduce((s: number, a: any) => s + sign * (Number(a.total_debit || 0) - Number(a.total_credit || 0)), 0);
                        const assets = sum('Asset', 1);
                        const liabilitiesAndEquity = sum('Liability', -1) + sum('Equity', -1) + Number(balanceSheet.retainedEarnings || 0);
                        const difference = assets - liabilitiesAndEquity;
                        return (
                          <TableRow className="bg-[#141414] text-white hover:bg-[#141414]">
                            <TableCell className="font-black text-lg">
                              Total Liabilities & Equity
                              {Math.abs(difference) < 0.01
                                ? <Badge className="ml-3 bg-emerald-500/20 text-emerald-300 border-none align-middle">Balanced</Badge>
                                : <Badge className="ml-3 bg-rose-500/20 text-rose-300 border-none align-middle">Out by {money(difference)}</Badge>}
                            </TableCell>
                            <TableCell className="text-right font-black text-xl">{money(liabilitiesAndEquity)}</TableCell>
                          </TableRow>
                        );
                      })()}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            {reportTab === 'project-analysis' && (
              <div className="space-y-6">
                {projects.length > 0 && (
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-xs text-[#8E9299]">All-time invoiced revenue (net of credit notes and tax) against supplier bills tagged to each project.</p>
                    <Button variant="outline" size="sm" onClick={() => handleExportCSV('project_analysis', ['Project', 'Name', 'Client', 'Revenue', 'Direct costs', 'Profit', 'Margin %'], projects.map(p => {
                      const f = projectFigures(p);
                      return [p.id, p.name, p.client || '', f.revenue.toFixed(2), f.cost.toFixed(2), f.profit.toFixed(2), f.revenue > 0 ? ((f.profit / f.revenue) * 100).toFixed(1) : ''];
                    }))}><FileSpreadsheet className="w-4 h-4 mr-2" /> Export CSV</Button>
                  </div>
                )}
                {projects.length === 0 && (
                  <div className="rounded-3xl border border-dashed border-[#E6E6E6] bg-white px-6 py-12 text-center">
                    <p className="text-sm font-bold text-[#141414]">No projects yet</p>
                    <p className="mt-1 text-xs text-[#8E9299]">Project revenue and direct costs appear here once invoices and bills are tagged to a project.</p>
                  </div>
                )}
                <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                  {projects.map(p => {
                    const { revenue: projectRevenue, cost: projectCost, profit: projectProfit } = projectFigures(p);

                    return (
                      <Card key={p.id} className="border-none shadow-sm rounded-2xl overflow-hidden border-l-4 border-l-blue-600">
                        <CardHeader className="bg-[#F5F5F5]/30">
                          <CardTitle className="text-lg">{p.id} - {p.name}</CardTitle>
                          <CardDescription>{p.client}</CardDescription>
                        </CardHeader>
                        <CardContent className="p-6 space-y-4">
                          <div className="flex justify-between items-center">
                            <span className="text-[#8E9299] text-sm">Total Revenue</span>
                            <span className="font-bold text-green-600">{money(projectRevenue)}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-[#8E9299] text-sm">Total Direct Costs</span>
                            <span className="font-bold text-red-600">{money(projectCost)}</span>
                          </div>
                          <div className="pt-4 border-t border-[#F5F5F5] flex justify-between items-center">
                            <span className="font-black text-[#141414]">{projectProfit < 0 ? 'Net Project Loss' : 'Net Project Profit'}</span>
                            <span className={`font-black text-xl ${projectProfit >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                              {money(projectProfit)}
                            </span>
                          </div>
                          <div className="w-full bg-[#F5F5F5] h-2 rounded-full overflow-hidden">
                            <div
                              className={`${projectProfit >= 0 ? 'bg-blue-600' : 'bg-red-500'} h-full`}
                              style={{ width: `${Math.min(100, projectRevenue > 0 ? Math.abs(projectProfit / projectRevenue) * 100 : 0)}%` }}
                            />
                          </div>
                          <p className={`text-[10px] text-center uppercase font-bold tracking-wider ${projectProfit < 0 ? 'text-red-600' : 'text-[#8E9299]'}`}>
                            {projectRevenue > 0 ? `Margin: ${((projectProfit / projectRevenue) * 100).toFixed(1)}%` : projectCost > 0 ? 'Costs with no revenue yet' : 'No activity yet'}
                          </p>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}

            {reportTab === 'trial-balance' && (
              <div className="overflow-x-auto rounded-2xl border border-[#F5F5F5] shadow-sm">
                <Table className="bg-white">
                  <TableHeader>
                    <TableRow className="bg-[#F5F5F5]/50 border-none">
                      <TableHead colSpan={7}>
                        <div className="flex justify-between items-center w-full">
                          <span>Trial Balance {reportStartDate ? `(${reportStartDate} to ${reportEndDate}, opening balances brought forward)` : `(as of ${reportEndDate})`}</span>
                          <Button variant="outline" size="sm" onClick={() => handleExportCSV('trial_balance', ['Code', 'Account Name', 'Type', 'Opening (Dr+/Cr-)', 'Period Debit', 'Period Credit', 'Closing Debit', 'Closing Credit'], trialBalance.map(a => [a.code, a.name, a.type, Number(a.opening_balance || 0).toFixed(2), Number(a.period_debit || 0).toFixed(2), Number(a.period_credit || 0).toFixed(2), Number(a.total_debit || 0).toFixed(2), Number(a.total_credit || 0).toFixed(2)]))}><FileSpreadsheet className="w-4 h-4 mr-2" /> Export CSV</Button>
                        </div>
                      </TableHead>
                    </TableRow>
                    <TableRow className="bg-[#F5F5F5]/50">
                      <TableHead className="font-bold text-[#141414]">Code</TableHead>
                      <TableHead className="font-bold text-[#141414]">Account Name</TableHead>
                      <TableHead className="text-right font-bold text-[#141414]">Opening</TableHead>
                      <TableHead className="text-right font-bold text-[#141414]">Period Dr</TableHead>
                      <TableHead className="text-right font-bold text-[#141414]">Period Cr</TableHead>
                      <TableHead className="text-right font-bold text-[#141414]">Closing Debit</TableHead>
                      <TableHead className="text-right font-bold text-[#141414]">Closing Credit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trialBalance.filter(showTrialBalanceRow).map(a => (
                      <TableRow 
                        key={a.id} 
                        className="hover:bg-[#F5F5F5]/50 cursor-pointer"
                        onClick={async () => {
                          const matchingBank = bankAccounts.find((ba: any) => String(ba.coa_account_id) === String(a.id));
                          setSelectedPeriodLabel(`${a.name} (${reportStartDate} to ${reportEndDate})`);
                          setPeriodFilterDates({ start: reportStartDate, end: reportEndDate });
                          setPeriodFilterAccountId(matchingBank ? String(matchingBank.id) : null);
                          setSelectedCOAId(String(a.id));
                          setDrillDownMode(matchingBank ? 'bank' : 'ledger');
                          setIsPeriodBankDetailsOpen(true);
                          try {
                            const res = await accountingApi.getLedgerEntries(a.id);
                            setLedgerEntries(res.data);
                          } catch (error) {
                            toast.error("Failed to load ledger details");
                          }
                        }}
                      >
                        <TableCell className="font-mono text-xs font-bold text-[#8E9299]">{a.code}</TableCell>
                        <TableCell className="font-bold text-[#141414]">{a.name}</TableCell>
                        <TableCell className="text-right font-mono text-xs text-[#8E9299]">{Number(a.opening_balance || 0) === 0 ? '-' : `${fmtMoney(Math.abs(a.opening_balance))} ${Number(a.opening_balance) > 0 ? 'Dr' : 'Cr'}`}</TableCell>
                        <TableCell className="text-right font-mono text-xs text-[#8E9299]">{Number(a.period_debit) > 0 ? fmtMoney(a.period_debit) : '-'}</TableCell>
                        <TableCell className="text-right font-mono text-xs text-[#8E9299]">{Number(a.period_credit) > 0 ? fmtMoney(a.period_credit) : '-'}</TableCell>
                        <TableCell className="text-right font-mono text-[#141414]">{Number(a.total_debit) > 0 ? `${money(a.total_debit)}` : '-'}</TableCell>
                        <TableCell className="text-right font-mono text-[#141414]">{Number(a.total_credit) > 0 ? `${money(a.total_credit)}` : '-'}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-[#141414] text-white hover:bg-[#141414]">
                      <TableCell colSpan={5} className="font-black text-right text-lg">BALANCING TOTAL</TableCell>
                      <TableCell className="text-right font-black text-lg">{money(trialBalance.reduce((s, a) => s + Number(a.total_debit), 0))}</TableCell>
                      <TableCell className="text-right font-black text-lg">{money(trialBalance.reduce((s, a) => s + Number(a.total_credit), 0))}</TableCell>
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
          if (coaSearch && !(
            a.name.toLowerCase().includes(coaSearch.toLowerCase()) || 
            a.code.toLowerCase().includes(coaSearch.toLowerCase())
          )) return false;
          return true;
        });
        const groupedByType = ['Asset', 'Liability', 'Equity', 'Income', 'Expense'];
        const totalsByType = groupedByType.map(type => ({
          type,
          count: coa.filter(a => a.type === type).length,
          balance: coa.filter(a => a.type === type).reduce((s: number, a: any) => s + Number(a.natural_balance ?? 0), 0)
        }));

        return (
          <div className="space-y-6">
            <AccountingGuidance 
              title="Chart of Accounts Hierarchy" 
              message="The Chart of Accounts is the skeleton of your financial system. Categorize accounts correctly (Asset, Liability, Equity, Income, Expense) for accurate financial reporting." 
            />
            {/* Summary Cards */}
            <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
              {totalsByType.map(t => (
                <button
                  key={t.type}
                  onClick={() => setCoaFilter(coaFilter === t.type ? 'All' : t.type)}
                  className={`p-4 rounded-2xl border-2 transition-all text-left ${coaFilter === t.type ? 'border-[#141414] bg-[#141414] text-white shadow-xl' : 'border-[#F5F5F5] bg-white hover:border-[#8E9299]'
                    }`}
                >
                  <p className={`text-[10px] font-bold uppercase tracking-widest ${coaFilter === t.type ? 'text-white/60' : 'text-[#8E9299]'}`}>{t.type}</p>
                  <p className={`text-2xl font-black ${coaFilter === t.type ? 'text-white' : 'text-[#141414]'}`}>{t.count}</p>
                  <p className={`text-xs font-bold mt-1 ${coaFilter === t.type ? 'text-white/70' : 'text-[#8E9299]'}`}>{money(t.balance)}</p>
                </button>
              ))}
            </div>

            {/* Header */}
            <div className="flex flex-wrap justify-between items-center gap-3">
              <div>
                <h2 className="text-xl font-bold">Chart of Accounts</h2>
                <p className="text-sm text-[#8E9299]">{filteredCOA.length} accounts {coaFilter !== 'All' ? `(${coaFilter})` : ''}</p>
              </div>
              <div className="flex gap-2 flex-1 basis-full md:basis-auto max-w-full md:max-w-md md:ml-8 order-last md:order-none">
                <div className="relative w-full">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8E9299]" />
                  <Input 
                    placeholder="Search by name or code..." 
                    value={coaSearch}
                    onChange={(e) => setCoaSearch(e.target.value)}
                    className="pl-10 h-11 bg-white border-[#E4E3E0] rounded-xl font-medium focus:ring-2 focus:ring-blue-500/20 transition-all"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="gap-2 rounded-xl font-bold h-11" onClick={() => handleExportCSV('chart_of_accounts', ['Code', 'Name', 'Type', 'Balance'], coa.map((a: any) => [a.code, a.name, a.type, Number(a.natural_balance ?? 0).toFixed(2)]))}><FileSpreadsheet className="w-4 h-4" /> Export CSV</Button>
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
                          type: fd.get('type')
                        });
                        toast.success('Ledger account created');
                        setIsAddAccountOpen(false);
                        fetchData();
                      } catch (error: any) {
                        toast.error(errorText(error, 'Failed to create account'));
                      }
                    }}>
                      <DialogHeader className="p-8 pr-14 bg-blue-50">
                        <DialogTitle className="text-2xl font-bold text-blue-900">Register Ledger Account</DialogTitle>
                        <DialogDescription className="text-blue-700">Add a new account to your Chart of Accounts.</DialogDescription>
                      </DialogHeader>
                      <div className="p-8 space-y-4">
                        <div className="grid gap-4 sm:grid-cols-3">
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
                      <DialogHeader className="p-8 pr-14 bg-blue-50">
                        <DialogTitle className="text-2xl font-bold text-blue-900">Edit Ledger Account</DialogTitle>
                        <DialogDescription className="text-blue-700">Update account details.</DialogDescription>
                      </DialogHeader>
                      <div className="p-8 space-y-4">
                        <div className="grid gap-4 sm:grid-cols-3">
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
                        <p className="text-xs text-[#8E9299] font-medium">Balances come only from posted journals. To change a balance, post a manual journal or set opening balances under Foundation & Setup.</p>
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
                        <TableRow 
                          key={a.id} 
                          className="border-b border-[#F5F5F5] hover:bg-[#F5F5F5]/30 cursor-pointer"
                          onClick={async () => {
                            const matchingBank = bankAccounts.find(ba => String(ba.coa_account_id) === String(a.id));
                            setSelectedPeriodLabel(`Drill-down: ${a.name}`);
                            setPeriodFilterDates(null);
                            setPeriodFilterAccountId(matchingBank ? String(matchingBank.id) : null);
                            setSelectedCOAId(String(a.id));
                            setDrillDownMode('ledger'); // Default to ledger for COA
                            setIsPeriodBankDetailsOpen(true);
                            
                            // Fetch ledger entries
                            try {
                              const res = await accountingApi.getLedgerEntries(a.id);
                              setLedgerEntries(res.data);
                            } catch (error) {
                              toast.error("Failed to load ledger details");
                            }
                          }}
                        >
                          <TableCell className="font-mono font-bold text-blue-600">{a.code}</TableCell>
                          <TableCell className="font-bold text-[#141414]">{a.name}</TableCell>
                          <TableCell><Badge className={`${typeColors[a.type] || 'bg-gray-100 text-gray-700'} border-none font-bold text-[10px]`}>{a.type.toUpperCase()}</Badge></TableCell>
                          <TableCell className={`text-right font-black ${Number(a.natural_balance ?? 0) >= 0 ? 'text-[#141414]' : 'text-red-600'}`}>{money(a.natural_balance)}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50" 
                                onClick={async (e) => { 
                                  e.stopPropagation(); 
                                  setSelectedPeriodLabel(`Drill-down: ${a.name}`);
                                  setPeriodFilterDates(null);
                                  setSelectedCOAId(String(a.id));
                                  setDrillDownMode('ledger');
                                  setIsPeriodBankDetailsOpen(true);
                                  try {
                                    const res = await accountingApi.getLedgerEntries(a.id);
                                    setLedgerEntries(res.data);
                                  } catch (error) {
                                    toast.error("Failed to load ledger details");
                                  }
                                }}
                                title="View Ledger"
                              >
                                <ExternalLink className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50" onClick={(e) => { e.stopPropagation(); setSelectedTarget(a); setIsEditAccountOpen(true); }}>
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50" onClick={(e) => { e.stopPropagation(); setSelectedTarget(a); setIsDeleteAccountOpen(true); }}>
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
      
      case 'accounting-foundation': {
        return (
          <div className="space-y-8">
            <AccountingGuidance 
              title="Financial System Foundation" 
              message="Configure the fundamental settings of your accounting environment. Set your fiscal year, verify company identity, and establish starting ledger balances for a clean audit trail." 
            />
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Company Identity */}
              <Card className="border-none shadow-sm rounded-2xl overflow-hidden">
                <CardHeader className="bg-[#F5F5F5]/30 border-b border-[#F5F5F5]">
                  <CardTitle className="text-xl font-black text-[#141414] flex items-center gap-2">
                    <Globe className="w-5 h-5 text-blue-600" /> Company Identity
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-8 space-y-6">
                  <div className="space-y-2">
                    <Label className="font-bold text-xs uppercase text-[#8E9299]">Corporate Entity Name</Label>
                    <Input 
                      value={profileData.name} 
                      onChange={(e) => setProfileData({...profileData, name: e.target.value})}
                      className="h-12 bg-[#F5F5F5] border-none rounded-xl font-bold" 
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold text-xs uppercase text-[#8E9299]">Registered Address</Label>
                    <textarea 
                      className="w-full min-h-[100px] p-4 bg-[#F5F5F5] border-none rounded-2xl text-sm focus:ring-2 focus:ring-blue-500 outline-none font-medium"
                      value={profileData.address}
                      onChange={(e) => setProfileData({...profileData, address: e.target.value})}
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label className="font-bold text-xs uppercase text-[#8E9299]">Tax ID / TIN</Label>
                      <Input 
                        value={profileData.tin} 
                        onChange={(e) => setProfileData({...profileData, tin: e.target.value})}
                        className="h-12 bg-[#F5F5F5] border-none rounded-xl font-bold" 
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="font-bold text-xs uppercase text-[#8E9299]">Contact Phone</Label>
                      <Input 
                        value={profileData.phone} 
                        onChange={(e) => setProfileData({...profileData, phone: e.target.value})}
                        className="h-12 bg-[#F5F5F5] border-none rounded-xl font-bold" 
                      />
                    </div>
                  </div>
                  <Button 
                    className="w-full bg-[#141414] text-white rounded-xl h-12 font-black shadow-lg shadow-black/20"
                    onClick={handleSaveProfile}
                    disabled={isSaving}
                  >
                    {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'SAVE PROFILE'}
                  </Button>
                </CardContent>
              </Card>

              {/* Fiscal Year Configuration */}
              <Card className="border-none shadow-sm rounded-2xl overflow-hidden">
                <CardHeader className="bg-[#F5F5F5]/30 border-b border-[#F5F5F5]">
                  <CardTitle className="text-xl font-black text-[#141414] flex items-center gap-2">
                    <Calendar className="w-5 h-5 text-blue-600" /> Fiscal Period
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-8 space-y-6">
                  <div className="p-6 bg-blue-50 rounded-2xl border border-blue-100">
                    <p className="text-xs font-bold text-blue-800 uppercase tracking-widest">Active Reporting Cycle</p>
                    <p className="text-2xl font-black text-blue-900 mt-2">
                      {new Date(2000, fiscalYear.startMonth - 1, fiscalYear.startDay).toLocaleString('en-US', { month: 'short', day: '2-digit' })} — 
                      {new Date(2000, fiscalYear.startMonth - 2, fiscalYear.startDay - 1).toLocaleString('en-US', { month: 'short', day: '2-digit' })}
                    </p>
                    <Badge className="bg-green-100 text-green-700 border-none font-bold mt-3">FISCAL YEAR OPEN</Badge>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label className="font-bold text-xs uppercase text-[#8E9299]">Start Month</Label>
                      <Select 
                        value={String(fiscalYear.startMonth)} 
                        onValueChange={(v) => setFiscalYear({...fiscalYear, startMonth: Number(v)})}
                      >
                        <SelectTrigger className="h-12 bg-[#F5F5F5] border-none rounded-xl font-bold"><SelectValue /></SelectTrigger>
                        <SelectContent className="rounded-xl border-none shadow-2xl">
                          <SelectItem value="1">January</SelectItem>
                          <SelectItem value="2">February</SelectItem>
                          <SelectItem value="3">March</SelectItem>
                          <SelectItem value="4">April</SelectItem>
                          <SelectItem value="5">May</SelectItem>
                          <SelectItem value="6">June</SelectItem>
                          <SelectItem value="7">July</SelectItem>
                          <SelectItem value="8">August</SelectItem>
                          <SelectItem value="9">September</SelectItem>
                          <SelectItem value="10">October</SelectItem>
                          <SelectItem value="11">November</SelectItem>
                          <SelectItem value="12">December</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button 
                      className="w-full bg-blue-600 text-white rounded-xl h-12 font-black shadow-lg shadow-blue-500/20"
                      onClick={async () => {
                        try {
                          await accountingApi.updateFiscalYear(fiscalYear);
                          toast.success('Fiscal year settings updated');
                        } catch (err) {
                          toast.error('Failed to update fiscal year');
                        }
                      }}
                    >
                      UPDATE FISCAL YEAR
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <TaxSettingsCard coa={coa} />

              <PeriodLockCard isAdmin={user?.role === 'admin'} />
              <ApprovalLimitCard isAdmin={isAdmin} currSym={currSym} />

              {/* Opening Balances Tool */}
              <Card className="col-span-1 md:col-span-2 border-none shadow-sm rounded-2xl overflow-hidden">
                <CardHeader className="bg-[#F5F5F5]/30 border-b border-[#F5F5F5]">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <CardTitle className="text-xl font-black text-[#141414] flex items-center gap-2">
                      <Calculator className="w-5 h-5 text-blue-600" /> Opening Balances
                    </CardTitle>
                    <div className="flex flex-wrap items-center gap-4">
                      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm whitespace-nowrap tabular-nums">
                        <div className="text-center">
                          <p className="text-[10px] font-black uppercase text-[#8E9299]">Assets</p>
                          <p className="font-black text-green-600">{money(Object.entries(openingBalances).reduce((sum, [id, bal]) => {
                            const acc = coa.find(a => String(a.id) === id);
                            return sum + (acc?.type === 'Asset' ? Number(bal) : 0);
                          }, 0))}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-[10px] font-black uppercase text-[#8E9299]">Liabilities</p>
                          <p className="font-black text-red-600">{money(Object.entries(openingBalances).reduce((sum, [id, bal]) => {
                            const acc = coa.find(a => String(a.id) === id);
                            return sum + (acc?.type === 'Liability' ? Number(bal) : 0);
                          }, 0))}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-[10px] font-black uppercase text-[#8E9299]">Equity</p>
                          <p className="font-black text-purple-600">{money(Object.entries(openingBalances).reduce((sum, [id, bal]) => {
                            const acc = coa.find(a => String(a.id) === id);
                            return sum + (acc?.type === 'Equity' ? Number(bal) : 0);
                          }, 0))}</p>
                        </div>
                      </div>
                      <div className="relative sm:ml-4">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#8E9299]" />
                        <Input 
                          placeholder="Find account..." 
                          value={obSearch}
                          onChange={(e) => setObSearch(e.target.value)}
                          className="pl-9 h-9 w-48 bg-white border-[#E4E3E0] rounded-xl text-xs font-medium focus:ring-2 focus:ring-blue-500/20 transition-all"
                        />
                      </div>
                    </div>
                  </div>
                  <CardDescription className="mt-2">
                    Enter each account's balance as at the cut-over date, as a positive number on its normal side (assets as debits; liabilities and equity as credits). A balanced journal is posted on that date with Opening Balance Equity (3900) as the offset.
                  </CardDescription>
                  <div className="mt-4 flex flex-wrap items-end gap-4">
                    <div className="space-y-1">
                      <Label className="font-bold text-xs uppercase text-[#8E9299]">Balances as at</Label>
                      <Input type="date" value={obDate} onChange={async (e) => { setObDate(e.target.value); if (e.target.value) { try { await loadOpeningBalances(e.target.value); } catch { /* keep previous info */ } } }} className="h-10 w-48 bg-white border-[#E4E3E0] rounded-xl font-bold" />
                    </div>
                    {obInfo?.journal && <p className="text-xs text-[#8E9299] font-medium">Currently posted: journal #{obInfo.journal.id} dated {formatDate(obInfo.journal.date)}.</p>}
                  </div>
                  {obDate && obInfo && obInfo.entries_on_or_before > 0 && (
                    <div className="mt-3 p-3 rounded-xl bg-yellow-50 border border-yellow-200 text-xs font-medium text-yellow-800 flex gap-2 items-start">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>{obInfo.entries_on_or_before} ledger lines are already dated on or before {formatDate(obDate)}. Their effect is already in the books, so opening balances entered here must exclude them or those amounts will be counted twice.</span>
                    </div>
                  )}
                </CardHeader>
                <CardContent className="p-0">
                  {['Asset', 'Liability', 'Equity', 'Income', 'Expense'].map(type => {
                    const accounts = coa.filter(a => {
                      if (a.type !== type) return false;
                      if (a.code === '3900') return false;
                      if (obSearch && !(
                        a.name.toLowerCase().includes(obSearch.toLowerCase()) || 
                        a.code.toLowerCase().includes(obSearch.toLowerCase())
                      )) return false;
                      return true;
                    });
                    if (accounts.length === 0) return null;
                    const typeColor: Record<string, string> = {
                      'Asset': 'bg-blue-600', 'Liability': 'bg-red-500', 'Equity': 'bg-purple-500', 'Income': 'bg-green-500', 'Expense': 'bg-orange-500'
                    };
                    return (
                      <div key={type}>
                        <div className={`${typeColor[type]} text-white px-4 sm:px-8 py-3 flex items-center justify-between`}>
                          <span className="text-xs font-black uppercase tracking-widest">{type} Accounts</span>
                          <span className="text-xs font-bold opacity-80">{accounts.length} accounts</span>
                        </div>
                        <div className="divide-y divide-[#F5F5F5]">
                          {accounts.map(a => (
                            <div key={a.id} className="flex flex-wrap sm:flex-nowrap items-center gap-x-4 gap-y-2 px-4 sm:px-8 py-3 hover:bg-[#F5F5F5]/30 transition-colors">
                              <span className="font-mono text-xs font-bold text-blue-600 w-12 sm:w-16 shrink-0">{a.code}</span>
                              <span className="flex-1 min-w-0 truncate font-bold text-[#141414] text-sm" title={a.name}>{a.name}</span>
                              <div className="flex items-center gap-2 ml-auto">
                                <span className="text-xs text-[#8E9299] font-bold">{currSym}</span>
                                <AmountInput
                                  aria-label={`Opening balance for ${a.code} ${a.name}`}
                                  value={openingBalances[String(a.id)]}
                                  onValueChange={(v) => setOpeningBalances({
                                    ...openingBalances,
                                    [String(a.id)]: v
                                  })}
                                  className="w-36 sm:w-40 h-10 bg-[#F5F5F5] border-none rounded-xl font-bold text-right text-sm"
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
                <div className="p-4 sm:p-6 bg-[#F5F5F5]/30 border-t border-[#F5F5F5] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <p className="text-xs text-[#8E9299] font-medium">
                    The previous opening balance journal is replaced when you post.
                  </p>
                  <Button
                    className="w-full sm:w-auto bg-blue-600 text-white rounded-xl px-10 h-12 font-black shadow-lg shadow-blue-500/20 gap-2"
                    disabled={isSaving}
                    onClick={async () => {
                      if (!obDate) {
                        toast.error('Choose the date the opening balances apply to');
                        return;
                      }
                      const balances = Object.entries(openingBalances)
                        .filter(([, bal]) => Number(bal) !== 0)
                        .map(([account_id, amount]) => ({ account_id: Number(account_id), amount: Number(amount) }));
                      if (balances.length === 0) {
                        toast.error('Enter at least one non-zero balance');
                        return;
                      }
                      setIsSaving(true);
                      try {
                        await accountingApi.postOpeningBalances({ balances, date: obDate });
                        toast.success(`Opening balances posted as at ${formatDate(obDate)}`);
                        fetchData();
                      } catch (error: any) {
                        toast.error(errorText(error, 'Failed to post opening balances'));
                      } finally {
                        setIsSaving(false);
                      }
                    }}
                  >
                    {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    POST OPENING BALANCES
                  </Button>
                </div>
              </Card>
            </div>
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
        {SECTION_SUBTITLES[activeSub] && <p className="text-[#8E9299] text-lg mt-1 font-medium">{SECTION_SUBTITLES[activeSub]}</p>}
      </div>
      {approvalCount > 0 && activeSub !== 'accounting-approvals' && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-yellow-200 bg-yellow-50 px-5 py-3">
          <p className="text-sm font-bold text-yellow-800 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" />
            {isAdmin
              ? `${approvalCount} request${approvalCount === 1 ? '' : 's'} waiting for your approval`
              : `${approvalCount} of your request${approvalCount === 1 ? ' is' : 's are'} waiting for admin approval`}
          </p>
          {onNavigate && <Button size="sm" className="bg-[#141414] text-white font-bold" onClick={() => onNavigate('accounting-approvals')}>Open Approvals</Button>}
        </div>
      )}
      {renderContent()}

      <CorrectionDialog
        target={correctionTarget}
        coa={coa}
        suppliers={suppliers}
        projects={projects}
        currSym={currSym}
        onClose={() => setCorrectionTarget(null)}
        onSubmitted={() => { fetchData(); refreshApprovalCount(); }}
      />
      <PaymentsDialog
        target={paymentsTarget}
        bankAccounts={bankAccounts}
        currSym={currSym}
        onClose={() => setPaymentsTarget(null)}
        onChanged={() => { fetchData(); refreshApprovalCount(); }}
      />

      {/* Void Invoice / Bill Modal */}
      <Dialog open={!!voidTarget} onOpenChange={(open) => !open && setVoidTarget(null)}>
        <DialogContent className="rounded-2xl">
          <form onSubmit={handleVoid}>
            <DialogHeader>
              <DialogTitle>Void {voidTarget?.label}</DialogTitle>
              <DialogDescription>An admin must approve the void. Once approved, a reversing journal is posted on the date below (or the first open date if that period is closed) and the document is marked VOID. The original stays on record for audit.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="space-y-2"><Label>Void Date</Label><Input name="date" type="date" required defaultValue={todayIso()} className="bg-[#F5F5F5] border-none" /></div>
              <div className="space-y-2"><Label>Reason</Label><Input name="reason" required minLength={3} className="bg-[#F5F5F5] border-none" placeholder="e.g. Raised in error, duplicate" /></div>
            </div>
            <DialogFooter><Button type="submit" variant="destructive" className="w-full h-11 font-bold">REQUEST VOID</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Drill-down Modal */}
      <Dialog open={isPeriodBankDetailsOpen} onOpenChange={setIsPeriodBankDetailsOpen}>
        <DialogContent className="max-w-4xl rounded-2xl max-h-[90vh] overflow-hidden flex flex-col p-0 border-none shadow-2xl">
          <DialogHeader className="p-8 pr-14 bg-blue-600 text-white rounded-t-2xl">
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-white/10 rounded-2xl">
                  <Calculator className="w-6 h-6 text-white" />
                </div>
                <div>
                  <DialogTitle className="text-2xl font-black">Account Drill-Down</DialogTitle>
                  <DialogDescription className="text-blue-100 font-bold uppercase tracking-widest text-[10px] mt-1 opacity-80">
                    {selectedPeriodLabel}
                  </DialogDescription>
                </div>
              </div>
              <div className="flex gap-1 bg-black/20 p-1 rounded-xl">
                <button 
                  onClick={() => setDrillDownMode('bank')}
                  className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${drillDownMode === 'bank' ? 'bg-white text-blue-600 shadow-sm' : 'text-white/60 hover:text-white'}`}
                >
                  Bank Feed
                </button>
                <button 
                  onClick={async () => {
                    setDrillDownMode('ledger');
                    if (selectedCOAId) {
                      const res = await accountingApi.getLedgerEntries(selectedCOAId);
                      setLedgerEntries(res.data);
                    }
                  }}
                  className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${drillDownMode === 'ledger' ? 'bg-white text-blue-600 shadow-sm' : 'text-white/60 hover:text-white'}`}
                >
                  Ledger Entries
                </button>
              </div>
            </div>
          </DialogHeader>
          
          <div className="flex-1 overflow-y-auto p-8">
            <div className="overflow-x-auto rounded-2xl border border-[#F5F5F5] shadow-sm">
              <Table className="bg-white">
                {drillDownMode === 'bank' ? (
                  <>
                    <TableHeader>
                      <TableRow className="bg-[#F5F5F5]/50 border-none">
                        <TableHead className="font-bold text-[#141414]">Date</TableHead>
                        <TableHead className="font-bold text-[#141414]">Description</TableHead>
                        <TableHead className="font-bold text-[#141414]">Account</TableHead>
                        <TableHead className="text-right font-bold text-[#141414]">Amount</TableHead>
                        <TableHead className="font-bold text-[#141414]">Status</TableHead>
                        <TableHead className="text-right font-bold text-[#141414]">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {bankTx
                        .filter(tx => {
                          let dateMatch = true;
                          if (periodFilterDates) {
                            const txDate = tx.date.split('T')[0];
                            dateMatch = txDate >= periodFilterDates.start && txDate <= periodFilterDates.end;
                          }
                          
                          let accountMatch = true;
                          if (periodFilterAccountId) {
                            accountMatch = String(tx.bank_account_id) === String(periodFilterAccountId);
                          }
                          
                          return dateMatch && accountMatch;
                        })
                        .map((tx, idx) => (
                          <TableRow key={idx} className="hover:bg-blue-50/20">
                            <TableCell className="text-xs font-bold text-[#8E9299] font-mono">{new Date(tx.date).toLocaleDateString()}</TableCell>
                            <TableCell className="font-bold text-[#141414]">{tx.description}</TableCell>
                            <TableCell className="text-xs text-[#8E9299]">{tx.bank_name}</TableCell>
                            <TableCell className={`text-right font-black ${tx.type === 'Credit' ? 'text-green-600' : 'text-[#141414]'}`}>
                              {tx.type === 'Credit' ? '+' : '-'}{money(Number(tx.amount))}
                            </TableCell>
                            <TableCell>
                              <Badge className={tx.status === 'Reconciled' ? 'bg-green-100 text-green-700 border-none' : 'bg-yellow-100 text-yellow-700 border-none'}>
                                {tx.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  className="h-8 w-8 text-blue-600 hover:text-blue-700"
                                  onClick={async () => {
                                    if (tx.status === 'Reconciled' && tx.matched_ledger_id) {
                                      if (await openJournalEditor(tx.matched_ledger_id)) setIsPeriodBankDetailsOpen(false);
                                    } else {
                                      setSelectedBankTx(tx);
                                      setIsEditBankTxOpen(true);
                                      setIsPeriodBankDetailsOpen(false);
                                    }
                                  }}
                                >
                                  <Edit className="w-4 h-4" />
                                </Button>
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  className="h-8 w-8 text-red-500 hover:text-red-700"
                                  onClick={async () => {
                                    if (window.confirm("Delete this bank statement line?")) {
                                      try {
                                        await accountingApi.deleteBankTransaction(tx.id);
                                        toast.success("Bank statement line removed");
                                        fetchData();
                                      } catch (err: any) {
                                        toast.error(errorText(err, "Failed to delete statement line"));
                                      }
                                    }
                                  }}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      {bankTx.filter(tx => {
                        let dm = true;
                        if (periodFilterDates) {
                          const txDate = tx.date.split('T')[0];
                          dm = txDate >= periodFilterDates.start && txDate <= periodFilterDates.end;
                        }
                        let am = true;
                        if (periodFilterAccountId) am = String(tx.bank_account_id) === String(periodFilterAccountId);
                        return dm && am;
                      }).length === 0 && (
                        <TableRow><TableCell colSpan={5} className="text-center py-24 text-[#8E9299]">No bank feed records found.</TableCell></TableRow>
                      )}
                    </TableBody>
                  </>
                ) : (
                  <>
                    <TableHeader>
                      <TableRow className="bg-[#F5F5F5]/50 border-none">
                        <TableHead className="font-bold text-[#141414]">Date</TableHead>
                        <TableHead className="font-bold text-[#141414]">{ledgerEntries.some((le: any) => le.account_name) ? 'Account' : 'Description'}</TableHead>
                        <TableHead className="font-bold text-[#141414]">Type</TableHead>
                        <TableHead className="text-right font-bold text-[#141414]">Debit</TableHead>
                        <TableHead className="text-right font-bold text-[#141414]">Credit</TableHead>
                        <TableHead className="text-right font-bold text-[#141414]">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ledgerEntries.map((le, idx) => (
                        <TableRow key={idx} className="hover:bg-blue-50/20">
                          <TableCell className="text-xs font-bold text-[#8E9299] font-mono">{formatDate(le.date)}</TableCell>
                          <TableCell className="font-bold text-[#141414]">{le.account_name ? `${le.account_code} - ${le.account_name}` : le.description}</TableCell>
                          <TableCell className="text-[10px] uppercase font-black text-blue-600 tracking-widest">{String(le.reference_type || '').replace(/_/g, ' ')}</TableCell>
                          <TableCell className="text-right font-mono text-green-600 font-bold">{Number(le.debit) > 0 ? `${money(le.debit)}` : '-'}</TableCell>
                          <TableCell className="text-right font-mono text-red-600 font-bold">{Number(le.credit) > 0 ? `${money(le.credit)}` : '-'}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              {le.reference_type === 'manual' && (
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                  title="Edit journal"
                                  onClick={async () => {
                                    if (await openJournalEditor(le.journal_id)) setIsPeriodBankDetailsOpen(false);
                                  }}
                                >
                                  <Edit className="w-4 h-4" />
                                </Button>
                              )}
                              {le.reference_type && onNavigate && (
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50"
                                  onClick={() => {
                                    const type = String(le.reference_type).toLowerCase();
                                    let target: any = null;
                                    if (type === 'bill') target = 'accounting-ap';
                                    if (type === 'invoice') target = 'accounting-ar';
                                    if (type === 'payroll') target = 'hr-payroll';
                                    if (type === 'payment') target = 'accounting-bank';
                                    
                                    if (target) {
                                      onNavigate(target);
                                      setIsPeriodBankDetailsOpen(false);
                                    } else {
                                      toast.info(`Source: ${le.reference_type || 'Internal'}`);
                                    }
                                  }}
                                  title={`View Source: ${le.reference_type}`}
                                >
                                  <ExternalLink className="w-4 h-4" />
                                </Button>
                              )}
                              {le.reference_type === 'manual' && (
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                                  title="Delete journal"
                                  onClick={async () => {
                                    if (!(await handleDeleteJournal(le.journal_id))) return;
                                    if (selectedCOAId) {
                                      const res = await accountingApi.getLedgerEntries(selectedCOAId);
                                      setLedgerEntries(res.data);
                                    } else {
                                      setIsPeriodBankDetailsOpen(false);
                                    }
                                  }}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                      {ledgerEntries.length === 0 && (
                        <TableRow><TableCell colSpan={5} className="text-center py-24 text-[#8E9299]">No journal entries found in the ledger for this account.</TableCell></TableRow>
                      )}
                    </TableBody>
                  </>
                )}
              </Table>
            </div>
          </div>

          <DialogFooter className="p-6 bg-[#F5F5F5]/30 border-t border-[#F5F5F5] rounded-b-2xl">
            <div className="flex justify-between items-center w-full">
              <div className="flex items-center gap-4 text-xs font-bold text-[#8E9299] uppercase tracking-widest">
                <span>{drillDownMode === 'bank' ? 'Bank Statement View' : 'General Ledger View'}</span>
                <div className="w-1 h-1 bg-[#8E9299] rounded-full"></div>
                <span className="text-blue-600">
                  {drillDownMode === 'bank' ? bankTx.filter(tx => {
                    let dm = true; if (periodFilterDates) { const txd = tx.date.split('T')[0]; dm = txd >= periodFilterDates.start && txd <= periodFilterDates.end; }
                    let am = true; if (periodFilterAccountId) am = String(tx.bank_account_id) === String(periodFilterAccountId);
                    return dm && am;
                  }).length : ledgerEntries.length} Records
                </span>
              </div>
              <div className="flex gap-3">
                  <Button variant="outline" className="rounded-xl font-bold border-[#E4E3E0] h-11 px-6" onClick={() => setIsPeriodBankDetailsOpen(false)}>DISMISS</Button>
                  <Button
                    className="bg-[#141414] text-white rounded-xl font-bold gap-2 h-11 px-6 shadow-lg shadow-[#141414]/20"
                    onClick={() => {
                      if (drillDownMode === 'bank') {
                        const rows = bankTx
                          .filter((tx) => {
                            let dm = true;
                            if (periodFilterDates) {
                              const txd = tx.date.split('T')[0];
                              dm = txd >= periodFilterDates.start && txd <= periodFilterDates.end;
                            }
                            let am = true;
                            if (periodFilterAccountId) am = String(tx.bank_account_id) === String(periodFilterAccountId);
                            return dm && am;
                          })
                          .map((tx: any) => [
                            String(tx.date).slice(0, 10),
                            tx.description,
                            tx.bank_name,
                            Number(tx.amount || 0).toFixed(2),
                            tx.type,
                            tx.status,
                          ]);
                        handleExportCSV('bank_drilldown', ['Date', 'Description', 'Bank', 'Amount', 'Type', 'Status'], rows);
                      } else {
                        const rows = ledgerEntries.map((le: any) => [
                          String(le.date).slice(0, 10),
                          String(le.journal_id ?? ''),
                          le.description,
                          le.account_name ? `${le.account_code} - ${le.account_name}` : '',
                          le.reference_type,
                          Number(le.debit || 0).toFixed(2),
                          Number(le.credit || 0).toFixed(2),
                        ]);
                        handleExportCSV('ledger_drilldown', ['Date', 'Journal #', 'Description', 'Account', 'Type', 'Debit', 'Credit'], rows);
                      }
                    }}
                  >
                    <Printer className="w-4 h-4" /> EXPORT
                  </Button>
                </div>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Bank Transaction Modal */}
      <Dialog open={isEditBankTxOpen} onOpenChange={setIsEditBankTxOpen}>
        <DialogContent className="max-w-md rounded-2xl">
          <form onSubmit={async (e) => {
            e.preventDefault();
            if (!selectedBankTx) return;
            const fd = new FormData(e.target as HTMLFormElement);
            try {
              await accountingApi.updateBankTransaction(selectedBankTx.id, {
                date: fd.get('date'),
                description: fd.get('description'),
                amount: Number(fd.get('amount')),
                type: fd.get('type')
              });
              toast.success('Bank transaction updated');
              setIsEditBankTxOpen(false);
              fetchData();
            } catch (error) {
              toast.error('Failed to update bank transaction');
            }
          }}>
            <DialogHeader>
              <DialogTitle>Edit Bank Transaction</DialogTitle>
              <DialogDescription>Modify the imported bank feed details.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label>Date</Label>
                <Input name="date" type="date" defaultValue={selectedBankTx?.date?.split('T')[0]} required className="bg-[#F5F5F5] border-none" />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Input name="description" defaultValue={selectedBankTx?.description} required className="bg-[#F5F5F5] border-none" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Amount</Label>
                  <Input name="amount" type="number" step="0.01" defaultValue={selectedBankTx?.amount} required className="bg-[#F5F5F5] border-none" />
                </div>
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select name="type" defaultValue={selectedBankTx?.type}>
                    <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Credit">Credit (Deposit)</SelectItem>
                      <SelectItem value="Debit">Debit (Withdrawal)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" className="w-full bg-[#141414] text-white font-bold h-11">UPDATE FEED ENTRY</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Global Journal Entry Modal */}
      <Dialog open={isJournalOpen} onOpenChange={setIsJournalOpen} modal={false}>
        <DialogContent className="max-w-3xl rounded-2xl border-none shadow-2xl p-0 gap-0">
          <form onSubmit={handlePostJournal} key={journalFormKey}>
            <DialogHeader className="bg-[#F5F5F5]/60 px-6 py-5 pr-14 border-b border-[#F0F0F0]">
              <DialogTitle className="text-xl sm:text-2xl font-black text-[#141414]">{editingJournalId ? `Correct Journal #${editingJournalId}` : 'Double-Entry Journal Post'}</DialogTitle>
              <DialogDescription className="font-medium text-[#8E9299]">
                {editingJournalId
                  ? 'Your correction goes to an admin. Once approved, the original entry is reversed and the corrected one is posted.'
                  : 'Maintain ledger integrity with balanced debits and credits.'}
              </DialogDescription>
            </DialogHeader>
            <div className="px-4 sm:px-6 py-6 space-y-6">
              {editingJournalId && (
                <div className="space-y-2">
                  <Label className="font-bold text-xs uppercase text-[#8E9299]">Reason for the correction <span className="text-red-500">*</span></Label>
                  <Input name="correction_reason" required minLength={3} placeholder="e.g. Posted to the wrong expense account" className="h-11 bg-amber-50 border-none rounded-xl font-bold" />
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label className="font-bold text-xs uppercase text-[#8E9299]">Post Date</Label>
                  <Input type="date" name="date" required defaultValue={editingJournal?.date || todayIso()} className="h-11 bg-[#F5F5F5] border-none rounded-xl font-bold" />
                </div>
                <div className="space-y-2">
                  <Label className="font-bold text-xs uppercase text-[#8E9299]">Project (optional)</Label>
                  <Select name="project_id" defaultValue={editingJournal?.project_id ? String(editingJournal.project_id) : 'none'}>
                    <SelectTrigger className="h-11 bg-[#F5F5F5] border-none rounded-xl font-bold"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No project</SelectItem>
                      {projects.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label className="font-bold text-xs uppercase text-[#8E9299]">Reference / Description</Label>
                  <Textarea name="description" placeholder="e.g. Accrued site rent" required rows={2} defaultValue={editingJournal?.description || ''} className="min-h-[44px] resize-y bg-[#F5F5F5] border-none rounded-xl font-bold" />
                </div>
              </div>

              <div className="space-y-3">
                <div className="hidden md:grid md:grid-cols-[minmax(0,1fr)_140px_140px_36px] gap-3 px-1 text-[10px] font-black uppercase text-[#8E9299] tracking-widest">
                  <div>Target Account</div>
                  <div className="text-right">Debit (+)</div>
                  <div className="text-right">Credit (-)</div>
                  <div />
                </div>

                {journalItems.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-2 md:grid-cols-[minmax(0,1fr)_140px_140px_36px] gap-2 md:gap-3 items-center rounded-2xl md:rounded-none bg-[#FAFAFA] md:bg-transparent p-2 md:p-0">
                    <div className="col-span-2 md:col-span-1 min-w-0">
                      <AccountSelect
                        value={String(item.account_id)}
                        onValueChange={(val: string) => {
                          const n = [...journalItems];
                          n[idx].account_id = val;
                          setJournalItems(n);
                        }}
                        accounts={coa}
                        placeholder="Search account..."
                      />
                    </div>
                    <AmountInput
                      aria-label={`Line ${idx + 1} debit`}
                      placeholder="Debit"
                      value={item.debit}
                      onValueChange={(v) => { const n = [...journalItems]; n[idx].debit = v; setJournalItems(n); }}
                      className="h-11 bg-[#F5F5F5] border-none rounded-xl font-black text-right text-green-600 focus-visible:ring-green-500"
                    />
                    <AmountInput
                      aria-label={`Line ${idx + 1} credit`}
                      placeholder="Credit"
                      value={item.credit}
                      onValueChange={(v) => { const n = [...journalItems]; n[idx].credit = v; setJournalItems(n); }}
                      className="h-11 bg-[#F5F5F5] border-none rounded-xl font-black text-right text-red-600 focus-visible:ring-red-500"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove line ${idx + 1}`}
                      title="Remove line"
                      disabled={journalItems.length <= 2}
                      onClick={() => setJournalItems(journalItems.filter((_, i) => i !== idx))}
                      className="col-span-2 md:col-span-1 h-9 w-full md:w-9 text-[#8E9299] hover:text-red-600 hover:bg-red-50 rounded-xl"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}

                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setJournalItems([...journalItems, { account_id: '', debit: 0, credit: 0 }])}
                  className="w-full border-2 border-dashed border-[#E4E3E0] text-[#8E9299] font-bold hover:bg-[#F5F5F5] hover:text-[#141414] rounded-2xl h-11 transition-all"
                >
                  + ADD LEDGER ENTRY LINE
                </Button>
              </div>
            </div>

            {(() => {
              const totalDebit = journalItems.reduce((s, i) => s + (Number(i.debit) || 0), 0);
              const totalCredit = journalItems.reduce((s, i) => s + (Number(i.credit) || 0), 0);
              const difference = totalDebit - totalCredit;
              const balanced = Math.abs(difference) < 0.01;
              const empty = totalDebit === 0 && totalCredit === 0;
              return (
                <DialogFooter className="bg-[#141414] px-4 sm:px-6 py-4 flex-col sm:flex-row gap-4 sm:items-center">
                  <div className="flex-1 flex flex-wrap items-end gap-x-6 gap-y-2">
                    <div>
                      <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">Total Debits</p>
                      <p className="text-lg font-black text-green-400 font-mono whitespace-nowrap">{money(totalDebit)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">Total Credits</p>
                      <p className="text-lg font-black text-red-400 font-mono whitespace-nowrap">{money(totalCredit)}</p>
                    </div>
                    <span role="status" className={`mb-1 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap ${empty ? 'bg-white/10 text-white/60' : balanced ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>
                      {empty ? 'Enter amounts' : balanced ? <><Check className="w-3.5 h-3.5" /> Balanced</> : `Out by ${money(Math.abs(difference))}`}
                    </span>
                  </div>
                  <Button
                    type="submit"
                    className={`h-12 px-8 w-full sm:w-auto rounded-2xl font-black text-white shadow-xl transition-all ${balanced ? 'bg-blue-600 hover:bg-blue-500' : 'bg-white/10 cursor-not-allowed'}`}
                    disabled={!balanced}
                  >
                    {balanced ? (editingJournalId ? 'SEND FOR APPROVAL' : 'AUTHORIZE & POST') : 'LEDGER UNBALANCED'}
                  </Button>
                </DialogFooter>
              );
            })()}
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
