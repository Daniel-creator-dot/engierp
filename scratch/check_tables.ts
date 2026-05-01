import knex from 'knex';

const connectionString = 'postgresql://postgres.udajgnvqizrnluldmnni:Daniel@24419000@aws-0-eu-west-1.pooler.supabase.com:5432/postgres';

const db = knex({
  client: 'postgresql',
  connection: {
    connectionString,
    ssl: { rejectUnauthorized: false }
  }
});

async function check() {
  try {
    const tables = ['users', 'employees', 'settings', 'sms_configurations', 'payroll', 'leave_requests', 'appraisals'];
    for (const table of tables) {
      const exists = await db.schema.hasTable(table);
      console.log(`Table '${table}' exists: ${exists}`);
    }
  } catch (e) {
    console.error('ERROR:', e.message);
  } finally {
    await db.destroy();
  }
}

check();
