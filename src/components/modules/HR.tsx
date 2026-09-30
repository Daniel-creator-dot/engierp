import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { settingsApi } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import type { Setting } from './hr/types';
import { ATTENDANCE_VIEW_ROLES, PAYROLL_PREPARE_ROLES, errorMessage } from './hr/utils';
import Directory from './hr/Directory';
import Payroll from './hr/Payroll';
import Leave from './hr/Leave';
import Attendance from './hr/Attendance';
import Performance from './hr/Performance';

interface HRProps {
  activeSub?: string;
}

const TITLES: Record<string, { title: string; subtitle: string }> = {
  'hr-directory': { title: 'Human Capital Management', subtitle: 'Personnel records, statutory data and bank details.' },
  'hr-payroll': { title: 'Payroll', subtitle: 'Monthly runs, statutory deductions and payslips.' },
  'hr-attendance': { title: 'Attendance & Timesheets', subtitle: 'Daily site and office attendance feeding payroll and project labour cost.' },
  'hr-leave': { title: 'Leave Management', subtitle: 'Requests, approvals and annual balances.' },
  'hr-performance': { title: 'Performance', subtitle: 'Appraisals and review history.' },
};

function NoAccess({ what }: { what: string }) {
  return <div className="p-10 text-center text-sm text-[#8E9299] bg-white rounded-2xl">You don't have access to {what}.</div>;
}

export default function HR({ activeSub = 'hr-directory' }: HRProps) {
  const { user } = useAuth();
  const role = user?.role || '';
  const [settings, setSettings] = useState<Setting[]>([]);

  useEffect(() => {
    settingsApi.getSettings()
      .then(res => setSettings(res.data))
      .catch(error => toast.error(errorMessage(error, 'Failed to load company settings')));
  }, []);

  const sub = TITLES[activeSub] ? activeSub : 'hr-directory';
  const { title, subtitle } = TITLES[sub];

  const content = () => {
    switch (sub) {
      case 'hr-payroll':
        return <Payroll settings={settings} />;
      case 'hr-attendance':
        return ATTENDANCE_VIEW_ROLES.includes(role) ? <Attendance /> : <NoAccess what="attendance" />;
      case 'hr-leave':
        return <Leave />;
      case 'hr-performance':
        return <Performance />;
      default:
        return PAYROLL_PREPARE_ROLES.includes(role) ? <Directory settings={settings} /> : <NoAccess what="the employee directory" />;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[#141414]">{title}</h1>
        <p className="text-[#8E9299]">{subtitle}</p>
      </div>
      {content()}
    </div>
  );
}
