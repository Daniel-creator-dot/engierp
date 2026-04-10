import React, { useState, useEffect } from 'react';
import { 
  User, 
  Mail, 
  Shield, 
  Calendar, 
  Building, 
  Phone, 
  MapPin, 
  CreditCard,
  CheckCircle2,
  Clock,
  LogOut,
  ChevronRight,
  Loader2,
  Briefcase
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Button } from '../ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Badge } from '../ui/badge';
import { useAuth } from '../../contexts/AuthContext';
import { hrApi } from '../../lib/api';
import { toast } from 'sonner';

export default function Profile() {
  const { user, logout } = useAuth();
  const [employee, setEmployee] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchEmployeeData();
  }, [user]);

  const fetchEmployeeData = async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const res = await hrApi.getEmployees();
      // Try to find employee by email prefix or full email if possible
      // Assuming employee names or some field might match
      const match = res.data.find((emp: any) => 
        emp.name.toLowerCase().includes(user.email.split('@')[0].toLowerCase()) ||
        emp.email?.toLowerCase() === user.email.toLowerCase()
      );
      setEmployee(match);
    } catch (error) {
      console.error('Failed to link HR profile');
    } finally {
      setIsLoading(false);
    }
  };

  if (!user) return null;

  return (
    <div className="max-w-4xl mx-auto space-y-10 pb-20">
      {/* Header Profile Section */}
      <div className="relative group">
        <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-[2.5rem] blur opacity-25 group-hover:opacity-40 transition duration-1000"></div>
        <Card className="relative border-none shadow-2xl rounded-[2.5rem] bg-white overflow-hidden">
          <CardContent className="p-8 md:p-12">
            <div className="flex flex-col md:flex-row items-center gap-10">
              <div className="relative">
                <Avatar className="w-32 h-32 md:w-40 md:h-40 border-4 border-white shadow-2xl">
                  <AvatarImage src={`https://api.dicebear.com/7.x/initials/svg?seed=${user.email}&backgroundColor=2563eb,3b82f6,60a5fa`} />
                  <AvatarFallback className="bg-blue-600 text-white text-4xl font-bold">
                    {user.email.substring(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="absolute bottom-2 right-2 bg-green-500 w-6 h-6 rounded-full border-4 border-white shadow-lg"></div>
              </div>
              
              <div className="text-center md:text-left space-y-4">
                <div className="space-y-1">
                  <Badge className="bg-blue-100 text-blue-700 border-none font-bold px-3 mb-2">
                    ACTIVE {user.role.toUpperCase()}
                  </Badge>
                  <h1 className="text-3xl md:text-5xl font-black text-[#141414] tracking-tighter">
                    {user.email.split('@')[0]}
                  </h1>
                  <div className="flex items-center justify-center md:justify-start gap-2 text-[#8E9299] font-medium text-lg">
                    <Mail className="w-5 h-5" />
                    {user.email}
                  </div>
                </div>
                
                <div className="flex flex-wrap justify-center md:justify-start gap-3">
                  <Button className="bg-[#141414] text-white hover:bg-black rounded-xl font-bold px-8 h-12">
                    Edit Profile
                  </Button>
                  <Button variant="outline" className="rounded-xl font-bold px-8 h-12 border-[#F5F5F5] hover:bg-[#F5F5F5]" onClick={logout}>
                    <LogOut className="w-4 h-4 mr-2" /> Log out
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-8 md:grid-cols-2">
        {/* Employment Matrix */}
        <Card className="border-none shadow-xl shadow-black/[0.02] rounded-3xl bg-white overflow-hidden">
          <CardHeader className="p-8 border-b border-[#F5F5F5]">
            <CardTitle className="text-xl font-bold flex items-center gap-3">
              <Building className="w-5 h-5 text-blue-600" /> Employment Matrix
            </CardTitle>
            <CardDescription>Official personnel connectivity data.</CardDescription>
          </CardHeader>
          <CardContent className="p-8 space-y-6">
            {isLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
              </div>
            ) : employee ? (
              <>
                <ProfileItem icon={Shield} label="Employee ID" value={employee.id} />
                <ProfileItem icon={Building} label="Department" value={employee.department} />
                <ProfileItem icon={Briefcase} label="Official Role" value={employee.role} />
                <ProfileItem icon={Calendar} label="Commencement" value={employee.joinDate} />
                {employee.phone && <ProfileItem icon={Phone} label="Contact" value={employee.phone} />}
              </>
            ) : (
              <div className="p-6 bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-center">
                <p className="text-sm font-medium text-slate-500">
                  No linked HR record found for this account email. 
                </p>
                <Button variant="link" className="text-blue-600 font-bold mt-2 h-auto p-0">
                  Link Employee Record
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Security & Access */}
        <Card className="border-none shadow-xl shadow-black/[0.02] rounded-3xl bg-white overflow-hidden">
          <CardHeader className="p-8 border-b border-[#F5F5F5]">
            <CardTitle className="text-xl font-bold flex items-center gap-3">
              <Shield className="w-5 h-5 text-green-600" /> Digital Credentials
            </CardTitle>
            <CardDescription>Security and authentication footprint.</CardDescription>
          </CardHeader>
          <CardContent className="p-8 space-y-6">
            <div className="flex items-center justify-between p-4 bg-green-50 rounded-2xl border border-green-100">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-500 rounded-lg">
                  <CheckCircle2 className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="font-bold text-green-900 text-sm">Account Status</p>
                  <p className="text-xs text-green-700">Verified & Active</p>
                </div>
              </div>
              <Badge className="bg-green-500">TRUSTED</Badge>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between py-2 border-b border-[#F5F5F5]">
                <div className="flex items-center gap-3">
                  <Clock className="w-4 h-4 text-[#8E9299]" />
                  <span className="text-sm font-medium text-[#141414]">Last Signed In</span>
                </div>
                <span className="text-xs font-bold text-[#8E9299]">Today, {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-[#F5F5F5]">
                <div className="flex items-center gap-3">
                  <MapPin className="w-4 h-4 text-[#8E9299]" />
                  <span className="text-sm font-medium text-[#141414]">Location</span>
                </div>
                <span className="text-xs font-bold text-[#8E9299]">Ghana (ERP Origin)</span>
              </div>
              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  <Monitor className="w-4 h-4 text-[#8E9299]" />
                  <span className="text-sm font-medium text-[#141414]">Primary Device</span>
                </div>
                <span className="text-xs font-bold text-[#8E9299]">Macintosh (Chrome)</span>
              </div>
            </div>

            <Button className="w-full bg-[#141414] text-white hover:bg-black rounded-xl font-bold h-12 group">
              Security Settings <ChevronRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Monitor({ className }: { className?: string }) {
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      width="24" 
      height="24" 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      className={className}
    >
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <line x1="8" x2="16" y1="21" y2="21" />
      <line x1="12" x2="12" y1="17" y2="21" />
    </svg>
  );
}

function ProfileItem({ icon: Icon, label, value }: any) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-[#F5F5F5] rounded-xl">
          <Icon className="w-4 h-4 text-[#141414]" />
        </div>
        <span className="text-sm font-bold text-[#8E9299] uppercase tracking-widest">{label}</span>
      </div>
      <span className="text-sm font-black text-[#141414]">{value}</span>
    </div>
  );
}
