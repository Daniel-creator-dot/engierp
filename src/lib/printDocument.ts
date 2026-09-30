import { format } from 'date-fns';
import { escapeHtml, safeImageSrc } from './html';

export interface SettingRow {
  key: string;
  value: string | null;
}

export interface PrintDocumentOptions {
  /** Heading shown top-right, e.g. "LOCAL PURCHASE ORDER". */
  title: string;
  /** Real document reference, e.g. the PO number. */
  docNumber: string;
  /** Already-escaped HTML for the document body. */
  bodyHtml: string;
  settings: SettingRow[];
  printedBy?: string;
  /** Show a signature block in the footer. */
  signature?: boolean;
}

const settingValue = (settings: SettingRow[], key: string) =>
  settings.find(s => s.key === key)?.value || '';

/**
 * Opens a branded print window. Every value interpolated here is escaped;
 * callers must escape anything they put into `bodyHtml`.
 */
export function printDocument({ title, docNumber, bodyHtml, settings, printedBy, signature = true }: PrintDocumentOptions) {
  const logo = safeImageSrc(settingValue(settings, 'company_logo'));
  const signatureImg = safeImageSrc(settingValue(settings, 'company_signature'));
  const companyName = settingValue(settings, 'company_name') || 'Company';
  const address = settingValue(settings, 'company_address');
  const phone = settingValue(settings, 'company_phone');
  const email = settingValue(settings, 'company_email');
  const tin = settingValue(settings, 'company_tin');

  const win = window.open('', '_blank');
  if (!win) return false;

  win.document.write(`<!doctype html>
<html>
  <head>
    <title>${escapeHtml(title)} ${escapeHtml(docNumber)}</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: 'Inter', Arial, sans-serif; padding: 36px; color: #141414; line-height: 1.45; font-size: 13px; }
      .header { border-bottom: 2px solid #141414; padding-bottom: 16px; margin-bottom: 28px; display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
      .logo { max-height: 60px; max-width: 200px; }
      .company h1 { margin: 0; font-size: 20px; }
      .muted { color: #6b7280; font-size: 12px; }
      .doc { text-align: right; }
      .doc h2 { margin: 0 0 4px; font-size: 18px; letter-spacing: 0.04em; }
      table { width: 100%; border-collapse: collapse; }
      th { background: #f3f4f6; text-align: left; padding: 8px 10px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
      td { padding: 8px 10px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
      .num { text-align: right; white-space: nowrap; }
      .totals td { border: none; font-weight: 700; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px; }
      .box h4 { margin: 0 0 6px; font-size: 11px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.05em; }
      .footer { margin-top: 56px; border-top: 1px solid #e5e7eb; padding-top: 16px; display: flex; justify-content: space-between; align-items: flex-end; }
      .signature { max-height: 60px; }
      .sigline { height: 50px; width: 220px; border-bottom: 1px solid #000; }
      .neg { color: #b91c1c; }
      @media print { body { padding: 16px; } }
    </style>
  </head>
  <body>
    <div class="header">
      <div class="company">
        ${logo ? `<img src="${logo}" class="logo" alt="" />` : ''}
        <h1>${escapeHtml(companyName)}</h1>
        ${address ? `<div class="muted">${escapeHtml(address)}</div>` : ''}
        ${phone || email ? `<div class="muted">${escapeHtml([phone, email].filter(Boolean).join(' · '))}</div>` : ''}
        ${tin ? `<div class="muted">TIN: ${escapeHtml(tin)}</div>` : ''}
      </div>
      <div class="doc">
        <h2>${escapeHtml(title)}</h2>
        <div><strong>${escapeHtml(docNumber)}</strong></div>
        <div class="muted">Printed ${escapeHtml(format(new Date(), 'd MMM yyyy, HH:mm'))}</div>
      </div>
    </div>
    ${bodyHtml}
    <div class="footer">
      <div>
        ${signature ? `<p class="muted">Authorised signature</p>${signatureImg ? `<img src="${signatureImg}" class="signature" alt="" />` : '<div class="sigline"></div>'}` : ''}
      </div>
      <div class="muted" style="text-align:right">
        <div>Document: ${escapeHtml(docNumber)}</div>
        ${printedBy ? `<div>Printed by: ${escapeHtml(printedBy)}</div>` : ''}
      </div>
    </div>
  </body>
</html>`);
  win.document.close();
  setTimeout(() => win.print(), 400);
  return true;
}
