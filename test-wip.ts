import knex from 'knex';
import config from './knexfile';
const db = knex((config as any).development);

async function run() {
  try {
    const projects = await db('projects')
      .select('projects.*', 'contracts.value as contract_value')
      .leftJoin('contracts', 'projects.id', 'contracts.project_id')
      .where('projects.status', 'In Progress');
    console.log("projects query success", projects);
    for (const project of projects) {
       const costRes = await db('ledger_entries')
        .join('journal_entries', 'ledger_entries.journal_id', 'journal_entries.id')
        .join('chart_of_accounts', 'ledger_entries.account_id', 'chart_of_accounts.id')
        .where('journal_entries.project_id', project.id)
        .where('chart_of_accounts.type', 'Expense')
        .sum(db.raw('debit - credit as total'))
        .first();
       console.log("costRes query success", costRes);
    }
  } catch(e) {
    console.error("DB Error:", e);
  } finally {
    process.exit(0);
  }
}
run();
