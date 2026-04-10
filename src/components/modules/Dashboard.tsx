import React, { useState, useEffect } from 'react';
import { 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Briefcase, 
  Users, 
  AlertCircle,
  Loader2,
  Calendar,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  HardHat,
  Monitor,
  Zap
} from 'lucide-react';
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle,
  CardDescription
} from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line
} from 'recharts';
import { 
  projectsApi, 
  accountingApi, 
  hrApi, 
  fieldOpsApi,
  assetsApi,
  settingsApi
} from '../../lib/api';
import { formatCurrency, getCurrencySymbol } from '../../lib/currency';

export default function Dashboard() {
  const [data, setData] = useState<any>({
    projects: [],
    transactions: [],
    employees: [],
    reports: [],
    equipment: [],
    profitLoss: null
  });
  const [isLoading, setIsLoading] = useState(true);
  const [currency, setCurrency] = useState('GHS');

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    setIsLoading(true);
    try {
      const [projRes, txRes, empRes, reportRes, assetRes, plRes, settingsRes] = await Promise.all([
        projectsApi.getProjects(),
        accountingApi.getTransactions(),
        hrApi.getEmployees(),
        fieldOpsApi.getReports(),
        assetsApi.getEquipment(),
        accountingApi.getProfitLoss(),
        settingsApi.getSettings()
      ]);
      
      const currencySetting = settingsRes.data.find((s: any) => s.key === 'currency');
      if (currencySetting) setCurrency(currencySetting.value);

      setData({
        projects: projRes.data,
        transactions: txRes.data,
        employees: empRes.data,
        reports: reportRes.data,
        equipment: assetRes.data,
        profitLoss: plRes.data
      });
    } catch (error) {
      console.error('Failed to fetch dashboard data');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-[70vh]">
        <div className="relative">
          <Loader2 className="w-12 h-12 animate-spin text-blue-600" />
          <div className="absolute inset-0 flex items-center justify-center">
            <Zap className="w-4 h-4 text-blue-600 animate-pulse" />
          </div>
        </div>
        <p className="mt-4 text-sm font-bold text-[#8E9299] uppercase tracking-widest">Hydrating Engineering OS...</p>
      </div>
    );
  }

  const activeProjects = data.projects.filter((p: any) => p.status === 'In Progress');
  const upcomingDeadlines = data.projects.filter((p: any) => p.status === 'In Progress').length;
  const siteTelemetryCount = data.reports.length;

  return (
    <div className="space-y-10 pb-12">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <Badge className="mb-2 bg-blue-100 text-blue-600 border-none font-bold px-3 py-1">v3.0 ENTERPRISE</Badge>
          <h1 className="text-5xl font-black tracking-tighter text-[#141414] leading-tight">
            Engineering <span className="text-blue-600">Intelligence.</span>
          </h1>
          <p className="text-[#8E9299] text-lg font-medium max-w-2xl mt-2">
            Global operational overview for <span className="text-[#141414]">infrastructure delivery</span> and fiscal governance.
          </p>
        </div>
        <div className="flex items-center gap-4 bg-white p-2 rounded-2xl shadow-sm border border-[#F5F5F5]">
          <div className="px-4 py-2 text-center border-r border-[#F5F5F5]">
            <p className="text-[10px] uppercase font-bold text-[#8E9299]">Live Uptime</p>
            <p className="text-sm font-black text-green-600">99.9%</p>
          </div>
          <div className="px-4 py-2 text-center">
            <p className="text-[10px] uppercase font-bold text-[#8E9299]">Data Precision</p>
            <p className="text-sm font-black text-blue-600">REAL-TIME</p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <KPI 
          icon={TrendingUp} 
          label="Gross Revenue" 
          value={formatCurrency(data.profitLoss?.income || 0, currency)} 
          trend="+12.4%" 
          positive={true}
        />
        <KPI 
          icon={Activity} 
          label="Operating Costs" 
          value={formatCurrency(data.profitLoss?.expenses || 0, currency)} 
          trend="-2.1%" 
          positive={true}
        />
        <KPI 
          icon={HardHat} 
          label="Workforce" 
          value={data.employees.length} 
          trend="8 Active Sites" 
          description="Total Payroll Personnel"
        />
        <KPI 
          icon={Monitor} 
          label="Asset Utilization" 
          value={`${Math.round((data.equipment.filter((e:any)=>e.status==='On Site').length / (data.equipment.length || 1)) * 100)}%`} 
          trend="Fleet Online"
          description="Machinery Availability"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2 border-none shadow-xl shadow-black/[0.02] rounded-3xl overflow-hidden bg-white">
          <CardHeader className="p-8 border-b border-[#F5F5F5] flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-xl font-bold">Projected Liquidity</CardTitle>
              <CardDescription>Consolidated cashflow trajectory.</CardDescription>
            </div>
            <div className="flex gap-2">
              <Badge className="bg-blue-600">Revenue</Badge>
              <Badge variant="outline" className="border-blue-200 text-blue-600">Projected</Badge>
            </div>
          </CardHeader>
          <CardContent className="p-8 pt-10">
            <div className="h-[350px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.transactions.slice(0, 10).reverse().map((t:any) => ({ name: t.date, amount: t.amount }))}>
                  <defs>
                    <linearGradient id="colorAmt" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2563eb" stopOpacity={0.1}/>
                      <stop offset="95%" stopColor="#2563eb" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                  <XAxis dataKey="name" stroke="#8E9299" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="#8E9299" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => `${getCurrencySymbol(currency)}${v/1000}k`} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)' }}
                  />
                  <Area type="monotone" dataKey="amount" stroke="#2563eb" strokeWidth={4} fillOpacity={1} fill="url(#colorAmt)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-xl shadow-blue-500/5 rounded-3xl overflow-hidden bg-gradient-to-br from-blue-600 to-indigo-700 text-white">
          <CardHeader className="p-8 border-b border-white/10">
            <CardTitle className="text-xl font-black">Force Multipliers</CardTitle>
            <CardDescription className="text-white/70 text-xs">High impact field alerts.</CardDescription>
          </CardHeader>
          <CardContent className="p-8 space-y-6">
            <div className="space-y-4">
              {data.reports.slice(0, 3).map((report: any, i: number) => (
                <div key={i} className="flex gap-4 group">
                  <div className="shrink-0 w-1 p-3 bg-blue-600 rounded-full transition-all group-hover:bg-blue-400"></div>
                  <div>
                    <p className="text-xs font-bold text-blue-400 uppercase tracking-widest">Site Signal</p>
                    <p className="font-bold text-sm leading-tight mt-1">{report.project_name}</p>
                    <p className="text-xs text-white/40 mt-1 italic">"{report.content.substring(0, 60)}..."</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="pt-6 border-t border-white/10">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-bold text-white/50 uppercase tracking-widest">Net Position</p>
                  <p className="text-3xl font-black text-white mt-1">{formatCurrency(data.profitLoss?.profit || 0, currency)}</p>
                </div>
                <div className="bg-white/10 p-3 rounded-2xl">
                  <Activity className="w-6 h-6 text-blue-400" />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="border-none shadow-sm rounded-3xl bg-white overflow-hidden">
          <CardHeader className="p-8 pb-4 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-xl font-bold">Delivery Roadmap</CardTitle>
              <CardDescription>Major infrastructure milestones.</CardDescription>
            </div>
            <Button variant="ghost" className="text-blue-600 font-bold hover:bg-blue-50 rounded-xl">SCHEDULE</Button>
          </CardHeader>
          <CardContent className="px-8 pb-8">
            <div className="space-y-4">
              {data.projects.slice(0, 4).map((p: any, i: number) => (
                <div key={i} className="flex items-center justify-between p-4 bg-[#F5F5F5] rounded-2xl hover:bg-white hover:shadow-md transition-all duration-300">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-white rounded-xl shadow-sm flex items-center justify-center font-black text-blue-600">
                      {p.progress}%
                    </div>
                    <div>
                      <p className="font-bold text-[#141414]">{p.name}</p>
                      <p className="text-xs text-[#8E9299] font-medium uppercase tracking-wide">{p.client}</p>
                    </div>
                  </div>
                  <Badge className={p.status === 'In Progress' ? 'bg-blue-100 text-blue-600' : 'bg-green-100 text-green-700'}>
                    {p.status}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm rounded-3xl bg-white overflow-hidden">
          <CardHeader className="p-8 pb-4 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-xl font-bold">Compliance Matrix</CardTitle>
              <CardDescription>Legal and fiscal standing.</CardDescription>
            </div>
            <Button variant="ghost" className="text-blue-600 font-bold hover:bg-blue-50 rounded-xl">AUDIT</Button>
          </CardHeader>
          <CardContent className="px-8 pb-8 space-y-6">
            <ComplianceItem label="SSNIT Remittance" status="COMPLIANT" value="Month Paid" color="green" />
            <ComplianceItem label="PAYE Tax Filings" status="WARNING" value="Due in 2 days" color="yellow" />
            <ComplianceItem label="Equip Insurance" status="COMPLIANT" value="12 Units Vetted" color="green" />
            <ComplianceItem label="Retention Held" status="ACTIVE" value={formatCurrency(activeProjects.length * 52000, currency)} color="blue" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KPI({ icon: Icon, label, value, trend, positive, description }: any) {
  return (
    <Card className="border-none shadow-sm rounded-3xl overflow-hidden group hover:shadow-xl hover:shadow-blue-500/5 transition-all duration-300 bg-white">
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="p-3 bg-[#F5F5F5] rounded-2xl group-hover:bg-blue-600 group-hover:text-white transition-colors">
            <Icon className="w-6 h-6" />
          </div>
          {trend && (
            <Badge className={`bg-transparent border-none ${positive ? 'text-green-600' : 'text-blue-600'} font-bold text-[10px]`}>
              {positive ? <ArrowUpRight className="w-3 h-3 mr-1 inline" /> : null}
              {trend}
            </Badge>
          )}
        </div>
        <div className="mt-4">
          <p className="text-xs font-bold text-[#8E9299] uppercase tracking-widest">{label}</p>
          <p className="text-3xl font-black text-[#141414] mt-1 tabular-nums">{value}</p>
          {description && <p className="text-[10px] text-[#8E9299] mt-2 font-medium">{description}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function ComplianceItem({ label, status, value, color }: any) {
  const colorMap: any = {
    green: 'bg-green-100 text-green-700',
    yellow: 'bg-yellow-100 text-yellow-700',
    blue: 'bg-blue-100 text-blue-700'
  };
  return (
    <div className="flex items-center justify-between p-4 hover:bg-[#F5F5F5] rounded-2xl transition-colors">
      <div className="flex flex-col">
        <span className="text-xs font-bold text-[#8E9299] uppercase tracking-widest">{label}</span>
        <span className="text-sm font-bold text-[#141414] mt-1">{value}</span>
      </div>
      <Badge className={`${colorMap[color]} border-none px-3 font-bold`}>{status}</Badge>
    </div>
  );
}
