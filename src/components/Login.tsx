import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import LogoImg from '../thisone.png';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './ui/card';
import { Briefcase, Lock, Mail, Loader2, Smartphone, ArrowLeft, KeyRound, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { authApi, apiErrorMessage } from '../lib/api';
import { passwordProblem, PASSWORD_HINT } from './ChangePasswordForm';

type LoginMode = 'login' | 'email_otp' | 'forgot_phone' | 'forgot_otp' | 'reset_password' | 'success';

export default function Login() {
  const [mode, setMode] = useState<LoginMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [devCode, setDevCode] = useState('');
  const [otpMessage, setOtpMessage] = useState('');
  const [otpAccount, setOtpAccount] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { login, completeLogin } = useAuth();

  useEffect(() => {
    if (mode !== 'login') return;
    const value = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setOtpAccount(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const response = await authApi.loginMethod(value);
        if (!cancelled) setOtpAccount(response.data.method === 'otp');
      } catch {
        if (!cancelled) setOtpAccount(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [email, mode]);

  const requestCode = async (address: string) => {
    setIsLoading(true);
    try {
      const response = await authApi.requestOtp(address.trim().toLowerCase());
      setOtpMessage(response.data.message || '');
      setDevCode(response.data.dev_code || '');
      setOtpCode(response.data.dev_code || '');
      setMode('email_otp');
      if (response.data.dev_code) {
        toast.message('Sign-in code is on this screen', { description: 'Email delivery is not configured in this environment.' });
      } else {
        toast.success(response.data.message);
      }
    } catch (error: any) {
      toast.error(apiErrorMessage(error, 'Could not send a sign-in code'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const address = email.trim().toLowerCase();
    let useOtp = otpAccount;
    if (!useOtp) {
      try {
        const response = await authApi.loginMethod(address);
        useOtp = response.data.method === 'otp';
        setOtpAccount(useOtp);
      } catch {
        useOtp = false;
      }
    }
    if (useOtp) {
      await requestCode(address);
      return;
    }
    if (!password) {
      toast.error('Enter your password');
      return;
    }
    setIsLoading(true);
    try {
      await login({ email: address, password });
      toast.success('Welcome back!');
    } catch (error: any) {
      if (error?.response?.data?.code === 'OTP_REQUIRED') {
        setIsLoading(false);
        await requestCode(address);
        return;
      }
      toast.error('Login failed', { description: apiErrorMessage(error, 'Please check your credentials.') });
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmailOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const response = await authApi.verifyOtp(email.trim().toLowerCase(), otpCode.trim());
      completeLogin(response.data.token, response.data.user);
      toast.success('Welcome back!');
    } catch (error: any) {
      toast.error(apiErrorMessage(error, 'That code was not accepted'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const response = await authApi.forgotPassword(phone);
      toast.success(response.data.message);
      setMode('forgot_otp');
    } catch (error: any) {
      toast.error(apiErrorMessage(error, 'Failed to send reset code'));
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
    const problem = passwordProblem(newPassword);
    if (problem) {
      toast.error(problem);
      return;
    }
    setIsLoading(true);
    try {
      await authApi.resetPassword({ 
        phone, 
        code: otpCode, 
        newPassword 
      });
      toast.success('Password updated successfully');
      setMode('success');
    } catch (error: any) {
      toast.error(apiErrorMessage(error, 'Reset failed'));
      if (/request a new code|expired/i.test(error?.response?.data?.message || '')) setMode('forgot_otp');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#F5F5F5] p-4 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-blue-50 to-indigo-50 z-0" />
      
      <Card className="w-full max-w-md shadow-2xl z-10 border-none rounded-3xl overflow-hidden bg-white/95 backdrop-blur-xl">
        <CardHeader className="space-y-4 pt-12 px-10 pb-8 text-center bg-white border-b border-gray-100">
          <div className="mx-auto w-24 h-24 bg-white rounded-3xl flex items-center justify-center shadow-xl transform -rotate-3 border border-blue-100 p-2">
            <img src={LogoImg} className="w-full h-full object-contain" alt="Logo" />
          </div>
          <div className="space-y-1 pt-2">
            <CardTitle className="text-3xl font-black tracking-tighter">
              <span className="text-[#141414]">bytz</span>
              <span className="text-orange-500">forge</span>
            </CardTitle>
            <CardDescription className="text-[#8E9299] font-medium">
              {mode === 'login' ? 'Terminal Access Portal' : mode === 'email_otp' ? 'Email sign-in code' : 'Security Recovery'}
            </CardDescription>
          </div>
        </CardHeader>
        
        <CardContent className="p-10">
          {mode === 'login' && (
            <form onSubmit={handleLogin} className="space-y-6">
              <div className="space-y-2">
                <Label className="font-bold text-[10px] uppercase tracking-widest text-[#8E9299]">Email</Label>
                <div className="relative"><Mail className="absolute left-3 top-3 h-4 w-4 text-[#8E9299]" /><Input type="email" placeholder="you@company.com" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required className="h-12 pl-10 bg-[#F5F5F5] border-none rounded-xl" /></div>
              </div>
              {otpAccount ? (
                <p className="text-sm text-[#8E9299]">This account signs in with a one-time email code. Password sign-in is not used.</p>
              ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="font-bold text-[10px] uppercase tracking-widest text-[#8E9299]">Password</Label>
                  <button type="button" onClick={() => setMode('forgot_phone')} className="text-[11px] font-bold text-blue-600 hover:underline">Forgot?</button>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-[#8E9299]" />
                  <Input 
                    type={showPassword ? "text" : "password"} 
                    placeholder="••••••••" 
                    value={password} 
                    onChange={(e) => setPassword(e.target.value)} 
                    className="h-12 pl-10 pr-12 bg-[#F5F5F5] border-none rounded-xl" 
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-3 text-[#8E9299] hover:text-[#141414]"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              )}
              <Button type="submit" className="w-full h-12 bg-[#141414] text-white rounded-xl font-bold shadow-xl shadow-black/10 hover:bg-black transition-all" disabled={isLoading}>{isLoading ? <Loader2 className="animate-spin" /> : otpAccount ? 'Email me a sign-in code' : 'Enter Dashboard'}</Button>
            </form>
          )}

          {mode === 'email_otp' && (
            <form onSubmit={handleEmailOtp} className="space-y-6">
              <div className="space-y-2 text-center pb-2">
                <p className="text-sm text-[#8E9299]">{otpMessage || <>Enter the 6-digit code for <b>{email}</b></>}</p>
              </div>
              {devCode && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center" data-testid="dev-otp">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-amber-800">Local sign-in code</p>
                  <p className="mt-1 text-sm text-amber-900">Email delivery is not configured, so the code is shown here. It is hidden in production.</p>
                  <p className="mt-2 text-3xl font-black tracking-[0.3em] text-[#141414]">{devCode}</p>
                </div>
              )}
              <div className="space-y-2">
                <Label className="font-bold text-[10px] uppercase tracking-widest text-[#8E9299]">6-Digit Code</Label>
                <div className="relative"><KeyRound className="absolute left-3 top-3 h-4 w-4 text-[#8E9299]" /><Input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" value={otpCode} onChange={(e) => setOtpCode(e.target.value)} required className="h-12 pl-10 bg-[#F5F5F5] border-none rounded-xl text-center tracking-[1em] font-black" /></div>
              </div>
              <Button type="submit" className="w-full h-12 bg-[#141414] text-white rounded-xl font-bold shadow-xl shadow-black/10 hover:bg-black transition-all" disabled={isLoading}>{isLoading ? <Loader2 className="animate-spin" /> : 'Enter Dashboard'}</Button>
              <button type="button" onClick={() => requestCode(email)} className="w-full text-sm font-bold text-blue-600 hover:underline" disabled={isLoading}>Send a new code</button>
              <button type="button" onClick={() => { setMode('login'); setDevCode(''); }} className="w-full text-sm font-bold text-[#8E9299] hover:text-[#141414]">Use a different account</button>
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
              <Button type="submit" className="w-full h-12 bg-[#141414] text-white rounded-xl font-bold shadow-xl shadow-black/10 hover:bg-black transition-all" disabled={isLoading}>{isLoading ? <Loader2 className="animate-spin" /> : 'Send Reset Code'}</Button>
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
              <Button type="submit" className="w-full h-12 bg-[#141414] text-white rounded-xl font-bold shadow-xl shadow-black/10 hover:bg-black transition-all">Verify Code</Button>
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
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-[#8E9299]" />
                  <Input 
                    type={showPassword ? "text" : "password"} 
                    placeholder="••••••••" 
                    value={newPassword} 
                    onChange={(e) => setNewPassword(e.target.value)} 
                    required 
                    className="h-12 pl-10 pr-12 bg-[#F5F5F5] border-none rounded-xl" 
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-3 text-[#8E9299] hover:text-[#141414]"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="text-xs text-[#8E9299]">{PASSWORD_HINT}</p>
              </div>
              <Button type="submit" className="w-full h-12 bg-[#141414] text-white rounded-xl font-bold shadow-xl shadow-black/10 hover:bg-black transition-all" disabled={isLoading}>{isLoading ? <Loader2 className="animate-spin" /> : 'Update Password'}</Button>
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
        
      </Card>
    </div>
  );
}
