import React, { useRef, useState } from 'react';
import { Download, Loader2, Paperclip, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../ui/dialog';
import { accountingApi, AttachmentEntity } from '../../../lib/api';
import { formatDate } from '../../../lib/dates';
import { errorText } from './print';

const MAX_BYTES = 5 * 1024 * 1024;

interface Attachment {
  id: number;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by?: string | null;
  created_at: string;
}

const formatSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export default function AttachmentsButton({ entityType, entityId, label }: { entityType: AttachmentEntity; entityId: string | number; label: string }) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await accountingApi.getAttachments(entityType, entityId);
      setFiles(res.data);
    } catch (error: any) {
      toast.error(errorText(error, 'Failed to load attachments'));
    } finally {
      setLoading(false);
    }
  };

  const openDialog = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(true);
    load();
  };

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_BYTES) {
      toast.error('Files must be 5 MB or smaller');
      return;
    }
    setUploading(true);
    try {
      await accountingApi.uploadAttachment(entityType, entityId, file);
      toast.success(`${file.name} attached`);
      load();
    } catch (error: any) {
      toast.error(errorText(error, 'Upload failed'));
    } finally {
      setUploading(false);
    }
  };

  const download = async (file: Attachment) => {
    try {
      const res = await accountingApi.downloadAttachment(file.id);
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.file_name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error: any) {
      toast.error(errorText(error, 'Download failed'));
    }
  };

  const remove = async (file: Attachment) => {
    if (!window.confirm(`Delete ${file.file_name}?`)) return;
    try {
      await accountingApi.deleteAttachment(file.id);
      setFiles(files.filter(f => f.id !== file.id));
    } catch (error: any) {
      toast.error(errorText(error, 'Delete failed'));
    }
  };

  return (
    <>
      <Button variant="ghost" size="icon" className="h-8 w-8 text-[#8E9299] hover:text-[#141414]" title="Attachments" onClick={openDialog}>
        <Paperclip className="w-4 h-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-2xl" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Attachments: {label}</DialogTitle>
            <DialogDescription>Receipts, supplier invoices and supporting documents (up to 5 MB each).</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2 max-h-[50vh] overflow-y-auto">
            {loading && <p className="text-sm text-[#8E9299] flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>}
            {!loading && files.length === 0 && <p className="text-sm text-[#8E9299]">No files attached yet.</p>}
            {files.map(file => (
              <div key={file.id} className="flex items-center gap-3 p-3 rounded-xl bg-[#F5F5F5]">
                <Paperclip className="w-4 h-4 text-[#8E9299] shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate">{file.file_name}</p>
                  <p className="text-[10px] text-[#8E9299]">{formatSize(file.size_bytes)} · {formatDate(file.created_at)}{file.uploaded_by ? ` · ${file.uploaded_by}` : ''}</p>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8" title="Download" onClick={() => download(file)}><Download className="w-4 h-4" /></Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" title="Delete" onClick={() => remove(file)}><Trash2 className="w-4 h-4" /></Button>
              </div>
            ))}
          </div>
          <input ref={inputRef} type="file" className="hidden" onChange={upload} />
          <Button className="w-full bg-[#141414] text-white font-bold gap-2" disabled={uploading} onClick={() => inputRef.current?.click()}>
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Attach a file
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
