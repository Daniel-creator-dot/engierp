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

  // Seed Financial Data (Ledger v3)
  const bankAcc = await knex('chart_of_accounts').where('code', '1002').first();
  const revenueAcc = await knex('chart_of_accounts').where('code', '4001').first();
  const materialsAcc = await knex('chart_of_accounts').where('code', '5002').first();
  const rentAcc = await knex('chart_of_accounts').where('code', '5100').first();

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
    { key: 'companyName', value: 'EngiCorp Solutions' },
    { key: 'payroll_config', value: JSON.stringify({ ssnit_employee: 5.5, max_leave_days_per_month: 30, tax_tiers: [{threshold: 402, rate: 0}, {threshold: 110, rate: 5}] }) }
  ]);
};
