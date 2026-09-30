const NUMBER_LOCALE = 'en-US';

export const getCurrencySymbol = (currency: string = 'GHS') => (currency === 'USD' ? '$' : 'GH₵');

/** e.g. "GH₵ 1,234.56" and "-GH₵ 1,234.56"; always comma thousands separators regardless of browser locale. */
export const formatCurrency = (amount: number, currency: string = 'GHS') => {
  const value = Number(amount) || 0;
  const symbol = getCurrencySymbol(currency);
  const digits = Math.abs(value).toLocaleString(NUMBER_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sign = value < 0 && Math.abs(value) >= 0.005 ? '-' : '';
  return `${sign}${symbol}${currency === 'USD' ? '' : ' '}${digits}`;
};

/** Short form for chart axes and tight spaces, e.g. "GH₵ 1.2M", "GH₵ 480k". */
export const formatCompactCurrency = (amount: number, currency: string = 'GHS') => {
  const value = Number(amount) || 0;
  const symbol = getCurrencySymbol(currency);
  const digits = Math.abs(value).toLocaleString(NUMBER_LOCALE, { notation: 'compact', maximumFractionDigits: 1 });
  return `${value < 0 ? '-' : ''}${symbol}${currency === 'USD' ? '' : ' '}${digits}`;
};
