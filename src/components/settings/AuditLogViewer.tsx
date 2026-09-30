import { Fragment, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { ChevronDown, ChevronRight, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { auditApi, apiErrorMessage } from '../../lib/api';

interface AuditEntry {
  id: number;
  user_email?: string | null;
  user_role?: string | null;
  action: string;
  entity: string;
  entity_id?: string | null;
  before?: any;
  after?: any;
  ip?: string | null;
  created_at: string;
}

const PAGE_SIZE = 50;
const ALL = '__all__';

const humanize = (value: string) => value.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());

function ChangeDetail({ before, after }: { before: any; after: any }) {
  const keys = Array.from(new Set([...Object.keys(before || {}), ...Object.keys(after || {})]));
  if (!keys.length) return <p className="text-xs text-[#8E9299]">No field details recorded.</p>;
  const show = (v: any) => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-[#8E9299]"><th className="py-1 pr-4 font-semibold">Field</th><th className="py-1 pr-4 font-semibold">Before</th><th className="py-1 font-semibold">After</th></tr>
      </thead>
      <tbody>
        {keys.map(k => (
          <tr key={k} className="align-top border-t border-[#E4E3E0]">
            <td className="py-1 pr-4 font-mono">{k}</td>
            <td className="py-1 pr-4 break-all max-w-xs">{show(before?.[k])}</td>
            <td className="py-1 break-all max-w-xs">{show(after?.[k])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function AuditLogViewer() {
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [entities, setEntities] = useState<string[]>([]);
  const [entity, setEntity] = useState(ALL);
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    auditApi.list({
      entity: entity === ALL ? undefined : entity,
      q: appliedQuery || undefined,
      from: from || undefined,
      to: to || undefined,
      limit: PAGE_SIZE,
      offset,
    })
      .then(res => {
        if (cancelled) return;
        setItems(res.data.items);
        setTotal(res.data.total);
        setEntities(res.data.entities || []);
      })
      .catch(error => { if (!cancelled) toast.error(apiErrorMessage(error, 'Failed to load audit log')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [entity, appliedQuery, from, to, offset]);

  const toggle = (id: number) => setExpanded(s => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  return (
    <Card className="border-none shadow-sm">
      <CardHeader>
        <CardTitle>Audit Log</CardTitle>
        <CardDescription>Who changed what, and when. Passwords and keys are never recorded.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <form
            className="relative"
            onSubmit={e => { e.preventDefault(); setOffset(0); setAppliedQuery(query.trim()); }}
          >
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8E9299]" />
            <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="User, action or record ID" className="pl-9 bg-[#F5F5F5] border-none rounded-xl w-64" />
          </form>
          <Select value={entity} onValueChange={v => { setOffset(0); setEntity(v); }}>
            <SelectTrigger className="w-44 bg-[#F5F5F5] border-none rounded-xl"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All record types</SelectItem>
              {entities.map(e => <SelectItem key={e} value={e}>{humanize(e)}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2 text-sm">
            <Input type="date" value={from} onChange={e => { setOffset(0); setFrom(e.target.value); }} className="bg-[#F5F5F5] border-none rounded-xl w-40" aria-label="From date" />
            <span className="text-[#8E9299]">to</span>
            <Input type="date" value={to} onChange={e => { setOffset(0); setTo(e.target.value); }} className="bg-[#F5F5F5] border-none rounded-xl w-40" aria-label="To date" />
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>
        ) : items.length === 0 ? (
          <p className="text-center text-sm text-[#8E9299] py-10">No audit entries match.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-[#8E9299] border-b border-[#E4E3E0]">
                  <th className="py-2 pr-2 w-6" />
                  <th className="py-2 pr-4">When</th>
                  <th className="py-2 pr-4">Who</th>
                  <th className="py-2 pr-4">Action</th>
                  <th className="py-2">Record</th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => {
                  const open = expanded.has(item.id);
                  return (
                    <Fragment key={item.id}>
                      <tr className="border-b border-[#F5F5F5] hover:bg-[#F5F5F5]/60 cursor-pointer" onClick={() => toggle(item.id)}>
                        <td className="py-2 pr-2 text-[#8E9299]">{open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</td>
                        <td className="py-2 pr-4 whitespace-nowrap">{format(new Date(item.created_at), 'd MMM yyyy, HH:mm')}</td>
                        <td className="py-2 pr-4">{item.user_email || <span className="text-[#8E9299]">System / signed-out user</span>}{item.user_role && <span className="text-xs text-[#8E9299]"> · {item.user_role}</span>}</td>
                        <td className="py-2 pr-4 font-medium">{humanize(item.action)}</td>
                        <td className="py-2">{humanize(item.entity)}{item.entity_id ? <span className="font-mono text-xs text-[#5f6368]"> #{item.entity_id}</span> : null}</td>
                      </tr>
                      {open && (
                        <tr className="bg-[#FAFAFA]">
                          <td />
                          <td colSpan={4} className="py-3 pr-4">
                            <ChangeDetail before={item.before} after={item.after} />
                            {item.ip && <p className="text-[10px] text-[#8E9299] mt-2">IP {item.ip}</p>}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between text-sm text-[#8E9299]">
          <span>{total ? `${offset + 1}–${Math.min(offset + PAGE_SIZE, total)} of ${total}` : ''}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="rounded-xl" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(offset - PAGE_SIZE, 0))}>Previous</Button>
            <Button variant="outline" size="sm" className="rounded-xl" disabled={offset + PAGE_SIZE >= total || loading} onClick={() => setOffset(offset + PAGE_SIZE)}>Next</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
