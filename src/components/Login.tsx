import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import LogoImg from '../thisone.png';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './ui/card';
import { Briefcase, Lock, Mail, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await login({ email, password });
      toast.success('Welcome back!');
    } catch (error) {
      toast.error('Login failed', {
        description: 'Please check your credentials and try again.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#F5F5F5] p-4 relative overflow-hidden">
      {/* Dynamic Background Elements */}
      <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-blue-50 to-indigo-50 z-0" />
      <div className="absolute -top-24 -left-24 w-96 h-96 bg-white/5 rounded-full blur-3xl z-0" />
      
      <Card className="w-full max-w-md shadow-2xl z-10 border-none rounded-3xl overflow-hidden bg-white/95 backdrop-blur-xl">
        <CardHeader className="space-y-4 pt-12 px-10 pb-8 text-center bg-[#141414] border-b border-white/5">
          <div className="mx-auto w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-lg transform -rotate-6">
            <img src={LogoImg} className="w-8 h-8 object-contain" alt="Logo" />
          </div>
          <div className="space-y-1">
            <CardTitle className="text-2xl font-bold tracking-tight">
              <span className="text-orange-500">bytz</span>
              <span className="text-white">forge</span>
              <span className="text-white/60 ml-2">Portal</span>
            </CardTitle>
            <CardDescription className="text-[#8E9299]">
              Enter your credentials to access the terminal.
            </CardDescription>
          </div>
        </CardHeader>
        
        <CardContent className="p-10">
          <form id="login-form" onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest text-[#8E9299]">Email Address</Label>
              <div className="relative group">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-[#8E9299] group-focus-within:text-blue-600 transition-colors" />
                <Input 
                  type="email" 
                  placeholder="admin@bytzforge.com" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required 
                  className="h-12 pl-10 bg-[#F5F5F5] border-none rounded-xl focus-visible:ring-2 focus-visible:ring-blue-600 transition-all" 
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="font-bold text-xs uppercase tracking-widest text-[#8E9299]">Password</Label>
                <button type="button" className="text-xs font-bold text-blue-600 hover:underline">Forgot password?</button>
              </div>
              <div className="relative group">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-[#8E9299] group-focus-within:text-blue-600 transition-colors" />
                <Input 
                  type="password" 
                  placeholder="••••••••" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required 
                  className="h-12 pl-10 bg-[#F5F5F5] border-none rounded-xl focus-visible:ring-2 focus-visible:ring-blue-600 transition-all" 
                />
              </div>
            </div>

            <Button 
              type="submit" 
              className="w-full h-12 bg-blue-600 text-white rounded-xl font-bold shadow-xl shadow-blue-500/20 hover:bg-blue-700 hover:scale-[1.02] active:scale-[0.98] transition-all"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Authenticating...
                </>
              ) : (
                'Sign In to Dashboard'
              )}
            </Button>
          </form>
        </CardContent>
        
        <CardFooter className="px-10 py-6 bg-[#F5F5F5]/30 border-t border-[#E4E3E0] flex flex-col gap-4">
          <div className="flex items-center justify-center gap-2 text-xs text-[#8E9299]">
            <div className="w-1 h-1 rounded-full bg-blue-600" />
            Encrypted Session
            <div className="w-1 h-1 rounded-full bg-blue-600" />
            Authorized Access Only
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
