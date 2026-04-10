export const formatCurrency = (amount: number, currency: string = 'GHS') => {
  const symbol = currency === 'USD' ? '$' : 'GH₵';
  return `${symbol}${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export const getCurrencySymbol = (currency: string = 'GHS') => {
  return currency === 'USD' ? '$' : 'GH₵';
};
