import { Router } from 'express';
import db from '../db';
import { naturalBalance, round2, sendError, toIsoDate } from '../lib/ledger';
import { CREDIT_NOTE_METHOD } from '../lib/accounting';
import { loadPayrollAccounts } from '../lib/payroll';

// Mounted inside routes/accounting.ts, which already enforces admin/accountant access.
const router = Router();

const str = (v: unknown) => (v ? String(v) : undefined);

/** Per-account debit/credit sums, optionally limited to a date window. */
function accountSums(opts: { from?: string; to?: string; before?: string; types?: string[] }) {
  const q = db('chart_of_accounts as c')
    .leftJoin('ledger_entries as le', 'c.id', 'le.account_id')
    .leftJoin('journal_entries as j', 'le.journal_id', 'j.id')
    .groupBy('c.id')
    .orderBy('c.code')
    .select('c.id', 'c.code', 'c.name', 'c.type');
  const cond: string[] = [];
  const bindings: string[] = [];
  if (opts.from) { cond.push('j.date >= ?'); bindings.push(opts.from); }
  if (opts.to) { cond.push('j.date <= ?'); bindings.push(opts.to); }
  if (opts.before) { cond.push('j.date < ?'); bindings.push(opts.before); }
  const filter = cond.length ? cond.join(' AND ') : 'TRUE';
  q.select(
    db.raw(`COALESCE(SUM(CASE WHEN ${filter} THEN le.debit ELSE 0 END), 0) AS total_debit`, bindings),
    db.raw(`COALESCE(SUM(CASE WHEN ${filter} THEN le.credit ELSE 0 END), 0) AS total_credit`, bindings)
  );
  if (opts.types) q.whereIn('c.type', opts.types);
  return q;
}

// Trial balance as at endDate. Opening = everything before startDate, so the report always balances.
router.get('/reports/trial-balance', async (req, res) => {
  try {
    const startDate = str(req.query.startDate);
    const endDate = str(req.query.endDate);
    const [opening, period] = await Promise.all([
      startDate ? accountSums({ before: startDate, to: endDate }) : Promise.resolve([] as any[]),
      accountSums({ from: startDate, to: endDate }),
    ]);
    const openingById = new Map((opening as any[]).map((r) => [r.id, Number(r.total_debit) - Number(r.total_credit)]));
    res.json((period as any[]).map((r) => {
      const openingBalance = round2(openingById.get(r.id) || 0);
      const periodDebit = round2(r.total_debit);
      const periodCredit = round2(r.total_credit);
      const closing = round2(openingBalance + periodDebit - periodCredit);
      return {
        id: r.id,
        code: r.code,
        name: r.name,
        type: r.type,
        opening_balance: openingBalance,
        period_debit: periodDebit,
        period_credit: periodCredit,
        closing_balance: closing,
        total_debit: closing > 0 ? closing : 0,
        total_credit: closing < 0 ? -closing : 0,
      };
    }));
  } catch (error) {
    sendError(res, error, 'Error generating trial balance');
  }
});

router.get('/reports/income-statement', async (req, res) => {
  try {
    res.json(await accountSums({ from: str(req.query.startDate), to: str(req.query.endDate), types: ['Income', 'Expense'] }));
  } catch (error) {
    sendError(res, error, 'Error generating income statement');
  }
});

router.get('/reports/balance-sheet', async (req, res) => {
  try {
    const asOf = str(req.query.asOfDate);
    const accounts = await accountSums({ to: asOf, types: ['Asset', 'Liability', 'Equity'] });
    const pl = await accountSums({ to: asOf, types: ['Income', 'Expense'] });
    const retainedEarnings = round2((pl as any[]).reduce((s, r) => s + Number(r.total_credit) - Number(r.total_debit), 0));
    res.json({ accounts, retainedEarnings });
  } catch (error) {
    sendError(res, error, 'Error generating balance sheet');
  }
});

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const utcDate = (iso: string) => new Date(`${iso}T00:00:00Z`);

/**
 * The comparison window for a report range: the same number of whole months before it when the range is
 * month-aligned (e.g. September -> August, Q3 -> Q2), otherwise the same number of days immediately before.
 */
function priorRange(startDate: string, endDate: string) {
  const start = utcDate(startDate);
  const end = utcDate(endDate);
  const dayAfterEnd = new Date(end.getTime() + 86400000);
  if (start.getUTCDate() === 1 && dayAfterEnd.getUTCDate() === 1) {
    const months = (dayAfterEnd.getUTCFullYear() - start.getUTCFullYear()) * 12 + dayAfterEnd.getUTCMonth() - start.getUTCMonth();
    const priorStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - months, 1));
    return { from: isoDay(priorStart), to: isoDay(new Date(start.getTime() - 86400000)) };
  }
  const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  return { from: isoDay(new Date(start.getTime() - days * 86400000)), to: isoDay(new Date(start.getTime() - 86400000)) };
}

function summarise(rows: any[], payrollIds: number[]) {
  const stats: Record<string, number> = { Asset: 0, Liability: 0, Equity: 0, Income: 0, Expense: 0, PayrollCost: 0 };
  for (const r of rows) {
    const movement = Number(r.total_debit) - Number(r.total_credit);
    stats[r.type] = round2((stats[r.type] || 0) + naturalBalance(r.type, movement));
    if (payrollIds.includes(Number(r.id))) stats.PayrollCost = round2(stats.PayrollCost + movement);
  }
  return stats;
}

router.get('/reports/management', async (req, res) => {
  try {
    const startDate = str(req.query.startDate);
    const endDate = str(req.query.endDate);
    const payrollAccounts = await loadPayrollAccounts(db);
    const payrollIds = [...new Set([
      payrollAccounts.salary_expense_account_id,
      payrollAccounts.site_labour_account_id,
      payrollAccounts.employer_ssnit_account_id,
    ].filter((id): id is number => !!id))];

    const prior = startDate && endDate ? priorRange(startDate, endDate) : null;
    // At least six months of trend so a single-month report still has context; the client highlights the range.
    const trendEnd = utcDate(endDate || toIsoDate());
    const sixMonthsBack = isoDay(new Date(Date.UTC(trendEnd.getUTCFullYear(), trendEnd.getUTCMonth() - 5, 1)));
    const trendFrom = startDate && startDate < sixMonthsBack ? startDate : sixMonthsBack;
    const monthlyQuery = db('ledger_entries as le')
      .join('journal_entries as j', 'le.journal_id', 'j.id')
      .join('chart_of_accounts as c', 'le.account_id', 'c.id')
      .whereIn('c.type', ['Income', 'Expense'])
      .select(
        db.raw(`to_char(date_trunc('month', j.date), 'YYYY-MM') AS month`),
        db.raw(`COALESCE(SUM(CASE WHEN c.type = 'Income' THEN le.credit - le.debit ELSE 0 END), 0) AS income`),
        db.raw(`COALESCE(SUM(CASE WHEN c.type = 'Expense' THEN le.debit - le.credit ELSE 0 END), 0) AS expense`)
      )
      .groupByRaw('1')
      .orderByRaw('1');
    monthlyQuery.where('j.date', '>=', trendFrom);
    if (endDate) monthlyQuery.where('j.date', '<=', endDate);

    const payrollQuery = db('payroll').where('status', 'Paid').sum('net_pay as total_paid');
    if (startDate) payrollQuery.where('payment_date', '>=', startDate);
    if (endDate) payrollQuery.where('payment_date', '<=', endDate);

    const [rows, priorRows, monthly, [payrollResult], payrollNames]: any = await Promise.all([
      accountSums({ from: startDate, to: endDate }),
      prior ? accountSums({ from: prior.from, to: prior.to, types: ['Income', 'Expense'] }) : Promise.resolve(null),
      monthlyQuery,
      payrollQuery,
      payrollIds.length ? db('chart_of_accounts').whereIn('id', payrollIds).orderBy('code').select('code', 'name') : Promise.resolve([]),
    ]);

    const stats: Record<string, any> = summarise(rows, payrollIds);
    stats.TotalPayroll = Number(payrollResult?.total_paid || 0);
    stats.PayrollAccounts = (payrollNames as any[]).map((a) => `${a.code} ${a.name}`);
    stats.Monthly = (monthly as any[]).map((m) => ({ month: m.month, income: round2(m.income), expense: round2(m.expense) }));
    if (prior && priorRows) {
      const p = summarise(priorRows, payrollIds);
      stats.Prior = { from: prior.from, to: prior.to, Income: p.Income, Expense: p.Expense, PayrollCost: p.PayrollCost };
    }
    res.json(stats);
  } catch (error) {
    sendError(res, error, 'Error generating management reports');
  }
});

/** Cash and bank ledger accounts: linked bank accounts, Cash on Hand, and asset accounts named cash/bank. */
async function cashAccountIds() {
  const linked = await db('bank_accounts').whereNotNull('coa_account_id').pluck('coa_account_id');
  const named = await db('chart_of_accounts').where('type', 'Asset')
    .where(function () {
      this.where('code', '1101').orWhere('name', 'ilike', '%cash%').orWhere('name', 'ilike', 'bank%').orWhere('name', 'ilike', '% bank%');
    })
    .pluck('id');
  return [...new Set([...linked, ...named].map(Number))];
}

type Section = 'operating' | 'investing' | 'financing';

/** Classifies the account on the other side of a cash movement. */
function sectionFor(acc: { type: string; code: string; name: string }): Section {
  const code = String(acc.code || '');
  if (acc.type === 'Equity') return 'financing';
  if (acc.type === 'Liability' && (code.startsWith('22') || /loan|hire purchase|borrow/i.test(acc.name))) return 'financing';
  if (acc.type === 'Asset' && (code.startsWith('12') || code.startsWith('13'))) return 'investing';
  return 'operating';
}

router.get('/reports/cash-flow', async (req, res) => {
  try {
    const startDate = str(req.query.startDate);
    const endDate = str(req.query.endDate);
    const cashIds = await cashAccountIds();
    const empty = { inflows: 0, outflows: 0, net: 0, lines: [] as any[] };
    if (cashIds.length === 0) return res.json({ operating: empty, investing: empty, financing: empty, netCashFlow: 0, openingCash: 0, closingCash: 0 });

    const journalsQ = db('ledger_entries as le').join('journal_entries as j', 'le.journal_id', 'j.id')
      .whereIn('le.account_id', cashIds).distinct('le.journal_id');
    if (startDate) journalsQ.where('j.date', '>=', startDate);
    if (endDate) journalsQ.where('j.date', '<=', endDate);

    const lines = await db('ledger_entries as le')
      .join('chart_of_accounts as c', 'le.account_id', 'c.id')
      .whereIn('le.journal_id', journalsQ)
      .select('le.journal_id', 'le.account_id', 'le.debit', 'le.credit', 'c.type', 'c.code', 'c.name');

    const byJournal = new Map<number, any[]>();
    for (const l of lines) {
      if (!byJournal.has(l.journal_id)) byJournal.set(l.journal_id, []);
      byJournal.get(l.journal_id)!.push(l);
    }

    const sections: Record<Section, { inflows: number; outflows: number; byAccount: Map<string, number> }> = {
      operating: { inflows: 0, outflows: 0, byAccount: new Map() },
      investing: { inflows: 0, outflows: 0, byAccount: new Map() },
      financing: { inflows: 0, outflows: 0, byAccount: new Map() },
    };

    for (const jl of byJournal.values()) {
      const cashNet = jl.filter((l) => cashIds.includes(l.account_id)).reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
      const others = jl.filter((l) => !cashIds.includes(l.account_id));
      if (Math.abs(cashNet) < 0.005 || others.length === 0) continue; // transfers between cash accounts
      const weights = others.map((l) => Math.abs(Number(l.debit) - Number(l.credit)));
      const totalWeight = weights.reduce((s, w) => s + w, 0) || 1;
      others.forEach((l, i) => {
        const share = cashNet * (weights[i] / totalWeight);
        const sec = sections[sectionFor(l)];
        if (share >= 0) sec.inflows += share; else sec.outflows += -share;
        const key = `${l.code} ${l.name}`;
        sec.byAccount.set(key, (sec.byAccount.get(key) || 0) + share);
      });
    }

    const shape = (s: typeof sections.operating) => ({
      inflows: round2(s.inflows),
      outflows: round2(s.outflows),
      net: round2(s.inflows - s.outflows),
      lines: [...s.byAccount.entries()].map(([account, amount]) => ({ account, amount: round2(amount) })).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)),
    });

    const openingQ = db('ledger_entries as le').join('journal_entries as j', 'le.journal_id', 'j.id').whereIn('le.account_id', cashIds)
      .select(db.raw('COALESCE(SUM(le.debit - le.credit), 0) AS bal'));
    if (startDate) openingQ.where('j.date', '<', startDate); else openingQ.whereRaw('FALSE');
    const [{ bal: openingCash }]: any = await openingQ;

    const operating = shape(sections.operating);
    const investing = shape(sections.investing);
    const financing = shape(sections.financing);
    const netCashFlow = round2(operating.net + investing.net + financing.net);
    res.json({ operating, investing, financing, netCashFlow, openingCash: round2(openingCash), closingCash: round2(Number(openingCash) + netCashFlow) });
  } catch (error) {
    sendError(res, error, 'Error generating cash flow statement');
  }
});

// --- Receivables ---

const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);

router.get('/reports/ar-aging', async (req, res) => {
  try {
    const asOf = toIsoDate(str(req.query.asOfDate));
    const invoices = await db('invoices as i')
      .leftJoin('payments as p', function () {
        this.on('p.target_id', 'i.id').andOn('p.target_type', db.raw('?', ['Invoice'])).andOn('p.date', '<=', db.raw('?', [asOf]));
      })
      .where(function () { this.whereNull('i.status').orWhereNot('i.status', 'void'); })
      .whereRaw('COALESCE(i.date, CAST(i.created_at AS DATE)) <= ?', [asOf])
      .groupBy('i.id')
      .select('i.id', 'i.client', 'i.project_id', 'i.amount', 'i.dueDate', 'i.date', 'i.created_at', db.raw('COALESCE(SUM(p.amount), 0) AS settled'));

    const buckets = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'] as const;
    const clients = new Map<string, any>();
    const open: any[] = [];
    for (const inv of invoices as any[]) {
      const balance = round2(Number(inv.amount) - Number(inv.settled));
      if (balance <= 0.005) continue;
      const due = inv.dueDate ? String(inv.dueDate).slice(0, 10) : toIsoDate(inv.date || inv.created_at);
      const overdue = daysBetween(due, asOf);
      const bucket = overdue <= 0 ? 'current' : overdue <= 30 ? 'd1_30' : overdue <= 60 ? 'd31_60' : overdue <= 90 ? 'd61_90' : 'd90_plus';
      const row = { id: inv.id, client: inv.client, project_id: inv.project_id, date: toIsoDate(inv.date || inv.created_at), due_date: due, amount: Number(inv.amount), balance, days_overdue: Math.max(0, overdue), bucket };
      open.push(row);
      const key = inv.client || 'Unknown client';
      if (!clients.has(key)) clients.set(key, { client: key, total: 0, invoices: 0, ...Object.fromEntries(buckets.map((b) => [b, 0])) });
      const c = clients.get(key);
      c[bucket] = round2(c[bucket] + balance);
      c.total = round2(c.total + balance);
      c.invoices += 1;
    }
    const summary = [...clients.values()].sort((a, b) => b.total - a.total);
    const totals: any = { total: 0, ...Object.fromEntries(buckets.map((b) => [b, 0])) };
    for (const c of summary) for (const k of ['total', ...buckets]) totals[k] = round2(totals[k] + c[k]);
    res.json({ asOf, clients: summary, invoices: open.sort((a, b) => b.days_overdue - a.days_overdue), totals });
  } catch (error) {
    sendError(res, error, 'Error generating AR aging');
  }
});

router.get('/clients', async (req, res) => {
  try {
    const rows = await db('invoices').whereNotNull('client').distinct('client').orderBy('client');
    res.json(rows.map((r: any) => r.client));
  } catch (error) {
    sendError(res, error, 'Error fetching clients');
  }
});

// Statement of account: opening balance, then invoices (debits) and receipts / credit notes (credits).
router.get('/clients/statement', async (req, res) => {
  try {
    const client = String(req.query.client || '');
    if (!client) return res.status(400).json({ message: 'client is required' });
    const endDate = toIsoDate(str(req.query.endDate));
    const startDate = str(req.query.startDate) || '1900-01-01';

    const invoices = await db('invoices').where({ client }).where(function () { this.whereNull('status').orWhereNot('status', 'void'); })
      .select('id', 'amount', 'date', 'created_at', 'dueDate');
    const invoiceIds = invoices.map((i: any) => i.id);
    const payments = invoiceIds.length
      ? await db('payments').where('target_type', 'Invoice').whereIn('target_id', invoiceIds).select('payment_id', 'date', 'amount', 'method', 'reference', 'target_id')
      : [];

    const events = [
      ...invoices.map((i: any) => ({ date: toIsoDate(i.date || i.created_at), type: 'Invoice', reference: i.id, description: `Invoice ${i.id}${i.dueDate ? ` (due ${String(i.dueDate).slice(0, 10)})` : ''}`, debit: Number(i.amount), credit: 0 })),
      ...payments.map((p: any) => ({
        date: toIsoDate(p.date),
        type: p.method === CREDIT_NOTE_METHOD ? 'Credit Note' : 'Payment',
        reference: p.payment_id,
        description: `${p.method === CREDIT_NOTE_METHOD ? 'Credit note' : `Payment (${p.method})`} on ${p.target_id}${p.reference ? ` - ${p.reference}` : ''}`,
        debit: 0,
        credit: Number(p.amount),
      })),
    ].filter((e) => e.date <= endDate).sort((a, b) => a.date.localeCompare(b.date) || (a.type === 'Invoice' ? -1 : 1));

    let opening = 0;
    let running = 0;
    const lines: any[] = [];
    for (const e of events) {
      if (e.date < startDate) { opening = round2(opening + e.debit - e.credit); running = opening; continue; }
      running = round2(running + e.debit - e.credit);
      lines.push({ ...e, balance: running });
    }
    res.json({ client, startDate: str(req.query.startDate) || null, endDate, opening_balance: opening, lines, closing_balance: round2(lines.length ? running : opening) });
  } catch (error) {
    sendError(res, error, 'Error generating statement');
  }
});

// --- GRA schedules ---

router.get('/reports/vat', async (req, res) => {
  try {
    const startDate = str(req.query.startDate);
    const endDate = str(req.query.endDate);
    const q = db('invoices').where(function () { this.whereNull('status').orWhereNot('status', 'void'); })
      .select('id', 'client', 'date', 'created_at', 'subtotal', 'tax_amount', 'tax_breakdown', 'amount')
      .orderBy('date');
    if (startDate) q.whereRaw('COALESCE(date, CAST(created_at AS DATE)) >= ?', [startDate]);
    if (endDate) q.whereRaw('COALESCE(date, CAST(created_at AS DATE)) <= ?', [endDate]);
    const invoices = await q;

    const creditNotes = await db('credit_notes as cn').join('invoices as i', 'cn.invoice_id', 'i.id')
      .modify((b) => { if (startDate) b.where('cn.date', '>=', startDate); if (endDate) b.where('cn.date', '<=', endDate); })
      .select('cn.id', 'cn.invoice_id', 'cn.client', 'cn.date', 'cn.amount', 'i.amount as invoice_amount', 'i.subtotal as invoice_subtotal', 'i.tax_breakdown');

    const totals: Record<string, { name: string; rate: number; amount: number }> = {};
    const add = (code: string, name: string, rate: number, amount: number) => {
      if (!totals[code]) totals[code] = { name, rate, amount: 0 };
      totals[code].amount = round2(totals[code].amount + amount);
    };
    const parse = (v: any) => { try { return typeof v === 'string' ? JSON.parse(v) : (v || []); } catch { return []; } };

    let taxable = 0;
    const rows = invoices.map((inv: any) => {
      const breakdown = parse(inv.tax_breakdown);
      taxable += Number(inv.subtotal || 0);
      if (breakdown.length) breakdown.forEach((b: any) => add(b.code, b.name, Number(b.rate), Number(b.amount)));
      else if (Number(inv.tax_amount) > 0) add('VAT', 'VAT (unsplit)', 0, Number(inv.tax_amount));
      return { id: inv.id, client: inv.client, date: toIsoDate(inv.date || inv.created_at), taxable: Number(inv.subtotal || inv.amount), tax: Number(inv.tax_amount || 0), total: Number(inv.amount), breakdown };
    });

    const cnRows = creditNotes.map((cn: any) => {
      const ratio = Number(cn.invoice_amount) ? Number(cn.amount) / Number(cn.invoice_amount) : 0;
      const breakdown = parse(cn.tax_breakdown).map((b: any) => ({ ...b, amount: round2(Number(b.amount) * ratio) }));
      breakdown.forEach((b: any) => add(b.code, b.name, Number(b.rate), -b.amount));
      taxable -= Number(cn.invoice_subtotal || 0) * ratio;
      return { id: cn.id, invoice_id: cn.invoice_id, client: cn.client, date: toIsoDate(cn.date), amount: Number(cn.amount), tax: round2(breakdown.reduce((s: number, b: any) => s + b.amount, 0)) };
    });

    const inputVat = await db('ledger_entries as le').join('journal_entries as j', 'le.journal_id', 'j.id').join('chart_of_accounts as c', 'le.account_id', 'c.id')
      .where('c.code', '1109')
      .modify((b) => { if (startDate) b.where('j.date', '>=', startDate); if (endDate) b.where('j.date', '<=', endDate); })
      .select(db.raw('COALESCE(SUM(le.debit - le.credit), 0) AS amount')).first();

    const outputTax = round2(Object.values(totals).reduce((s, t) => s + t.amount, 0));
    const inputTax = round2((inputVat as any)?.amount || 0);
    res.json({ startDate, endDate, taxable_sales: round2(taxable), components: totals, output_tax: outputTax, input_tax: inputTax, net_payable: round2(outputTax - inputTax), invoices: rows, credit_notes: cnRows });
  } catch (error) {
    sendError(res, error, 'Error generating VAT report');
  }
});

router.get('/reports/wht', async (req, res) => {
  try {
    const startDate = str(req.query.startDate);
    const endDate = str(req.query.endDate);
    const q = db('payments as p')
      .join('bills as b', 'p.target_id', db.raw('CAST(b.id AS VARCHAR)'))
      .join('suppliers as s', 'b.supplier_id', 's.id')
      .where('p.target_type', 'Bill')
      .where('p.wht_amount', '>', 0)
      // s.* first so the explicit columns below win on name clashes (e.g. category).
      .select('s.*', 'p.payment_id', 'p.date', 'p.amount', 'p.wht_rate', 'p.wht_amount', 'p.reference', 'b.id as bill_id', 'b.category', 's.id as supplier_id', 's.name as supplier_name')
      .orderBy('p.date');
    if (startDate) q.where('p.date', '>=', startDate);
    if (endDate) q.where('p.date', '<=', endDate);
    const rows = (await q).map((r: any) => ({
      payment_id: r.payment_id,
      date: toIsoDate(r.date),
      supplier_id: r.supplier_id,
      supplier_name: r.supplier_name,
      supplier_tin: r.tin || r.gra_tin || r.tax_id || null,
      bill_id: r.bill_id,
      category: r.category,
      gross: Number(r.amount),
      rate: Number(r.wht_rate),
      wht: Number(r.wht_amount),
      net: round2(Number(r.amount) - Number(r.wht_amount)),
    }));
    res.json({ startDate, endDate, rows, total_gross: round2(rows.reduce((s, r) => s + r.gross, 0)), total_wht: round2(rows.reduce((s, r) => s + r.wht, 0)) });
  } catch (error) {
    sendError(res, error, 'Error generating withholding tax report');
  }
});

export default router;
