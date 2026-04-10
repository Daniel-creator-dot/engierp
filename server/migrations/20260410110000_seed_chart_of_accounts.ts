import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Only seed if chart_of_accounts is empty
  const existing = await knex('chart_of_accounts').count('* as cnt').first();
  if (Number(existing?.cnt) > 0) return;

  await knex('chart_of_accounts').insert([
    // ASSETS (1000s)
    { code: '1001', name: 'Cash on Hand', type: 'Asset', balance: 0 },
    { code: '1002', name: 'Bank - Operating Account', type: 'Asset', balance: 0 },
    { code: '1003', name: 'Accounts Receivable', type: 'Asset', balance: 0 },
    { code: '1004', name: 'Inventory - Raw Materials', type: 'Asset', balance: 0 },
    { code: '1005', name: 'Prepaid Expenses', type: 'Asset', balance: 0 },
    { code: '1006', name: 'Work-in-Progress (WIP)', type: 'Asset', balance: 0 },
    { code: '1100', name: 'Property, Plant & Equipment', type: 'Asset', balance: 0 },
    { code: '1101', name: 'Accumulated Depreciation', type: 'Asset', balance: 0 },
    { code: '1200', name: 'Mobile Money Float', type: 'Asset', balance: 0 },

    // LIABILITIES (2000s)
    { code: '2001', name: 'Accounts Payable', type: 'Liability', balance: 0 },
    { code: '2002', name: 'Accrued Liabilities', type: 'Liability', balance: 0 },
    { code: '2003', name: 'VAT Payable', type: 'Liability', balance: 0 },
    { code: '2004', name: 'PAYE Tax Payable', type: 'Liability', balance: 0 },
    { code: '2005', name: 'SSNIT Payable', type: 'Liability', balance: 0 },
    { code: '2006', name: 'Retention Payable', type: 'Liability', balance: 0 },
    { code: '2100', name: 'Short-Term Loans', type: 'Liability', balance: 0 },
    { code: '2200', name: 'Long-Term Debt', type: 'Liability', balance: 0 },

    // EQUITY (3000s)
    { code: '3001', name: 'Owners Equity / Capital', type: 'Equity', balance: 0 },
    { code: '3002', name: 'Retained Earnings', type: 'Equity', balance: 0 },

    // REVENUE / INCOME (4000s)
    { code: '4001', name: 'Project Revenue', type: 'Income', balance: 0 },
    { code: '4002', name: 'Consulting Revenue', type: 'Income', balance: 0 },
    { code: '4003', name: 'Interest & Other Income', type: 'Income', balance: 0 },

    // EXPENSES (5000s)
    { code: '5001', name: 'Direct Labour', type: 'Expense', balance: 0 },
    { code: '5002', name: 'Materials & Supplies', type: 'Expense', balance: 0 },
    { code: '5003', name: 'Subcontractor Costs', type: 'Expense', balance: 0 },
    { code: '5004', name: 'Equipment Rental', type: 'Expense', balance: 0 },
    { code: '5005', name: 'Site Overheads', type: 'Expense', balance: 0 },
    { code: '5006', name: 'Fuel & Transport', type: 'Expense', balance: 0 },
    { code: '5100', name: 'Office Rent', type: 'Expense', balance: 0 },
    { code: '5101', name: 'Utilities', type: 'Expense', balance: 0 },
    { code: '5102', name: 'Professional Fees', type: 'Expense', balance: 0 },
    { code: '5103', name: 'Insurance', type: 'Expense', balance: 0 },
    { code: '5104', name: 'Depreciation Expense', type: 'Expense', balance: 0 },
    { code: '5105', name: 'Salaries & Wages', type: 'Expense', balance: 0 },
    { code: '5106', name: 'Bank Charges', type: 'Expense', balance: 0 },
    { code: '5107', name: 'Miscellaneous Expense', type: 'Expense', balance: 0 },
  ]);
}

export async function down(knex: Knex): Promise<void> {
  // Only remove if they are the seeded ones
  await knex('chart_of_accounts')
    .whereIn('code', [
      '1001','1002','1003','1004','1005','1006','1100','1101','1200',
      '2001','2002','2003','2004','2005','2006','2100','2200',
      '3001','3002',
      '4001','4002','4003',
      '5001','5002','5003','5004','5005','5006','5100','5101','5102','5103','5104','5105','5106','5107'
    ])
    .del();
}
