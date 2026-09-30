import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Badge } from '../../ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/table';
import { toast } from 'sonner';
import { hrApi } from '../../../lib/api';
import { downloadWorkbook, errorMessage, money, readSpreadsheet } from './utils';

const COLUMNS: { header: string; field: string; example: string; aliases?: string[] }[] = [
  { header: 'Full Name', field: 'name', example: 'Ama Mensah', aliases: ['name', 'employee name'] },
  { header: 'Role', field: 'role', example: 'Site Engineer', aliases: ['position', 'job title'] },
  { header: 'Department', field: 'department', example: 'ENGINEERING' },
  { header: 'Commencement Date', field: 'joinDate', example: '2026-01-15', aliases: ['join date', 'start date', 'joindate'] },
  { header: 'Wage Type', field: 'wage_type', example: 'Salaried' },
  { header: 'Salary or Rate', field: 'salary', example: '4500', aliases: ['salary', 'rate', 'basic salary', 'salary or hourly rate', 'daily rate'] },
  { header: 'Employment Type', field: 'employment_type', example: 'Permanent' },
  { header: 'Contract End Date', field: 'contract_end_date', example: '' },
  { header: 'Probation End Date', field: 'probation_end_date', example: '2026-04-15' },
  { header: 'Date of Birth', field: 'date_of_birth', example: '1992-06-30', aliases: ['dob'] },
  { header: 'SSNIT Number', field: 'ssnit', example: 'C018012345678', aliases: ['ssnit'] },
  { header: 'Ghana Card', field: 'ghana_card', example: 'GHA-123456789-0', aliases: ['ghana card id', 'ghana card pin'] },
  { header: 'Phone', field: 'phone', example: '+233241234567' },
  { header: 'Address', field: 'address', example: 'Accra' },
  { header: 'Bank Name', field: 'bank_name', example: 'GCB Bank', aliases: ['bank'] },
  { header: 'Account Name', field: 'account_name', example: 'Ama Mensah' },
  { header: 'Account Number', field: 'account_number', example: '1441000123456' },
  { header: 'Branch', field: 'branch', example: 'Accra Central' },
  { header: 'Annual Leave Days', field: 'annual_leave_days', example: '' },
];

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const HEADER_TO_FIELD = new Map<string, string>();
for (const c of COLUMNS) {
  for (const h of [c.header, c.field, ...(c.aliases || [])]) HEADER_TO_FIELD.set(key(h), c.field);
}

interface RowResult { row: number; data: Record<string, any>; errors: string[]; warnings: string[] }

interface BulkImportProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

export default function BulkImport({ open, onOpenChange, onImported }: BulkImportProps) {
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [results, setResults] = useState<RowResult[]>([]);
  const [unknownColumns, setUnknownColumns] = useState<string[]>([]);
  const [isChecking, setIsChecking] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const reset = () => {
    setFileName('');
    setRows([]);
    setResults([]);
    setUnknownColumns([]);
  };

  const downloadTemplate = () => {
    downloadWorkbook('Employee_Import_Template.xlsx', [
      { name: 'Employees', rows: [COLUMNS.map(c => c.header), COLUMNS.map(c => c.example)] },
      {
        name: 'Notes',
        rows: [
          ['Column', 'Notes'],
          ['Full Name, Role, Department, Commencement Date', 'Required'],
          ['Dates', 'YYYY-MM-DD'],
          ['Wage Type', 'Salaried (monthly basic salary), Hourly (rate per hour) or Daily (casual worker, rate per day). Blank = Daily for Casual staff, otherwise Salaried'],
          ['Employment Type', 'Permanent, Contract, Casual, Intern or National Service'],
          ['Contract End Date', 'Required for Contract, Intern and National Service'],
          ['SSNIT Number', 'Letter + 12 digits (C018012345678) or Ghana Card PIN (GHA-123456789-0)'],
          ['Annual Leave Days', 'Leave blank to use the company default'],
          ['Staff ID', 'Assigned automatically; do not include'],
        ],
      },
    ]);
  };

  const validate = async (mapped: Record<string, any>[]) => {
    setIsChecking(true);
    try {
      const res = await hrApi.bulkImportEmployees(mapped, true);
      setResults(res.data.results || []);
    } catch (error) {
      toast.error(errorMessage(error, 'Could not validate the file'));
      setResults([]);
    } finally {
      setIsChecking(false);
    }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    reset();
    try {
      const raw = await readSpreadsheet(file);
      const unknown = new Set<string>();
      const mapped = raw
        .map(r => {
          const out: Record<string, any> = {};
          for (const [header, value] of Object.entries(r)) {
            const field = HEADER_TO_FIELD.get(key(header));
            if (!field) {
              if (String(value).trim()) unknown.add(header);
              continue;
            }
            const text = String(value ?? '').trim();
            if (text) out[field] = text;
          }
          return out;
        })
        .filter(r => Object.keys(r).length > 0);
      if (mapped.length === 0) {
        toast.error('No employee rows found. Use the template headers in the first row.');
        return;
      }
      setFileName(file.name);
      setRows(mapped);
      setUnknownColumns(Array.from(unknown));
      await validate(mapped);
    } catch (error) {
      toast.error(errorMessage(error, 'Could not read the file'));
    }
  };

  const invalidCount = results.filter(r => r.errors.length).length;
  const canImport = results.length > 0 && invalidCount === 0 && !isChecking;

  const handleImport = async () => {
    setIsImporting(true);
    try {
      const res = await hrApi.bulkImportEmployees(rows, false);
      toast.success(res.data.message || 'Employees imported');
      reset();
      onOpenChange(false);
      onImported();
    } catch (error: any) {
      if (error?.response?.data?.results) setResults(error.response.data.results);
      toast.error(errorMessage(error, 'Import failed'));
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk Employee Import</DialogTitle>
          <DialogDescription>Upload an Excel or CSV file. Every row is checked before anything is saved, and the whole file imports in one go.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" onClick={downloadTemplate} className="rounded-xl gap-2">
              <Download className="w-4 h-4" /> Download template
            </Button>
            <label className="inline-flex items-center gap-2 px-4 h-9 rounded-xl bg-[#141414] text-white text-sm font-medium cursor-pointer">
              <Upload className="w-4 h-4" /> Choose file
              <Input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} className="hidden" />
            </label>
            {fileName && (
              <span className="text-sm text-[#8E9299] flex items-center gap-1"><FileSpreadsheet className="w-4 h-4" /> {fileName} · {rows.length} row(s)</span>
            )}
            {isChecking && <Loader2 className="w-4 h-4 animate-spin" />}
          </div>

          {unknownColumns.length > 0 && (
            <p className="text-xs text-amber-700">Ignored columns: {unknownColumns.join(', ')}</p>
          )}

          {results.length > 0 && (
            <>
              <div className={`p-3 rounded-xl text-sm flex items-center gap-2 ${invalidCount ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                {invalidCount ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                {invalidCount
                  ? `${invalidCount} of ${results.length} row(s) need fixing. Correct the file and upload it again.`
                  : `All ${results.length} row(s) are valid and ready to import.`}
              </div>
              <div className="border rounded-xl overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-[#F5F5F5]/50">
                      <TableHead>Row</TableHead><TableHead>Name</TableHead><TableHead>Department</TableHead>
                      <TableHead>Wage</TableHead><TableHead>SSNIT</TableHead><TableHead>Check</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map(r => (
                      <TableRow key={r.row} className={r.errors.length ? 'bg-red-50/50' : ''}>
                        <TableCell className="font-mono text-xs">{r.row}</TableCell>
                        <TableCell className="font-medium">{r.data.name || '—'}</TableCell>
                        <TableCell>{r.data.department || '—'}</TableCell>
                        <TableCell className="text-xs">{r.data.wage_type} · {money(r.data.salary)}</TableCell>
                        <TableCell className="font-mono text-xs">{r.data.ssnit || '—'}</TableCell>
                        <TableCell className="text-xs space-y-1">
                          {r.errors.map(e => <div key={e} className="text-red-700">{e}</div>)}
                          {r.warnings.map(w => <div key={w} className="text-amber-700">{w}</div>)}
                          {!r.errors.length && !r.warnings.length && <Badge className="bg-green-100 text-green-700 border-none">OK</Badge>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button onClick={handleImport} disabled={!canImport || isImporting} className="bg-[#141414] text-white rounded-xl gap-2">
            {isImporting && <Loader2 className="w-4 h-4 animate-spin" />}
            Import {results.length ? `${results.length} employee(s)` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
