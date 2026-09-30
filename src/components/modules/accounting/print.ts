import { toast } from 'sonner';
import { escapeHtml, safeImageSrc } from '../../../lib/html';

export interface PrintBranding {
  companyName?: string;
  companyAddress?: string;
  companyTin?: string;
  logo?: string;
  signature?: string;
  footerNote?: string;
  printedBy?: string;
}

/** Builds branding from the settings rows returned by /settings. */
export function brandingFrom(settings: { key: string; value: string }[], user?: { email?: string; name?: string }): PrintBranding {
  const get = (key: string) => settings.find((s) => s.key === key)?.value || '';
  return {
    companyName: get('company_name') || 'ENGINEERING ERP',
    companyAddress: get('company_address'),
    companyTin: get('company_tin'),
    logo: get('company_logo'),
    signature: get('company_signature'),
    footerNote: get('company_footer_note'),
    printedBy: user?.name || user?.email || '',
  };
}

/**
 * Opens a print window. `bodyHtml` must already be escaped by the caller (use escapeHtml for every
 * interpolated value); branding values are escaped here.
 */
export function openPrintWindow(title: string, bodyHtml: string, branding: PrintBranding, docNumber?: string) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    toast.error('Print window was blocked. Please allow popups for this site.');
    return;
  }
  const logo = safeImageSrc(branding.logo);
  const signature = safeImageSrc(branding.signature);
  const printedAt = new Date().toLocaleString();
  printWindow.document.write(`
    <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <style>
          body { font-family: 'Inter', Arial, sans-serif; padding: 40px; color: #141414; line-height: 1.5; }
          .header { border-bottom: 2px solid #141414; padding-bottom: 20px; margin-bottom: 32px; }
          .logo-container { text-align: center; margin-bottom: 24px; }
          .logo { max-height: 120px; max-width: 400px; }
          .meta-header { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; }
          .address-block { font-size: 0.8rem; color: #6B7280; white-space: pre-line; }
          .footer { margin-top: 60px; border-top: 1px solid #E4E3E0; padding-top: 20px; }
          .footer-grid { display: flex; justify-content: space-between; gap: 24px; }
          .signature { max-height: 60px; }
          .footer-note { margin-top: 30px; padding: 20px; background: #F5F5F5; border-radius: 12px; font-size: 0.85rem; text-align: center; font-style: italic; color: #4B5563; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
          th, td { border: 1px solid #E4E3E0; padding: 10px; text-align: left; font-size: 0.85rem; }
          th { background: #F5F5F5; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; }
          .num { text-align: right; font-variant-numeric: tabular-nums; }
          .total-row { font-weight: bold; background: #F5F5F5; }
          .muted { color: #6B7280; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="logo-container">
            ${logo ? `<img src="${logo}" class="logo" />` : `<h1>${escapeHtml(branding.companyName)}</h1>`}
          </div>
          <div class="meta-header">
            <div class="address-block">
              <strong>${escapeHtml(branding.companyName)}</strong><br/>
              ${escapeHtml(branding.companyAddress)}
              ${branding.companyTin ? `<br/>TIN: ${escapeHtml(branding.companyTin)}` : ''}
            </div>
            <div style="text-align: right">
              <h2 style="margin: 0">${escapeHtml(title)}</h2>
              ${docNumber ? `<p style="margin: 4px 0 0">No. <strong>${escapeHtml(docNumber)}</strong></p>` : ''}
            </div>
          </div>
        </div>
        ${bodyHtml}
        <div class="footer">
          <div class="footer-grid">
            <div>
              <p>Authorized Signature</p>
              ${signature ? `<img src="${signature}" class="signature" />` : '<div style="height: 60px; width: 200px; border-bottom: 1px solid #000;"></div>'}
            </div>
            <div style="text-align: right; color: #6B7280; font-size: 0.75rem;">
              ${docNumber ? `<p style="margin: 0">Document: ${escapeHtml(docNumber)}</p>` : ''}
              <p style="margin: 0">Printed${branding.printedBy ? ` by ${escapeHtml(branding.printedBy)}` : ''} on ${escapeHtml(printedAt)}</p>
            </div>
          </div>
          ${branding.footerNote ? `<div class="footer-note">${escapeHtml(branding.footerNote)}</div>` : ''}
        </div>
      </body>
    </html>
  `);
  printWindow.document.close();
  setTimeout(() => printWindow.print(), 500);
}

export function downloadCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const cell = (c: unknown) => `"${String(c ?? '').replace(/"/g, '""')}"`;
  const csv = [headers.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${filename}_${new Date().toISOString().split('T')[0]}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  toast.success(`${filename}.csv exported`);
}

export const fmtMoney = (value: unknown) =>
  Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const errorText = (error: any, fallback: string) => error?.response?.data?.message || fallback;
