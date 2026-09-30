// Shared by the API (server/src/lib/payroll.ts) and the HR screens so previews match what gets posted.

export interface TaxTier { threshold: number; rate: number }
export interface DeductionType { name: string; type: 'fixed' | 'percentage'; value: number }
export interface PayItem { type: string; amount: number; taxable?: boolean }

export interface PayrollConfig {
  ssnit_employee: number;
  ssnit_employer: number;
  ssnit_tier1: number;
  ssnit_tier2: number;
  tax_tiers: TaxTier[];
  deduction_types: DeductionType[];
  annual_leave_days: number;
  max_carry_over_days: number;
  overtime_multiplier: number;
  standard_hours_per_day: number;
  [key: string]: any;
}

// GRA monthly PAYE bands for residents, effective 2024. Each threshold is the width of its band;
// income beyond the last band is taxed at the last rate.
export const GRA_MONTHLY_TAX_TIERS: TaxTier[] = [
  { threshold: 490, rate: 0 },
  { threshold: 110, rate: 5 },
  { threshold: 130, rate: 10 },
  { threshold: 3166.67, rate: 17.5 },
  { threshold: 16000, rate: 25 },
  { threshold: 30520, rate: 30 },
  { threshold: 999999, rate: 35 },
];

export const DEFAULT_PAYROLL_CONFIG: PayrollConfig = {
  ssnit_employee: 5.5,
  ssnit_employer: 13,
  ssnit_tier1: 13.5,
  ssnit_tier2: 5,
  tax_tiers: GRA_MONTHLY_TAX_TIERS,
  deduction_types: [],
  annual_leave_days: 15,
  max_carry_over_days: 5,
  overtime_multiplier: 1.5,
  standard_hours_per_day: 8,
};

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const round2 = (value: unknown) => Math.round((Number(value) || 0) * 100) / 100;

const num = (value: unknown, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/** Accepts the raw settings value (JSON string or object) and fills any missing keys with defaults. */
export function normalisePayrollConfig(raw: unknown): PayrollConfig {
  let parsed: any = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }
  }
  parsed = parsed && typeof parsed === 'object' ? parsed : {};
  const tiers = Array.isArray(parsed.tax_tiers) && parsed.tax_tiers.length
    ? parsed.tax_tiers.map((t: any) => ({ threshold: num(t.threshold, 0), rate: num(t.rate, 0) }))
    : GRA_MONTHLY_TAX_TIERS;
  const deductionTypes = Array.isArray(parsed.deduction_types)
    ? parsed.deduction_types.map((d: any) => typeof d === 'string'
      ? { name: d, type: 'fixed' as const, value: 0 }
      : { name: String(d.name || ''), type: d.type === 'percentage' ? 'percentage' as const : 'fixed' as const, value: num(d.value, 0) })
      .filter((d: DeductionType) => d.name)
    : [];
  return {
    ...parsed,
    ssnit_employee: num(parsed.ssnit_employee, DEFAULT_PAYROLL_CONFIG.ssnit_employee),
    ssnit_employer: num(parsed.ssnit_employer, DEFAULT_PAYROLL_CONFIG.ssnit_employer),
    ssnit_tier1: num(parsed.ssnit_tier1, DEFAULT_PAYROLL_CONFIG.ssnit_tier1),
    ssnit_tier2: num(parsed.ssnit_tier2, DEFAULT_PAYROLL_CONFIG.ssnit_tier2),
    tax_tiers: tiers,
    deduction_types: deductionTypes,
    annual_leave_days: num(parsed.annual_leave_days, DEFAULT_PAYROLL_CONFIG.annual_leave_days),
    max_carry_over_days: num(parsed.max_carry_over_days, DEFAULT_PAYROLL_CONFIG.max_carry_over_days),
    overtime_multiplier: num(parsed.overtime_multiplier, DEFAULT_PAYROLL_CONFIG.overtime_multiplier),
    standard_hours_per_day: num(parsed.standard_hours_per_day, DEFAULT_PAYROLL_CONFIG.standard_hours_per_day),
  };
}

export function calculatePAYE(taxableIncome: number, tiers: TaxTier[]): number {
  let tax = 0;
  let remaining = Math.max(Number(taxableIncome) || 0, 0);
  for (const tier of tiers) {
    if (remaining <= 0) break;
    const inBand = Math.min(remaining, Math.max(Number(tier.threshold) || 0, 0));
    tax += inBand * (Number(tier.rate) / 100);
    remaining -= inBand;
  }
  if (remaining > 0 && tiers.length > 0) tax += remaining * (Number(tiers[tiers.length - 1].rate) / 100);
  return round2(tax);
}

export interface PayInput {
  basic: number;               // basic salary, or hours x rate for hourly staff; SSNIT is charged on this
  allowances?: PayItem[];      // taxable unless taxable === false
  deductions?: PayItem[];      // voluntary/other deductions (loans, advances, ...), after tax
}

export interface PayResult {
  basic: number;
  allowances: number;
  taxable_allowances: number;
  gross: number;
  ssnit_employee: number;
  ssnit_employer: number;
  taxable_income: number;
  paye: number;
  other_deductions: number;
  total_deductions: number;
  net_pay: number;
}

export function computePay(input: PayInput, config: PayrollConfig): PayResult {
  const basic = round2(input.basic);
  const allowanceItems = (input.allowances || []).filter(a => Number(a.amount));
  const allowances = round2(allowanceItems.reduce((s, a) => s + Number(a.amount), 0));
  const taxableAllowances = round2(allowanceItems.filter(a => a.taxable !== false).reduce((s, a) => s + Number(a.amount), 0));
  const otherDeductions = round2((input.deductions || []).reduce((s, d) => s + (Number(d.amount) || 0), 0));
  const ssnitEmployee = round2(basic * config.ssnit_employee / 100);
  const ssnitEmployer = round2(basic * config.ssnit_employer / 100);
  const taxableIncome = round2(Math.max(basic + taxableAllowances - ssnitEmployee, 0));
  const paye = calculatePAYE(taxableIncome, config.tax_tiers);
  const gross = round2(basic + allowances);
  const totalDeductions = round2(ssnitEmployee + paye + otherDeductions);
  return {
    basic,
    allowances,
    taxable_allowances: taxableAllowances,
    gross,
    ssnit_employee: ssnitEmployee,
    ssnit_employer: ssnitEmployer,
    taxable_income: taxableIncome,
    paye,
    other_deductions: otherDeductions,
    total_deductions: totalDeductions,
    net_pay: round2(gross - totalDeductions),
  };
}

/** Amount for a configured deduction type (percentages apply to basic pay). */
export const deductionAmount = (type: DeductionType | undefined, basic: number) =>
  !type ? 0 : type.type === 'percentage' ? round2(basic * type.value / 100) : round2(type.value);

// SSNIT accepts the legacy number (one letter + 12 digits, e.g. C018012345678) or the Ghana Card PIN
// (GHA-123456789-0), which SSNIT now uses as the member number.
const LEGACY_SSNIT = /^[A-Z]\d{12}$/;
const GHANA_CARD_PIN = /^GHA-\d{9}-\d$/;
export const normaliseSsnit = (value: unknown) => {
  const raw = String(value ?? '').trim().toUpperCase().replace(/\s+/g, '');
  const card = raw.replace(/-/g, '').match(/^GHA(\d{9})(\d)$/);
  return card ? `GHA-${card[1]}-${card[2]}` : raw.replace(/-/g, '');
};
export const isValidSsnit = (value: unknown) => {
  const v = normaliseSsnit(value);
  return LEGACY_SSNIT.test(v) || GHANA_CARD_PIN.test(v);
};

/** Mon-Fri days between two YYYY-MM-DD dates, inclusive. */
export function workingDaysBetween(start: string, end: string): number {
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) return 0;
  let days = 0;
  for (const d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) days++;
  }
  return days;
}
