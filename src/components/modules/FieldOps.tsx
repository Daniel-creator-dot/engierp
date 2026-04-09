import React, { useState, useEffect } from 'react';
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
  History
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
import { fieldOpsApi, projectsApi } from '../../lib/api';

export default function FieldOps() {
  const [reports, setReports] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isSubmitLoading, setIsSubmitLoading] = useState(false);
  const [viewAll, setViewAll] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [reportsRes, tasksRes, projectsRes] = await Promise.all([
        fieldOpsApi.getReports(),
        fieldOpsApi.getTasks(),
        projectsApi.getProjects()
      ]);
      setReports(reportsRes.data);
      setTasks(tasksRes.data);
      setProjects(projectsRes.data);
    } catch (error) {
      toast.error('Failed to load field operations data');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitLoading(true);
    const formData = new FormData(e.target as HTMLFormElement);
    
    const data = {
      project_id: formData.get('project_id'),
      weather: formData.get('weather'),
      content: formData.get('content'),
      issues: formData.get('issues'),
      gps_lat: "5.6035° N", // Simulated GPS for browser environment
      gps_lng: "0.1870° W",
      photos: [] 
    };

    try {
      await fieldOpsApi.submitReport(data);
      toast.success('Site report submitted!');
      setIsReportModalOpen(false);
      fetchData();
    } catch (error) {
      toast.error('Failed to submit site report');
    } finally {
      setIsSubmitLoading(false);
    }
  };

  const handleUpdateTaskStatus = async (taskId: string, status: string) => {
    try {
      await fieldOpsApi.updateTask(taskId, status);
      toast.success('Task updated');
      fetchData();
    } catch (error) {
      toast.error('Failed to update task');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (viewAll) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Button variant="ghost" className="gap-2" onClick={() => setViewAll(false)}>
            <History className="w-4 h-4" /> Back to Overview
          </Button>
          <h1 className="text-2xl font-bold">Site Report Archives</h1>
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
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs">{new Date(r.created_at).toLocaleString()}</TableCell>
                    <TableCell className="font-bold">{r.project_name}</TableCell>
                    <TableCell>{r.author_email}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="gap-1"><CloudSun className="w-3 h-3" />{r.weather}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={r.status === 'Approved' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}>
                        {r.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[#141414]">Field Operations</h1>
          <p className="text-[#8E9299]">Live project telemetry, labor logs, and GPS reporting.</p>
        </div>
        <div className="flex items-center gap-3">
          <Dialog open={isReportModalOpen} onOpenChange={setIsReportModalOpen}>
            <DialogTrigger asChild>
              <Button className="bg-blue-600 text-white gap-2 h-11 px-6 rounded-xl shadow-lg shadow-blue-500/20">
                <Plus className="w-4 h-4" />
                Submit Site Report
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl bg-white border-none shadow-2xl rounded-2xl p-0 overflow-hidden">
              <form onSubmit={handleSubmitReport}>
                <DialogHeader className="p-8 bg-blue-50/50">
                  <DialogTitle className="text-2xl font-bold">Daily Site Log</DialogTitle>
                  <DialogDescription>
                    Record operational progress and capture field conditions.
                  </DialogDescription>
                </DialogHeader>
                <div className="p-8 space-y-6">
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label className="font-bold text-xs uppercase text-[#8E9299]">Target Project</Label>
                      <Select name="project_id" required>
                        <SelectTrigger className="h-11 bg-[#F5F5F5] border-none rounded-xl">
                          <SelectValue placeholder="Select site..." />
                        </SelectTrigger>
                        <SelectContent className="border-none shadow-2xl rounded-xl">
                          {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className="font-bold text-xs uppercase text-[#8E9299]">Current Weather</Label>
                      <Select name="weather" required defaultValue="Sunny">
                        <SelectTrigger className="h-11 bg-[#F5F5F5] border-none rounded-xl">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="border-none shadow-2xl rounded-xl">
                          <SelectItem value="Sunny">Sunny / Clear</SelectItem>
                          <SelectItem value="Rainy">Rainy / Stormy</SelectItem>
                          <SelectItem value="Cloudy">Overcast</SelectItem>
                          <SelectItem value="Extreme Heat">Warning: Extreme Heat</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold text-xs uppercase text-[#8E9299]">Progress Details</Label>
                    <Textarea name="content" required placeholder="Milestones achieved today..." className="min-h-[120px] bg-[#F5F5F5] border-none rounded-xl resize-none" />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold text-xs uppercase text-[#8E9299]">Blockers & Safety Issues</Label>
                    <Textarea name="issues" placeholder="Any delays or hazards encountered?" className="min-h-[80px] bg-[#F5F5F5] border-none rounded-xl resize-none" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex items-center gap-2 p-4 bg-[#F5F5F5] rounded-xl border-2 border-dashed border-[#E4E3E0] cursor-pointer hover:bg-white hover:border-blue-300 transition-all duration-300">
                      <Camera className="w-5 h-5 text-blue-600" />
                      <span className="text-sm font-bold text-[#8E9299]">Attach Photos</span>
                    </div>
                    <div className="flex items-center gap-3 p-4 bg-green-50 rounded-xl border border-green-100">
                      <MapPin className="w-5 h-5 text-green-600 animate-pulse" />
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-green-700 uppercase">GPS ACTIVE</span>
                        <span className="text-xs font-mono text-green-800">5.60° N, 0.18° W</span>
                      </div>
                    </div>
                  </div>
                </div>
                <DialogFooter className="p-8 bg-[#F5F5F5]/50 border-t border-[#F5F5F5]">
                  <Button type="button" variant="ghost" className="h-12 px-6 rounded-xl" onClick={() => setIsReportModalOpen(false)}>Cancel</Button>
                  <Button type="submit" className="bg-blue-600 text-white h-12 px-10 rounded-xl font-bold shadow-lg shadow-blue-500/20" disabled={isSubmitLoading}>
                    {isSubmitLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Broadcast to Dashboard'}
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
                <CardTitle className="text-xl font-bold">Live Site Tasks</CardTitle>
                <CardDescription>Mission critical tasks in progress.</CardDescription>
              </div>
              <Badge className="bg-blue-600 text-white border-none px-3 py-1">{tasks.length} Active</Badge>
            </div>
          </CardHeader>
          <CardContent className="p-6">
            <div className="space-y-4">
              {tasks.length > 0 ? tasks.map((item, i) => (
                <div key={i} className="flex items-center justify-between p-5 bg-[#F5F5F5]/50 border border-[#F5F5F5]/50 rounded-2xl group hover:bg-white hover:shadow-md transition-all duration-300">
                  <div className="flex items-center gap-4">
                    <div className={`p-3 bg-white rounded-xl shadow-sm text-blue-600`}>
                      <Clock className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="font-bold text-[#141414]">{item.name}</p>
                      <p className="text-xs text-[#8E9299] font-medium tracking-wide">{item.project_name}</p>
                    </div>
                  </div>
                  <Select 
                    defaultValue={item.status} 
                    onValueChange={(val) => handleUpdateTaskStatus(item.id, val)}
                  >
                    <SelectTrigger className="w-32 h-9 border-none bg-white text-xs font-bold rounded-lg shadow-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-none shadow-2xl rounded-xl">
                      <SelectItem value="Open">Open</SelectItem>
                      <SelectItem value="In Progress">In Progress</SelectItem>
                      <SelectItem value="Completed">Completed</SelectItem>
                      <SelectItem value="Delayed">Delayed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )) : (
                <div className="text-center py-12 text-[#8E9299]">No active site tasks assigned.</div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm rounded-2xl overflow-hidden">
          <CardHeader className="bg-[#F5F5F5]/50 border-b border-[#F5F5F5]">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-xl font-bold">Recent Field Signals</CardTitle>
                <CardDescription>Telemetry from site engineers.</CardDescription>
              </div>
              <Button variant="ghost" size="sm" className="text-blue-600 font-bold" onClick={() => setViewAll(true)}>
                HISTORY
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-6">
            <div className="space-y-6">
              {reports.slice(0, 5).map((report, i) => (
                <div key={i} className="flex items-start justify-between pb-6 border-b border-[#F5F5F5] last:border-0 last:pb-0 group">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-colors duration-300">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-[#141414] line-clamp-1">{report.project_name} - Operation Log</p>
                      <p className="text-xs text-[#8E9299] mt-1">{new Date(report.created_at).toLocaleDateString()} • {report.author_email}</p>
                      <p className="text-xs text-[#141414]/70 mt-3 line-clamp-2 italic">“{report.content}”</p>
                    </div>
                  </div>
                  <Badge className={report.status === 'Approved' ? 'bg-green-100 text-green-700 border-none' : 'bg-blue-50 text-blue-600 border-none'}>
                    {report.status}
                  </Badge>
                </div>
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
                View Full Documentation
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
