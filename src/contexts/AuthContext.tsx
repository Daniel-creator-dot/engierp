import React, { createContext, useContext, useState, useEffect } from 'react';
import { toast } from 'sonner';
import { authApi, onSessionEnded, onPasswordChangeRequired } from '../lib/api';

export interface User {
  id: number;
  email: string;
  role: string;
  phone?: string | null;
  employee_id?: string;
  name?: string | null;
  must_change_password?: boolean;
  last_login_at?: string | null;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (credentials: any) => Promise<void>;
  logout: () => void;
  /** Store a refreshed token/user returned by change-password or profile updates. */
  applySession: (token: string | undefined, user: User) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
    const offSession = onSessionEnded((message) => {
      setUser(null);
      toast.error('Signed out', { description: message });
    });
    const offPasswordChange = onPasswordChangeRequired(() => {
      setUser(current => current ? { ...current, must_change_password: true } : current);
    });
    return () => { offSession(); offPasswordChange(); };
  }, []);

  const checkAuth = async () => {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const response = await authApi.me();
        setUser(response.data);
      } catch (error: any) {
        // Keep the token on network errors so a brief outage doesn't sign everyone out.
        if (error?.response?.status === 401) localStorage.removeItem('token');
        setUser(null);
      }
    }
    setLoading(false);
  };

  const login = async (credentials: any) => {
    const response = await authApi.login(credentials);
    const { token, user } = response.data;
    localStorage.setItem('token', token);
    setUser(user);
  };

  const logout = () => {
    localStorage.removeItem('token');
    setUser(null);
  };

  const applySession = (token: string | undefined, nextUser: User) => {
    if (token) localStorage.setItem('token', token);
    setUser(nextUser);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, applySession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
