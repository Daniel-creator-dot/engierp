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
  casual_wht_rate: number;
  casual_overtime_multiplier: number;
  casual_hours_per_day: number;
  [key: string]: any;
}

export type TaxTreatment = 'casual_wht' | 'paye' | 'none';
export const TAX_TREATMENTS: { value: TaxTreatment; label: string }[] = [
  { value: 'casual_wht', label: 'Casual: final withholding tax, no SSNIT' },
  { value: 'paye', label: 'PAYE and SSNIT (like permanent staff)' },
  { value: 'none', label: 'No tax or SSNIT (exempt)' },
];

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
  casual_wht_rate: 5,
  casual_overtime_multiplier: 1.5,
  casual_hours_per_day: 8,
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
    casual_wht_rate: num(parsed.casual_wht_rate, DEFAULT_PAYROLL_CONFIG.casual_wht_rate),
    casual_overtime_multiplier: num(parsed.casual_overtime_multiplier, DEFAULT_PAYROLL_CONFIG.casual_overtime_multiplier),
    casual_hours_per_day: num(parsed.casual_hours_per_day, DEFAULT_PAYROLL_CONFIG.casual_hours_per_day) || 8,
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

// Daily-rated casual workers: pay = days x daily rate + overtime hours x overtime rate.
export const isCasualWage = (wageType: unknown) => wageType === 'Daily';

export function effectiveTaxTreatment(emp: { wage_type?: string | null; tax_treatment?: string | null }): TaxTreatment {
  if (emp.tax_treatment === 'casual_wht' || emp.tax_treatment === 'paye' || emp.tax_treatment === 'none') return emp.tax_treatment;
  return isCasualWage(emp.wage_type) ? 'casual_wht' : 'paye';
}

/** Per-hour overtime rate: the worker's override, else (daily rate / hours per day) x the casual multiplier. */
export function casualOvertimeRate(dailyRate: number, override: unknown, config: PayrollConfig): number {
  const o = Number(override);
  if (override !== null && override !== undefined && override !== '' && Number.isFinite(o) && o >= 0) return round2(o);
  return round2((Number(dailyRate) || 0) / (config.casual_hours_per_day || 8) * config.casual_overtime_multiplier);
}

export const casualWhtLabel = (config: PayrollConfig) => `Withholding tax (${config.casual_wht_rate}% final)`;

// Deduction lines the system calculates itself; everything else in detailed_deductions is user-entered.
export const isStatutoryDeduction = (type: unknown) => /^(SSNIT employee|PAYE|Withholding tax)/i.test(String(type || ''));

export interface CasualPayInput {
  days: number;
  dailyRate: number;
  overtimeHours: number;
  overtimeRate: number;
  taxTreatment: TaxTreatment;
  allowances?: PayItem[];      // excluding overtime, which is added here
  deductions?: PayItem[];
}

export interface CasualPayResult extends PayResult {
  wht: number;
  overtime_pay: number;
  allowance_items: PayItem[];  // including the overtime line
}

export function computeCasualPay(input: CasualPayInput, config: PayrollConfig): CasualPayResult {
  const basic = round2((Number(input.days) || 0) * (Number(input.dailyRate) || 0));
  const overtimePay = round2((Number(input.overtimeHours) || 0) * (Number(input.overtimeRate) || 0));
  const allowanceItems: PayItem[] = [
    ...(overtimePay ? [{ type: `Overtime (${round2(input.overtimeHours)} h)`, amount: overtimePay, taxable: true }] : []),
    ...(input.allowances || []).filter(a => Number(a.amount) && !/^Overtime/i.test(a.type)),
  ];
  if (input.taxTreatment === 'paye') {
    const r = computePay({ basic, allowances: allowanceItems, deductions: input.deductions }, config);
    return { ...r, wht: 0, overtime_pay: overtimePay, allowance_items: allowanceItems };
  }
  const allowances = round2(allowanceItems.reduce((s, a) => s + Number(a.amount), 0));
  const gross = round2(basic + allowances);
  const wht = input.taxTreatment === 'casual_wht' ? round2(gross * config.casual_wht_rate / 100) : 0;
  const otherDeductions = round2((input.deductions || []).reduce((s, d) => s + (Number(d.amount) || 0), 0));
  const totalDeductions = round2(wht + otherDeductions);
  return {
    basic,
    allowances,
    taxable_allowances: allowances,
    gross,
    ssnit_employee: 0,
    ssnit_employer: 0,
    taxable_income: gross,
    paye: 0,
    other_deductions: otherDeductions,
    total_deductions: totalDeductions,
    net_pay: round2(gross - totalDeductions),
    wht,
    overtime_pay: overtimePay,
    allowance_items: allowanceItems,
  };
}

const isoOf = (d: Date) => d.toISOString().slice(0, 10);
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoOf(d);
}
/** Casual pay week containing the date: Monday to Saturday (a Sunday belongs to the week just ended). */
export function casualWeek(iso: string): { start: string; end: string } {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = d.getUTCDay();
  const start = addDays(iso, dow === 0 ? -6 : 1 - dow);
  return { start, end: addDays(start, 5) };
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
