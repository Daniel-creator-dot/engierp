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

/** Only allow image data URLs and http(s) URLs in <img src>; anything else becomes ''. */
export const safeImageSrc = (value: unknown): string => {
  const src = String(value ?? '').trim();
  if (/^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(src)) return src;
  if (/^https?:\/\//i.test(src)) return escapeHtml(src);
  return '';
};
