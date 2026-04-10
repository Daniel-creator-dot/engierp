import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import LogoImg from '../thisone.png';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './ui/card';
import { Briefcase, Lock, Mail, Loader2, Smartphone, ArrowLeft, KeyRound, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import axios from 'axios';

type LoginMode = 'login' | 'forgot_phone' | 'forgot_otp' | 'reset_password' | 'success';

export default function Login() {
  const [mode, setMode] = useState<LoginMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await login({ email, password });
      toast.success('Welcome back!');
    } catch (error) {
      toast.error('Login failed', { description: 'Please check your credentials.' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await axios.post('/api/auth/forgot-password', { phone });
      toast.success('Reset code sent to your phone');
      setMode('forgot_otp');
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to send OTP');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setMode('reset_password');
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await axios.post('/api/auth/reset-password', { 
        phone, 
        code: otpCode, 
        newPassword 
      });
      toast.success('Password updated successfully');
      setMode('success');
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Reset failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#F5F5F5] p-4 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-blue-50 to-indigo-50 z-0" />
      
      <Card className="w-full max-w-md shadow-2xl z-10 border-none rounded-3xl overflow-hidden bg-white/95 backdrop-blur-xl">
        <CardHeader className="space-y-4 pt-12 px-10 pb-8 text-center bg-blue-50/50 border-b border-blue-100">
          <div className="mx-auto w-24 h-24 bg-white rounded-3xl flex items-center justify-center shadow-xl transform -rotate-3 border border-blue-100 p-2">
            <img src={LogoImg} className="w-full h-full object-contain" alt="Logo" />
          </div>
          <div className="space-y-1 pt-2">
            <CardTitle className="text-3xl font-black tracking-tighter">
              <span className="text-orange-500">bytz</span>
              <span className="text-[#141414]">forge</span>
            </CardTitle>
            <CardDescription className="text-[#8E9299] font-medium">
              {mode === 'login' ? 'Terminal Access Portal' : 'Security Recovery'}
            </CardDescription>
          </div>
        </CardHeader>
        
        <CardContent className="p-10">
          {mode === 'login' && (
            <form onSubmit={handleLogin} className="space-y-6">
              <div className="space-y-2">
                <Label className="font-bold text-[10px] uppercase tracking-widest text-[#8E9299]">Administrator Email</Label>
                <div className="relative"><Mail className="absolute left-3 top-3 h-4 w-4 text-[#8E9299]" /><Input type="email" placeholder="admin@bytzforge.com" value={email} onChange={(e) => setEmail(e.target.value)} required className="h-12 pl-10 bg-[#F5F5F5] border-none rounded-xl" /></div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between"><Label className="font-bold text-[10px] uppercase tracking-widest text-[#8E9299]">Password</Label><button type="button" onClick={() => setMode('forgot_phone')} className="text-[11px] font-bold text-blue-600 hover:underline">Forgot?</button></div>
                <div className="relative"><Lock className="absolute left-3 top-3 h-4 w-4 text-[#8E9299]" /><Input type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required className="h-12 pl-10 bg-[#F5F5F5] border-none rounded-xl" /></div>
              </div>
              <Button type="submit" className="w-full h-12 bg-[#141414] text-white rounded-xl font-bold shadow-xl shadow-black/10 hover:bg-black transition-all" disabled={isLoading}>{isLoading ? <Loader2 className="animate-spin" /> : 'Enter Dashboard'}</Button>
            </form>
          )}

          {mode === 'forgot_phone' && (
            <form onSubmit={handleSendOTP} className="space-y-6">
              <div className="space-y-2 text-center pb-2">
                <p className="text-sm text-[#8E9299]">Enter your registered phone number to receive a reset code.</p>
              </div>
              <div className="space-y-2">
                <Label className="font-bold text-[10px] uppercase tracking-widest text-[#8E9299]">Phone Number</Label>
                <div className="relative"><Smartphone className="absolute left-3 top-3 h-4 w-4 text-[#8E9299]" /><Input type="text" placeholder="+233..." value={phone} onChange={(e) => setPhone(e.target.value)} required className="h-12 pl-10 bg-[#F5F5F5] border-none rounded-xl" /></div>
              </div>
              <Button type="submit" className="w-full h-12 bg-blue-600 text-white rounded-xl font-bold" disabled={isLoading}>{isLoading ? <Loader2 className="animate-spin" /> : 'Send Reset Code'}</Button>
              <button type="button" onClick={() => setMode('login')} className="w-full flex items-center justify-center gap-2 text-sm font-bold text-[#8E9299] hover:text-[#141414]"><ArrowLeft className="w-4 h-4" /> Back to Login</button>
            </form>
          )}

          {mode === 'forgot_otp' && (
            <form onSubmit={handleVerifyOTP} className="space-y-6">
              <div className="space-y-2 text-center pb-2">
                <p className="text-sm text-[#8E9299]">We sent a 6-digit code to <b>{phone}</b></p>
              </div>
              <div className="space-y-2">
                <Label className="font-bold text-[10px] uppercase tracking-widest text-[#8E9299]">6-Digit Code</Label>
                <div className="relative"><KeyRound className="absolute left-3 top-3 h-4 w-4 text-[#8E9299]" /><Input type="text" maxLength={6} placeholder="000000" value={otpCode} onChange={(e) => setOtpCode(e.target.value)} required className="h-12 pl-10 bg-[#F5F5F5] border-none rounded-xl text-center tracking-[1em] font-black" /></div>
              </div>
              <Button type="submit" className="w-full h-12 bg-blue-600 text-white rounded-xl font-bold">Verify Code</Button>
              <button type="button" onClick={() => setMode('forgot_phone')} className="w-full text-sm font-bold text-[#8E9299] hover:text-[#141414]">Try a different number</button>
            </form>
          )}

          {mode === 'reset_password' && (
            <form onSubmit={handleResetPassword} className="space-y-6">
              <div className="space-y-2 text-center pb-2">
                  <p className="text-sm text-[#8E9299]">Verification successful. Enter your new security password.</p>
              </div>
              <div className="space-y-2">
                <Label className="font-bold text-[10px] uppercase tracking-widest text-[#8E9299]">New Password</Label>
                <div className="relative"><Lock className="absolute left-3 top-3 h-4 w-4 text-[#8E9299]" /><Input type="password" placeholder="••••••••" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required className="h-12 pl-10 bg-[#F5F5F5] border-none rounded-xl" /></div>
              </div>
              <Button type="submit" className="w-full h-12 bg-green-600 text-white rounded-xl font-bold" disabled={isLoading}>{isLoading ? <Loader2 className="animate-spin" /> : 'Update Password'}</Button>
            </form>
          )}

          {mode === 'success' && (
            <div className="text-center space-y-6 py-4">
              <div className="mx-auto w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center"><CheckCircle2 className="w-8 h-8" /></div>
              <div className="space-y-1">
                <h3 className="text-xl font-bold">Access Restored</h3>
                <p className="text-sm text-[#8E9299]">Your password has been changed.</p>
              </div>
              <Button onClick={() => setMode('login')} className="w-full h-12 bg-[#141414] text-white rounded-xl font-bold">Return to Login</Button>
            </div>
          )}
        </CardContent>
        
        <CardFooter className="px-10 py-6 bg-[#F5F5F5]/30 border-t border-[#E4E3E0] flex flex-col gap-4">
          <div className="flex items-center justify-center gap-2 text-xs text-[#8E9299]">
            <div className="w-1 h-1 rounded-full bg-blue-600" />
            bytzforge Infrastructure Governance
            <div className="w-1 h-1 rounded-full bg-blue-600" />
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
