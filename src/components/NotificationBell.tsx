import { useCallback, useEffect, useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { notificationsApi } from '../lib/api';
import type { Module } from '../types';

interface Notification {
  id: number;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  read_at?: string | null;
  created_at: string;
}

const POLL_MS = 60_000;

export default function NotificationBell({ onNavigate }: { onNavigate: (module: Module) => void }) {
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await notificationsApi.list();
      setItems(res.data.items || []);
      setUnread(res.data.unread || 0);
    } catch {
      // The bell is non-essential; keep the last known state.
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const open = async (n: Notification) => {
    if (!n.read_at) {
      setItems(list => list.map(x => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
      setUnread(c => Math.max(c - 1, 0));
      notificationsApi.markRead(n.id).catch(() => undefined);
    }
    if (n.link) onNavigate(n.link as Module);
  };

  const markAll = async () => {
    setItems(list => list.map(x => ({ ...x, read_at: x.read_at || new Date().toISOString() })));
    setUnread(0);
    notificationsApi.markAllRead().catch(() => undefined);
  };

  return (
    <DropdownMenu onOpenChange={isOpen => { if (isOpen) load(); }}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative hover:bg-[#F5F5F5]" aria-label={unread ? `${unread} unread notifications` : 'Notifications'}>
          <Bell className="w-5 h-5" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full border-2 border-white flex items-center justify-center">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2">
          <DropdownMenuLabel className="p-0">Notifications</DropdownMenuLabel>
          {unread > 0 && (
            <button type="button" onClick={markAll} className="text-xs font-semibold text-blue-600 hover:underline flex items-center gap-1">
              <CheckCheck className="w-3.5 h-3.5" /> Mark all read
            </button>
          )}
        </div>
        <DropdownMenuSeparator className="m-0" />
        {items.length === 0 ? (
          <p className="p-6 text-center text-sm text-[#8E9299]">You're all caught up.</p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {items.map(n => (
              <button
                key={n.id}
                type="button"
                onClick={() => open(n)}
                className={`w-full text-left px-3 py-2.5 border-b border-[#F5F5F5] last:border-0 hover:bg-[#F5F5F5] ${n.read_at ? '' : 'bg-blue-50/60'}`}
              >
                <div className="flex items-start gap-2">
                  {!n.read_at && <span className="mt-1.5 w-2 h-2 rounded-full bg-blue-600 shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[#141414]">{n.title}</p>
                    {n.body && <p className="text-xs text-[#5f6368] mt-0.5 line-clamp-3">{n.body}</p>}
                    <p className="text-[10px] text-[#8E9299] mt-1">{formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
