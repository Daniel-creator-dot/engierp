import { differenceInCalendarDays, differenceInMonths, differenceInYears, format, isValid, parseISO } from 'date-fns';

// Dates are stored as 'YYYY-MM-DD'; parseISO reads them as local dates so they never shift by a day.
const toDate = (value?: string | null) => {
  if (!value) return null;
  const date = parseISO(String(value).slice(0, 10));
  return isValid(date) ? date : null;
};

export const todayIso = () => format(new Date(), 'yyyy-MM-dd');

export function formatDate(value?: string | null, fallback = '—') {
  const date = toDate(value);
  return date ? format(date, 'd MMM yyyy') : fallback;
}

/** Number of calendar days from start to end, counting both days. */
export function inclusiveDays(start?: string | null, end?: string | null) {
  const s = toDate(start);
  const e = toDate(end);
  if (!s || !e) return 0;
  return Math.max(differenceInCalendarDays(e, s) + 1, 0);
}

/** Days from today until the date; negative when the date has passed. */
export function daysUntil(value?: string | null) {
  const date = toDate(value);
  return date ? differenceInCalendarDays(date, new Date()) : null;
}

/** e.g. "3 yrs 2 mos". Measured to `until` (exit date) or today. */
export function serviceLength(start?: string | null, until?: string | null) {
  const s = toDate(start);
  if (!s) return '—';
  const end = toDate(until) || new Date();
  if (end < s) return 'Not started';
  const totalMonths = differenceInMonths(end, s);
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  if (years === 0 && months === 0) {
    const days = differenceInCalendarDays(end, s);
    return `${days} day${days === 1 ? '' : 's'}`;
  }
  const parts = [];
  if (years) parts.push(`${years} yr${years === 1 ? '' : 's'}`);
  if (months) parts.push(`${months} mo${months === 1 ? '' : 's'}`);
  return parts.join(' ');
}

export function ageInYears(dateOfBirth?: string | null) {
  const dob = toDate(dateOfBirth);
  return dob ? differenceInYears(new Date(), dob) : null;
}
