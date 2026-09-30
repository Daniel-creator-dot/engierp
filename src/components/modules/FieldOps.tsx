import React, { useState, useEffect, useRef } from 'react';
import {
  Plus,
  MapPin,
  Camera,
  CheckCircle2,
  Clock,
  AlertTriangle,
  FileText,
  Loader2,
  CloudSun,
  History,
  X,
  Trash2,
  ListTodo,
  XCircle,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription
} from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '../ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '../ui/dialog';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../ui/select';
import { Badge } from '../ui/badge';
import { toast } from 'sonner';
import { fieldOpsApi, projectsApi, apiErrorMessage } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { daysUntil, formatDate } from '../../lib/dates';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_PHOTOS = 10;
const TASK_STATUSES = ['Open', 'In Progress', 'Completed', 'Delayed'];

type GeoState =
  | { status: 'idle' | 'locating' | 'unsupported' }
  | { status: 'denied' | 'error'; message: string }
  | { status: 'ok'; lat: number; lng: number; accuracy: number };

/** Large phone photos are scaled down to keep uploads under the size limit and quick on site data. */
async function prepareImage(file: File): Promise<Blob> {
  if (file.type === 'image/gif' || file.size <= 1.5 * 1024 * 1024) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file; // e.g. HEIC in browsers that can't decode it; the server still accepts it
  }
}

const formatCoords = (lat: number | string, lng: number | string) => {
  const la = Number(lat);
  const ln = Number(lng);
  return `${Math.abs(la).toFixed(5)}° ${la >= 0 ? 'N' : 'S'}, ${Math.abs(ln).toFixed(5)}° ${ln >= 0 ? 'E' : 'W'}`;
};

const hasCoords = (r: any) => r?.gps_lat != null && r?.gps_lng != null && r.gps_lat !== '' && !isNaN(Number(r.gps_lat)) && !isNaN(Number(r.gps_lng));

const reportBadgeClass = (status: string) =>
  status === 'Approved' ? 'bg-green-100 text-green-700 border-none' :
  status === 'Rejected' ? 'bg-red-100 text-red-700 border-none' :
  'bg-yellow-100 text-yellow-700 border-none';

function ReportPhotos({ reportId }: { reportId: number }) {
  const [photos, setPhotos] = useState<{ id: number; url: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    (async () => {
      try {
        const list = await fieldOpsApi.getReportPhotos(reportId);
        const loaded = await Promise.all(list.data.map(async (p: any) => {
          const blob = await fieldOpsApi.getPhotoBlob(p.id);
          const url = URL.createObjectURL(blob.data);
          urls.push(url);
          return { id: p.id, url, name: p.file_name || `Photo ${p.id}` };
        }));
        if (!cancelled) setPhotos(loaded);
      } catch (error) {
        if (!cancelled) toast.error(apiErrorMessage(error, 'Failed to load photos'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      urls.forEach(u => URL.revokeObjectURL(u));
    };
  }, [reportId]);

  if (loading) return <div className="flex items-center gap-2 text-sm text-[#8E9299]"><Loader2 className="w-4 h-4 animate-spin" /> Loading photos…</div>;
  if (photos.length === 0) return <p className="text-sm text-[#8E9299]">No photos attached.</p>;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {photos.map(p => (
        <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="block rounded-xl overflow-hidden border border-[#F5F5F5] hover:opacity-90">
          <img src={p.url} alt={p.name} className="w-full h-32 object-cover" />
        </a>
      ))}
    </div>
  );
}

export default function FieldOps() {
  const { user } = useAuth();
  const [reports, setReports] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [isSubmitLoading, setIsSubmitLoading] = useState(false);
  const [viewAll, setViewAll] = useState(false);
  const [selectedReport, setSelectedReport] = useState<any | null>(null);
  const [geo, setGeo] = useState<GeoState>({ status: 'idle' });
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [showCompleted, setShowCompleted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    const loaders: [string, () => Promise<any>, (data: any) => void][] = [
      ['site reports', fieldOpsApi.getReports, setReports],
      ['tasks', fieldOpsApi.getTasks, setTasks],
      ['projects', projectsApi.getProjects, setProjects],
    ];
    const results = await Promise.allSettled(loaders.map(([, load]) => load()));
    const failures: string[] = [];
    results.forEach((result, i) => {
      const [label, , apply] = loaders[i];
      if (result.status === 'fulfilled') apply(result.value.data);
      else failures.push(`${label}: ${apiErrorMessage(result.reason, 'request failed')}`);
    });
    if (failures.length) toast.error(`Some field operations data could not be loaded (${failures.join('; ')})`);
    setIsLoading(false);
  };

  const captureLocation = () => {
    if (!('geolocation' in navigator)) {
      setGeo({ status: 'unsupported' });
      return;
    }
    setGeo({ status: 'locating' });
    navigator.geolocation.getCurrentPosition(
      pos => setGeo({ status: 'ok', lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      err => setGeo(err.code === err.PERMISSION_DENIED
        ? { status: 'denied', message: 'Location permission was denied. The report can still be submitted without it.' }
        : { status: 'error', message: err.code === err.TIMEOUT ? 'Timed out getting a location fix.' : 'Location is unavailable on this device.' }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  };

  const openReportModal = (open: boolean) => {
    setIsReportModalOpen(open);
    if (open) {
      setPhotoFiles([]);
      captureLocation();
    }
  };

  const handlePickPhotos = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []) as File[];
    e.target.value = '';
    const images = picked.filter(f => f.type.startsWith('image/'));
    if (images.length < picked.length) toast.error('Only image files can be attached');
    setPhotoFiles(prev => {
      const next = [...prev, ...images];
      if (next.length > MAX_PHOTOS) toast.error(`You can attach up to ${MAX_PHOTOS} photos`);
      return next.slice(0, MAX_PHOTOS);
    });
  };

  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    if (!formData.get('project_id')) {
      toast.error('Select the project this report is for');
      return;
    }
    setIsSubmitLoading(true);

    const data = {
      project_id: formData.get('project_id'),
      weather: formData.get('weather'),
      content: formData.get('content'),
      issues: formData.get('issues'),
      gps_lat: geo.status === 'ok' ? geo.lat : null,
      gps_lng: geo.status === 'ok' ? geo.lng : null,
      gps_accuracy: geo.status === 'ok' ? Math.round(geo.accuracy) : null,
    };

    try {
      const res = await fieldOpsApi.submitReport(data);
      const reportId = res.data.id;
      let failed = 0;
      for (const file of photoFiles) {
        try {
          const blob = await prepareImage(file);
          if (blob.size > MAX_PHOTO_BYTES) {
            failed++;
            toast.error(`${file.name} is larger than 5 MB and was skipped`);
            continue;
          }
          await fieldOpsApi.uploadReportPhoto(reportId, blob, file.name);
        } catch (error) {
          failed++;
          toast.error(apiErrorMessage(error, `Failed to upload ${file.name}`));
        }
      }
      if (failed) toast.warning(`Report submitted, but ${failed} photo${failed === 1 ? '' : 's'} did not upload`);
      else toast.success('Site report submitted');
      setIsReportModalOpen(false);
      setPhotoFiles([]);
      fetchData();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to submit site report'));
    } finally {
      setIsSubmitLoading(false);
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    const project_id = String(formData.get('project_id') || '');
    if (!project_id) {
      toast.error('Select a project for the task');
      return;
    }
    try {
      await fieldOpsApi.createTask({
        project_id,
        name: String(formData.get('name') || ''),
        description: String(formData.get('description') || '') || undefined,
        assigned_to: String(formData.get('assigned_to') || '') || undefined,
        due_date: String(formData.get('due_date') || '') || undefined,
      });
      toast.success('Task created');
      setIsTaskModalOpen(false);
      fetchData();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to create task'));
    }
  };

  const handleUpdateTaskStatus = async (taskId: string, status: string) => {
    try {
      await fieldOpsApi.updateTask(taskId, status);
      toast.success('Task updated');
      fetchData();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to update task'));
    }
  };

  const handleDeleteTask = async (task: any) => {
    if (!window.confirm(`Delete the task "${task.name}"?`)) return;
    try {
      await fieldOpsApi.deleteTask(task.id);
      toast.success('Task deleted');
      fetchData();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to delete task'));
    }
  };

  const handleReview = async (status: 'Approved' | 'Rejected') => {
    if (!selectedReport) return;
    try {
      await fieldOpsApi.reviewReport(selectedReport.id, status);
      toast.success(`Report ${status.toLowerCase()}`);
      setSelectedReport(null);
      fetchData();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to update report'));
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  const openTasks = tasks.filter(t => t.status !== 'Completed');
  const visibleTasks = showCompleted ? tasks : openTasks;
  const canReview = selectedReport && selectedReport.status === 'Pending Review' &&
    (user?.role === 'admin' || (user?.role === 'pm' && selectedReport.author_id !== user?.id));

  const reportDetailDialog = (
    <Dialog open={!!selectedReport} onOpenChange={(open) => !open && setSelectedReport(null)}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl">
        {selectedReport && (
          <>
            <DialogHeader>
              <DialogTitle>{selectedReport.project_name} — Site Report</DialogTitle>
              <DialogDescription>
                {new Date(selectedReport.created_at).toLocaleString()} · {selectedReport.author_email || 'Unknown author'}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-5 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={reportBadgeClass(selectedReport.status)}>{selectedReport.status}</Badge>
                <Badge variant="outline" className="gap-1"><CloudSun className="w-3 h-3" />{selectedReport.weather}</Badge>
                {hasCoords(selectedReport) ? (
                  <a
                    href={`https://www.google.com/maps?q=${Number(selectedReport.gps_lat)},${Number(selectedReport.gps_lng)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:underline"
                  >
                    <MapPin className="w-3 h-3" />
                    {formatCoords(selectedReport.gps_lat, selectedReport.gps_lng)}
                    {selectedReport.gps_accuracy ? ` (±${Math.round(selectedReport.gps_accuracy)} m)` : ''}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                ) : (
                  <span className="text-xs text-[#8E9299]">No location recorded</span>
                )}
              </div>
              <div>
                <Label className="text-xs uppercase text-[#8E9299]">Progress</Label>
                <p className="mt-1 whitespace-pre-wrap text-sm">{selectedReport.content}</p>
              </div>
              {selectedReport.issues && (
                <div>
                  <Label className="text-xs uppercase text-[#8E9299]">Blockers & safety issues</Label>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-orange-700">{selectedReport.issues}</p>
                </div>
              )}
              <div>
                <Label className="text-xs uppercase text-[#8E9299]">Photos</Label>
                <div className="mt-2"><ReportPhotos reportId={selectedReport.id} /></div>
              </div>
            </div>
            {canReview && (
              <DialogFooter>
                <Button variant="outline" className="gap-1 text-red-600 border-red-200" onClick={() => handleReview('Rejected')}><XCircle className="w-4 h-4" /> Reject</Button>
                <Button className="gap-1 bg-green-600 text-white" onClick={() => handleReview('Approved')}><CheckCircle2 className="w-4 h-4" /> Approve</Button>
              </DialogFooter>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );

  if (viewAll) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Button variant="ghost" className="gap-2" onClick={() => setViewAll(false)}>
            <History className="w-4 h-4" /> Back to Overview
          </Button>
          <h1 className="text-2xl font-bold">Site Report Archive</h1>
        </div>
        <Card className="border-none shadow-sm">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Author</TableHead>
                  <TableHead>Weather</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Photos</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer hover:bg-blue-50/30" onClick={() => setSelectedReport(r)}>
                    <TableCell className="text-xs">{new Date(r.created_at).toLocaleString()}</TableCell>
                    <TableCell className="font-bold">{r.project_name}</TableCell>
                    <TableCell>{r.author_email}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="gap-1"><CloudSun className="w-3 h-3" />{r.weather}</Badge>
                    </TableCell>
                    <TableCell className="text-xs font-mono">{hasCoords(r) ? formatCoords(r.gps_lat, r.gps_lng) : '—'}</TableCell>
                    <TableCell>{r.photo_count || 0}</TableCell>
                    <TableCell>
                      <Badge className={reportBadgeClass(r.status)}>{r.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {reports.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-12 text-[#8E9299]">No site reports submitted yet.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        {reportDetailDialog}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[#141414]">Field Operations</h1>
          <p className="text-[#8E9299]">Daily site reports with location and photos, and site task tracking.</p>
        </div>
        <div className="flex items-center gap-3">
          <Dialog open={isTaskModalOpen} onOpenChange={setIsTaskModalOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2 h-11 px-5 rounded-xl border-[#141414]">
                <ListTodo className="w-4 h-4" />
                New Task
              </Button>
            </DialogTrigger>
            <DialogContent className="rounded-2xl">
              <form onSubmit={handleCreateTask}>
                <DialogHeader>
                  <DialogTitle>New Site Task</DialogTitle>
                  <DialogDescription>Assign a piece of work on a project site.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label>Project</Label>
                    <Select name="project_id" required>
                      <SelectTrigger className="bg-[#F5F5F5] border-none"><SelectValue placeholder="Select project..." /></SelectTrigger>
                      <SelectContent>
                        {projects.filter(p => p.status !== 'Completed').map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2"><Label>Task</Label><Input name="name" required maxLength={200} placeholder="e.g. Pour slab for block B" className="bg-[#F5F5F5] border-none" /></div>
                  <div className="grid gap-2"><Label>Details (optional)</Label><Textarea name="description" className="bg-[#F5F5F5] border-none resize-none min-h-[80px]" /></div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="grid gap-2"><Label>Assigned to</Label><Input name="assigned_to" placeholder="Name or crew" className="bg-[#F5F5F5] border-none" /></div>
                    <div className="grid gap-2"><Label>Due date</Label><Input name="due_date" type="date" className="bg-[#F5F5F5] border-none" /></div>
                  </div>
                </div>
                <DialogFooter><Button type="submit" className="bg-[#141414] text-white w-full rounded-xl font-bold h-11">Create Task</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog open={isReportModalOpen} onOpenChange={openReportModal}>
            <DialogTrigger asChild>
              <Button className="bg-blue-600 text-white gap-2 h-11 px-6 rounded-xl shadow-lg shadow-blue-500/20">
                <Plus className="w-4 h-4" />
                Submit Site Report
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-white border-none shadow-2xl rounded-2xl p-0">
              <form onSubmit={handleSubmitReport}>
                <DialogHeader className="p-8 bg-blue-50/50">
                  <DialogTitle className="text-2xl font-bold">Daily Site Log</DialogTitle>
                  <DialogDescription>
                    Record progress and site conditions. Location and photos are optional.
                  </DialogDescription>
                </DialogHeader>
                <div className="p-8 space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label className="font-bold text-xs uppercase text-[#8E9299]">Project</Label>
                      <Select name="project_id" required>
                        <SelectTrigger className="h-11 bg-[#F5F5F5] border-none rounded-xl">
                          <SelectValue placeholder="Select site..." />
                        </SelectTrigger>
                        <SelectContent className="border-none shadow-2xl rounded-xl">
                          {projects.filter(p => p.status !== 'Completed').map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className="font-bold text-xs uppercase text-[#8E9299]">Weather</Label>
                      <Select name="weather" required defaultValue="Sunny">
                        <SelectTrigger className="h-11 bg-[#F5F5F5] border-none rounded-xl">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="border-none shadow-2xl rounded-xl">
                          <SelectItem value="Sunny">Sunny / Clear</SelectItem>
                          <SelectItem value="Rainy">Rainy / Stormy</SelectItem>
                          <SelectItem value="Cloudy">Overcast</SelectItem>
                          <SelectItem value="Extreme Heat">Extreme Heat</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold text-xs uppercase text-[#8E9299]">Progress Details</Label>
                    <Textarea name="content" required placeholder="Work completed today..." className="min-h-[120px] bg-[#F5F5F5] border-none rounded-xl resize-none" />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold text-xs uppercase text-[#8E9299]">Blockers & Safety Issues</Label>
                    <Textarea name="issues" placeholder="Any delays or hazards encountered?" className="min-h-[80px] bg-[#F5F5F5] border-none rounded-xl resize-none" />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-2 p-4 bg-[#F5F5F5] rounded-xl border-2 border-dashed border-[#E4E3E0] hover:bg-white hover:border-blue-300 transition-all duration-300 text-left"
                    >
                      <Camera className="w-5 h-5 text-blue-600" />
                      <span className="text-sm font-bold text-[#8E9299]">
                        {photoFiles.length ? `${photoFiles.length} photo${photoFiles.length === 1 ? '' : 's'} attached — add more` : 'Attach photos'}
                      </span>
                    </button>
                    <input ref={fileInputRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={handlePickPhotos} />
                    {geo.status === 'ok' ? (
                      <div className="flex items-center gap-3 p-4 bg-green-50 rounded-xl border border-green-100">
                        <MapPin className="w-5 h-5 text-green-600" />
                        <div className="flex flex-col">
                          <span className="text-[10px] font-bold text-green-700 uppercase">Location captured (±{Math.round(geo.accuracy)} m)</span>
                          <span className="text-xs font-mono text-green-800">{formatCoords(geo.lat, geo.lng)}</span>
                        </div>
                      </div>
                    ) : geo.status === 'locating' ? (
                      <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-xl border border-blue-100">
                        <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                        <span className="text-xs font-bold text-blue-700">Getting your location…</span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-3 p-4 bg-[#F5F5F5] rounded-xl border border-[#E4E3E0]">
                        <div className="flex items-center gap-3">
                          <MapPin className="w-5 h-5 text-[#8E9299]" />
                          <span className="text-xs text-[#8E9299]">
                            {geo.status === 'unsupported' ? 'This browser cannot share location.' :
                              geo.status === 'denied' || geo.status === 'error' ? geo.message : 'Location not captured.'}
                          </span>
                        </div>
                        {geo.status !== 'unsupported' && (
                          <Button type="button" variant="ghost" size="icon" onClick={captureLocation} title="Try again"><RefreshCw className="w-4 h-4" /></Button>
                        )}
                      </div>
                    )}
                  </div>
                  {photoFiles.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {photoFiles.map((file, i) => (
                        <span key={`${file.name}-${i}`} className="inline-flex items-center gap-1 rounded-lg bg-[#F5F5F5] px-2 py-1 text-xs">
                          {file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)
                          <button type="button" onClick={() => setPhotoFiles(prev => prev.filter((_, j) => j !== i))} className="text-[#8E9299] hover:text-red-600" aria-label={`Remove ${file.name}`}>
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <DialogFooter className="p-8 bg-[#F5F5F5]/50 border-t border-[#F5F5F5]">
                  <Button type="button" variant="ghost" className="h-12 px-6 rounded-xl" onClick={() => setIsReportModalOpen(false)}>Cancel</Button>
                  <Button type="submit" className="bg-blue-600 text-white h-12 px-10 rounded-xl font-bold shadow-lg shadow-blue-500/20" disabled={isSubmitLoading}>
                    {isSubmitLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Submit Report'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <Card className="border-none shadow-sm rounded-2xl overflow-hidden">
          <CardHeader className="bg-[#F5F5F5]/50 border-b border-[#F5F5F5]">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-xl font-bold">Site Tasks</CardTitle>
                <CardDescription>Open work across project sites.</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" className="text-xs" onClick={() => setShowCompleted(v => !v)}>
                  {showCompleted ? 'Hide completed' : 'Show completed'}
                </Button>
                <Badge className="bg-blue-600 text-white border-none px-3 py-1">{openTasks.length} Open</Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-6">
            <div className="space-y-4">
              {visibleTasks.length > 0 ? visibleTasks.map((item) => {
                const due = daysUntil(item.due_date);
                const overdue = item.status !== 'Completed' && due !== null && due < 0;
                return (
                  <div key={item.id} className="flex items-center justify-between gap-3 p-5 bg-[#F5F5F5]/50 border border-[#F5F5F5]/50 rounded-2xl group hover:bg-white hover:shadow-md transition-all duration-300">
                    <div className="flex items-center gap-4 min-w-0">
                      <div className={`p-3 bg-white rounded-xl shadow-sm ${overdue ? 'text-red-600' : item.status === 'Completed' ? 'text-green-600' : 'text-blue-600'}`}>
                        {overdue ? <AlertTriangle className="w-5 h-5" /> : item.status === 'Completed' ? <CheckCircle2 className="w-5 h-5" /> : <Clock className="w-5 h-5" />}
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-[#141414] truncate" title={item.description || item.name}>{item.name}</p>
                        <p className="text-xs text-[#8E9299] font-medium tracking-wide truncate">
                          {item.project_name}
                          {item.assigned_to ? ` · ${item.assigned_to}` : ''}
                          {item.due_date ? ` · due ${formatDate(item.due_date)}` : ''}
                        </p>
                        {overdue && <p className="text-[10px] font-bold uppercase text-red-600">Overdue</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Select
                        value={item.status}
                        onValueChange={(val) => handleUpdateTaskStatus(item.id, val)}
                      >
                        <SelectTrigger className="w-32 h-9 border-none bg-white text-xs font-bold rounded-lg shadow-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="border-none shadow-2xl rounded-xl">
                          {TASK_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-[#8E9299] hover:text-red-600" onClick={() => handleDeleteTask(item)} title="Delete task">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                );
              }) : (
                <div className="text-center py-12 text-[#8E9299]">
                  {tasks.length ? 'No open tasks.' : 'No site tasks yet. Use "New Task" to add one.'}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm rounded-2xl overflow-hidden">
          <CardHeader className="bg-[#F5F5F5]/50 border-b border-[#F5F5F5]">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-xl font-bold">Recent Site Reports</CardTitle>
                <CardDescription>Latest daily logs from site. Click one to open it.</CardDescription>
              </div>
              <Button variant="ghost" size="sm" className="text-blue-600 font-bold" onClick={() => setViewAll(true)}>
                HISTORY
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-6">
            <div className="space-y-6">
              {reports.slice(0, 5).map((report) => (
                <button
                  type="button"
                  key={report.id}
                  onClick={() => setSelectedReport(report)}
                  className="w-full text-left flex items-start justify-between pb-6 border-b border-[#F5F5F5] last:border-0 last:pb-0 group"
                >
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-colors duration-300">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-[#141414] line-clamp-1">{report.project_name}</p>
                      <p className="text-xs text-[#8E9299] mt-1">
                        {new Date(report.created_at).toLocaleDateString()} • {report.author_email}
                        {report.photo_count ? ` • ${report.photo_count} photo${report.photo_count === 1 ? '' : 's'}` : ''}
                        {hasCoords(report) ? ' • located' : ''}
                      </p>
                      <p className="text-xs text-[#141414]/70 mt-3 line-clamp-2 italic">“{report.content}”</p>
                    </div>
                  </div>
                  <Badge className={reportBadgeClass(report.status)}>
                    {report.status}
                  </Badge>
                </button>
              ))}
              {reports.length === 0 && (
                <div className="text-center py-12 text-[#8E9299]">No site reports submitted yet.</div>
              )}
            </div>
            {reports.length > 5 && (
              <Button
                variant="outline"
                className="w-full mt-8 border-[#F5F5F5] text-[#141414] font-bold h-11 rounded-xl hover:bg-[#F5F5F5]"
                onClick={() => setViewAll(true)}
              >
                View All Reports
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
      {reportDetailDialog}
    </div>
  );
}
