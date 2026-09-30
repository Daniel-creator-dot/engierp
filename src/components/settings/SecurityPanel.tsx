import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { ShieldCheck, ShieldAlert, Users, Lock, KeyRound, Clock, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { settingsApi } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import ChangePasswordForm, { PASSWORD_HINT } from '../ChangePasswordForm';

interface SecuritySummary {
  total_users: number;
  active_users: number;
  inactive_users: number;
  pending_password_change: string[];
  locked_accounts: string[];
  never_logged_in: string[];
  dormant_30_days: string[];
  admins: string[];
  sms_configured: boolean;
  jwt_secret_from_env: boolean;
  sms_key_from_env: boolean;
}

function Stat({ icon: Icon, label, value, tone = 'default' }: { icon: any; label: string; value: number | string; tone?: 'default' | 'warn' }) {
  return (
    <div className={`p-4 rounded-2xl ${tone === 'warn' ? 'bg-amber-50 text-amber-900' : 'bg-[#F5F5F5]'}`}>
      <div className="flex items-center gap-2 text-xs font-bold uppercase text-[#8E9299]"><Icon className="w-4 h-4" /> {label}</div>
      <p className="text-2xl font-black mt-1">{value}</p>
    </div>
  );
}

function EmailList({ title, emails }: { title: string; emails: string[] }) {
  if (!emails.length) return null;
  return (
    <div>
      <p className="text-sm font-bold text-[#141414]">{title}</p>
      <p className="text-sm text-[#5f6368]">{emails.join(', ')}</p>
    </div>
  );
}

function ConfigRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className={`flex items-start gap-3 p-3 rounded-xl ${ok ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-900'}`}>
      {ok ? <ShieldCheck className="w-5 h-5 shrink-0" /> : <ShieldAlert className="w-5 h-5 shrink-0" />}
      <div>
        <p className="text-sm font-bold">{label}</p>
        <p className="text-xs">{detail}</p>
      </div>
    </div>
  );
}

export default function SecurityPanel() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [summary, setSummary] = useState<SecuritySummary | null>(null);
  const [loading, setLoading] = useState(isAdmin);

  useEffect(() => {
    if (!isAdmin) return;
    settingsApi.getSecuritySummary()
      .then(res => setSummary(res.data))
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
  }, [isAdmin]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle>Your Account</CardTitle>
          <CardDescription>
            {user?.last_login_at ? `Signed in ${format(new Date(user.last_login_at), 'd MMM yyyy, HH:mm')}.` : 'Sign-in time not recorded yet.'}
            {' '}Password policy: {PASSWORD_HINT}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>

      {isAdmin && (
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle>Access Overview</CardTitle>
            <CardDescription>Accounts lock for 15 minutes after 5 failed sign-ins. Sessions last 24 hours.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {loading ? (
              <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>
            ) : !summary ? (
              <p className="text-sm text-[#8E9299]">Could not load the security overview.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Stat icon={Users} label="Active users" value={summary.active_users} />
                  <Stat icon={Users} label="Deactivated" value={summary.inactive_users} />
                  <Stat icon={KeyRound} label="Awaiting first sign-in" value={summary.pending_password_change.length} tone={summary.pending_password_change.length ? 'warn' : 'default'} />
                  <Stat icon={Lock} label="Locked now" value={summary.locked_accounts.length} tone={summary.locked_accounts.length ? 'warn' : 'default'} />
                </div>
                <div className="space-y-3">
                  <EmailList title="Administrators" emails={summary.admins} />
                  <EmailList title="Locked accounts" emails={summary.locked_accounts} />
                  <EmailList title="Never signed in" emails={summary.never_logged_in} />
                  <EmailList title="No sign-in for 30+ days (consider deactivating)" emails={summary.dormant_30_days} />
                </div>
                <div className="space-y-2">
                  <ConfigRow
                    ok={summary.jwt_secret_from_env}
                    label="Session signing key"
                    detail={summary.jwt_secret_from_env ? 'Set from the JWT_SECRET environment variable.' : 'JWT_SECRET is not set on the server; a key stored in the database is used. Set JWT_SECRET on the host.'}
                  />
                  <ConfigRow
                    ok={summary.sms_configured}
                    label="SMS gateway"
                    detail={summary.sms_configured
                      ? summary.sms_key_from_env ? 'Key set from the SMS_API_KEY environment variable.' : 'Using the key saved in the SMS Gateway tab.'
                      : 'Not configured: password-reset codes and SMS alerts are disabled. Set SMS_API_KEY on the host.'}
                  />
                </div>
                <p className="text-xs text-[#8E9299] flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> Every sign-in, user change and settings change is recorded in the Audit Log tab.</p>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
