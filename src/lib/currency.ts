const NUMBER_LOCALE = 'en-US';

/** Plain amount without a symbol, for table cells whose header already names the currency. */
export const formatAmount = (amount: unknown) =>
  (Number(amount) || 0).toLocaleString(NUMBER_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const getCurrencySymbol = (currency: string = 'GHS') => (currency === 'USD' ? '$' : 'GH₵');

const joinSymbol = (symbol: string, digits: string) => `${symbol}${symbol === '$' ? '' : ' '}${digits}`;

/** e.g. "GH₵ 1,234.56" and "-GH₵ 1,234.56"; always comma thousands separators regardless of browser locale. */
export const formatWithSymbol = (amount: unknown, symbol: string = 'GH₵') => {
  const value = Number(amount) || 0;
  const digits = Math.abs(value).toLocaleString(NUMBER_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sign = value < 0 && Math.abs(value) >= 0.005 ? '-' : '';
  return `${sign}${joinSymbol(symbol, digits)}`;
};

/** Short form for chart axes and tight spaces, e.g. "GH₵ 1.2M", "GH₵ 480K". */
export const formatCompactWithSymbol = (amount: unknown, symbol: string = 'GH₵') => {
  const value = Number(amount) || 0;
  const digits = Math.abs(value).toLocaleString(NUMBER_LOCALE, { notation: 'compact', maximumFractionDigits: 1 });
  return `${value < 0 ? '-' : ''}${joinSymbol(symbol, digits)}`;
};

export const formatCurrency = (amount: number, currency: string = 'GHS') => formatWithSymbol(amount, getCurrencySymbol(currency));

export const formatCompactCurrency = (amount: number, currency: string = 'GHS') => formatCompactWithSymbol(amount, getCurrencySymbol(currency));
