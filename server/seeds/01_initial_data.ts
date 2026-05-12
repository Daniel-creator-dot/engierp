import type { Knex } from "knex";

export async function seed(knex: Knex): Promise<void> {
  // Deletes ALL existing entries
  await knex("settings").del();
  await knex("leave_requests").del();
  await knex("taxes").del();
  await knex("ledger_entries").del();
  await knex("journal_entries").del();
  await knex("invoices").del();
  await knex("transactions").del();
  await knex("projects").del();
  await knex("users").del();
  await knex("employees").del();

  // Seed Employees
  await knex("employees").insert([
    { id: 'EMP-001', name: 'James Mensah', role: 'Senior Engineer', department: 'Civil', salary: 8500, joinDate: '2020-01-10', status: 'active' },
    { id: 'EMP-002', name: 'Abena Osei', role: 'Project Manager', department: 'Operations', salary: 9200, joinDate: '2021-03-15', status: 'active' },
    { id: 'EMP-003', name: 'Kofi Appiah', role: 'Site Supervisor', department: 'Construction', salary: 5500, joinDate: '2022-06-01', status: 'on-leave' },
  ]);

  // Seed Users
  await knex("users").insert([
    { email: 'admin@engierp.com', password: '$2b$10$/gjDIB.MDV4xYW1nM5NT2u3bp8kOoq6y6yNn.qLCjXXo2Q118kk4q', role: 'admin' },
    { email: 'acc@engierp.com', password: '$2b$10$/gjDIB.MDV4xYW1nM5NT2u3bp8kOoq6y6yNn.qLCjXXo2Q118kk4q', role: 'accountant' },
  ]);

  // Seed Projects
  await knex("projects").insert([
    { id: 'PRJ-001', name: 'Skyline Bridge Construction', client: 'City Council', budget: 1200000, spent: 850000, status: 'active', startDate: '2023-01-15', endDate: '2024-06-30', manager: 'John Doe', profitability: 28 },
    { id: 'PRJ-002', name: 'Green Valley Solar Farm', client: 'EcoEnergy Ltd', budget: 5000000, spent: 2100000, status: 'active', startDate: '2023-05-10', endDate: '2025-12-31', manager: 'Sarah Smith', profitability: 35 },
  ]);

  await knex("payments").del();
  await knex("bank_transactions").del();
  await knex("bank_accounts").del();
  await knex("chart_of_accounts").del();

  // Seed Chart of Accounts
  const coa = [
    { code: '1101', name: 'Cash on Hand', type: 'Asset' },
    { code: '1102', name: 'Bank – ADB Current', type: 'Asset' },
    { code: '1103', name: 'Bank – Salary', type: 'Asset' },
    { code: '1104', name: 'Accounts Receivable', type: 'Asset' },
    { code: '1105', name: 'Contract Receivables', type: 'Asset' },
    { code: '1106', name: 'Staff Advances', type: 'Asset' },
    { code: '1107', name: 'Prepayments', type: 'Asset' },
    { code: '1108', name: 'Withholding Tax Receivable', type: 'Asset' },
    { code: '1109', name: 'VAT Input', type: 'Asset' },
    { code: '1201', name: 'Land & Buildings', type: 'Asset' },
    { code: '1202', name: 'Office Equipment', type: 'Asset' },
    { code: '1203', name: 'Engineering Equipment', type: 'Asset' },
    { code: '1204', name: 'Motor Vehicles', type: 'Asset' },
    { code: '1205', name: 'Furniture & Fittings', type: 'Asset' },
    { code: '1206', name: 'IT Equipment', type: 'Asset' },
    { code: '1301', name: 'Acc Dep – Equipment', type: 'Asset' },
    { code: '1302', name: 'Acc Dep – Vehicles', type: 'Asset' },
    { code: '1303', name: 'Acc Dep – Furniture', type: 'Asset' },
    { code: '2101', name: 'Accounts Payable', type: 'Liability' },
    { code: '2102', name: 'Withholding Tax Payable', type: 'Liability' },
    { code: '2103', name: 'PAYE Payable', type: 'Liability' },
    { code: '2104', name: 'SSNIT Payable', type: 'Liability' },
    { code: '2105', name: 'VAT Output', type: 'Liability' },
    { code: '2106', name: 'Accrued Expenses', type: 'Liability' },
    { code: '2107', name: 'Contract Liabilities', type: 'Liability' },
    { code: '2201', name: 'Bank Loans', type: 'Liability' },
    { code: '2202', name: 'Hire Purchase Obligations', type: 'Liability' },
    { code: '3101', name: 'Share Capital', type: 'Equity' },
    { code: '3102', name: 'Retained Earnings', type: 'Equity' },
    { code: '3103', name: 'Current Year Profit', type: 'Equity' },
    { code: '3900', name: 'Opening Balance Equity', type: 'Equity' },
    { code: '4101', name: 'Civil Engineering Revenue', type: 'Income' },
    { code: '4102', name: 'Electrical Engineering Revenue', type: 'Income' },
    { code: '4103', name: 'Mechanical Engineering Revenue', type: 'Income' },
    { code: '4104', name: 'Consultancy Fees', type: 'Income' },
    { code: '4105', name: 'Project Management Fees', type: 'Income' },
    { code: '5101', name: 'Materials – Construction', type: 'Expense' },
    { code: '5102', name: 'Labour – Site Workers', type: 'Expense' },
    { code: '5103', name: 'Subcontractor Costs', type: 'Expense' },
    { code: '5104', name: 'Equipment Hire', type: 'Expense' },
    { code: '5105', name: 'Fuel – Site', type: 'Expense' },
    { code: '5106', name: 'Site Transport', type: 'Expense' },
    { code: '5107', name: 'Site Utilities', type: 'Expense' },
    { code: '5108', name: 'Project Insurance', type: 'Expense' },
    { code: '6101', name: 'Salaries – Office Staff', type: 'Expense' },
    { code: '6102', name: 'Office Rent', type: 'Expense' },
    { code: '6103', name: 'Utilities – Office', type: 'Expense' },
    { code: '6104', name: 'Internet & Communication', type: 'Expense' },
    { code: '6105', name: 'Stationery & Printing', type: 'Expense' },
    { code: '6201', name: 'Repairs & Maintenance', type: 'Expense' },
    { code: '6202', name: 'Fuel – Office Vehicles', type: 'Expense' },
    { code: '6203', name: 'Staff Welfare', type: 'Expense' },
    { code: '6204', name: 'Training & Development', type: 'Expense' },
    { code: '6301', name: 'Audit Fees', type: 'Expense' },
    { code: '6302', name: 'Legal Fees', type: 'Expense' },
    { code: '6303', name: 'Consultancy Fees', type: 'Expense' },
    { code: '6401', name: 'Advertising', type: 'Expense' },
    { code: '6402', name: 'Tendering Costs', type: 'Expense' },
    { code: '6403', name: 'Business Development', type: 'Expense' },
    { code: '7101', name: 'Bank Charges', type: 'Expense' },
    { code: '7102', name: 'Loan Interest', type: 'Expense' },
    { code: '7103', name: 'Forex Gain/Loss', type: 'Expense' }
  ];

  await knex('chart_of_accounts').insert(coa);

  // Seed Bank Accounts
  await knex('bank_accounts').insert([
    { account_name: 'Main Operating (ADB)', account_number: '123-456-789', bank_name: 'ADB Bank', type: 'Current', balance: 231500 },
    { account_name: 'Salary Account', account_number: '987-654-321', bank_name: 'ADB Bank', type: 'Savings', balance: 0 }
  ]);

  // Seed Financial Data (Ledger v3)
  const bankAcc = await knex('chart_of_accounts').where('code', '1102').first();
  const revenueAcc = await knex('chart_of_accounts').where('code', '4101').first();
  const materialsAcc = await knex('chart_of_accounts').where('code', '5101').first();
  const rentAcc = await knex('chart_of_accounts').where('code', '6102').first();

  if (bankAcc && revenueAcc && materialsAcc && rentAcc) {
    // 1. Progress Payment Income
    const [j1] = await knex('journal_entries').insert({
      date: '2024-04-05',
      description: 'Progress Payment #4 - Skyline Bridge',
      project_id: 'PRJ-001',
      reference_type: 'invoice'
    }).returning('id');
    const j1Id = typeof j1 === 'object' ? j1.id : j1;

    await knex('ledger_entries').insert([
      { journal_id: j1Id, account_id: bankAcc.id, debit: 250000, credit: 0 },
      { journal_id: j1Id, account_id: revenueAcc.id, debit: 0, credit: 250000 }
    ]);

    // 2. Material Expense
    const [j2] = await knex('journal_entries').insert({
      date: '2024-04-01',
      description: 'Cement Supply - Batch A',
      project_id: 'PRJ-001',
      reference_type: 'bill'
    }).returning('id');
    const j2Id = typeof j2 === 'object' ? j2.id : j2;

    await knex('ledger_entries').insert([
      { journal_id: j2Id, account_id: materialsAcc.id, debit: 15000, credit: 0 },
      { journal_id: j2Id, account_id: bankAcc.id, debit: 0, credit: 15000 }
    ]);

    // 3. Office Rent
    const [j3] = await knex('journal_entries').insert({
      date: '2024-04-06',
      description: 'Office Rent - April',
      reference_type: 'manual'
    }).returning('id');
    const j3Id = typeof j3 === 'object' ? j3.id : j3;

    await knex('ledger_entries').insert([
      { journal_id: j3Id, account_id: rentAcc.id, debit: 3500, credit: 0 },
      { journal_id: j3Id, account_id: bankAcc.id, debit: 0, credit: 3500 }
    ]);

    // Update balances
    await knex('chart_of_accounts').where('id', bankAcc.id).update({ balance: 250000 - 15000 - 3500 });
    await knex('chart_of_accounts').where('id', revenueAcc.id).update({ balance: 250000 });
    await knex('chart_of_accounts').where('id', materialsAcc.id).update({ balance: 15000 });
    await knex('chart_of_accounts').where('id', rentAcc.id).update({ balance: 3500 });
  }

  // Seed Invoices
  await knex("invoices").insert([
    { id: 'INV-1001', client: 'City Council', amount: 250000, dueDate: '2024-05-01', status: 'unpaid', project_id: 'PRJ-001' },
    { id: 'INV-1002', client: 'EcoEnergy Ltd', amount: 500000, dueDate: '2024-04-15', status: 'paid', project_id: 'PRJ-002' },
  ]);

  // Seed Settings
  await knex("settings").insert([
    { key: 'currency', value: 'GHS' },
    { key: 'company_name', value: 'SRAJ NOVA ENGINEERING SOLUTIONS LTD' },
    { key: 'company_tin', value: 'C0066528941' },
    { key: 'company_address', value: '123 Industrial Area, Accra, Ghana' },
    { key: 'payroll_config', value: JSON.stringify({ ssnit_employee: 5.5, max_leave_days_per_month: 30, tax_tiers: [{threshold: 402, rate: 0}, {threshold: 110, rate: 5}] }) }
  ]);
};
