import React, { useState } from 'react';
import { Loader2, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { authApi, apiErrorMessage } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

export const PASSWORD_HINT = 'At least 8 characters, including a letter and a number.';

export const passwordProblem = (password: string) => {
  if (password.length < 8) return 'Password must be at least 8 characters long.';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Password must contain at least one letter and one number.';
  return null;
};

export default function ChangePasswordForm({ onDone, submitLabel = 'Change Password' }: { onDone?: () => void; submitLabel?: string }) {
  const { applySession } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = passwordProblem(newPassword);
    if (problem) return toast.error(problem);
    if (newPassword !== confirmPassword) return toast.error('The new passwords do not match.');
    setSaving(true);
    try {
      const res = await authApi.changePassword({ currentPassword, newPassword });
      applySession(res.data.token, res.data.user);
      toast.success('Password changed');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      onDone?.();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Could not change password'));
    } finally {
      setSaving(false);
    }
  };

  const type = show ? 'text' : 'password';
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Current password</Label>
        <Input type={type} value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required autoComplete="current-password" className="bg-[#F5F5F5] border-none rounded-xl h-11" />
      </div>
      <div className="space-y-2">
        <Label>New password</Label>
        <div className="relative">
          <Input type={type} value={newPassword} onChange={e => setNewPassword(e.target.value)} required autoComplete="new-password" className="bg-[#F5F5F5] border-none rounded-xl h-11 pr-11" />
          <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-3 text-[#8E9299] hover:text-[#141414]" aria-label={show ? 'Hide passwords' : 'Show passwords'}>
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <p className="text-xs text-[#8E9299]">{PASSWORD_HINT}</p>
      </div>
      <div className="space-y-2">
        <Label>Confirm new password</Label>
        <Input type={type} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required autoComplete="new-password" className="bg-[#F5F5F5] border-none rounded-xl h-11" />
      </div>
      <Button type="submit" disabled={saving} className="w-full h-11 bg-[#141414] text-white rounded-xl font-bold hover:bg-black">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : submitLabel}
      </Button>
    </form>
  );
}
