const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

// Print windows share the app's origin (and its localStorage token), so every value
// interpolated into their HTML must go through this.
export const escapeHtml = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value).replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);

export const esc = escapeHtml;
