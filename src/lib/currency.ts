export const formatCurrency = (amount: number, currency: string = 'GHS') => {
  const symbol = getCurrencySymbol(currency);
  return `${symbol}${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};


export const getCurrencySymbol = (currency: string = 'GHS') => {
  // Use a glyph that is most reliably supported.
  // "₵" can appear as "â" in some fonts/encodings.
  return currency === 'USD' ? '$' : 'GH¢';
};

