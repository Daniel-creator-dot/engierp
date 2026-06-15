export const formatCurrency = (amount: number, currency: string = 'GHS') => {
  const symbol = getCurrencySymbol(currency);
  return `${symbol}${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};


export const getCurrencySymbol = (currency: string = 'GHS') => {
  // Use a simple ASCII abbreviation to avoid encoding issues in CSV/Excel exports.
  return currency === 'USD' ? '$' : 'Gh';
};

